"""Balance hídrico de la zona radicular (método FAO-56 simplificado).

Convenciones: theta = contenido volumétrico de agua (m³/m³); láminas en mm;
tiempos en horas. El modelo es de UN solo depósito (zona radicular).
"""

import math
from dataclasses import dataclass

from .kpis import vpd_kpa
from .soils import Soil

LAMBDA_J_PER_KG = 2.45e6        # calor latente de vaporización
LUX_PER_WM2 = 110.0             # luz solar: ~110 lux por W/m² de radiación global
PRIESTLEY_TAYLOR_ALPHA = 1.26
DRAIN_TAU_H = 3.0               # el exceso sobre capacidad de campo drena con esta constante


def pressure_kpa(altitude_m: float) -> float:
    return 101.3 * ((293.0 - 0.0065 * altitude_m) / 293.0) ** 5.26


def et0_mm_h(air_t: float, air_rh: float | None, lux: float | None, altitude_m: float = 0.0) -> float:
    """ET de referencia horaria estimada con los sensores del prototipo.

    Priestley-Taylor con radiación inferida de los lux (BH1750) + un pequeño término
    aerodinámico por VPD. Es una estimación: el factor `et_scale` que ajusta el twin
    con los datos reales corrige el sesgo de la maceta/invernadero concreto.
    """
    lux = 0.0 if lux is None else min(max(lux, 0.0), 65535.0)
    rs = lux / LUX_PER_WM2                       # W/m²
    rn = 0.7 * rs
    es_slope = 4098.0 * 0.6108 * math.exp(17.27 * air_t / (air_t + 237.3)) / (air_t + 237.3) ** 2
    gamma = 0.000665 * pressure_kpa(altitude_m)
    rad = PRIESTLEY_TAYLOR_ALPHA * es_slope / (es_slope + gamma) * rn * 3600.0 / LAMBDA_J_PER_KG
    vpd = vpd_kpa(air_t, air_rh if air_rh is not None else 70.0) or 0.0
    return max(0.0, rad + 0.03 * vpd)


@dataclass(frozen=True)
class SoilWater:
    theta: float
    aw_pct: float          # agua útil disponible, % (100 = capacidad de campo)
    taw_mm: float
    raw_mm: float          # agua fácilmente aprovechable
    dr_mm: float           # agotamiento actual
    ks: float              # coeficiente de estrés hídrico (1 = sin estrés)
    needs_irrigation: bool
    root_depth_cm: float


def ks_coef(dr_mm: float, raw_mm: float, taw_mm: float) -> float:
    if dr_mm <= raw_mm:
        return 1.0
    return max(0.0, (taw_mm - dr_mm) / max(taw_mm - raw_mm, 1e-9))


def soil_water(theta: float, soil: Soil, root_depth_cm: float, p: float) -> SoilWater:
    root_mm = root_depth_cm * 10.0
    taw = (soil.theta_fc - soil.theta_wp) * root_mm
    raw = p * taw
    dr = max(0.0, (soil.theta_fc - theta) * root_mm)
    aw = (theta - soil.theta_wp) / (soil.theta_fc - soil.theta_wp) * 100.0
    ks = ks_coef(dr, raw, taw)
    return SoilWater(
        theta=theta, aw_pct=aw, taw_mm=taw, raw_mm=raw, dr_mm=dr, ks=ks,
        needs_irrigation=dr >= raw, root_depth_cm=root_depth_cm,
    )


def theta_from_pct(vwc_pct: float, soil: Soil) -> float:
    """El sensor se calibra con 0 % = seco y 100 % = suelo saturado de ESTE sustrato."""
    return vwc_pct / 100.0 * soil.theta_sat


def pct_from_theta(theta: float, soil: Soil) -> float:
    return theta / soil.theta_sat * 100.0


def step(
    theta: float, dt_h: float, *, soil: Soil, root_depth_cm: float, kc: float, p: float,
    et0_h: float, irrigation_mm: float = 0.0, rain_mm: float = 0.0, et_scale: float = 1.0,
) -> tuple[float, float, float]:
    """Avanza dt_h horas. Devuelve (theta_nuevo, etc_mm_h, ks)."""
    root_mm = root_depth_cm * 10.0
    # El agua aplicada al inicio del intervalo ya está disponible para la planta en ese intervalo
    available = min(theta + (irrigation_mm + rain_mm) / root_mm, soil.theta_sat)
    sw = soil_water(available, soil, root_depth_cm, p)
    etc = et0_h * kc * sw.ks * et_scale
    new = available - etc * dt_h / root_mm
    if new > soil.theta_fc:
        new = soil.theta_fc + (new - soil.theta_fc) * math.exp(-dt_h / DRAIN_TAU_H)
    new = min(max(new, soil.theta_wp * 0.6), soil.theta_sat)
    return new, etc, sw.ks


def fit_et_scale(
    hours: list[dict], *, soil: Soil, root_depth_cm: float, kc: float, p: float, altitude_m: float,
) -> tuple[float, str, int]:
    """Calibra el twin con los datos reales: compara cuánto se secó el suelo cada hora
    (sin riego) con lo que el modelo esperaba. Devuelve (et_scale, confianza, n_horas).

    hours: filas horarias ordenadas con claves hr (datetime), theta, pump (bool),
    air_t, air_rh, lux.
    """
    obs = mod = 0.0
    n = 0
    for a, b in zip(hours, hours[1:]):
        if (b["hr"] - a["hr"]).total_seconds() != 3600:
            continue
        if a["pump"] or b["pump"] or a["air_t"] is None or a["theta"] is None or b["theta"] is None:
            continue
        if a["theta"] > soil.theta_fc:   # por encima de capacidad de campo domina el drenaje, no la ET
            continue
        d_obs = a["theta"] - b["theta"]
        if d_obs < -0.004:               # humedecimiento no explicado (lluvia/riego manual): descartar
            continue
        # Se conservan los cambios pequeños de ambos signos: así el ruido del sensor se promedia
        # en vez de sesgar la estimación hacia arriba.
        et0 = et0_mm_h(a["air_t"], a["air_rh"], a["lux"], altitude_m)
        sw = soil_water(a["theta"], soil, root_depth_cm, p)
        d_mod = et0 * kc * sw.ks / (root_depth_cm * 10.0)
        if d_mod <= 0:
            continue
        obs += d_obs
        mod += d_mod
        n += 1
    if n < 6 or mod <= 0 or obs <= 0:
        return 1.0, "none", n
    scale = min(5.0, max(0.2, obs / mod))
    return scale, ("medium" if n >= 12 else "low"), n
