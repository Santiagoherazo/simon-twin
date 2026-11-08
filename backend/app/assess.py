"""Evaluación en vivo, recomendador de cultivos y optimizador de riego sobre el motor de ciclo de cultivo."""

from __future__ import annotations

import math
from datetime import timezone

from .cropmodel import Chem, CropEngine
from .crops import CropProfile, load_profiles
from .growth import gdd_step
from .schemas import SimulateRequest
from .simulate import SimContext, simulate
from .soils import Soil
from .waterbalance import soil_water, theta_from_pct

HISTORY_DAYS = 14


async def history_rows(pool, device_id: str, days: int = HISTORY_DAYS) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT date_trunc('hour', ts) AS hr, avg(vwc_pct) AS vwc, avg(air_t) AS air_t, avg(air_rh) AS air_rh,
               avg(lux) AS lux, avg(soil_t) AS soil_t
        FROM telemetry WHERE device_id = $1 AND ts > now() - make_interval(days => $2)
        GROUP BY 1 ORDER BY 1
        """, device_id, days)
    return [dict(r) for r in rows]


def replay(profile: CropProfile, soil: Soil, rows: list[dict], chem: Chem, *, gdd_now: float, root_cm: float) -> dict | None:
    """Pasa las lecturas reales (por hora) por el motor para estimar el daño ACUMULADO hoy."""
    usable = [r for r in rows if r["air_t"] is not None]
    if len(usable) < 2:
        return None
    eng = CropEngine(profile, soil, chem)
    span_gdd = sum(gdd_step(r["air_t"], 1.0, profile.base_c, profile.cap_c) for r in usable)
    gdd_th = max(0.0, gdd_now - span_gdd)
    gdd_eff = gdd_th
    t0 = usable[0]["hr"].timestamp()
    last_f: dict = {}
    prev_ts = t0
    for r in usable:
        ts = r["hr"].replace(tzinfo=r["hr"].tzinfo or timezone.utc).timestamp()
        dt_h = min(12.0, max(0.25, (ts - prev_ts) / 3600.0 or 1.0))
        prev_ts = ts
        idx = profile.stage_index(gdd_eff)
        vwc = r["vwc"]
        theta = theta_from_pct(vwc, soil) if vwc is not None else soil.theta_fc
        sw = soil_water(theta, soil, min(profile.stages[idx].root_depth_cm, root_cm), profile.p_depletion)
        rh = r["air_rh"] if r["air_rh"] is not None else 65.0
        lux = r["lux"] if r["lux"] is not None else 0.0
        dg = gdd_step(r["air_t"], dt_h, profile.base_c, profile.cap_c)
        gdd_th += dg
        res = eng.step(dt_h=dt_h, t_h=(ts - t0) / 3600.0, ts=ts, air_t=r["air_t"], rh=rh, lux=lux, theta=theta, ks=sw.ks,
                       gdd_th=gdd_th, gdd_eff=gdd_eff + dg, stage_idx=idx)
        gdd_eff += dg * res["dev"]
        last_f = res["factors"]
    events = []
    for e in eng.events:
        if e["code"].startswith("stage_") or e["code"] == "harvest":
            continue
        events.append({**e, "active": bool(eng._active.get(e["code"]))})
    return {
        "window_h": len(usable), "factors": {k: round(v, 3) for k, v in last_f.items()}, "events": events,
        "summary": eng.summary(gdd_th), "visual": eng.visual(last_f, gdd_th),
    }


def alerts_from_assessment(a: dict | None) -> list[dict]:
    """Alertas con causa, consecuencia y acción a partir de los eventos ACTIVOS del motor."""
    out = []
    for e in (a or {}).get("events", []):
        if not e.get("active") or e["level"] == "info":
            continue
        out.append({"code": "model_" + e["code"], "level": e["level"], "title": e["title"], "cause": e["cause"],
                    "consequence": e["consequence"], "action": e["action"],
                    "message": f"{e['title']}: {e['cause']} {e['consequence']}"})
    return out


# ------------------------------------------------------------------ recomendador ---------------

def _daily_gdd(env, profile: CropProfile) -> float:
    return sum(gdd_step(t, 1.0, profile.base_c, profile.cap_c) for t in env.air_t) / 24.0 * 24.0


def recommend(ctx: SimContext, *, irrigation_trigger: float = 65.0, mm: float = 8.0, soil_drainage: str | None = None) -> list[dict]:
    """Simula el ciclo completo de cada cultivo con las condiciones reales del dispositivo
    y ordena por rendimiento proyectado. Es una comparación relativa entre cultivos, no una promesa."""
    out = []
    for prof in load_profiles().values():
        gd = _daily_gdd(ctx.env, prof)
        if gd < 0.5:
            out.append({"crop": prof.id, "name": prof.name, "yield_pct": 0.0, "harvested": False, "days": None,
                        "verdict": "No alcanza el calor mínimo para completar el ciclo", "issues": []})
            continue
        days = math.ceil(prof.gdd["maturity"] / gd * 1.2)
        hours = min(4800.0, 24.0 * days)
        c = SimContext(profile=prof, soil=ctx.soil, vwc_pct0=ctx.vwc_pct0, gdd0=0.0, start_ts=ctx.start_ts,
                       soil_depth_cm=ctx.soil_depth_cm, pot_area_cm2=ctx.pot_area_cm2, pump_flow_ml_min=ctx.pump_flow_ml_min,
                       env=ctx.env, et_scale=ctx.et_scale, altitude_m=ctx.altitude_m, chem=ctx.chem)
        req = SimulateRequest.model_validate({
            "hours": hours, "step_minutes": 180 if hours > 1200 else 60, "weather": {"mode": "persist"},
            "auto_irrigation": {"enabled": True, "mm": mm, "trigger_aw_pct": irrigation_trigger},
            "overrides": {"drainage": soil_drainage},
        })
        r = simulate(c, req)
        m = r["summary"]["crop_model"]
        issues = [{"title": e["title"], "level": e["level"], "cause": e["cause"], "action": e["action"]}
                  for e in r["events"] if e["level"] != "info"]
        issues.sort(key=lambda e: 0 if e["level"] == "critical" else 1)
        y = m["yield_pct"] if m["harvested"] else round(m["yield_pct"] * 0.5, 1)
        verdict = ("Excelente" if y >= 70 else "Buena" if y >= 50 else "Regular" if y >= 30 else "Mala")
        out.append({
            "crop": prof.id, "name": prof.name, "category": prof.category, "yield_pct": y, "vigor_pct": m["vigor_pct"],
            "harvested": m["harvested"], "days": days if m["harvested"] else None, "dead": m["dead"],
            "yield_kg_m2": round(prof.yield_potential_kg_m2 * y / 100.0, 2), "verdict": verdict + (" (no llega a cosecha)" if not m["harvested"] else ""),
            "issues": issues[:4], "losses": m["losses"],
        })
    out.sort(key=lambda x: -x["yield_pct"])
    return out


# ------------------------------------------------------------------ afinidad con lo observado ---

def identify(rows: list[dict], soil: Soil, chem: Chem, root_cm: float, current_id: str | None = None) -> list[dict]:
    """Pasa el historial REAL por el motor de cada cultivo (a media etapa vegetativa) y ordena por qué tan bien
    lo toleran las condiciones observadas. No detecta la especie: sin sensores de la planta solo se puede decir
    qué cultivos habrían sufrido menos con este clima, riego y suelo."""
    out = []
    for prof in load_profiles().values():
        a = replay(prof, soil, rows, chem, gdd_now=0.35 * prof.gdd["maturity"], root_cm=root_cm)
        if a is None:
            continue
        sm = a["summary"]
        issues = [{"title": e["title"], "level": e["level"], "cause": e["cause"], "action": e["action"]}
                  for e in a["events"] if e["level"] != "info"]
        issues.sort(key=lambda e: 0 if e["level"] == "critical" else 1)
        score = round(sm["health_pct"], 1)
        out.append({"crop": prof.id, "name": prof.name, "category": prof.category, "score": score,
                    "health_pct": sm["health_pct"], "yield_pct": sm["yield_pct"], "dead": sm["dead"],
                    "current": prof.id == current_id, "issues": issues[:3]})
    out.sort(key=lambda x: -x["score"])
    for i, r in enumerate(out):
        r["rank"] = i + 1
    return out


# ------------------------------------------------------------------ optimizador de riego -------

TRIGGERS = [30, 40, 50, 60, 70, 80]
DOSES = [4, 8, 12, 16]


def optimize_irrigation(ctx: SimContext, base: SimulateRequest) -> dict:
    """Prueba combinaciones de «cuándo regar» (umbral de agua útil) y «cuánto» (mm) y devuelve la mejor."""
    results = []
    for trig in TRIGGERS:
        for mm in DOSES:
            req = base.model_copy(deep=True)
            req.step_minutes = max(req.step_minutes, 60 if req.hours <= 1200 else 180)
            req.auto_irrigation.enabled = True
            req.auto_irrigation.trigger_aw_pct = float(trig)
            req.auto_irrigation.mm = float(mm)
            r = simulate(ctx, req)
            m = r["summary"]["crop_model"]
            crit = sum(1 for e in r["events"] if e["level"] == "critical")
            water = r["summary"]["irrigation_total_mm"]
            score = m["yield_pct"] - 0.01 * water - 3.0 * crit      # prioriza rendimiento; desempata por agua usada
            results.append({"trigger_aw_pct": trig, "mm": mm, "yield_pct": m["yield_pct"], "vigor_pct": m["vigor_pct"],
                            "irrigation_mm": water, "critical_events": crit, "dead": m["dead"], "score": round(score, 2),
                            "hours_water_stress": r["summary"]["hours_water_stress"],
                            "waterlog_h": m["hours"]["waterlog"]})
    results.sort(key=lambda x: -x["score"])
    best = results[0]
    worst = min(results, key=lambda x: x["yield_pct"])
    return {"best": best, "top": results[:5], "worst": worst, "all": results,
            "note": "Compara estrategias de riego con el mismo clima; el mejor equilibra rendimiento, estrés hídrico y encharcamiento."}
