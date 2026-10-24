"""Crea el esquema al arrancar. Así el backend funciona en Railway/PostgreSQL gestionado,
donde no existe el docker-entrypoint-initdb.d de docker-compose."""

import logging
from pathlib import Path

import asyncpg

log = logging.getLogger("simon.migrate")

SCHEMA = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
LOCK_ID = 727_001

# Cada paso va en su propia sentencia: los agregados continuos no pueden correr dentro de una transacción.
TIMESCALE_STEPS = [
    "CREATE EXTENSION IF NOT EXISTS timescaledb",
    "SELECT create_hypertable('telemetry', 'ts', if_not_exists => TRUE, migrate_data => TRUE)",
    """CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_5m WITH (timescaledb.continuous) AS
       SELECT time_bucket('5 minutes', ts) AS bucket, device_id,
              avg(vwc_pct) AS vwc_pct, avg(soil_t) AS soil_t, avg(ph) AS ph, avg(ec) AS ec,
              avg(n) AS n, avg(p) AS p, avg(k) AS k, avg(air_t) AS air_t, avg(air_rh) AS air_rh,
              avg(vpd_kpa) AS vpd_kpa, avg(lux) AS lux, max(pump_ma) AS pump_ma_max, count(*) AS samples
       FROM telemetry GROUP BY bucket, device_id WITH NO DATA""",
    """SELECT add_continuous_aggregate_policy('telemetry_5m', start_offset => INTERVAL '1 day',
       end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)""",
    "SELECT add_retention_policy('telemetry', INTERVAL '365 days', if_not_exists => TRUE)",
]


async def migrate(pool: asyncpg.Pool) -> bool:
    """Devuelve True si además quedó activo TimescaleDB."""
    async with pool.acquire() as con:
        await con.execute("SELECT pg_advisory_lock($1)", LOCK_ID)
        try:
            await con.execute(SCHEMA)
            available = await con.fetchval("SELECT count(*) FROM pg_available_extensions WHERE name = 'timescaledb'")
            if not available:
                log.info("TimescaleDB no está disponible: se usa PostgreSQL normal")
                return False
            for step in TIMESCALE_STEPS:
                try:
                    await con.execute(step)
                except asyncpg.PostgresError as e:
                    log.warning("paso opcional de TimescaleDB omitido (%s): %s", step.split()[0:3], e)
                    return False
            return True
        finally:
            await con.execute("SELECT pg_advisory_unlock($1)", LOCK_ID)
