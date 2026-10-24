"""Grados-día, etapa fenológica y parámetros visuales de la planta."""

from datetime import date

from .crops import CropProfile


def gdd_day(tmin: float, tmax: float, base: float, cap: float) -> float:
    """Grados-día del método modificado: temperaturas acotadas a [base, cap]."""
    lo = min(max(tmin, base), cap)
    hi = min(max(tmax, base), cap)
    return (lo + hi) / 2.0 - base


def gdd_step(air_t: float, dt_h: float, base: float, cap: float) -> float:
    """Grados-día acumulados en un intervalo corto a temperatura constante."""
    return (min(max(air_t, base), cap) - base) * dt_h / 24.0


def accumulate_gdd(daily: list[tuple[date, float, float]], profile: CropProfile, total_days: int) -> float:
    """Suma los grados-día de los días con datos y rellena los días sin datos con el
    promedio de los conocidos (el twin sigue funcionando si el ESP32 estuvo caído)."""
    if not daily:
        return 0.0
    known = sum(gdd_day(tmin, tmax, profile.base_c, profile.cap_c) for _, tmin, tmax in daily)
    missing = max(0, total_days - len(daily))
    return known + (known / len(daily)) * missing


def _smooth(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def plant_visual(profile: CropProfile, gdd: float, wilt: float, health: float | None) -> dict:
    """Parámetros para dibujar la planta: altura, hojas, marchitez y órganos."""
    pv = profile.plant_visual
    idx = profile.stage_index(gdd)
    codes = [s.code for s in profile.stages]

    def reached(code: str | None) -> bool:
        return code is not None and code in codes and idx >= codes.index(code)

    height = pv.max_height_cm * _smooth(gdd / pv.height_full_gdd)
    leaves = max(0 if gdd <= 0 else 1, round(pv.max_leaves * _smooth(gdd / pv.leaves_full_gdd)))
    lai = pv.max_lai * _smooth(gdd / (pv.leaves_full_gdd * 1.2))
    return {
        "height_cm": round(height, 1),
        "leaf_count": int(leaves),
        "lai": round(lai, 2),
        "wilt": round(max(0.0, min(1.0, wilt)), 2),
        "health": None if health is None else round(max(0.0, min(1.0, health)), 2),
        "has_tassel": reached(pv.tassel_from_stage),
        "has_fruit": reached(pv.fruit_from_stage),
    }
