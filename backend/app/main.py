import asyncio
import hashlib
import json
import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import settings
from .crops import get_crop, load_profiles
from .backup import backfill, backup_loop, pending as backup_pending, pull_inbox, restore
from .backup import drain as backup_drain
from .cache import Cache, key_hash
from . import notebook as nbk
from .devcfg import DRIVER_CATALOG, DeviceConfig, load_config, pin_warnings, save_config
from .migrate import migrate, seed_device_configs
from .ingest import ensure_device, mqtt_loop, process_telemetry, telemetry_args
from .schemas import (
    DeviceCreate, DeviceUpdate, ImportBody, PumpCommand, SimOverrides, SimulateRequest, Telemetry,
)
from .simulate import simulate
from .soils import SOILS, get_soil
from .twin import TwinError, compute_state, schedule_state_publish, sim_context, take_snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("simon.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # La base puede tardar unos segundos en aceptar conexiones
    for attempt in range(10):
        try:
            app.state.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=8)
            break
        except (OSError, asyncpg.PostgresError):
            log.warning("base de datos no disponible (intento %d/10)", attempt + 1)
            await asyncio.sleep(3)
    else:
        raise RuntimeError("no se pudo conectar a la base de datos")
    await migrate(app.state.pool)
    await seed_device_configs(app.state.pool)
    app.state.mqtt = None
    app.state.twin_cache = {}
    app.state.bg_tasks = set()
    app.state.cache = Cache(settings.redis_url)
    await app.state.cache.start()
    app.state.backup = {"enabled": False}
    app.state.kernels = nbk.Kernels()
    app.state.remote_pool = None
    task = asyncio.create_task(mqtt_loop(app))
    backup_task = asyncio.create_task(backup_loop(app))
    yield
    task.cancel()
    backup_task.cancel()
    await app.state.kernels.stop_all()
    await app.state.cache.close()
    for t in list(app.state.bg_tasks):
        t.cancel()
    await app.state.pool.close()


app = FastAPI(
    title="Simón — gemelo digital del suelo", version="0.2.0", lifespan=lifespan,
    description="Ingesta de telemetría (MQTT y HTTP), estado del twin, simulación what-if y control.",
)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-API-Key", "X-Device-Key"],
)


# ------------------------------------------------------------------ seguridad -------------

def require_api_key(x_api_key: str = Header(default="")):
    if not secrets.compare_digest(x_api_key.encode(), settings.api_key.encode()):
        raise HTTPException(status_code=401, detail="API key inválida")


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _device_or_404(device_id: str):
    row = await app.state.pool.fetchrow("SELECT * FROM devices WHERE device_id = $1", device_id)
    if not row:
        raise HTTPException(404, "dispositivo desconocido")
    return row


# ------------------------------------------------------------------ utilidades ------------

@app.get("/health")
async def health():
    db_ok = True
    try:
        await app.state.pool.fetchval("SELECT 1")
    except Exception:
        db_ok = False
    cache = app.state.cache
    out = {"db": db_ok, "mqtt": app.state.mqtt is not None,
           "redis": (cache.ok if cache.enabled else None)}
    bk = dict(app.state.backup)
    if bk.get("enabled") and db_ok:
        bk["pending"] = await backup_pending(app.state.pool)
    out["backup"] = bk if bk.get("enabled") else None
    return out


@app.get("/mqtt-config")
async def mqtt_config():
    """Dirección pública del broker para los ESP32 (el firmware la consulta al arrancar y cada pocos segundos)."""
    if not settings.mqtt_public_host or not settings.mqtt_public_port:
        raise HTTPException(404, "define MQTT_PUBLIC_HOST y MQTT_PUBLIC_PORT en el backend")
    return {"host": settings.mqtt_public_host, "port": settings.mqtt_public_port}


@app.get("/crops")
async def crops():
    return [
        {"id": p.id, "name": p.name, "scientific": p.scientific, "note": p.note, "category": p.category,
         "yield_potential_kg_m2": p.yield_potential_kg_m2, "sources": p.sources,
         "stages": [{"code": s.code, "name": s.name, "gdd_start": s.gdd_start} for s in p.stages],
         "optimal": p.optimal}
        for p in load_profiles().values()
    ]


@app.get("/crops/{crop_id}/params")
async def crop_params(crop_id: str):
    """Parámetros editables del cultivo (con unidades, rangos y ayuda) para el panel de simulación."""
    from .cropmodel import param_values
    try:
        return param_values(get_crop(crop_id))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/soils")
async def soils():
    return [
        {"id": s.id, "name": s.name, "theta_sat": s.theta_sat, "theta_fc": s.theta_fc, "theta_wp": s.theta_wp}
        for s in SOILS.values()
    ]


# ------------------------------------------------------------------ dispositivos ----------

_PUBLIC_COLS = ("device_id, name, crop, soil_type, vwc_raw_dry, vwc_raw_wet, sowing_date, soil_depth_cm, "
                "pot_area_cm2, pump_flow_ml_min, online, status_ts, local_ip, local_host, fw_version, "
                "(ingest_key_hash IS NOT NULL) AS has_ingest_key")


@app.get("/devices")
async def list_devices():
    rows = await app.state.pool.fetch(f"SELECT {_PUBLIC_COLS} FROM devices ORDER BY device_id")
    return [dict(r) for r in rows]


@app.post("/devices", dependencies=[Depends(require_api_key)], status_code=201)
async def create_device(body: DeviceCreate):
    if not re.match(settings.device_id_regex, body.device_id):
        raise HTTPException(422, f"device_id debe cumplir {settings.device_id_regex}")
    try:
        get_crop(body.crop)
        get_soil(body.soil_type)
    except ValueError as e:
        raise HTTPException(422, str(e))
    try:
        await app.state.pool.execute(
            "INSERT INTO devices (device_id, name, crop, soil_type) VALUES ($1,$2,$3,$4)",
            body.device_id, body.name, body.crop, body.soil_type,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "el dispositivo ya existe")
    return {"ok": True, "device_id": body.device_id}


def _parse_sowing(value: str) -> datetime:
    try:
        d = datetime.fromisoformat(value)
    except ValueError:
        try:
            d = datetime.combine(date.fromisoformat(value), datetime.min.time())
        except ValueError:
            raise HTTPException(422, "sowing_date debe ser ISO 8601 (2026-09-25 o 2026-09-25T06:00:00Z)")
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


@app.put("/devices/{device_id}", dependencies=[Depends(require_api_key)])
async def update_device(device_id: str, body: DeviceUpdate):
    cur = await _device_or_404(device_id)
    dry = body.vwc_raw_dry if body.vwc_raw_dry is not None else cur["vwc_raw_dry"]
    wet = body.vwc_raw_wet if body.vwc_raw_wet is not None else cur["vwc_raw_wet"]
    if dry <= wet:
        raise HTTPException(422, "vwc_raw_dry debe ser mayor que vwc_raw_wet")
    try:
        if body.crop:
            get_crop(body.crop)
        if body.soil_type:
            get_soil(body.soil_type)
    except ValueError as e:
        raise HTTPException(422, str(e))
    sowing = _parse_sowing(body.sowing_date) if body.sowing_date else None
    await app.state.pool.execute(
        """
        UPDATE devices SET
          name = COALESCE($2, name), crop = COALESCE($3, crop), soil_type = COALESCE($4, soil_type),
          vwc_raw_dry = $5, vwc_raw_wet = $6, sowing_date = COALESCE($7, sowing_date),
          soil_depth_cm = COALESCE($8, soil_depth_cm), pot_area_cm2 = COALESCE($9, pot_area_cm2),
          pump_flow_ml_min = COALESCE($10, pump_flow_ml_min)
        WHERE device_id = $1
        """,
        device_id, body.name, body.crop, body.soil_type, dry, wet, sowing,
        body.soil_depth_cm, body.pot_area_cm2, body.pump_flow_ml_min,
    )
    app.state.twin_cache.clear()
    await app.state.cache.delete_prefix(f"state:{device_id}")
    await app.state.cache.delete_prefix(f"sim:{device_id}:")
    schedule_state_publish(app, device_id)
    return {"ok": True}


@app.post("/devices/{device_id}/ingest-key", dependencies=[Depends(require_api_key)])
async def new_ingest_key(device_id: str):
    """Genera la clave que el Arduino/ESP32 usa en POST /ingest/{device_id}. Se muestra UNA vez;
    en la base solo se guarda su hash. Volver a llamar invalida la anterior."""
    await _device_or_404(device_id)
    key = secrets.token_urlsafe(32)
    await app.state.pool.execute(
        "UPDATE devices SET ingest_key_hash = $2 WHERE device_id = $1", device_id, _hash_key(key)
    )
    return {"device_id": device_id, "ingest_key": key,
            "usage": f"POST /ingest/{device_id} con cabecera X-Device-Key y el JSON de telemetría"}


# ------------------------------------------------------------------ ingesta HTTP ----------

@app.post("/ingest/{device_id}", status_code=202)
async def ingest_http(device_id: str, body: Telemetry, x_device_key: str = Header(default="")):
    """Alternativa a MQTT para el Arduino/ESP32 (o para pruebas con curl)."""
    row = await app.state.pool.fetchrow(
        "SELECT ingest_key_hash FROM devices WHERE device_id = $1", device_id
    )
    if row is None:
        raise HTTPException(404, "dispositivo desconocido")
    stored = row["ingest_key_hash"]
    if stored is None or not secrets.compare_digest(_hash_key(x_device_key), stored):
        raise HTTPException(401, "clave de dispositivo inválida")
    ts = await process_telemetry(app, device_id, body)
    return {"ok": True, "stored_ts": None if ts is None else ts.isoformat()}


@app.post("/devices/{device_id}/import", dependencies=[Depends(require_api_key)])
async def import_rows(device_id: str, body: ImportBody):
    """Importación masiva de histórico (cada fila con ts). Útil para volcar la SD o un CSV."""
    if len(body.rows) > settings.import_max_rows:
        raise HTTPException(413, f"máximo {settings.import_max_rows} filas por llamada")
    dev = await ensure_device(app.state.pool, device_id)
    if dev is None:
        raise HTTPException(404, "dispositivo desconocido")
    now = time.time()
    args = []
    for i, t in enumerate(body.rows):
        if t.ts is None:
            raise HTTPException(422, f"fila {i}: falta ts")
        if t.ts > now + settings.max_clock_skew_seconds:
            raise HTTPException(422, f"fila {i}: ts en el futuro")
        ts = datetime.fromtimestamp(t.ts, tz=timezone.utc)
        args.append(telemetry_args(device_id, t, ts, dev["vwc_raw_dry"], dev["vwc_raw_wet"]))
    from .ingest import INSERT_TELEMETRY
    await app.state.pool.executemany(INSERT_TELEMETRY, args)
    app.state.twin_cache.clear()
    schedule_state_publish(app, device_id)
    return {"ok": True, "inserted": len(args)}


# ------------------------------------------------------------------ lectura ---------------

@app.get("/devices/{device_id}/latest")
async def latest_reading(device_id: str):
    async def load():
        row = await app.state.pool.fetchrow(
            "SELECT * FROM telemetry WHERE device_id = $1 ORDER BY ts DESC LIMIT 1", device_id
        )
        return dict(row) if row else None

    cache = app.state.cache
    val = await cache.get(f"latest:{device_id}")
    if val is None:
        val = await load()
        if val is None:
            raise HTTPException(404, "sin datos para ese dispositivo")
        await cache.set(f"latest:{device_id}", val, 60)      # ingest la invalida con cada lectura nueva
    return val


@app.get("/devices/{device_id}/history")
async def history(
    device_id: str,
    hours: float = Query(6, gt=0, le=24 * 30),
    bucket_seconds: int = Query(60, ge=1, le=86400),
):
    """Serie agregada por intervalos. El intervalo sube solo si el rango pediría
    más de 2000 puntos, para no enviar respuestas enormes."""
    bucket = max(bucket_seconds, int(hours * 3600 / 2000) + 1)
    return await app.state.cache.cached(
        f"hist:{device_id}:{hours}:{bucket}", settings.cache_history_ttl_s,
        lambda: _history(device_id, hours, bucket))


async def _history(device_id: str, hours: float, bucket: int):
    rows = await app.state.pool.fetch(
        """
        SELECT to_timestamp(floor(extract(epoch FROM ts)::double precision / $3::double precision) * $3::double precision) AS t,
               avg(vwc_pct) AS vwc_pct, avg(soil_t) AS soil_t, avg(ph) AS ph, avg(ec) AS ec,
               avg(n) AS n, avg(p) AS p, avg(k) AS k,
               avg(air_t) AS air_t, avg(air_rh) AS air_rh, avg(vpd_kpa) AS vpd_kpa,
               avg(lux) AS lux, max(pump_ma) AS pump_ma_max
        FROM telemetry
        WHERE device_id = $1 AND ts > now() - make_interval(hours => $2)
        GROUP BY t ORDER BY t
        """,
        device_id, hours, float(bucket),
    )
    return {"bucket_seconds": bucket, "points": [dict(r) for r in rows]}


# ------------------------------------------------------------------ twin ------------------

@app.get("/devices/{device_id}/state")
async def state(device_id: str):
    """Estado actual del gemelo (el mismo JSON que se publica en simon/<id>/state)."""
    async def produce():
        return await compute_state(app, device_id)

    try:
        return await app.state.cache.cached(f"state:{device_id}", settings.cache_state_ttl_s, produce)
    except TwinError as e:
        raise HTTPException(404 if "desconocido" in str(e) and "dispositivo" in str(e) else 422, str(e))


@app.post("/devices/{device_id}/simulate")
async def simulate_endpoint(device_id: str, body: SimulateRequest):
    """What-if: parte del estado actual del suelo (o de overrides) y proyecta la humedad,
    el estrés, la etapa y la planta bajo un clima y un plan de riego/lluvia dados."""
    cache = app.state.cache
    # La clave incluye la hora de la última lectura redondeada a 1 min: simulaciones iguales sobre el mismo estado se reutilizan
    try:
        latest = await latest_reading(device_id)
    except HTTPException:
        latest = None
    stamp = str(latest["ts"])[:16] if latest and latest.get("ts") else "x"
    key = f"sim:{device_id}:{stamp}:{key_hash(body.model_dump(mode='json'))}"
    hit = await cache.get(key)
    if hit is not None:
        return hit
    try:
        snap = await take_snapshot(app, device_id)
        ctx = sim_context(snap, body.overrides)
    except TwinError as e:
        raise HTTPException(404 if str(e) == "dispositivo desconocido" else 422, str(e))
    res = simulate(ctx, body)
    await cache.set(key, res, settings.cache_sim_ttl_s)
    return res


# ------------------------------------------------------------------ control ---------------

@app.post("/devices/{device_id}/pump", dependencies=[Depends(require_api_key)])
async def pump(device_id: str, body: PumpCommand):
    """Manda un comando de riego por MQTT. El ESP32 debe aplicar además su propia
    lógica de seguridad (tiempo máximo, corte en seco)."""
    if body.seconds > settings.pump_max_seconds:
        raise HTTPException(422, f"máximo {settings.pump_max_seconds} s por comando")
    online = await app.state.pool.fetchval("SELECT online FROM devices WHERE device_id = $1", device_id)
    if online is None:
        raise HTTPException(404, "dispositivo desconocido")
    if not online:
        raise HTTPException(409, "el dispositivo está offline")
    client = app.state.mqtt
    if client is None:
        raise HTTPException(503, "sin conexión con el broker MQTT")
    cmd = {"cmd_id": str(uuid.uuid4()), "seconds": body.seconds, "ts": time.time()}
    await client.publish(f"simon/{device_id}/cmd/pump", payload=json.dumps(cmd), qos=1)
    return cmd


@app.post("/admin/backup/backfill", dependencies=[Depends(require_api_key)])
async def backup_backfill(days: int = Query(30, ge=1, le=3650)):
    """Encola para Supabase el histórico ya guardado (los duplicados se ignoran)."""
    if not app.state.backup.get("enabled"):
        raise HTTPException(409, "el respaldo no está configurado (SUPABASE_DB_URL)")
    return {"queued": await backfill(app.state.pool, days)}


def _remote_or_409():
    if not app.state.backup.get("enabled"):
        raise HTTPException(409, "el respaldo no está configurado (SUPABASE_DB_URL)")
    if app.state.remote_pool is None:
        raise HTTPException(503, "sin conexión con Supabase por ahora")
    return app.state.remote_pool


@app.post("/admin/sync/run", dependencies=[Depends(require_api_key)])
async def sync_run():
    """Una pasada completa ahora mismo (lo mismo que hace el ciclo automático): local -> Supabase y buzón -> local."""
    remote = _remote_or_409()
    sent = 0
    while True:
        n = await backup_drain(app.state.pool, remote, settings.backup_batch)
        sent += n
        if n < settings.backup_batch:
            break
    return {"sent_to_supabase": sent, "inbox": await pull_inbox(app, remote, settings.sync_inbox_batch)}


@app.post("/admin/sync/restore", dependencies=[Depends(require_api_key)])
async def sync_restore(days: int = Query(30, ge=1, le=3650)):
    """Supabase -> base local: recupera lo que falte localmente (recuperación tras perder la base)."""
    return await restore(app, _remote_or_409(), days)


# ------------------------------------------------------------------ configuración del dispositivo ----------

@app.get("/catalog")
async def catalog():
    """Tipos de sensor y actuador disponibles (para el panel admin)."""
    return {"drivers": DRIVER_CATALOG}


@app.get("/catalog/hardware")
async def catalog_hardware():
    """Configuración lista del hardware confirmado (DHT11, suelo + DS18B20, 4 LDR, bomba y relé 2)."""
    from .devcfg import config_hardware_confirmado
    return config_hardware_confirmado().model_dump()


@app.get("/devices/{device_id}/config")
async def device_config(device_id: str, v: int | None = None, full: bool = False):
    """Lo descarga el ESP32 (solo lo activo). Con ?v=<versión que ya tiene> responde corto si no cambió.
    El panel admin pide ?full=1 para ver también lo desactivado y los indicadores."""
    cfg = await load_config(app.state.pool, device_id)
    if cfg is None:
        raise HTTPException(404, "dispositivo desconocido")
    if v is not None and v == cfg["version"] and not full:
        return {"version": cfg["version"], "unchanged": True}
    if not full:
        cfg["sensors"] = [s for s in cfg["sensors"] if s["enabled"]]
        cfg["actuators"] = [a for a in cfg["actuators"] if a["enabled"]]
        cfg.pop("indicators", None)       # los indicadores los calcula el servidor
    else:
        cfg["warnings"] = pin_warnings(DeviceConfig.model_validate({k: cfg[k] for k in ("report_interval_s", "sensors", "actuators", "indicators")}))
    return cfg


@app.put("/admin/devices/{device_id}/config", dependencies=[Depends(require_api_key)])
async def put_device_config(device_id: str, body: DeviceConfig):
    """Reemplaza sensores, actuadores e indicadores. Sube la versión; el ESP32 la aplica en ~30 s sin reflashear."""
    try:
        version = await save_config(app.state.pool, device_id, body)
    except KeyError:
        raise HTTPException(404, "dispositivo desconocido")
    app.state.twin_cache.clear()
    await app.state.cache.delete_prefix(f"state:{device_id}")
    schedule_state_publish(app, device_id)
    return {"ok": True, "version": version, "warnings": pin_warnings(body)}


class ActuatorCommand(BaseModel):
    seconds: int = Field(ge=1, le=3600)


@app.post("/devices/{device_id}/actuators/{key}/command", dependencies=[Depends(require_api_key)])
async def actuator_command(device_id: str, key: str, body: ActuatorCommand):
    """Enciende un actuador N segundos (topic simon/<id>/cmd/<key>). El firmware aplica además su tope de seguridad."""
    cfg = await load_config(app.state.pool, device_id)
    if cfg is None:
        raise HTTPException(404, "dispositivo desconocido")
    act = next((a for a in cfg["actuators"] if a["key"] == key and a["enabled"]), None)
    if act is None:
        raise HTTPException(404, "actuador desconocido o desactivado")
    if body.seconds > act["max_seconds"]:
        raise HTTPException(422, f"máximo {act['max_seconds']} s para {key}")
    online = await app.state.pool.fetchval("SELECT online FROM devices WHERE device_id = $1", device_id)
    if not online:
        raise HTTPException(409, "el dispositivo está offline")
    if app.state.mqtt is None:
        raise HTTPException(503, "sin conexión con el broker MQTT")
    cmd = {"cmd_id": str(uuid.uuid4()), "seconds": body.seconds, "ts": time.time()}
    await app.state.mqtt.publish(f"simon/{device_id}/cmd/{key}", payload=json.dumps(cmd), qos=1)
    return cmd


# ------------------------------------------------------------------ cuadernos de modelos --------

class Cell(BaseModel):
    type: str = Field(default="code", pattern="^(code|text)$")
    source: str = Field(default="", max_length=200_000)


class NotebookBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    device_id: str | None = Field(default=None, max_length=40)
    cells: list[Cell] = Field(default_factory=list, max_length=200)


class RunBody(BaseModel):
    code: str = Field(max_length=200_000)
    timeout_s: float = Field(default=60, ge=1, le=300)


def _nb_id(nb_id: str) -> str:
    if not nbk.ID_RE.match(nb_id):
        raise HTTPException(422, "id de cuaderno inválido (minúsculas, números, - y _)")
    return nb_id


async def _nb_or_404(nb_id: str):
    row = await app.state.pool.fetchrow("SELECT * FROM notebooks WHERE id=$1", _nb_id(nb_id))
    if not row:
        raise HTTPException(404, "cuaderno desconocido")
    return row


def _nb_out(row) -> dict:
    cells = row["cells"]
    if isinstance(cells, str):
        cells = json.loads(cells)
    return {"id": row["id"], "name": row["name"], "device_id": row["device_id"], "cells": cells,
            "updated_at": row["updated_at"].isoformat(), "live": bool(row["live"])}


@app.get("/admin/notebook-templates", dependencies=[Depends(require_api_key)])
async def notebook_templates():
    return [{"id": k, "name": v["name"], "cells": v["cells"]} for k, v in nbk.TEMPLATES.items()]


@app.get("/admin/notebooks", dependencies=[Depends(require_api_key)])
async def list_notebooks():
    rows = await app.state.pool.fetch("SELECT id, name, device_id, updated_at, live FROM notebooks ORDER BY updated_at DESC")
    return [{"id": r["id"], "name": r["name"], "device_id": r["device_id"], "updated_at": r["updated_at"].isoformat(), "live": r["live"]} for r in rows]


@app.get("/admin/notebooks/{nb_id}", dependencies=[Depends(require_api_key)])
async def get_notebook(nb_id: str):
    return _nb_out(await _nb_or_404(nb_id))


@app.put("/admin/notebooks/{nb_id}", dependencies=[Depends(require_api_key)])
async def put_notebook(nb_id: str, body: NotebookBody):
    row = await app.state.pool.fetchrow(
        """INSERT INTO notebooks (id, name, device_id, cells, updated_at) VALUES ($1,$2,$3,$4::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, device_id=EXCLUDED.device_id, cells=EXCLUDED.cells, updated_at=now()
           RETURNING *""",
        _nb_id(nb_id), body.name, body.device_id, json.dumps([c.model_dump() for c in body.cells]))
    return _nb_out(row)


@app.delete("/admin/notebooks/{nb_id}", dependencies=[Depends(require_api_key)])
async def delete_notebook(nb_id: str):
    await app.state.pool.execute("DELETE FROM notebooks WHERE id=$1", _nb_id(nb_id))
    await app.state.kernels.drop(nb_id)
    return {"ok": True}


async def _kernel_for(nb_id: str, device_id: str | None, restart: bool = False):
    k = app.state.kernels.get(nb_id)
    if restart or not k.alive:
        rows = await nbk.telemetry_rows(app.state.pool, device_id)
        try:
            await k.start(rows, device_id)
        except nbk.KernelError as e:
            raise HTTPException(503, str(e))
    return k


@app.post("/admin/notebooks/{nb_id}/run", dependencies=[Depends(require_api_key)])
async def run_cell(nb_id: str, body: RunBody):
    """Ejecuta una celda en el kernel del cuaderno (las variables persisten entre celdas)."""
    row = await _nb_or_404(nb_id)
    k = await _kernel_for(nb_id, row["device_id"])
    async with k.lock:
        try:
            res = await k.call({"op": "run", "code": body.code}, body.timeout_s)
        except nbk.KernelError as e:
            return {"ok": False, "stdout": "", "result": None, "error": str(e), "metrics": [], "alerts": [],
                    "figures": [], "has_predict": False, "ms": 0, "restarted": True}
    return res


@app.post("/admin/notebooks/{nb_id}/restart", dependencies=[Depends(require_api_key)])
async def restart_kernel(nb_id: str):
    """Reinicia el kernel (borra las variables y recarga las lecturas más recientes)."""
    row = await _nb_or_404(nb_id)
    k = await _kernel_for(nb_id, row["device_id"], restart=True)
    return {"ok": True, "alive": k.alive}


class DeployBody(BaseModel):
    live: bool


@app.post("/admin/notebooks/{nb_id}/deploy", dependencies=[Depends(require_api_key)])
async def deploy_notebook(nb_id: str, body: DeployBody):
    """Activa/desactiva el predict() del cuaderno sobre los datos en vivo de su dispositivo."""
    row = await _nb_or_404(nb_id)
    if body.live:
        if not row["device_id"]:
            raise HTTPException(422, "el cuaderno no tiene dispositivo asignado")
        k = app.state.kernels.get(nb_id)
        if not k.alive:
            raise HTTPException(409, "Ejecuta primero las celdas del cuaderno (el kernel debe tener predict() registrado).")
    await app.state.pool.execute("UPDATE notebooks SET live=$2 WHERE id=$1", nb_id, body.live)
    return {"ok": True, "live": body.live}


@app.post("/admin/notebooks/{nb_id}/predict", dependencies=[Depends(require_api_key)])
async def predict_with_notebook(nb_id: str, body: dict | None = None):
    """Llama a predict(row) del cuaderno con la última lectura real (o con la fila enviada)."""
    row = await _nb_or_404(nb_id)
    k = app.state.kernels.get(nb_id)
    if not k.alive:
        raise HTTPException(409, "El kernel no está activo: ejecuta primero las celdas del cuaderno.")
    r = (body or {}).get("row")
    if not r:
        rows = await nbk.telemetry_rows(app.state.pool, row["device_id"], 1)
        r = rows[-1] if rows else {}
    async with k.lock:
        try:
            res = await k.call({"op": "predict", "row": r}, 30)
        except nbk.KernelError as e:
            raise HTTPException(503, str(e))
    res["input"] = r
    return res


# ------------------------------------------------------------------ recomendador y optimizador --

class OptimizeBody(BaseModel):
    simulation: SimulateRequest = Field(default_factory=lambda: SimulateRequest(hours=24 * 90, step_minutes=180))


async def _snap_ctx(device_id: str, overrides=None):
    try:
        snap = await take_snapshot(app, device_id)
        ov = overrides or SimOverrides()
        if ov.vwc_pct is None and snap.readings.get("vwc_pct") is None:
            ov = ov.model_copy(update={"vwc_pct": 60.0})
        return sim_context(snap, ov)
    except TwinError as e:
        raise HTTPException(404 if str(e) == "dispositivo desconocido" else 422, str(e))


@app.get("/devices/{device_id}/recommend")
async def recommend_crops(device_id: str, drainage: str | None = None):
    """Qué cultivo rinde mejor con las condiciones reales de este dispositivo (simulación de ciclo completo por cultivo)."""
    from .assess import recommend

    async def produce():
        ctx = await _snap_ctx(device_id)
        ranking = await asyncio.to_thread(recommend, ctx, soil_drainage=drainage)
        return {"device_id": device_id, "basis": "clima de las últimas 48 h repetido a lo largo del ciclo", "ranking": ranking,
                "disclaimer": "Comparación relativa con parámetros de literatura general; no es una promesa de cosecha."}
    return await app.state.cache.cached(f"recommend:{device_id}:{drainage}", 120, produce)


@app.get("/devices/{device_id}/identify")
async def identify_crops(device_id: str):
    """Qué cultivos toleran mejor lo que realmente ha vivido este dispositivo (últimos 14 días de lecturas)."""
    from .assess import history_rows, identify
    from .cropmodel import Chem

    async def produce():
        snap = await take_snapshot(app, device_id)
        rows = await history_rows(app.state.pool, device_id)
        r = snap.readings
        chem = Chem(ph=r.get("ph"), ec=r.get("ec"), n=r.get("n"), p=r.get("p"), k=r.get("k"), soil_t=r.get("soil_t"))
        ranking = await asyncio.to_thread(identify, rows, snap.soil, chem, snap.dev["soil_depth_cm"], snap.profile.id)
        cur = next((x for x in ranking if x["current"]), None)
        best = ranking[0] if ranking else None
        note = None
        if cur and best and best["crop"] != cur["crop"] and best["score"] - cur["score"] >= 15:
            note = f"Con lo vivido estos días, {best['name']} ({best['score']:.0f}) habría sufrido bastante menos que {cur['name']} ({cur['score']:.0f})."
        return {"device_id": device_id, "window_h": len(rows), "ranking": ranking, "note": note,
                "disclaimer": "Afinidad de las condiciones observadas con cada cultivo; no detecta la especie plantada."}
    return await app.state.cache.cached(f"identify:{device_id}", 60, produce)


@app.post("/devices/{device_id}/optimize")
async def optimize(device_id: str, body: OptimizeBody):
    """Busca la mejor estrategia de riego (cuándo y cuánto) para el escenario dado."""
    from .assess import optimize_irrigation
    ctx = await _snap_ctx(device_id, body.simulation.overrides)
    sim = body.simulation.model_copy(deep=True)
    sim.events = [e for e in sim.events if e.type != "irrigation"]     # la estrategia de riego la decide el optimizador
    return await asyncio.to_thread(optimize_irrigation, ctx, sim)
