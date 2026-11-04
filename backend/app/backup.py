"""Respaldo en Supabase (PostgreSQL). Cada lectura guardada deja una fila en backup_outbox (misma transacción);
un proceso en segundo plano copia los lotes a Supabase con ON CONFLICT DO NOTHING y borra lo enviado.
Si Supabase o internet fallan, la cola crece y se reintenta; no se pierde nada (hasta backup_outbox_max filas)."""

import asyncio
import hashlib
import json
import logging
import secrets
import time

import asyncpg

from .config import settings

log = logging.getLogger("simon.backup")

COLS = ["ts", "device_id", "vwc_raw", "soil_t", "ph", "ec", "n", "p", "k", "air_t", "air_rh",
        "lux", "tank_ok", "pump_on", "pump_ma", "vwc_pct", "vpd_kpa"]
DEVICE_COLS = ["device_id", "name", "crop", "soil_type", "vwc_raw_dry", "vwc_raw_wet", "sowing_date",
               "soil_depth_cm", "pot_area_cm2", "pump_flow_ml_min", "created_at"]   # sin ingest_key_hash (secreto)

# RLS activado y sin políticas: la clave pública (anon) de Supabase no puede leer ni escribir estas tablas.
# El backend entra con la conexión directa de Postgres, que no pasa por RLS.
REMOTE_SCHEMA = """
CREATE TABLE IF NOT EXISTS simon_devices (
    device_id TEXT PRIMARY KEY, name TEXT, crop TEXT, soil_type TEXT,
    vwc_raw_dry INTEGER, vwc_raw_wet INTEGER, sowing_date TIMESTAMPTZ,
    soil_depth_cm DOUBLE PRECISION, pot_area_cm2 DOUBLE PRECISION, pump_flow_ml_min DOUBLE PRECISION,
    created_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS simon_telemetry (
    ts TIMESTAMPTZ NOT NULL, device_id TEXT NOT NULL REFERENCES simon_devices(device_id),
    vwc_raw INTEGER, soil_t DOUBLE PRECISION, ph DOUBLE PRECISION, ec DOUBLE PRECISION,
    n DOUBLE PRECISION, p DOUBLE PRECISION, k DOUBLE PRECISION, air_t DOUBLE PRECISION,
    air_rh DOUBLE PRECISION, lux DOUBLE PRECISION, tank_ok BOOLEAN, pump_on BOOLEAN,
    pump_ma DOUBLE PRECISION, vwc_pct DOUBLE PRECISION, vpd_kpa DOUBLE PRECISION,
    PRIMARY KEY (device_id, ts)
);
-- Buzón: lo único que la clave pública (anon) puede hacer es INSERTAR aquí (el ESP32 lo usa si cae el servidor).
-- No puede leer. El backend valida cada fila (clave del dispositivo, rangos) antes de pasarla a la base real.
CREATE TABLE IF NOT EXISTS simon_inbox (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    device_key TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE simon_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE simon_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE simon_telemetry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT INSERT ON simon_inbox TO anon;
    GRANT USAGE, SELECT ON SEQUENCE simon_inbox_id_seq TO anon;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'simon_inbox' AND policyname = 'anon_insert_inbox') THEN
      CREATE POLICY anon_insert_inbox ON simon_inbox FOR INSERT TO anon
        WITH CHECK (device_id ~ '^esp32-[0-9]{2,3}$' AND octet_length(payload::text) < 2000);
    END IF;
  END IF;
END $$;
"""

INSERT_REMOTE = (f"INSERT INTO simon_telemetry ({', '.join(COLS)}) VALUES ({', '.join(f'${i+1}' for i in range(len(COLS)))}) "
                 "ON CONFLICT (device_id, ts) DO NOTHING")
UPSERT_DEVICE = (
    f"INSERT INTO simon_devices ({', '.join(DEVICE_COLS)}) VALUES ({', '.join(f'${i+1}' for i in range(len(DEVICE_COLS)))}) "
    "ON CONFLICT (device_id) DO UPDATE SET " + ", ".join(f"{c}=EXCLUDED.{c}" for c in DEVICE_COLS[1:]) + ", synced_at = now()"
)


def enabled() -> bool:
    return bool(settings.supabase_db_url)


async def enqueue(con, device_id: str, ts) -> None:
    """Se llama dentro de la misma transacción que guarda la lectura."""
    if enabled():
        await con.execute("INSERT INTO backup_outbox (device_id, ts) VALUES ($1, $2)", device_id, ts)


async def sync_devices(local: asyncpg.Pool, remote: asyncpg.Pool) -> None:
    rows = await local.fetch(f"SELECT {', '.join(DEVICE_COLS)} FROM devices")
    if rows:
        await remote.executemany(UPSERT_DEVICE, [tuple(r[c] for c in DEVICE_COLS) for r in rows])


async def drain(local: asyncpg.Pool, remote: asyncpg.Pool, batch: int) -> int:
    """Copia un lote. Devuelve cuántas filas de la cola procesó."""
    sel = ", ".join(f"t.{c} AS {c}" for c in COLS if c not in ("ts", "device_id"))
    rows = await local.fetch(
        f"SELECT o.id, o.device_id, o.ts, (t.device_id IS NOT NULL) AS has_row, {sel} FROM backup_outbox o "
        "LEFT JOIN telemetry t ON t.device_id = o.device_id AND t.ts = o.ts ORDER BY o.id LIMIT $1", batch)
    if not rows:
        return 0
    await sync_devices(local, remote)                       # las lecturas referencian al dispositivo
    data = [tuple(r[c] for c in COLS) for r in rows if r["has_row"]]   # sin fila = ya borrada por retención: se descarta
    async with remote.acquire() as con:
        async with con.transaction():
            await con.executemany(INSERT_REMOTE, data)
    await local.execute("DELETE FROM backup_outbox WHERE id = ANY($1::bigint[])", [r["id"] for r in rows])
    return len(rows)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def pull_inbox(app, remote: asyncpg.Pool, batch: int) -> dict:
    """Supabase -> base local: lecturas que el ESP32 dejó en simon_inbox. Cada fila se valida; las inválidas se descartan.
    Las válidas entran por el mismo camino que MQTT (process_telemetry) y se borran del buzón."""
    from pydantic import ValidationError
    from .ingest import process_telemetry
    from .schemas import Telemetry

    rows = await remote.fetch("SELECT id, device_id, device_key, payload FROM simon_inbox ORDER BY id LIMIT $1", batch)
    ok = bad = 0
    keys: dict[str, str | None] = {}
    for r in rows:
        did = r["device_id"]
        try:
            if did not in keys:
                keys[did] = await app.state.pool.fetchval("SELECT ingest_key_hash FROM devices WHERE device_id = $1", did)
            stored = keys[did]
            if settings.sync_require_device_key and (
                    stored is None or not r["device_key"] or not secrets.compare_digest(hash_key(r["device_key"]), stored)):
                raise ValueError("clave de dispositivo inválida")
            payload = r["payload"]
            data = json.loads(payload) if isinstance(payload, str) else payload
            t = Telemetry.model_validate(data)
            if await process_telemetry(app, did, t) is None:
                raise ValueError("dispositivo no permitido")
            ok += 1
        except (ValueError, ValidationError, TypeError, asyncpg.exceptions.DataError) as e:
            bad += 1
            log.warning("inbox: fila %s descartada (%s)", r["id"], str(e)[:120])
    if rows:
        await remote.execute("DELETE FROM simon_inbox WHERE id = ANY($1::bigint[])", [r["id"] for r in rows])
    return {"read": len(rows), "stored": ok, "discarded": bad}


async def restore(app, remote: asyncpg.Pool, days: int) -> dict:
    """Supabase -> base local: recupera dispositivos y lecturas que falten (p. ej. tras perder o restaurar la base).
    No pisa lo que ya existe localmente."""
    from datetime import datetime, timedelta, timezone

    dev_cols = [c for c in DEVICE_COLS if c != "created_at"]
    drows = await remote.fetch(f"SELECT {', '.join(dev_cols)} FROM simon_devices")
    if drows:
        await app.state.pool.executemany(
            f"INSERT INTO devices ({', '.join(dev_cols)}) VALUES ({', '.join(f'${i+1}' for i in range(len(dev_cols)))}) ON CONFLICT DO NOTHING",
            [tuple(r[c] for c in dev_cols) for r in drows])
    total = 0
    last_ts, last_dev = datetime.now(timezone.utc) - timedelta(days=days), ""
    ins = (f"INSERT INTO telemetry ({', '.join(COLS)}) VALUES ({', '.join(f'${i+1}' for i in range(len(COLS)))}) "
           "ON CONFLICT DO NOTHING")
    while True:
        rows = await remote.fetch(
            f"SELECT {', '.join(COLS)} FROM simon_telemetry WHERE (ts, device_id) > ($1, $2) ORDER BY ts, device_id LIMIT 1000",
            last_ts, last_dev)
        if not rows:
            return {"devices": len(drows), "telemetry_read": total}
        await app.state.pool.executemany(ins, [tuple(r[c] for c in COLS) for r in rows])
        total += len(rows)
        last_ts, last_dev = rows[-1]["ts"], rows[-1]["device_id"]


async def backup_loop(app) -> None:
    app.state.backup = {"enabled": enabled(), "remote_ok": False, "last_sync": None, "last_error": None}
    if not enabled():
        return
    remote: asyncpg.Pool | None = None
    st = app.state.backup
    while True:
        try:
            if remote is None:
                # statement_cache_size=0: necesario con el pooler de Supabase (pgbouncer en modo transacción)
                remote = await asyncpg.create_pool(settings.supabase_db_url, min_size=1, max_size=2,
                                                   statement_cache_size=0, command_timeout=30)
                await remote.execute(REMOTE_SCHEMA)
                app.state.remote_pool = remote
                log.info("respaldo: conectado a Supabase")
            n = await drain(app.state.pool, remote, settings.backup_batch)
            got = await pull_inbox(app, remote, settings.sync_inbox_batch)
            if got["read"]:
                st["last_inbox"] = {**got, "at": time.time()}
                n = max(n, got["read"])
            st.update(remote_ok=True, last_error=None)
            if n:
                st["last_sync"] = time.time()
            # recorte de seguridad: si Supabase lleva días caído la cola no crece sin límite
            await app.state.pool.execute(
                "DELETE FROM backup_outbox WHERE id < (SELECT max(id) FROM backup_outbox) - $1", settings.backup_outbox_max)
            await asyncio.sleep(0 if n >= settings.backup_batch else settings.backup_interval_s)
        except asyncio.CancelledError:
            if remote:
                await remote.close()
            raise
        except Exception as e:
            st.update(remote_ok=False, last_error=str(e)[:200])
            log.warning("respaldo: %s; reintento en 30 s", e)
            if remote:
                try:
                    await remote.close()
                except Exception:
                    pass
                remote = None
                app.state.remote_pool = None
            await asyncio.sleep(30)


async def pending(pool: asyncpg.Pool) -> int:
    return await pool.fetchval("SELECT count(*) FROM (SELECT 1 FROM backup_outbox LIMIT 100001) s")


async def backfill(pool: asyncpg.Pool, days: int) -> int:
    """Encola para respaldo el histórico existente (los duplicados en Supabase se ignoran)."""
    r = await pool.execute(
        "INSERT INTO backup_outbox (device_id, ts) SELECT device_id, ts FROM telemetry WHERE ts > now() - make_interval(days => $1)", days)
    return int(r.split()[-1])
