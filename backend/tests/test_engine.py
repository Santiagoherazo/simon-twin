import math
from datetime import datetime, timedelta, timezone

import pytest

from app.crops import get_crop, load_profiles
from app.growth import gdd_day, plant_visual
from app.ingest import resolve_ts
from app.kpis import vpd_kpa, vwc_pct
from app.schemas import SimEvent, SimulateRequest, SimWeather, SimAutoIrrigation, Telemetry
from app.simulate import SimContext, seconds_to_mm, simulate, synthetic_env
from app.soils import get_soil
from app.suitability import build_alerts, evaluate, range_score
from app.waterbalance import et0_mm_h, fit_et_scale, soil_water, step, theta_from_pct


def test_vpd_known_value():
    # 25 °C y 60 % HR -> VPD ≈ 1.27 kPa
    assert vpd_kpa(25, 60) == pytest.approx(1.267, abs=0.01)
    assert vpd_kpa(None, 60) is None


def test_vwc_pct_calibration():
    assert vwc_pct(3100, 3100, 1300) == 0.0
    assert vwc_pct(1300, 3100, 1300) == 100.0
    assert vwc_pct(2200, 3100, 1300) == 50.0
    assert vwc_pct(5000, 3100, 1300) == 0.0       # fuera de rango se acota


def test_profiles_load_and_validate():
    profiles = load_profiles()
    assert {"maiz", "tomate"} <= set(profiles)
    maiz = get_crop("maiz")
    assert maiz.stage_index(0) == 0
    assert maiz.stages[maiz.stage_index(300)].code == "V6"
    assert maiz.stages[maiz.stage_index(5000)].code == "R6"
    with pytest.raises(ValueError):
        get_crop("papaya")


def test_gdd_day_modified_method():
    assert gdd_day(8, 20, 10, 30) == pytest.approx(5.0)     # tmin se sube a 10 -> (10+20)/2-10
    assert gdd_day(15, 40, 10, 30) == pytest.approx(12.5)   # tmax se baja a 30
    assert gdd_day(2, 8, 10, 30) == 0.0


def test_soil_water_thresholds():
    soil = get_soil("franco")
    p = 0.55
    full = soil_water(soil.theta_fc, soil, 30, p)
    assert full.aw_pct == pytest.approx(100.0) and full.ks == 1.0 and not full.needs_irrigation
    wp = soil_water(soil.theta_wp, soil, 30, p)
    assert wp.aw_pct == pytest.approx(0.0) and wp.ks == pytest.approx(0.0) and wp.needs_irrigation
    # justo en el umbral de agotamiento (aw = 45 %): empieza a necesitar riego
    thr_theta = soil.theta_fc - p * (soil.theta_fc - soil.theta_wp)
    at = soil_water(thr_theta, soil, 30, p)
    assert at.aw_pct == pytest.approx(45.0) and at.needs_irrigation and at.ks == pytest.approx(1.0)


def test_step_dries_irrigates_and_drains():
    soil = get_soil("franco")
    kw = dict(soil=soil, root_depth_cm=30, kc=1.0, p=0.55)
    t = soil.theta_fc
    dried, etc, ks = step(t, 1.0, et0_h=0.5, **kw)
    assert dried < t and etc == pytest.approx(0.5) and ks == 1.0
    # 0.5 mm sobre 300 mm de zona radicular = 0.00167 de theta
    assert t - dried == pytest.approx(0.5 / 300, rel=1e-6)
    wet, _, _ = step(soil.theta_wp + 0.02, 0.25, et0_h=0.0, irrigation_mm=20, **kw)
    assert wet > soil.theta_wp + 0.02
    drained, _, _ = step(soil.theta_sat, 6.0, et0_h=0.0, **kw)      # exceso sobre FC drena
    assert soil.theta_fc < drained < soil.theta_sat


def test_et0_day_night_and_magnitude():
    noon = et0_mm_h(26, 60, 50000, 1500)
    night = et0_mm_h(20, 80, 0, 1500)
    assert 0.2 < noon < 0.8
    assert 0 <= night < 0.05


def test_fit_et_scale_recovers_known_factor():
    soil, p, root, kc, alt = get_soil("franco"), 0.55, 30, 1.0, 1500.0
    start = datetime(2026, 10, 1, 0, tzinfo=timezone.utc)
    hours, theta = [], 0.26
    for i in range(24):
        env = dict(air_t=26.0, air_rh=60.0, lux=40000.0 if 6 <= i % 24 <= 18 else 0.0)
        hours.append({"hr": start + timedelta(hours=i), "theta": theta, "pump": False, **env})
        et0 = et0_mm_h(env["air_t"], env["air_rh"], env["lux"], alt)
        sw = soil_water(theta, soil, root, p)
        theta -= 1.8 * et0 * kc * sw.ks / (root * 10)       # el "mundo real" seca 1.8x lo que dice el modelo
    scale, conf, n = fit_et_scale(hours, soil=soil, root_depth_cm=root, kc=kc, p=p, altitude_m=alt)
    assert scale == pytest.approx(1.8, rel=0.05) and conf == "medium" and n >= 8


def test_fit_et_scale_is_not_biased_by_sensor_noise():
    import random
    rnd = random.Random(7)
    soil, p, root, kc, alt = get_soil("franco"), 0.55, 30, 1.0, 1500.0
    start = datetime(2026, 10, 1, 0, tzinfo=timezone.utc)
    hours, theta = [], 0.26
    for i in range(48):
        env = dict(air_t=24.0, air_rh=65.0, lux=35000.0 if 6 <= i % 24 <= 18 else 0.0)
        hours.append({"hr": start + timedelta(hours=i), "theta": theta + rnd.gauss(0, 0.0015), "pump": False, **env})
        et0 = et0_mm_h(env["air_t"], env["air_rh"], env["lux"], alt)
        theta -= 2.0 * et0 * kc * soil_water(theta, soil, root, p).ks / (root * 10)
    scale, conf, n = fit_et_scale(hours, soil=soil, root_depth_cm=root, kc=kc, p=p, altitude_m=alt)
    assert scale == pytest.approx(2.0, rel=0.2)


def test_fit_et_scale_ignores_pump_hours_and_needs_data():
    soil = get_soil("franco")
    hours = [{"hr": datetime(2026, 10, 1, i, tzinfo=timezone.utc), "theta": 0.25, "pump": True,
              "air_t": 25, "air_rh": 60, "lux": 1000} for i in range(6)]
    scale, conf, n = fit_et_scale(hours, soil=soil, root_depth_cm=30, kc=1, p=0.55, altitude_m=0)
    assert (scale, conf, n) == (1.0, "none", 0)


def test_suitability_scores_and_alerts():
    prof, soil = get_crop("maiz"), get_soil("franco")
    sw = soil_water(soil.theta_fc, soil, 60, prof.p_depletion)
    good = {"air_t": 25, "soil_t": 22, "ph": 6.4, "ec": 600, "n": 90, "p": 30, "k": 180,
            "vpd_kpa": 1.1, "lux": 40000}
    s = evaluate(good, sw, soil, prof, 2)
    assert s["overall"] == 100.0
    bad = dict(good, ph=4.5, n=10)
    s2 = evaluate(bad, sw, soil, prof, 2)
    assert s2["overall"] < 90
    ph = next(v for v in s2["variables"] if v["id"] == "ph")
    assert ph["status"] == "low"
    alerts = build_alerts(bad, sw, s2, online=True, age_s=5, pump_dry_ma=40, pump_block_ma=700, stale_s=300)
    assert any(a["code"] == "ph_low" for a in alerts)
    # de noche no se evalúa la luz
    night = evaluate(dict(good, lux=0), sw, soil, prof, 2)
    assert next(v for v in night["variables"] if v["id"] == "light")["score"] is None
    # sin sensor => n/a, no penaliza
    partial = evaluate({"air_t": 25}, None, None, prof, 0)
    assert partial["overall"] == 100.0


def test_alerts_tank_pump_and_dry_soil():
    prof, soil = get_crop("maiz"), get_soil("franco")
    sw = soil_water(soil.theta_wp + 0.01, soil, 60, prof.p_depletion)
    suit = evaluate({}, sw, soil, prof, 2)
    alerts = {a["code"]: a for a in build_alerts(
        {"tank_ok": False, "pump_on": True, "pump_ma": 5}, sw, suit,
        online=False, age_s=999, pump_dry_ma=40, pump_block_ma=700, stale_s=300)}
    assert {"tank_empty", "pump_dry_run", "water_stress_severe", "device_stale"} <= set(alerts)
    assert alerts["tank_empty"]["level"] == "critical"


def _ctx(vwc=70.0, gdd=300.0, soil="franco", crop="maiz", depth=30.0):
    return SimContext(
        profile=get_crop(crop), soil=get_soil(soil), vwc_pct0=vwc, gdd0=gdd,
        start_ts=datetime(2026, 10, 9, 12, tzinfo=timezone.utc).timestamp(),
        soil_depth_cm=depth, pot_area_cm2=400, pump_flow_ml_min=300,
        env=synthetic_env(), et_scale=1.0, altitude_m=1500,
    )


def test_simulation_dries_then_irrigation_resets_and_summary():
    ctx = _ctx(vwc=59.0)       # ≈ 100 % del agua útil (theta = fc)
    dry = simulate(ctx, SimulateRequest(hours=240, step_minutes=60))
    aw = [p["aw_pct"] for p in dry["series"]]
    assert aw[0] > 95 and aw[-1] < aw[0] - 40
    assert all(b <= a + 1e-6 for a, b in zip(aw, aw[1:]))       # solo se seca
    assert dry["summary"]["first_irrigation_due_h"] is not None
    assert dry["summary"]["hours_water_stress"] > 0
    assert dry["summary"]["growth_index"] < 1.0                 # el estrés frena el desarrollo

    auto = simulate(ctx, SimulateRequest(hours=240, step_minutes=60,
                                         auto_irrigation=SimAutoIrrigation(enabled=True, mm=25)))
    assert auto["summary"]["hours_water_stress"] == 0
    assert auto["summary"]["irrigation_total_mm"] > 0
    assert auto["summary"]["growth_index"] == pytest.approx(1.0, abs=0.01)
    assert min(p["aw_pct"] for p in auto["series"]) > 40


def test_simulation_events_and_what_if_weather():
    ctx = _ctx(vwc=40.0)
    base = simulate(ctx, SimulateRequest(hours=48, step_minutes=30))
    hot = simulate(ctx, SimulateRequest(hours=48, step_minutes=30, weather=SimWeather(temp_offset_c=6, lux_scale=1.3)))
    assert hot["summary"]["etc_total_mm"] > base["summary"]["etc_total_mm"]
    rain = simulate(ctx, SimulateRequest(hours=48, step_minutes=30, events=[SimEvent(at_hour=3, type="rain", mm=30)]))
    assert rain["summary"]["rain_total_mm"] == 30
    assert rain["series"][-1]["aw_pct"] > base["series"][-1]["aw_pct"]
    pump = simulate(ctx, SimulateRequest(hours=24, events=[SimEvent(at_hour=1, type="irrigation", seconds=60)]))
    assert pump["summary"]["irrigation_total_mm"] == pytest.approx(seconds_to_mm(60, 300, 400), abs=0.01)


def test_simulation_soil_and_crop_swap():
    def at_fc(soil_id):                  # mismo punto de partida: capacidad de campo
        s = get_soil(soil_id)
        return s.theta_fc / s.theta_sat * 100.0

    clay = simulate(_ctx(soil="arcilloso", vwc=at_fc("arcilloso")), SimulateRequest(hours=240))
    sand = simulate(_ctx(soil="arenoso", vwc=at_fc("arenoso")), SimulateRequest(hours=240))
    # el suelo arenoso retiene menos agua útil: se agota antes
    assert (sand["summary"]["first_irrigation_due_h"] or 1e9) < (clay["summary"]["first_irrigation_due_h"] or 1e9)
    tom = simulate(_ctx(crop="tomate", gdd=100, vwc=70), SimulateRequest(hours=24))
    assert tom["series"][0]["stage"] == "ES"


def test_plant_visual_grows_with_gdd_and_wilts():
    prof = get_crop("maiz")
    young, mature = plant_visual(prof, 20, 0, 1), plant_visual(prof, 900, 0, 1)
    assert young["height_cm"] < 10 < mature["height_cm"] <= prof.plant_visual.max_height_cm
    assert mature["has_tassel"] and mature["has_fruit"] and not young["has_tassel"]
    assert plant_visual(prof, 400, 0.6, 0.5)["wilt"] == 0.6


def test_resolve_ts_rules():
    now = 1_800_000_000.0
    assert resolve_ts("esp32-01", now - 10, now).timestamp() == now - 10             # reloj coherente
    assert resolve_ts("esp32-01", now - 86400, now).timestamp() == now             # un dispositivo real no puede retrodatar
    assert resolve_ts("sim-01", now - 86400, now).timestamp() == now - 86400         # el simulado sí
    assert resolve_ts("sim-01", now + 86400, now).timestamp() == now                 # nunca el futuro
    assert resolve_ts("esp32-01", None, now).timestamp() == now


def test_telemetry_schema_validation():
    assert Telemetry.model_validate({"air_t": 25, "extra": 1}).air_t == 25
    for bad in ({"air_rh": 130}, {"ph": -1}, {"vwc_raw": 99999}, {"air_t": float("nan")}):
        with pytest.raises(Exception):
            Telemetry.model_validate(bad)
    with pytest.raises(Exception):
        Telemetry.model_validate_json('{"air_t": NaN}')
