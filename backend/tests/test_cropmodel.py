"""Motor de ciclo de cultivo: cada estrés debe producir su evento, su daño y su efecto en el rendimiento."""
import math

import pytest

from app.assess import optimize_irrigation, recommend, replay
from app.cropmodel import PARAM_DOC, Chem, apply_overrides, param_values
from app.crops import get_crop, load_profiles
from app.schemas import SimulateRequest
from app.simulate import SimContext, simulate, synthetic_env
from app.soils import get_soil
from datetime import datetime, timedelta, timezone

AUTO = {"enabled": True, "mm": 8, "trigger_aw_pct": 65}
CHEM = Chem(ph=6.4, ec=900, n=90, p=40, k=250)


def run(crop="tomate", soil="franco", vwc=60, hours=24 * 120, weather=None, events=None, auto=AUTO, drainage=None, chem=CHEM, **ov):
    ctx = SimContext(profile=get_crop(crop), soil=get_soil(soil), vwc_pct0=vwc, gdd0=0, start_ts=0, soil_depth_cm=25,
                     pot_area_cm2=400, pump_flow_ml_min=300, env=synthetic_env(), chem=chem)
    req = SimulateRequest.model_validate({
        "hours": hours, "step_minutes": 120, "weather": weather or {"mode": "constant"}, "events": events or [],
        "auto_irrigation": auto, "overrides": {"drainage": drainage, **ov}})
    r = simulate(ctx, req)
    return r, r["summary"]["crop_model"], {e["code"]: e for e in r["events"]}


def test_diez_perfiles_validos():
    assert len(load_profiles()) >= 10


def test_cultivo_sano_sin_eventos_criticos():
    r, m, ev = run()
    assert m["harvested"] and m["yield_pct"] > 50
    assert not [e for e in r["events"] if e["level"] == "critical"]


def test_sequia_baja_rendimiento_y_avisa():
    _, base, _ = run()
    _, seco, ev = run(auto={"enabled": False})
    assert seco["yield_pct"] < base["yield_pct"] * 0.5
    assert "drought" in ev


def test_sobreriego_sin_drenaje_pudre_la_raiz():
    evs = [{"at_hour": h, "type": "irrigation", "mm": 20} for h in range(2, 24 * 40, 12)]
    _, m, ev = run(soil="franco_arcilloso", drainage="sin_salida", events=evs, hours=24 * 40, auto={"enabled": False}, vwc=70)
    assert "hypoxia" in ev and "root_rot" in ev
    assert m["root_health_pct"] < 50 and m["hours"]["waterlog"] > 48
    # el mismo riego con buen drenaje no pudre nada
    _, ok, ev2 = run(soil="sustrato", events=evs, hours=24 * 40, auto={"enabled": False}, vwc=50)
    assert "root_rot" not in ev2 and ok["root_health_pct"] > 90


def test_calor_en_floracion_pierde_cuajado():
    _, m, ev = run(weather={"mode": "constant", "air_t_mean": 36, "air_t_amp": 4, "rh_mean": 45})
    assert "repro_heat" in ev and m["losses"].get("floracion", 0) > 0.3


def test_frio_extremo_mata_planta_sensible():
    _, m, ev = run(weather={"mode": "constant", "air_t_mean": 3, "air_t_amp": 4})
    assert m["dead"] and ev["chilling"]["level"] == "critical"


def test_espinaca_tolera_el_frio_que_mata_al_tomate():
    w = {"mode": "constant", "air_t_mean": 5, "air_t_amp": 3}
    assert not run("espinaca", weather=w, hours=24 * 90)[1]["dead"]
    assert run("tomate", weather={"mode": "constant", "air_t_mean": 2, "air_t_amp": 3})[1]["dead"]


def test_humedad_alta_dispara_moho_y_tizon():
    _, _, ev = run(weather={"mode": "constant", "air_t_mean": 18, "air_t_amp": 3, "rh_mean": 97})
    assert "risk_botrytis" in ev and "risk_blight" in ev


def test_control_fitosanitario_reduce_el_dano():
    w = {"mode": "constant", "air_t_mean": 18, "air_t_amp": 3, "rh_mean": 97}
    _, sin, _ = run(weather=w)
    ctx_req = None
    ctx = SimContext(profile=get_crop("tomate"), soil=get_soil("franco"), vwc_pct0=60, gdd0=0, start_ts=0, soil_depth_cm=25,
                     pot_area_cm2=400, pump_flow_ml_min=300, env=synthetic_env(), chem=CHEM)
    req = SimulateRequest.model_validate({"hours": 24 * 120, "step_minutes": 120, "weather": w, "auto_irrigation": AUTO,
                                          "management": {"disease_control": 1.0}})
    con = simulate(ctx, req)["summary"]["crop_model"]
    assert con["yield_pct"] > sin["yield_pct"] and ctx_req is None


def test_salinidad_y_nutrientes_y_ph():
    _, base, _ = run()
    _, salino, ev = run(chem=Chem(ph=6.4, ec=6000, n=90, p=40, k=250))
    assert "salinity" in ev and salino["yield_pct"] < base["yield_pct"]
    _, pobre, ev = run(chem=Chem(ph=4.4, ec=900, n=8, p=40, k=250))
    assert "nutrient" in ev and "ph" in ev and pobre["yield_pct"] < base["yield_pct"] * 0.5


def test_fertilizar_corrige_la_deficiencia():
    _, pobre, _ = run(chem=Chem(ph=6.4, ec=900, n=8, p=40, k=250))
    _, abonado, _ = run(chem=Chem(ph=6.4, ec=900, n=8, p=40, k=250), events=[{"at_hour": 5, "type": "fertilize", "n": 120}])
    assert abonado["yield_pct"] > pobre["yield_pct"] + 10


def test_lechuga_espiga_con_calor():
    _, _, ev = run("lechuga", weather={"mode": "constant", "air_t_mean": 29, "air_t_amp": 4, "rh_mean": 60}, hours=24 * 120)
    assert "bolting" in ev


def test_parametros_editables_y_validados():
    p = apply_overrides(get_crop("tomate"), {"stress.heat_c": 28, "gdd.maturity": 1200})
    assert p.stress["heat_c"] == 28 and p.gdd["maturity"] == 1200
    assert get_crop("tomate").gdd["maturity"] == 1500            # el original no se toca
    with pytest.raises(ValueError):
        apply_overrides(get_crop("tomate"), {"stress.heat_c": 99})
    with pytest.raises(ValueError):
        apply_overrides(get_crop("tomate"), {"hack": 1})
    assert {v["key"] for v in param_values(get_crop("maiz"))} == set(PARAM_DOC)
    _, base, _ = run()
    _, tol, _ = run(weather={"mode": "constant", "air_t_mean": 33, "air_t_amp": 4}, crop_params={"stress.heat_c": 38, "stress.repro_heat_c": 40})
    _, nor, _ = run(weather={"mode": "constant", "air_t_mean": 33, "air_t_amp": 4})
    assert tol["yield_pct"] > nor["yield_pct"]


def test_recomendador_ordena_y_distingue():
    ctx = SimContext(profile=get_crop("tomate"), soil=get_soil("franco"), vwc_pct0=60, gdd0=0, start_ts=0, soil_depth_cm=25,
                     pot_area_cm2=400, pump_flow_ml_min=300, env=synthetic_env(t_mean=15, t_amp=4), chem=CHEM)
    r = recommend(ctx)
    ys = [x["yield_pct"] for x in r]
    assert ys == sorted(ys, reverse=True) and len(r) >= 10
    names = [x["crop"] for x in r]
    assert names.index("lechuga") < names.index("pepino")            # clima fresco favorece hojas frente a pepino


def test_optimizador_prefiere_regar_bien_que_nunca():
    ctx = SimContext(profile=get_crop("tomate"), soil=get_soil("franco"), vwc_pct0=60, gdd0=0, start_ts=0, soil_depth_cm=25,
                     pot_area_cm2=400, pump_flow_ml_min=300, env=synthetic_env(), chem=CHEM)
    out = optimize_irrigation(ctx, SimulateRequest(hours=24 * 90, step_minutes=180, weather={"mode": "constant"}))
    assert out["best"]["yield_pct"] > out["worst"]["yield_pct"] + 10 and len(out["all"]) == 24


def test_replay_historial_encharcado_detecta_dano():
    t0 = datetime(2026, 11, 1, tzinfo=timezone.utc)
    rows = [dict(hr=t0 + timedelta(hours=h), vwc=96 if h >= 12 else 60, air_t=24 + 5 * math.sin((h % 24 - 9) / 24 * 6.283),
                 air_rh=70, lux=40000 if 7 <= h % 24 <= 17 else 0, soil_t=None) for h in range(24 * 5)]
    a = replay(get_crop("tomate"), get_soil("sustrato"), rows, CHEM, gdd_now=300, root_cm=25)
    assert a and any(e["code"] == "hypoxia" and e["active"] for e in a["events"]) and a["visual"]["rot"] > 0.3
    assert replay(get_crop("tomate"), get_soil("sustrato"), rows[:1], CHEM, gdd_now=300, root_cm=25) is None


def test_identify_prefers_cool_crops_in_cold_history():
    import math
    from datetime import datetime, timedelta, timezone
    from app.assess import identify
    from app.cropmodel import Chem
    from app.soils import get_soil
    t0 = datetime(2026, 10, 20, tzinfo=timezone.utc)
    rows = [{"hr": t0 + timedelta(hours=h), "air_t": 8 + 4 * math.sin(((h % 24) - 9) / 24 * 2 * math.pi), "air_rh": 75,
             "lux": 20000.0 if 6 <= h % 24 <= 18 else 0.0, "vwc": 28.0, "soil_t": 12.0} for h in range(240)]
    r = identify(rows, get_soil("franco"), Chem(), 30, "maiz")
    names = [x["crop"] for x in r]
    assert names.index("lechuga") < names.index("pepino") and names.index("espinaca") < names.index("albahaca")
    assert [x["rank"] for x in r] == list(range(1, len(r) + 1)) and sum(x["current"] for x in r) == 1
