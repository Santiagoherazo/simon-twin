"""Ingesta: MQTT y HTTP convergen en process_telemetry(), que valida, calcula KPIs
derivados, guarda en TimescaleDB y dispara el recálculo del estado del twin."""

import asyncio
import ipaddress
import json
import math
import logging
import re
import time
from datetime import datetime, timezone

import aiomqtt
import asyncpg
from pydantic import ValidationError

from . import backup
from .config import settings
from .devcfg import KEY_RE, COLUMN_KEYS, DERIVED_KEYS, TANK_LOW_PCT, eval_formula, load_config
from .kpis import vpd_kpa, vwc_pct
from .schemas import Telemetry
from .twin import schedule_state_publish

log = logging.getLogger("simon.ingest")

TOPIC_RE = re.compile(r"^simon/([^/]+)/(telemetry|status|info)$")
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?\.local$")


def private_ipv4(value) -> str | None:
    """Solo se aceptan IPv4 de red local (10/8, 172.16/12, 192.168/16, 169.254/16).
    La web redirige a esta dirección, así que nunca debe apuntar a internet."""
    try:
        ip = ipaddress.IPv4Address(str(value).strip())
    except ValueError:
        return None
    return str(ip) if ip.is_private and not ip.is_loopback else None


def parse_info(payload: bytes) -> dict | None:
    """{"ip":"192.168.1.20","host":"simon-esp32-01.local","fw":"1.3"} -> campos validados."""
    try:
        d = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(d, dict):
        return None
    ip = private_ipv4(d.get("ip"))
    host = str(d.get("host") or "").strip().lower()
    host = host if HOST_RE.match(host) else None
    if not ip and not host:
        return None
    fw = str(d.get("fw") or "")[:20] or None
    return {"ip": ip, "host": host, "fw": fw}

DEVICE_RE = re.compile(settings.device_id_regex)

INSERT_TELEMETRY = """
INSERT INTO telemetry (ts, device_id, vwc_raw, soil_t, ph, ec, n, p, k,
                       air_t, air_rh, lux, tank_ok, pump_on, pump_ma,
                       vwc_pct, vpd_kpa, extra)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
ON CONFLICT DO NOTHING
"""


def resolve_ts(device_id: str, ts: float | None, now: float | None = None) -> datetime:
    """Decide con qué hora se guarda la lectura.

    - Sin ts, o ts incoherente con el servidor -> hora del servidor.
    - ts cercano al reloj del servidor (NTP del ESP32) -> se respeta.
    - Dispositivos simulados (prefijo sim-) pueden mandar histórico del pasado.
    - Dispositivos reales pueden vaciar su cola de hasta device_backdate_max_s (24 h por defecto) tras un corte.
    """
    now = time.time() if now is None else now
    use = now
    if ts is not None:
        if abs(ts - now) <= settings.max_clock_skew_seconds:
            use = ts
        elif (device_id.startswith(settings.backdate_prefix)
              and ts <= now + settings.max_clock_skew_seconds
              and now - ts <= settings.backdate_max_days * 86400):
            use = ts
        elif (ts <= now + settings.max_clock_skew_seconds
              and now - ts <= settings.device_backdate_max_s):
            use = ts        # cola del dispositivo tras un corte (cambio de puerto, WiFi...)
    return datetime.fromtimestamp(use, tz=timezone.utc)


async def ensure_device(pool: asyncpg.Pool, device_id: str):
    """Fila de calibración del dispositivo; lo registra si es nuevo y su id es válido."""
    sql = "SELECT vwc_raw_dry, vwc_raw_wet, config_version FROM devices WHERE device_id = $1"
    row = await pool.fetchrow(sql, device_id)
    if row:
        return row
    if not DEVICE_RE.match(device_id):
        return None
    await pool.execute("INSERT INTO devices (device_id) VALUES ($1) ON CONFLICT DO NOTHING", device_id)
    return await pool.fetchrow(sql, device_id)


def parse_telemetry(data) -> Telemetry:
    """Valida el mensaje; si algún campo está mal (fuera de rango, tipo incorrecto) se descarta SOLO ese campo
    y se conserva el resto de la lectura. Falla únicamente si el mensaje no es un objeto o queda sin nada útil."""
    if not isinstance(data, dict):
        raise ValueError("el mensaje no es un objeto JSON")
    try:
        t = Telemetry.model_validate(data)
    except ValidationError as e:
        bad = {err["loc"][0] for err in e.errors() if err["loc"]}
        clean = {k: v for k, v in data.items() if k not in bad}
        log.warning("campos inválidos descartados %s: %s", sorted(map(str, bad)), str(e.errors()[0]["msg"])[:80])
        t = Telemetry.model_validate(clean)
    if not any(getattr(t, f) is not None for f in Telemetry.model_fields if f not in ("v", "ts")) and not custom_values(t):
        raise ValueError("el mensaje no trae ningún dato útil")
    return t


def custom_values(t: Telemetry) -> dict:
    """Claves no estándar del mensaje (sensores personalizados): solo números/booleanos finitos, máx. 24."""
    out: dict = {}
    for k, v in (t.model_extra or {}).items():
        if k in COLUMN_KEYS or k in DERIVED_KEYS or not KEY_RE.match(k):
            continue
        if isinstance(v, bool) or (isinstance(v, (int, float)) and math.isfinite(v)):
            out[k] = v
        if len(out) >= 24:
            break
    return out


LUX_PER_PCT = 400.0  # aprox.: LDR al 100 % ≈ 40 000 lx. Sin calibrar: ajústalo con un luxómetro/BH1750.


def derive_lux(lux, extra: dict | None):
    """Si no llega `lux` pero sí las LDR de las esquinas (ldr_*, en %), la luz es su media × LUX_PER_PCT."""
    if lux is not None or not extra:
        return lux
    vals = [v for k, v in extra.items() if k.startswith("ldr_") and isinstance(v, (int, float)) and not isinstance(v, bool)]
    return round(sum(vals) / len(vals) * LUX_PER_PCT, 1) if vals else None


def telemetry_args(device_id: str, t: Telemetry, ts: datetime, dry: int, wet: int, extra: dict | None = None) -> tuple:
    return (
        ts, device_id, t.vwc_raw, t.soil_t, t.ph, t.ec, t.n, t.p, t.k,
        t.air_t, t.air_rh, derive_lux(t.lux, extra), t.tank_ok, t.pump_on, t.pump_ma,
        vwc_pct(t.vwc_raw, dry, wet), vpd_kpa(t.air_t, t.air_rh),
        json.dumps(extra) if extra else None,
    )


async def indicators_for(app, device_id: str, version: int) -> list[dict]:
    """Indicadores activos del dispositivo (en memoria mientras no cambie config_version)."""
    cache = app.state.__dict__.setdefault("ind_cache", {})
    hit = cache.get(device_id)
    if hit and hit[0] == version:
        return hit[1]
    cfg = await load_config(app.state.pool, device_id)
    inds = [i for i in (cfg["indicators"] if cfg else []) if i["enabled"]]
    cache[device_id] = (version, inds)
    return inds


async def process_telemetry(app, device_id: str, t: Telemetry) -> datetime | None:
    """Camino común MQTT/HTTP. Devuelve la hora con la que se guardó, o None si se descartó."""
    pool: asyncpg.Pool = app.state.pool
    dev = await ensure_device(pool, device_id)
    if dev is None:
        log.warning("telemetría ignorada: device_id no permitido (%r)", device_id)
        return None
    ts = resolve_ts(device_id, t.ts)
    async with pool.acquire() as con:
        async with con.transaction():           # lectura + cola de respaldo juntas: o quedan las dos o ninguna
            extra = custom_values(t)
            args = telemetry_args(device_id, t, ts, dev["vwc_raw_dry"], dev["vwc_raw_wet"], extra)
            inds = await indicators_for(app, device_id, dev["config_version"])
            if inds:
                env = {**t.model_dump(), **extra, "vwc_pct": args[15], "vpd_kpa": args[16]}
                for i in inds:
                    v = eval_formula(i["formula"], env)
                    if v is not None:
                        extra[i["key"]] = v
                        env[i["key"]] = v
                if t.tank_ok is None and isinstance(extra.get("tank_pct"), (int, float)):
                    # el ultrasonido mide el nivel del tanque: por debajo del umbral se dispara la alerta de tanque bajo
                    t = t.model_copy(update={"tank_ok": extra["tank_pct"] >= TANK_LOW_PCT})
                args = telemetry_args(device_id, t, ts, dev["vwc_raw_dry"], dev["vwc_raw_wet"], extra)
            await con.execute(INSERT_TELEMETRY, *args)
            await backup.enqueue(con, device_id, ts)
    cache = getattr(app.state, "cache", None)
    if cache is not None:
        await cache.delete(f"latest:{device_id}")
    if abs(time.time() - ts.timestamp()) < 120:      # solo datos "en vivo" recalculan el twin
        schedule_state_publish(app, device_id)
    return ts


async def handle_telemetry(app, device_id: str, payload: bytes) -> None:
    try:
        t = parse_telemetry(json.loads(payload))
    except (ValueError, ValidationError) as e:
        log.warning("telemetría inválida de %s: %s", device_id, str(e)[:200])
        return
    await process_telemetry(app, device_id, t)


def parse_status(payload: bytes) -> str:
    """Acepta 'online'/'offline' en texto plano o JSON tipo {"status":"online"} (como manda el firmware de pruebas)."""
    text = payload.decode("utf-8", "replace").strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
            text = str(data.get("status", data.get("online", ""))) if isinstance(data, dict) else ""
        except ValueError:
            return ""
        if text.lower() in ("true", "false"):
            text = "online" if text.lower() == "true" else "offline"
    return text.strip().strip('"').lower()


async def handle_status(app, device_id: str, payload: bytes) -> None:
    pool: asyncpg.Pool = app.state.pool
    if await ensure_device(pool, device_id) is None:
        return
    text = parse_status(payload)
    if text not in ("online", "offline"):
        log.warning("status inválido de %s: %r", device_id, text[:40])
        return
    await pool.execute(
        "UPDATE devices SET online = $2, status_ts = now() WHERE device_id = $1",
        device_id, text == "online",
    )
    schedule_state_publish(app, device_id)


async def handle_info(app, device_id: str, payload: bytes) -> None:
    pool: asyncpg.Pool = app.state.pool
    if await ensure_device(pool, device_id) is None:
        return
    info = parse_info(payload)
    if info is None:
        log.warning("info inválido de %s: %r", device_id, payload[:80])
        return
    await pool.execute(
        "UPDATE devices SET local_ip = $2, local_host = $3, fw_version = $4 WHERE device_id = $1",
        device_id, info["ip"], info["host"], info["fw"],
    )
    log.info("%s anuncia %s / %s", device_id, info["ip"], info["host"])


async def mqtt_loop(app) -> None:
    """Bucle de ingesta con reconexión automática. Si el broker cae, reintenta."""
    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_user,
                password=settings.mqtt_password,
                identifier="simon-backend",
                keepalive=30,
            ) as client:
                await client.subscribe("simon/+/telemetry", qos=1)
                await client.subscribe("simon/+/status", qos=1)
                await client.subscribe("simon/+/info", qos=1)
                app.state.mqtt = client
                log.info("conectado al broker MQTT")
                async for msg in client.messages:
                    m = TOPIC_RE.match(msg.topic.value)
                    if not m:
                        continue
                    device_id, kind = m.groups()
                    try:
                        if kind == "telemetry":
                            await handle_telemetry(app, device_id, msg.payload)
                        elif kind == "info":
                            await handle_info(app, device_id, msg.payload)
                        else:
                            await handle_status(app, device_id, msg.payload)
                    except asyncpg.PostgresError:
                        log.exception("error de base de datos al guardar %s", msg.topic.value)
                    except Exception:
                        log.exception("error procesando %s", msg.topic.value)
        except aiomqtt.MqttError as e:
            log.warning("MQTT desconectado (%s); reintentando en 5 s", e)
        finally:
            app.state.mqtt = None
        await asyncio.sleep(5)
