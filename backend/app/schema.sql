-- Esquema portable (PostgreSQL normal o TimescaleDB). Es idempotente: se aplica en cada arranque del backend.
-- Lo propio de TimescaleDB (hypertable, agregado continuo, retención) lo intenta app/migrate.py aparte.

CREATE TABLE IF NOT EXISTS devices (
    device_id     TEXT PRIMARY KEY,
    name          TEXT,
    crop          TEXT NOT NULL DEFAULT 'maiz',
    soil_type     TEXT NOT NULL DEFAULT 'franco',
    vwc_raw_dry   INTEGER NOT NULL DEFAULT 3100,
    vwc_raw_wet   INTEGER NOT NULL DEFAULT 1300,
    sowing_date      TIMESTAMPTZ,
    soil_depth_cm    DOUBLE PRECISION NOT NULL DEFAULT 30,
    pot_area_cm2     DOUBLE PRECISION NOT NULL DEFAULT 400,
    pump_flow_ml_min DOUBLE PRECISION NOT NULL DEFAULT 300,
    ingest_key_hash  TEXT,
    online        BOOLEAN NOT NULL DEFAULT FALSE,
    status_ts     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (vwc_raw_dry > vwc_raw_wet)
);

-- Dirección local del ESP32 (la anuncia él mismo en simon/<id>/info); la app la usa si cae la nube
ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_ip TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_host TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fw_version TEXT;

CREATE TABLE IF NOT EXISTS telemetry (
    ts            TIMESTAMPTZ NOT NULL,
    device_id     TEXT NOT NULL REFERENCES devices(device_id),
    vwc_raw       INTEGER,
    soil_t        DOUBLE PRECISION,
    ph            DOUBLE PRECISION,
    ec            DOUBLE PRECISION,
    n             DOUBLE PRECISION,
    p             DOUBLE PRECISION,
    k             DOUBLE PRECISION,
    air_t         DOUBLE PRECISION,
    air_rh        DOUBLE PRECISION,
    lux           DOUBLE PRECISION,
    tank_ok       BOOLEAN,
    pump_on       BOOLEAN,
    pump_ma       DOUBLE PRECISION,
    vwc_pct       DOUBLE PRECISION,
    vpd_kpa       DOUBLE PRECISION
);

-- Cola de respaldo hacia Supabase: se llena en la misma transacción que la lectura y se vacía en lotes
CREATE TABLE IF NOT EXISTS backup_outbox (
    id         BIGSERIAL PRIMARY KEY,
    device_id  TEXT NOT NULL,
    ts         TIMESTAMPTZ NOT NULL
);

-- Variables personalizadas (sensores que no son columnas) e indicadores calculados
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS extra JSONB;

-- Configuración editable del dispositivo: la descarga el ESP32 (GET /devices/<id>/config)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS report_interval_s INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS device_sensors (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    key TEXT NOT NULL, label TEXT NOT NULL, driver TEXT NOT NULL,
    pin INTEGER, param INTEGER, unit TEXT NOT NULL DEFAULT '',
    scale DOUBLE PRECISION NOT NULL DEFAULT 1, offset_v DOUBLE PRECISION NOT NULL DEFAULT 0,
    sim_min DOUBLE PRECISION, sim_max DOUBLE PRECISION, min_ok DOUBLE PRECISION, max_ok DOUBLE PRECISION,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (device_id, key)
);
CREATE TABLE IF NOT EXISTS device_actuators (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    key TEXT NOT NULL, label TEXT NOT NULL, driver TEXT NOT NULL DEFAULT 'relay',
    pin INTEGER, active_high BOOLEAN NOT NULL DEFAULT TRUE, max_seconds INTEGER NOT NULL DEFAULT 120,
    auto_variable TEXT, auto_on_below DOUBLE PRECISION, auto_on_above DOUBLE PRECISION, auto_off_at DOUBLE PRECISION,
    auto_seconds INTEGER NOT NULL DEFAULT 30, cooldown_s INTEGER NOT NULL DEFAULT 600,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (device_id, key)
);
CREATE TABLE IF NOT EXISTS device_indicators (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    key TEXT NOT NULL, label TEXT NOT NULL, formula TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
    min_ok DOUBLE PRECISION, max_ok DOUBLE PRECISION, enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (device_id, key)
);

CREATE INDEX IF NOT EXISTS telemetry_device_ts_idx ON telemetry (device_id, ts DESC);

INSERT INTO devices (device_id, name, crop, soil_type, sowing_date)
VALUES ('sim-01', 'Dispositivo virtual', 'maiz', 'franco', now() - interval '14 days')
ON CONFLICT DO NOTHING;
INSERT INTO devices (device_id, name, crop, soil_type)
VALUES ('esp32-01', 'Simón (ESP32 real)', 'maiz', 'franco')
ON CONFLICT DO NOTHING;

-- Cuadernos de modelos (panel admin > Modelos)
CREATE TABLE IF NOT EXISTS notebooks (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    device_id  TEXT,
    cells      JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS live BOOLEAN NOT NULL DEFAULT false;
