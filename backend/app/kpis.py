"""KPIs derivados que se calculan en el servidor (no en el ESP32), para poder
reprocesar el historial si cambia la fórmula o la calibración."""

import math


def svp_kpa(temp_c: float) -> float:
    """Presión de vapor de saturación (kPa), ecuación de Tetens."""
    return 0.6108 * math.exp(17.27 * temp_c / (temp_c + 237.3))


def vpd_kpa(air_t: float | None, air_rh: float | None) -> float | None:
    """Déficit de presión de vapor (kPa) a partir de temperatura y humedad del aire."""
    if air_t is None or air_rh is None:
        return None
    return round(svp_kpa(air_t) * (1 - air_rh / 100.0), 3)


def vwc_pct(raw: int | None, raw_dry: int, raw_wet: int) -> float | None:
    """Humedad relativa calibrada (0-100 %) de un sensor capacitivo.

    El sensor capacitivo da valores ADC MÁS ALTOS en seco y MÁS BAJOS en húmedo.
    raw_dry / raw_wet salen de calibrar con el sustrato real. Esto es humedad
    relativa del rango del sensor; el paso 3 la convertirá a agua útil usando la
    capacidad de campo y el punto de marchitez del tipo de suelo.
    """
    if raw is None or raw_dry <= raw_wet:
        return None
    pct = (raw_dry - raw) / (raw_dry - raw_wet) * 100.0
    return round(max(0.0, min(100.0, pct)), 1)
