-- Esquema inicial de Simón (gemelo digital del suelo). Se ejecuta una sola vez,
-- al crear el volumen de la base de datos.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Dispositivos (ESP32 reales o simulados) y su calibración / contexto agronómico
CREATE TABLE devices (
    device_id     TEXT PRIMARY KEY,
    name          TEXT,
    crop          TEXT NOT NULL DEFAULT 'maiz',   -- perfil de cultivo (paso 3)
    soil_type     TEXT NOT NULL DEFAULT 'franco', -- textura (paso 3)
    -- Calibración del sensor capacitivo (lecturas ADC de 12 bits) con TU sustrato:
    -- raw_dry = sustrato seco (0 %), raw_wet = sustrato saturado de agua (100 %).
    vwc_raw_dry   INTEGER NOT NULL DEFAULT 3100,
    vwc_raw_wet   INTEGER NOT NULL DEFAULT 1300,
    -- Contexto físico para el balance hídrico
    sowing_date      TIMESTAMPTZ,                    -- siembra/trasplante (NULL = primera lectura)
    soil_depth_cm    DOUBLE PRECISION NOT NULL DEFAULT 30,   -- profundidad útil de suelo o maceta
    pot_area_cm2     DOUBLE PRECISION NOT NULL DEFAULT 400,  -- área regada
    pump_flow_ml_min DOUBLE PRECISION NOT NULL DEFAULT 300,  -- caudal de la minibomba (medir)
    ingest_key_hash  TEXT,                           -- sha256 de la clave HTTP del dispositivo
    online        BOOLEAN NOT NULL DEFAULT FALSE,
    status_ts     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (vwc_raw_dry > vwc_raw_wet)
);

-- Telemetría cruda + KPIs derivados en el servidor
CREATE TABLE telemetry (
    ts            TIMESTAMPTZ NOT NULL,
    device_id     TEXT NOT NULL REFERENCES devices(device_id),
    -- crudos (NULL = el dispositivo no envió ese sensor)
    vwc_raw       INTEGER,
    soil_t        DOUBLE PRECISION,   -- °C temperatura del suelo
    ph            DOUBLE PRECISION,
    ec            DOUBLE PRECISION,   -- µS/cm
    n             DOUBLE PRECISION,   -- mg/kg
    p             DOUBLE PRECISION,
    k             DOUBLE PRECISION,
    air_t         DOUBLE PRECISION,   -- °C
    air_rh        DOUBLE PRECISION,   -- %
    lux           DOUBLE PRECISION,
    tank_ok       BOOLEAN,
    pump_on       BOOLEAN,
    pump_ma       DOUBLE PRECISION,
    -- derivados
    vwc_pct       DOUBLE PRECISION,   -- humedad relativa calibrada 0-100
    vpd_kpa       DOUBLE PRECISION
);

SELECT create_hypertable('telemetry', 'ts');
CREATE INDEX telemetry_device_ts_idx ON telemetry (device_id, ts DESC);

-- Agregados continuos: promedios precalculados para consultas históricas rápidas
CREATE MATERIALIZED VIEW telemetry_5m
WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', ts) AS bucket,
       device_id,
       avg(vwc_pct) AS vwc_pct,
       avg(soil_t)  AS soil_t,
       avg(ph)      AS ph,
       avg(ec)      AS ec,
       avg(n) AS n, avg(p) AS p, avg(k) AS k,
       avg(air_t)   AS air_t,
       avg(air_rh)  AS air_rh,
       avg(vpd_kpa) AS vpd_kpa,
       avg(lux)     AS lux,
       max(pump_ma) AS pump_ma_max,
       count(*)     AS samples
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_5m',
    start_offset      => INTERVAL '1 day',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- Retención: 1 año de datos crudos (los agregados se conservan)
SELECT add_retention_policy('telemetry', INTERVAL '365 days');

-- Dispositivos de ejemplo
INSERT INTO devices (device_id, name, crop, soil_type, sowing_date) VALUES
    ('sim-01',   'Dispositivo virtual', 'maiz', 'franco', now() - interval '14 days');
INSERT INTO devices (device_id, name, crop, soil_type) VALUES
    ('esp32-01', 'Simón (ESP32 real)', 'maiz', 'franco');
