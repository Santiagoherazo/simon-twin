"""Idoneidad: qué tan bien está el suelo/ambiente para el cultivo y la etapa actual."""

from .crops import CropProfile
from .soils import Soil
from .waterbalance import SoilWater

# id -> (etiqueta, unidad, clave en las lecturas)
VARIABLES: dict[str, tuple[str, str, str]] = {
    "soil_moisture": ("Humedad del suelo (agua útil)", "%", "aw_pct"),
    "air_t": ("Temperatura del aire", "°C", "air_t"),
    "soil_t": ("Temperatura del suelo", "°C", "soil_t"),
    "ph": ("pH", "", "ph"),
    "ec": ("Conductividad eléctrica", "µS/cm", "ec"),
    "n": ("Nitrógeno (N)", "mg/kg", "n"),
    "p": ("Fósforo (P)", "mg/kg", "p"),
    "k": ("Potasio (K)", "mg/kg", "k"),
    "vpd_kpa": ("Déficit de presión de vapor", "kPa", "vpd_kpa"),
    "light": ("Luz (de día)", "lx", "lux"),
}
DAYLIGHT_LUX = 2000.0


def range_score(value: float, lo: float, hi: float, margin: float | None = None) -> tuple[float, str]:
    """100 dentro del rango; baja linealmente a 0 a `margin` de distancia del borde."""
    margin = margin if margin is not None else 0.5 * (hi - lo)
    if lo <= value <= hi:
        return 100.0, "ok"
    dist = lo - value if value < lo else value - hi
    return round(max(0.0, 100.0 * (1.0 - dist / margin)), 1), ("low" if value < lo else "high")


def evaluate(
    readings: dict, sw: SoilWater | None, soil: Soil | None, profile: CropProfile, stage_idx: int,
) -> dict:
    optimal = profile.optimal_for(stage_idx)
    variables = []
    weighted = total_w = 0.0

    for var, (label, unit, key) in VARIABLES.items():
        item = {"id": var, "label": label, "unit": unit, "value": None, "score": None,
                "status": "n/a", "optimal": None}

        if var == "soil_moisture":
            if sw is None or soil is None:
                variables.append(item)
                continue
            lo = (1.0 - profile.p_depletion) * 100.0
            item.update(value=round(sw.aw_pct, 1), optimal=[round(lo, 1), 100.0])
            high_start = soil.theta_fc + 0.6 * (soil.theta_sat - soil.theta_fc)
            if sw.theta >= high_start:
                span = max(soil.theta_sat - soil.theta_fc, 1e-9)
                item.update(score=round(100.0 - 60.0 * (sw.theta - soil.theta_fc) / span, 1), status="high")
            elif sw.aw_pct > 100.0:
                item.update(score=100.0, status="ok")
            else:
                score, status = range_score(sw.aw_pct, lo, 100.0, margin=lo)
                item.update(score=score, status=status)
        else:
            value = readings.get(key)
            rng = optimal.get(var)
            if value is None or rng is None:
                variables.append(item)
                continue
            if var == "light" and value < DAYLIGHT_LUX:
                item.update(value=round(value, 1), optimal=rng, status="n/a")  # de noche no se evalúa
                variables.append(item)
                continue
            score, status = range_score(value, rng[0], rng[1])
            item.update(value=round(value, 3), optimal=rng, score=score, status=status)

        variables.append(item)
        if item["score"] is not None:
            w = profile.weight(var)
            weighted += w * item["score"]
            total_w += w

    overall = round(weighted / total_w, 1) if total_w else None
    return {"overall": overall, "variables": variables}


def build_alerts(
    readings: dict, sw: SoilWater | None, suit: dict, *, online: bool, age_s: float | None,
    pump_dry_ma: float, pump_block_ma: float, stale_s: float,
) -> list[dict]:
    alerts: list[dict] = []

    def add(code, level, message):
        alerts.append({"code": code, "level": level, "message": message})

    if not online or (age_s is not None and age_s > stale_s):
        add("device_stale", "warn", "Sin datos recientes del dispositivo; el estado puede estar desactualizado.")
    if readings.get("tank_ok") is False:
        add("tank_empty", "critical", "El tanque de agua está vacío o bajo.")
    if sw is not None:
        if sw.ks < 0.5:
            add("water_stress_severe", "critical", "Estrés hídrico severo: riega ya.")
        elif sw.needs_irrigation:
            add("needs_irrigation", "warn", "El agua útil bajó del umbral: toca regar.")
    if readings.get("pump_on"):
        ma = readings.get("pump_ma")
        if ma is not None and ma < pump_dry_ma:
            add("pump_dry_run", "critical", "La bomba está encendida sin carga (¿tanque vacío o manguera suelta?).")
        elif ma is not None and ma > pump_block_ma:
            add("pump_blocked", "critical", "Corriente de bomba muy alta: posible bloqueo.")

    names = {"soil_moisture": "humedad", "air_t": "temperatura del aire", "soil_t": "temperatura del suelo",
             "ph": "pH", "ec": "conductividad", "n": "nitrógeno", "p": "fósforo", "k": "potasio",
             "vpd_kpa": "VPD"}
    for v in suit["variables"]:
        if v["id"] in ("light",) or v["score"] is None or v["status"] in ("ok", "n/a"):
            continue
        if v["id"] == "soil_moisture" and sw is not None and (sw.needs_irrigation or v["status"] == "low"):
            continue  # ya cubierto por las alertas de riego
        level = "critical" if v["score"] < 30 else "warn"
        word = "baja" if v["status"] == "low" else "alta"
        add(f"{v['id']}_{v['status']}", level,
            f"{names.get(v['id'], v['label']).capitalize()} {word} para esta etapa "
            f"(valor {v['value']}, óptimo {v['optimal'][0]}–{v['optimal'][1]}).")
    return alerts
