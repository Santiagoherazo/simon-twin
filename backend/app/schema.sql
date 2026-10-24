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

CREATE INDEX IF NOT EXISTS telemetry_device_ts_idx ON telemetry (device_id, ts DESC);

INSERT INTO devices (device_id, name, crop, soil_type, sowing_date)
VALUES ('sim-01', 'Dispositivo virtual', 'maiz', 'franco', now() - interval '14 days')
ON CONFLICT DO NOTHING;
INSERT INTO devices (device_id, name, crop, soil_type)
VALUES ('esp32-01', 'Simón (ESP32 real)', 'maiz', 'franco')
ON CONFLICT DO NOTHING;
