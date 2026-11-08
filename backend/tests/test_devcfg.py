import asyncio, os, time
from types import SimpleNamespace
import pytest
from pydantic import ValidationError

from app.devcfg import (Actuator, DeviceConfig, Indicator, Sensor, default_config_esp32, eval_formula,
                        formula_names, pin_warnings)

LOCAL = os.getenv("TEST_PG_LOCAL")


def test_formulas_seguras():
    assert eval_formula("air_t - soil_t", {"air_t": 25.0, "soil_t": 21.5}) == 3.5
    assert eval_formula("max(a, b) * 2 + abs(-1)", {"a": 1, "b": 3}) == 7.0
    assert eval_formula("1 if x > 2 else 0", {"x": 3}) == 1.0
    assert eval_formula("a / b", {"a": 1, "b": 0}) is None          # error matemático -> None, no excepción
    assert eval_formula("a + b", {"a": 1}) is None                  # variable faltante
    assert eval_formula("9**9**9", {}) is None                      # no se cuelga con enteros gigantes
    for bad in ["__import__('os').system('ls')", "a.b", "[1,2]", "(lambda: 1)()", "open('x')", "a if b else open('x')"]:
        with pytest.raises(ValueError):
            formula_names(bad)


def test_validacion_de_configuracion():
    ok = default_config_esp32()
    assert pin_warnings(ok) == []
    with pytest.raises(ValidationError):                              # nombre repetido
        DeviceConfig(sensors=[Sensor(key="co2", label="a", driver="simulated"), Sensor(key="co2", label="b", driver="simulated")])
    with pytest.raises(ValidationError):                              # indicador con variable inexistente
        DeviceConfig(sensors=[], indicators=[Indicator(key="x1", label="x", formula="foo + 1")])
    with pytest.raises(ValidationError):                              # regla automática sobre sensor que no existe
        DeviceConfig(sensors=[], actuators=[Actuator(key="pump", label="b", pin=None, auto_variable="vwc_raw", auto_on_above=1)])
    with pytest.raises(ValidationError):                              # nombre reservado
        Sensor(key="vwc_pct", label="x", driver="simulated")
    w = pin_warnings(DeviceConfig(sensors=[
        Sensor(key="s1", label="a", driver="analog", pin=25),           # ADC2
        Sensor(key="s2", label="b", driver="analog", pin=34),
        Sensor(key="s3", label="c", driver="digital", pin=34),          # pin repetido
        Sensor(key="s4", label="d", driver="digital", pin=7),           # flash
        Sensor(key="t1", label="e", driver="dht_t", pin=4, param=22),
        Sensor(key="h1", label="f", driver="dht_h", pin=4, param=22),   # DHT comparte pin: permitido
    ], actuators=[Actuator(key="lamp", label="L", driver="relay", pin=35)]))
    text = " | ".join(w)
    assert "ADC2" in text and "ya lo usa" in text and "flash" in text and "solo de entrada" in text
    assert not any("h1" in x for x in w)


@pytest.mark.skipif(not LOCAL, reason="sin Postgres de prueba")
def test_guardar_leer_e_ingesta_con_sensor_personalizado_e_indicador():
    import asyncpg
    from app.ingest import process_telemetry
    from app.devcfg import load_config, save_config
    from app.migrate import migrate, seed_device_configs
    from app.schemas import Telemetry
    from app.twin import config_block

    async def go():
        pool = await asyncpg.create_pool(LOCAL, min_size=1, max_size=3)
        await pool.execute("DROP TABLE IF EXISTS backup_outbox, device_sensors, device_actuators, device_indicators, telemetry, devices CASCADE")
        await migrate(pool)
        await seed_device_configs(pool)
        cfg0 = await load_config(pool, "esp32-01")
        assert cfg0["version"] == 2 and len(cfg0["sensors"]) == 10 and cfg0["actuators"][0]["key"] == "pump"
        await seed_device_configs(pool)                                       # idempotente
        assert (await load_config(pool, "esp32-01"))["version"] == 2

        cfg = DeviceConfig(
            report_interval_s=5,
            sensors=[Sensor(key="air_t", label="Aire", driver="dht_t", pin=4, param=22, unit="°C"),
                     Sensor(key="soil_t", label="Suelo", driver="ds18b20", pin=5, unit="°C"),
                     Sensor(key="co2", label="CO2", driver="analog", pin=33, unit="ppm", scale=2.0, min_ok=400, max_ok=1200)],
            actuators=[Actuator(key="pump", label="Bomba", pin=26), Actuator(key="fan", label="Ventilador", driver="pwm", pin=27)],
            indicators=[Indicator(key="delta_t", label="Aire − suelo", formula="air_t - soil_t", unit="°C", min_ok=0, max_ok=6)])
        v = await save_config(pool, "esp32-01", cfg)
        assert v == 3
        got = await load_config(pool, "esp32-01")
        assert [s["key"] for s in got["sensors"]] == ["air_t", "soil_t", "co2"] and got["report_interval_s"] == 5
        assert got["sensors"][2]["scale"] == 2.0 and got["actuators"][1]["driver"] == "pwm"

        app = SimpleNamespace(state=SimpleNamespace(pool=pool, cache=None))
        t = Telemetry.model_validate({"v": 1, "ts": time.time() - 900, "air_t": 25.0, "soil_t": 21.0, "co2": 1500.0,
                                      "fan_on": True, "hack": "texto", "vwc_raw": 2200})
        assert await process_telemetry(app, "esp32-01", t) is not None
        row = await pool.fetchrow("SELECT air_t, extra FROM telemetry WHERE device_id='esp32-01'")
        import json
        extra = json.loads(row["extra"])
        assert row["air_t"] == 25.0
        assert extra == {"co2": 1500.0, "fan_on": True, "delta_t": 4.0}        # personalizado + indicador; texto descartado

        block = await config_block(pool, "esp32-01", {"pump_on": False})
        c = {x["key"]: x for x in block["custom"]}
        assert c["co2"]["value"] == 1500.0 and c["co2"]["status"] == "high"     # fuera de rango -> alerta visual
        assert c["delta_t"]["value"] == 4.0 and c["delta_t"]["status"] == "ok"
        acts = {a["key"]: a for a in block["actuators"]}
        assert acts["fan"]["on"] is True and acts["pump"]["on"] is False
        await pool.close()

    asyncio.run(go())
