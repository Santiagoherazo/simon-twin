"""Simulador what-if del suelo y la planta. Función pura (sin base de datos ni MQTT):
recibe un contexto y una solicitud, y devuelve la trayectoria."""

import math
from dataclasses import dataclass

from .crops import CropProfile
from .growth import gdd_step, plant_visual
from .schemas import SimulateRequest
from .soils import Soil
from .waterbalance import (
    et0_mm_h, pct_from_theta, soil_water, step,
)


@dataclass
class HourlyEnv:
    """Patrón diario de clima: 24 valores por hora del día (UTC)."""
    air_t: list[float]
    air_rh: list[float]
    lux: list[float]

    def at(self, hour_of_day: float) -> tuple[float, float, float]:
        h0 = int(math.floor(hour_of_day)) % 24
        h1 = (h0 + 1) % 24
        f = hour_of_day - math.floor(hour_of_day)
        lerp = lambda arr: arr[h0] * (1 - f) + arr[h1] * f  # noqa: E731
        return lerp(self.air_t), lerp(self.air_rh), lerp(self.lux)


def synthetic_env(
    *, t_mean: float = 24.0, t_amp: float = 5.0, rh_mean: float = 65.0, lux_peak: float = 45000.0,
    utc_offset_h: float = -5.0,
) -> HourlyEnv:
    """Día típico sintético: la temperatura máxima ~15:00 local, luz de 6:00 a 18:00 local."""
    air_t, air_rh, lux = [], [], []
    for h_utc in range(24):
        h = (h_utc + utc_offset_h) % 24
        t = t_mean + t_amp * math.sin(2 * math.pi * (h - 9) / 24)
        air_t.append(t)
        air_rh.append(min(98.0, max(25.0, rh_mean - 1.6 * (t - t_mean) * 2.5)))
        lux.append(lux_peak * max(0.0, math.sin(math.pi * (h - 6) / 12)) if 6 <= h <= 18 else 0.0)
    return HourlyEnv(air_t, air_rh, lux)


@dataclass
class SimContext:
    profile: CropProfile
    soil: Soil
    vwc_pct0: float
    gdd0: float
    start_ts: float
    soil_depth_cm: float
    pot_area_cm2: float
    pump_flow_ml_min: float
    env: HourlyEnv
    et_scale: float = 1.0
    altitude_m: float = 0.0


def seconds_to_mm(seconds: float, pump_flow_ml_min: float, pot_area_cm2: float) -> float:
    """Lámina equivalente (mm) de regar `seconds` con la bomba sobre el área de la maceta/mesa."""
    ml = pump_flow_ml_min * seconds / 60.0
    return ml * 10.0 / pot_area_cm2


def _modified_env(ctx: SimContext, req: SimulateRequest, t_s: float) -> tuple[float, float, float]:
    hour_of_day = ((ctx.start_ts + t_s) / 3600.0) % 24.0
    w = req.weather
    if w.mode == "constant":
        env = synthetic_env(t_mean=w.air_t_mean, t_amp=w.air_t_amp, rh_mean=w.rh_mean, lux_peak=w.lux_peak)
        air_t, rh, lux = env.at(hour_of_day)
    else:
        air_t, rh, lux = ctx.env.at(hour_of_day)
    return (
        air_t + w.temp_offset_c,
        min(100.0, max(5.0, rh + w.rh_offset)),
        max(0.0, lux * w.lux_scale),
    )


def simulate(ctx: SimContext, req: SimulateRequest) -> dict:
    soil, prof = ctx.soil, ctx.profile
    dt_h = req.step_minutes / 60.0
    n_steps = int(math.ceil(req.hours / dt_h))
    theta = ctx.vwc_pct0 / 100.0 * soil.theta_sat
    gdd_th = gdd_eff = ctx.gdd0

    # Eventos: lámina en mm (convertir segundos de bomba)
    events = []
    for e in req.events:
        mm = e.mm
        if mm is None and e.seconds is not None and e.type == "irrigation":
            mm = seconds_to_mm(e.seconds, ctx.pump_flow_ml_min, ctx.pot_area_cm2)
        if mm is None:
            continue
        events.append((e.at_hour, e.type, mm))

    series = []
    irrigations: list[dict] = []
    total_irrig = total_rain = total_etc = total_drain_est = 0.0
    hours_stress = 0.0
    min_aw = None
    first_due = None

    def snapshot(t_h, theta_, ks_, etc_, irr_mm, rain_mm, air_t_, lux_):
        idx = prof.stage_index(gdd_eff)
        root = min(prof.stages[idx].root_depth_cm, ctx.soil_depth_cm)
        sw = soil_water(theta_, soil, root, prof.p_depletion)
        ks_ = sw.ks if ks_ is None else ks_
        return {
            "t_hour": round(t_h, 3),
            "ts": ctx.start_ts + t_h * 3600.0,
            "theta": round(theta_, 4),
            "vwc_pct": round(pct_from_theta(theta_, soil), 1),
            "aw_pct": round(sw.aw_pct, 1),
            "dr_mm": round(sw.dr_mm, 1),
            "raw_mm": round(sw.raw_mm, 1),
            "taw_mm": round(sw.taw_mm, 1),
            "ks": round(ks_, 3),
            "etc_mm_h": round(etc_, 3),
            "stage": prof.stages[idx].code,
            "gdd": round(gdd_th, 1),
            "gdd_eff": round(gdd_eff, 1),
            "air_t": round(air_t_, 1),
            "lux": round(lux_, 0),
            "irrigation_mm": round(irr_mm, 2),
            "rain_mm": round(rain_mm, 2),
            "needs_irrigation": sw.needs_irrigation,
            "plant": plant_visual(prof, gdd_eff, 1.0 - sw.ks, None),
        }, sw

    # estado inicial
    t_init, _, lux_init = _modified_env(ctx, req, 0.0)
    first, sw0 = snapshot(0.0, theta, None, 0.0, 0.0, 0.0, t_init, lux_init)
    series.append(first)
    min_aw = sw0.aw_pct
    if sw0.needs_irrigation:
        first_due = 0.0

    for i in range(n_steps):
        t0 = i * dt_h
        t1 = t0 + dt_h
        t_mid_s = (t0 + dt_h / 2) * 3600.0
        air_t, rh, lux = _modified_env(ctx, req, t_mid_s)

        idx = prof.stage_index(gdd_eff)
        stage = prof.stages[idx]
        root = min(stage.root_depth_cm, ctx.soil_depth_cm)

        irr = sum(mm for at, kind, mm in events if kind == "irrigation" and t0 <= at < t1)
        rain = sum(mm for at, kind, mm in events if kind == "rain" and t0 <= at < t1)

        sw_pre = soil_water(theta, soil, root, prof.p_depletion)
        if req.auto_irrigation.enabled and sw_pre.needs_irrigation:
            irr += req.auto_irrigation.mm
            irrigations.append({"t_hour": round(t0, 2), "mm": req.auto_irrigation.mm, "auto": True})
        for at, kind, mm in events:
            if kind == "irrigation" and t0 <= at < t1:
                irrigations.append({"t_hour": round(at, 2), "mm": round(mm, 2), "auto": False})

        et0 = et0_mm_h(air_t, rh, lux, ctx.altitude_m)
        theta, etc, ks = step(
            theta, dt_h, soil=soil, root_depth_cm=root, kc=stage.kc, p=prof.p_depletion,
            et0_h=et0, irrigation_mm=irr, rain_mm=rain, et_scale=ctx.et_scale,
        )
        dg = gdd_step(air_t, dt_h, prof.base_c, prof.cap_c)
        gdd_th += dg
        gdd_eff += dg * ks

        total_irrig += irr
        total_rain += rain
        total_etc += etc * dt_h
        if ks < 1.0:
            hours_stress += dt_h

        pt, sw = snapshot(t1, theta, ks, etc, irr, rain, air_t, lux)
        series.append(pt)
        min_aw = min(min_aw, sw.aw_pct)
        if first_due is None and sw.needs_irrigation:
            first_due = t1

    last = series[-1]
    # Reducir a ≤ 600 puntos para no enviar respuestas enormes
    if len(series) > 600:
        stride = math.ceil(len(series) / 600)
        series = series[::stride] + ([last] if (len(series) - 1) % stride else [])

    return {
        "inputs": {
            "crop": prof.id, "soil_type": soil.id, "hours": req.hours, "step_minutes": req.step_minutes,
            "vwc_pct0": ctx.vwc_pct0, "gdd0": round(ctx.gdd0, 1), "et_scale": round(ctx.et_scale, 3),
            "weather": req.weather.model_dump(), "auto_irrigation": req.auto_irrigation.model_dump(),
        },
        "summary": {
            "first_irrigation_due_h": None if first_due is None else round(first_due, 2),
            "irrigations": irrigations,
            "irrigation_total_mm": round(total_irrig, 1),
            "rain_total_mm": round(total_rain, 1),
            "etc_total_mm": round(total_etc, 1),
            "min_aw_pct": round(min_aw, 1),
            "hours_water_stress": round(hours_stress, 1),
            # relación entre el desarrollo real y el térmico: <1 = el estrés frenó el crecimiento
            "growth_index": round((last["gdd_eff"] - ctx.gdd0) / max(last["gdd"] - ctx.gdd0, 1e-6), 3)
            if last["gdd"] > ctx.gdd0 else 1.0,
            "final_stage": last["stage"],
            "final_plant": last["plant"],
        },
        "series": series,
    }
