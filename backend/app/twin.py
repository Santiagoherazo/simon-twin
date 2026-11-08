"""Gemelo digital: junta lo que dicen los sensores (base de datos) con el conocimiento
del cultivo y del suelo (perfiles + balance hídrico) y produce el ESTADO del twin.

El estado se publica por MQTT en simon/<device>/state (retained) y también se expone
por REST. El simulador what-if parte del mismo snapshot."""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

from .config import settings
from .crops import CropProfile, get_crop
from .growth import accumulate_gdd, plant_visual
from .schemas import SimOverrides, SimulateRequest
from .simulate import HourlyEnv, SimContext, seconds_to_mm, simulate, synthetic_env
from .soils import Soil, get_soil
from .assess import alerts_from_assessment, history_rows, replay
from .cropmodel import FACTOR_NAMES, Chem
from .suitability import build_alerts, evaluate
from .waterbalance import fit_et_scale, soil_water, theta_from_pct

log = logging.getLogger("simon.twin")

READING_COLS = ["vwc_pct", "soil_t", "ph", "ec", "n", "p", "k", "air_t", "air_rh",
                "vpd_kpa", "lux", "tank_ok", "pump_on", "pump_ma"]
FORECAST_HOURS = 120


class TwinError(Exception):
    """Error de configuración o de datos del twin (se traduce a 4xx en la API)."""


@dataclass
class Snapshot:
    dev: asyncpg.Record
    profile: CropProfile
    soil: Soil
    readings: dict
    last_ts: datetime | None
    gdd: float
    days_since_sowing: int
    et_scale: float
    et_conf: str
    env: HourlyEnv
    env_from_data: bool


# ------------------------------------------------------------------ consultas -------------

async def load_device(pool: asyncpg.Pool, device_id: str):
    return await pool.fetchrow("SELECT * FROM devices WHERE device_id = $1", device_id)


async def latest_readings(pool: asyncpg.Pool, device_id: str) -> tuple[dict, datetime | None]:
    """Último valor NO nulo de cada sensor (los sensores pueden reportar a distinto ritmo)."""
    cols = ", ".join(
        f"(array_agg({c} ORDER BY ts DESC) FILTER (WHERE {c} IS NOT NULL))[1] AS {c}" for c in READING_COLS
    )
    sql = f"SELECT max(ts) AS ts, {cols} FROM telemetry WHERE device_id = $1 AND ts > now() - make_interval(mins => $2)"
    for window_min in (30, 60 * 24 * 30):
        row = await pool.fetchrow(sql, device_id, window_min)
        if row and row["ts"] is not None:
            return {c: row[c] for c in READING_COLS}, row["ts"]
    return {}, None


async def _gdd(pool, dev, profile: CropProfile, now: datetime) -> tuple[float, int]:
    sowing = dev["sowing_date"] or await pool.fetchval(
        "SELECT min(ts) FROM telemetry WHERE device_id = $1", dev["device_id"]
    )
    if sowing is None or sowing > now:
        return 0.0, 0
    rows = await pool.fetch(
        """
        SELECT date_trunc('day', ts)::date AS d, min(air_t) AS tmin, max(air_t) AS tmax
        FROM telemetry WHERE device_id = $1 AND ts >= $2 AND air_t IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """,
        dev["device_id"], sowing,
    )
    days = max(1, int((now - sowing).total_seconds() // 86400) + 1)
    return accumulate_gdd([(r["d"], r["tmin"], r["tmax"]) for r in rows], profile, days), days


def _fill_circular(values: list[float | None]) -> list[float] | None:
    known = [i for i, v in enumerate(values) if v is not None]
    if len(known) < 12:
        return None
    out = list(values)
    for i in range(24):
        if out[i] is not None:
            continue
        prev = next(((i - k) % 24 for k in range(1, 24) if values[(i - k) % 24] is not None))
        nxt = next(((i + k) % 24 for k in range(1, 24) if values[(i + k) % 24] is not None))
        dp = (i - prev) % 24
        dn = (nxt - i) % 24
        out[i] = (values[prev] * dn + values[nxt] * dp) / (dp + dn)
    return out  # type: ignore[return-value]


async def _env_profile(pool, device_id: str, readings: dict) -> tuple[HourlyEnv, bool]:
    rows = await pool.fetch(
        """
        SELECT extract(hour FROM ts AT TIME ZONE 'UTC')::int AS h,
               avg(air_t) AS air_t, avg(air_rh) AS air_rh, avg(lux) AS lux
        FROM telemetry WHERE device_id = $1 AND ts > now() - interval '48 hours' GROUP BY 1
        """,
        device_id,
    )
    by_h = {r["h"]: r for r in rows}
    t = _fill_circular([by_h[h]["air_t"] if h in by_h else None for h in range(24)])
    if t is not None:
        rh = _fill_circular([by_h[h]["air_rh"] if h in by_h else None for h in range(24)])
        lux = _fill_circular([by_h[h]["lux"] if h in by_h else None for h in range(24)])
        fallback = synthetic_env(utc_offset_h=settings.local_utc_offset_h)
        return HourlyEnv(t, rh or fallback.air_rh, lux or fallback.lux), True
    t_mean = readings.get("air_t")
    env = synthetic_env(
        t_mean=t_mean if t_mean is not None else 24.0,
        rh_mean=readings.get("air_rh") or 65.0,
        utc_offset_h=settings.local_utc_offset_h,
    )
    return env, False


async def _hourly_for_fit(pool, device_id: str, soil: Soil) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT date_trunc('hour', ts) AS hr, avg(vwc_pct) AS pct,
               bool_or(coalesce(pump_on, false)) AS pump,
               avg(air_t) AS air_t, avg(air_rh) AS air_rh, avg(lux) AS lux
        FROM telemetry WHERE device_id = $1 AND ts > now() - interval '48 hours'
        GROUP BY 1 ORDER BY 1
        """,
        device_id,
    )
    return [
        {"hr": r["hr"], "theta": None if r["pct"] is None else theta_from_pct(r["pct"], soil),
         "pump": r["pump"], "air_t": r["air_t"], "air_rh": r["air_rh"], "lux": r["lux"]}
        for r in rows
    ]


async def _cached(app, key: tuple, ttl: float, factory, enabled: bool = True):
    if not enabled:          # sin datos todavía: no cachear resultados vacíos
        return await factory()
    cache = app.state.twin_cache
    hit = cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = await factory()
    cache[key] = (now, value)
    return value


# ------------------------------------------------------------------ snapshot --------------

async def take_snapshot(app, device_id: str) -> Snapshot:
    pool: asyncpg.Pool = app.state.pool
    dev = await load_device(pool, device_id)
    if dev is None:
        raise TwinError("dispositivo desconocido")
    try:
        profile = get_crop(dev["crop"])
        soil = get_soil(dev["soil_type"])
    except ValueError as e:
        raise TwinError(str(e)) from e

    readings, last_ts = await latest_readings(pool, device_id)
    now = datetime.now(timezone.utc)
    has_data = last_ts is not None
    gdd, days = await _cached(app, (device_id, "gdd", dev["crop"], str(dev["sowing_date"])), 60,
                              lambda: _gdd(pool, dev, profile, now), has_data)
    env, env_from_data = await _cached(app, (device_id, "env"), 300,
                                       lambda: _env_profile(pool, device_id, readings), has_data)

    idx = profile.stage_index(gdd)
    stage = profile.stages[idx]
    root_cm = min(stage.root_depth_cm, dev["soil_depth_cm"])

    async def fit():
        hours = await _hourly_for_fit(pool, device_id, soil)
        return fit_et_scale(hours, soil=soil, root_depth_cm=root_cm, kc=stage.kc,
                            p=profile.p_depletion, altitude_m=settings.altitude_m)

    et_scale, et_conf, _n = await _cached(app, (device_id, "fit", dev["soil_type"], idx), 120, fit, has_data)
    return Snapshot(dev, profile, soil, readings, last_ts, gdd, days, et_scale, et_conf, env, env_from_data)


def sim_context(snap: Snapshot, overrides: SimOverrides | None = None, *, start_ts: float | None = None) -> SimContext:
    o = overrides or SimOverrides()
    try:
        profile = get_crop(o.crop) if o.crop else snap.profile
        soil = get_soil(o.soil_type) if o.soil_type else snap.soil
    except ValueError as e:
        raise TwinError(str(e)) from e
    vwc = o.vwc_pct if o.vwc_pct is not None else snap.readings.get("vwc_pct")
    if vwc is None:
        raise TwinError("no hay lectura de humedad del suelo; pasa overrides.vwc_pct")
    return SimContext(
        profile=profile, soil=soil, vwc_pct0=float(vwc),
        gdd0=o.gdd if o.gdd is not None else snap.gdd,
        start_ts=start_ts if start_ts is not None else time.time(),
        soil_depth_cm=o.soil_depth_cm or snap.dev["soil_depth_cm"],
        pot_area_cm2=snap.dev["pot_area_cm2"], pump_flow_ml_min=snap.dev["pump_flow_ml_min"],
        env=snap.env, et_scale=snap.et_scale, altitude_m=settings.altitude_m,
        chem=Chem(ph=snap.readings.get("ph"), ec=snap.readings.get("ec"), n=snap.readings.get("n"),
                  p=snap.readings.get("p"), k=snap.readings.get("k"), soil_t=snap.readings.get("soil_t")),
    )


# ------------------------------------------------------------------ estado ----------------

def _round(v, nd=2):
    return None if v is None else round(float(v), nd)


def _status(v, lo, hi):
    if v is None or isinstance(v, bool):
        return None
    if lo is not None and v < lo:
        return "low"
    if hi is not None and v > hi:
        return "high"
    return "ok" if (lo is not None or hi is not None) else None


async def config_block(pool, device_id: str, readings: dict) -> dict:
    """Variables personalizadas, indicadores y actuadores definidos en el panel admin, con su valor más reciente."""
    from .devcfg import COLUMN_KEYS, load_config

    cfg = await load_config(pool, device_id)
    if cfg is None:
        return {}
    row = await pool.fetchrow(
        "SELECT extra, pump_on FROM telemetry WHERE device_id = $1 AND extra IS NOT NULL ORDER BY ts DESC LIMIT 1", device_id)
    extra = {}
    if row and row["extra"]:
        extra = json.loads(row["extra"]) if isinstance(row["extra"], str) else dict(row["extra"])
    custom = []
    for s in cfg["sensors"]:
        if s["enabled"] and s["key"] not in COLUMN_KEYS:
            v = extra.get(s["key"])
            custom.append({"key": s["key"], "label": s["label"], "unit": s["unit"], "kind": "sensor", "value": v,
                           "min_ok": s["min_ok"], "max_ok": s["max_ok"], "status": _status(v, s["min_ok"], s["max_ok"])})
    for i in cfg["indicators"]:
        if i["enabled"]:
            v = extra.get(i["key"])
            custom.append({"key": i["key"], "label": i["label"], "unit": i["unit"], "kind": "indicator", "value": v,
                           "min_ok": i["min_ok"], "max_ok": i["max_ok"], "status": _status(v, i["min_ok"], i["max_ok"])})
    acts = []
    for a in cfg["actuators"]:
        if a["enabled"]:
            on = readings.get("pump_on") if a["key"] == "pump" else extra.get(f"{a['key']}_on")
            acts.append({"key": a["key"], "label": a["label"], "on": bool(on) if on is not None else None,
                         "max_seconds": a["max_seconds"]})
    return {"custom": custom, "actuators": acts, "config_version": cfg["version"]}


async def compute_state(app, device_id: str) -> dict:
    snap = await take_snapshot(app, device_id)
    dev, profile, soil, readings = snap.dev, snap.profile, snap.soil, snap.readings
    now = time.time()
    age = None if snap.last_ts is None else now - snap.last_ts.timestamp()

    state: dict = {
        "v": 1, "device_id": device_id, "ts": now, "online": dev["online"],
        "ready": snap.last_ts is not None,
        "crop": {"id": profile.id, "name": profile.name, "note": profile.note},
        "soil_type": {"id": soil.id, "name": soil.name},
        "device": {
            "soil_depth_cm": dev["soil_depth_cm"], "pot_area_cm2": dev["pot_area_cm2"],
            "pump_flow_ml_min": dev["pump_flow_ml_min"],
            "mm_per_pump_second": round(seconds_to_mm(1, dev["pump_flow_ml_min"], dev["pot_area_cm2"]), 4),
        },
    }
    if snap.last_ts is None:
        state.update(alerts=[{"code": "no_data", "level": "info", "message": "Aún no hay datos del dispositivo."}])
        return state

    idx = profile.stage_index(snap.gdd)
    stage = profile.stages[idx]
    root_cm = min(stage.root_depth_cm, dev["soil_depth_cm"])

    sw = None
    if readings.get("vwc_pct") is not None:
        sw = soil_water(theta_from_pct(readings["vwc_pct"], soil), soil, root_cm, profile.p_depletion)

    suit = evaluate(readings, sw, soil, profile, idx)
    alerts = build_alerts(
        readings, sw, suit, online=dev["online"], age_s=age,
        pump_dry_ma=settings.pump_dry_ma_max, pump_block_ma=settings.pump_block_ma_min,
        stale_s=settings.stale_seconds,
    )
    wilt = 0.0 if sw is None else 1.0 - sw.ks
    health = None if suit["overall"] is None else suit["overall"] / 100.0

    # Daño acumulado real: se reproducen las últimas 2 semanas de lecturas por el motor de ciclo de cultivo
    assessment = None
    try:
        rows = await history_rows(app.state.pool, device_id)
        chem = Chem(ph=readings.get("ph"), ec=readings.get("ec"), n=readings.get("n"), p=readings.get("p"),
                    k=readings.get("k"), soil_t=readings.get("soil_t"))
        assessment = replay(profile, soil, rows, chem, gdd_now=snap.gdd, root_cm=dev["soil_depth_cm"])
    except Exception:  # el estado básico no debe caerse por el modelo
        import logging
        logging.getLogger("simon.assess").exception("assess falló")
    alerts = alerts_from_assessment(assessment) + alerts

    prediction = None
    if sw is not None:
        ctx = sim_context(snap, start_ts=now)
        out = simulate(ctx, SimulateRequest(hours=FORECAST_HOURS, step_minutes=60))
        due = out["summary"]["first_irrigation_due_h"]
        prediction = {
            "hours_to_irrigation": due,
            "next_irrigation_ts": None if due is None else now + due * 3600.0,
            "horizon_h": FORECAST_HOURS,
            "et_scale": _round(snap.et_scale, 3),
            "et_scale_confidence": snap.et_conf,
            "forecast_basis": "patrón de las últimas 48 h" if snap.env_from_data else "día típico sintético",
        }

    state.update(
        age_s=_round(age, 1),
        readings={k: (v if isinstance(v, bool) or v is None else _round(v, 3)) for k, v in readings.items()},
        stage={
            "code": stage.code, "name": stage.name, "index": idx, "count": len(profile.stages),
            "gdd": _round(snap.gdd, 1), "progress_pct": profile.stage_progress_pct(snap.gdd),
            "days_since_sowing": snap.days_since_sowing, "kc": stage.kc, "root_depth_cm": root_cm,
        },
        soil=None if sw is None else {
            "vwc_pct": _round(readings["vwc_pct"], 1), "theta": _round(sw.theta, 4),
            "theta_sat": soil.theta_sat, "theta_fc": soil.theta_fc, "theta_wp": soil.theta_wp,
            "aw_pct": _round(sw.aw_pct, 1), "dr_mm": _round(sw.dr_mm, 1), "raw_mm": _round(sw.raw_mm, 1),
            "taw_mm": _round(sw.taw_mm, 1), "ks": _round(sw.ks, 3), "water_stress": _round(1 - sw.ks, 3),
            "needs_irrigation": sw.needs_irrigation, "root_depth_cm": root_cm,
        },
        suitability=suit,
        alerts=alerts,
        prediction=prediction,
        plant={**plant_visual(profile, snap.gdd, wilt, health), **(assessment["visual"] if assessment else {})},
        health=None if assessment is None else {
            "summary": assessment["summary"], "factors": assessment["factors"], "events": assessment["events"],
            "window_h": assessment["window_h"], "factor_names": FACTOR_NAMES,
        },
    )
    state.update(await config_block(app.state.pool, device_id, readings))
    await apply_live_models(app, device_id, state)
    return state


async def apply_live_models(app, device_id: str, state: dict) -> None:
    """Corre el predict() de los cuadernos activados: sus alertas se suman y sus 'overrides' ajustan lecturas."""
    import logging
    try:
        rows = await app.state.pool.fetch("SELECT id, name FROM notebooks WHERE live AND device_id=$1", device_id)
    except Exception:
        return
    models, extra_alerts = [], []
    for r in rows:
        k = app.state.kernels.get(r["id"])
        if not k.alive:
            models.append({"id": r["id"], "name": r["name"], "ok": False, "error": "kernel detenido: vuelve a ejecutar el cuaderno"})
            continue
        try:
            async with k.lock:
                res = await k.call({"op": "predict", "row": dict(state.get("readings") or {})}, 5)
        except Exception as e:  # incluye KernelError por tiempo agotado
            logging.getLogger("simon.models").warning("modelo %s falló: %s", r["id"], e)
            models.append({"id": r["id"], "name": r["name"], "ok": False, "error": str(e)})
            continue
        entry = {"id": r["id"], "name": r["name"], "ok": res.get("ok", False)}
        if not entry["ok"]:
            entry["error"] = res.get("error", "")[-300:]
            models.append(entry)
            continue
        out = res.get("output")
        entry["output"] = out
        ov = out.get("overrides") if isinstance(out, dict) else None
        if isinstance(ov, dict):
            applied = {}
            for key, val in ov.items():
                if isinstance(val, (int, float)) and not isinstance(val, bool) and key in (state.get("readings") or {}):
                    applied[key] = {"was": state["readings"][key], "now": _round(float(val), 3)}
                    state["readings"][key] = _round(float(val), 3)
            entry["overrides"] = applied
        for a in res.get("alerts", []):
            extra_alerts.append({"code": f"model_{r['id']}", "level": a["level"],
                                 "message": f"[{r['name']}] {a['message']}", "variable": a.get("variable")})
        models.append(entry)
    if models:
        state["models"] = models
    if extra_alerts:
        state["alerts"] = extra_alerts + state.get("alerts", [])


# ------------------------------------------------------------------ publicación -----------

_inflight: set[str] = set()
_last_pub: dict[str, float] = {}


async def publish_state(app, device_id: str) -> dict | None:
    state = await compute_state(app, device_id)
    client = app.state.mqtt
    if client is not None:
        await client.publish(f"simon/{device_id}/state", payload=json.dumps(state), qos=1, retain=True)
    return state


def schedule_state_publish(app, device_id: str) -> None:
    """Calcula y publica el estado en segundo plano, como mucho cada state_min_interval_s."""
    now = time.monotonic()
    if device_id in _inflight or now - _last_pub.get(device_id, 0.0) < settings.state_min_interval_s:
        return
    _inflight.add(device_id)

    async def run():
        try:
            await publish_state(app, device_id)
            _last_pub[device_id] = time.monotonic()
        except TwinError as e:
            log.warning("estado no calculado para %s: %s", device_id, e)
        except Exception:
            log.exception("error calculando el estado de %s", device_id)
        finally:
            _inflight.discard(device_id)

    task = asyncio.create_task(run())
    app.state.bg_tasks.add(task)
    task.add_done_callback(app.state.bg_tasks.discard)
