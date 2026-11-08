"""Motor de ciclo de cultivo: estreses, daño acumulado, enfermedades, plagas y rendimiento.

Se ejecuta paso a paso (cada 5–120 min) junto al balance hídrico. Es un modelo semi-empírico de
PROTOTIPO: cada umbral sale de literatura agronómica general (ver docs/modelo-cultivo.md) y todos
son editables por cultivo. Sirve para comparar escenarios y entender causas, no para predecir
kilos exactos de tu planta.

Convenciones: factores f ∈ [0, 1] (1 = sin estrés); índices de riesgo r ≥ 0 (r ≥ 1 = condición
cumplida el tiempo suficiente); daños d ∈ [0, 1] (permanentes o de recuperación lenta).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .crops import CropProfile
from .kpis import vpd_kpa
from .soils import Soil

LUX_TO_PPFD = 0.0185          # µmol m⁻² s⁻¹ por lux (luz solar; ~54 lux por µmol)
MAX_EVENTS = 80
_LEVEL = {"info": 0, "warn": 1, "critical": 2}

# ------------------------------------------------------------------ parámetros por categoría -----
# Cada clave está documentada en PARAM_DOC (etiqueta, unidad, ayuda y rango para el editor).
BASE = dict(
    temp_opt=[18.0, 28.0], heat_c=32.0, heat_crit_c=40.0, repro_heat_c=35.0, repro_night_c=24.0, repro_cold_c=10.0,
    cold_c=8.0, chill_c=5.0, frost_c=0.0,
    hypoxia_onset_h=48.0, root_lethal_h=96.0, waterlog_frac=0.7,
    ec_threshold_ds=2.0, ec_slope_pct=10.0, ec_factor=1.0,
    dli_min=15.0, dli_opt=25.0, tipburn_dli=0.0,
    vpd_low=0.4, vpd_high=1.5, bolt_c=0.0, long_day_h=0.0, ber=0.0, repro_drought=0.04,
    susc_botrytis=1.0, susc_blight=0.0, susc_powdery=1.0, susc_damping=1.0, susc_rootrot=1.0,
    susc_mites=1.0, susc_aphids=1.0, susc_whitefly=0.5,
)
CATEGORY = {
    "fruit": dict(ber=1.0, susc_blight=1.0, dli_min=20.0, dli_opt=30.0, repro_heat_c=34.0, ec_threshold_ds=2.5, ec_slope_pct=10.0),
    "leaf": dict(temp_opt=[12.0, 22.0], heat_c=26.0, heat_crit_c=34.0, repro_heat_c=99.0, cold_c=3.0, chill_c=0.0, frost_c=-2.0,
                 dli_min=12.0, dli_opt=17.0, bolt_c=26.0, ec_threshold_ds=1.3, ec_slope_pct=13.0,
                 vpd_low=0.4, vpd_high=1.2, susc_botrytis=1.5, repro_drought=0.0),
    "grain": dict(temp_opt=[20.0, 30.0], heat_c=33.0, heat_crit_c=42.0, repro_heat_c=35.0, repro_night_c=99.0, repro_cold_c=12.0,
                  cold_c=10.0, chill_c=5.0, dli_min=25.0, dli_opt=40.0, ec_threshold_ds=1.7, ec_slope_pct=12.0,
                  vpd_high=2.0, repro_drought=0.08, susc_botrytis=0.3, susc_powdery=0.3),
    "tuber": dict(temp_opt=[12.0, 22.0], heat_c=26.0, heat_crit_c=35.0, repro_heat_c=99.0, cold_c=5.0, chill_c=2.0, frost_c=-0.5,
                  dli_min=15.0, dli_opt=25.0, ec_threshold_ds=1.7, ec_slope_pct=12.0, susc_blight=1.6, repro_drought=0.03),
    "legume": dict(temp_opt=[18.0, 27.0], heat_c=30.0, heat_crit_c=38.0, repro_heat_c=32.0, repro_night_c=22.0, cold_c=10.0,
                   chill_c=6.0, dli_min=15.0, dli_opt=25.0, ec_threshold_ds=1.0, ec_slope_pct=19.0, repro_drought=0.05),
    "herb": dict(temp_opt=[18.0, 28.0], heat_c=32.0, heat_crit_c=38.0, repro_heat_c=99.0, cold_c=10.0, chill_c=8.0, frost_c=2.0,
                 dli_min=12.0, dli_opt=20.0, ec_threshold_ds=1.5, ec_slope_pct=15.0, susc_botrytis=1.3, repro_drought=0.0),
}


def stress_params(profile: CropProfile) -> dict:
    p = dict(BASE)
    p.update(CATEGORY.get(profile.category, {}))
    p.update(profile.stress)
    return p


# Parámetros que el usuario puede cambiar en el panel de simulación: clave → (etiqueta, unidad, mín, máx, ayuda)
PARAM_DOC: dict[str, tuple[str, str, float, float, str]] = {
    "gdd.base_c": ("Temperatura base", "°C", 0, 20, "Por debajo de esta temperatura la planta no avanza de etapa."),
    "gdd.cap_c": ("Temperatura tope de desarrollo", "°C", 20, 40, "Por encima de esta temperatura no se desarrolla más rápido."),
    "gdd.maturity": ("Ciclo hasta cosecha", "°C·día", 200, 3500, "Calor acumulado necesario hasta madurez."),
    "water.p_depletion": ("Agua fácilmente aprovechable (p)", "0–1", 0.1, 0.9, "Fracción del agua útil que se agota sin estrés (FAO-56)."),
    "stress.heat_c": ("Calor que frena la fotosíntesis", "°C", 20, 45, "Desde aquí el crecimiento baja."),
    "stress.heat_crit_c": ("Calor que daña las hojas", "°C", 28, 55, "Daño directo al follaje."),
    "stress.repro_heat_c": ("Calor que arruina flores/polinización", "°C", 25, 45, "Solo en etapas reproductivas: caída de flores y mal cuajado."),
    "stress.cold_c": ("Frío que casi detiene el crecimiento", "°C", -2, 15, "Por debajo de esta temperatura el crecimiento tiende a cero."),
    "stress.chill_c": ("Frío que daña tejidos (chilling)", "°C", -2, 12, "Daño acumulado por frío sin helada."),
    "stress.frost_c": ("Helada (daño inmediato)", "°C", -8, 4, "Congelación de tejidos."),
    "stress.hypoxia_onset_h": ("Horas encharcado hasta falta de oxígeno", "h", 6, 200, "A ~20 °C; con suelo caliente ocurre antes (≈48–96 h típico)."),
    "stress.root_lethal_h": ("Horas con hipoxia hasta perder la raíz", "h", 12, 400, "Tiempo adicional hasta pudrición total de raíces."),
    "stress.waterlog_frac": ("Qué tan lleno debe estar el suelo", "0–1", 0.3, 1, "0 = capacidad de campo, 1 = saturación; desde esta fracción se considera encharcado."),
    "stress.ec_threshold_ds": ("Salinidad tolerada", "dS/m", 0.5, 8, "Umbral de Maas–Hoffman: sin pérdida por debajo."),
    "stress.ec_slope_pct": ("Pérdida por cada dS/m extra", "%", 2, 40, "Pendiente de Maas–Hoffman."),
    "stress.dli_min": ("Luz diaria mínima (DLI)", "mol/m²/día", 4, 30, "Con menos luz el crecimiento cae proporcionalmente."),
    "stress.vpd_low": ("VPD bajo (riesgo hongos)", "kPa", 0.1, 0.8, "Aire casi saturado: hojas mojadas y poca transpiración."),
    "stress.vpd_high": ("VPD alto (cierra estomas)", "kPa", 0.8, 3.5, "Aire muy seco: la planta cierra estomas y no absorbe calcio."),
    "stress.bolt_c": ("Temperatura de espigado", "°C", 0, 40, "Hojas: el calor sostenido provoca floración prematura (0 = no aplica)."),
    "stress.repro_drought": ("Pérdida por sequía en floración", "por día", 0, 0.2, "Fracción de rendimiento perdida por día con estrés severo en etapa reproductiva."),
    "stress.susc_botrytis": ("Susceptibilidad a moho gris", "×", 0, 3, "Multiplica la velocidad de acumulación del riesgo."),
    "stress.susc_blight": ("Susceptibilidad a tizón", "×", 0, 3, ""),
    "stress.susc_powdery": ("Susceptibilidad a oídio", "×", 0, 3, ""),
    "stress.susc_rootrot": ("Susceptibilidad a pudrición de raíz", "×", 0, 3, "Pythium / Phytophthora."),
    "stress.susc_mites": ("Susceptibilidad a ácaros", "×", 0, 3, "Arañita roja: clima caliente y seco."),
    "yield_potential_kg_m2": ("Rendimiento de referencia", "kg/m²", 0.1, 30, "Rendimiento típico en buenas condiciones; solo sirve para escalar el %."),
    "kc_scale": ("Escala de consumo de agua (Kc)", "×", 0.5, 1.5, "Multiplica el Kc de todas las etapas."),
}


def apply_overrides(profile: CropProfile, overrides: dict[str, float] | None) -> CropProfile:
    """Devuelve una copia del perfil con parámetros editados (solo claves de PARAM_DOC)."""
    if not overrides:
        return profile
    p = profile.model_copy(deep=True)
    for key, v in overrides.items():
        if key not in PARAM_DOC:
            raise ValueError(f"parámetro desconocido: {key}")
        lab, unit, lo, hi, _ = PARAM_DOC[key]
        v = float(v)
        if not (lo <= v <= hi):
            raise ValueError(f"{lab}: {v} fuera de [{lo}, {hi}] {unit}")
        if key.startswith("gdd."):
            p.gdd[key.split(".", 1)[1]] = v
        elif key.startswith("water."):
            p.water[key.split(".", 1)[1]] = v
        elif key.startswith("stress."):
            p.stress[key.split(".", 1)[1]] = v
        elif key == "yield_potential_kg_m2":
            p.yield_potential_kg_m2 = v
        elif key == "kc_scale":
            for s in p.stages:
                s.kc = min(2.0, s.kc * v)
    if p.gdd["cap_c"] <= p.gdd["base_c"]:
        raise ValueError("la temperatura tope debe ser mayor que la base")
    return p


def param_values(profile: CropProfile) -> list[dict]:
    sp = stress_params(profile)
    out = []
    for key, (lab, unit, lo, hi, helptxt) in PARAM_DOC.items():
        if key.startswith("gdd."):
            v = profile.gdd.get(key.split(".", 1)[1])
        elif key.startswith("water."):
            v = profile.water.get(key.split(".", 1)[1])
        elif key.startswith("stress."):
            v = sp.get(key.split(".", 1)[1])
        elif key == "yield_potential_kg_m2":
            v = profile.yield_potential_kg_m2
        else:
            v = 1.0
        out.append({"key": key, "label": lab, "unit": unit, "min": lo, "max": hi, "help": helptxt, "value": v})
    return out


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def _smooth(x: float) -> float:
    x = _clip(x)
    return x * x * (3 - 2 * x)


def potential_curve(gdd: float, maturity: float) -> float:
    """Fracción del crecimiento potencial acumulado (curva en S) a un calor acumulado dado."""
    return _smooth(gdd / max(maturity, 1.0))


# ------------------------------------------------------------------ motor ----------------------

@dataclass
class Chem:
    """Química del sustrato al inicio (de los sensores). None = sin dato → no se modela ese estrés."""
    ph: float | None = None
    ec: float | None = None      # µS/cm
    n: float | None = None
    p: float | None = None
    k: float | None = None
    soil_t: float | None = None


FACTOR_NAMES = {
    "water": "Falta de agua", "hypoxia": "Exceso de agua", "temp": "Temperatura", "light": "Luz", "vpd": "Aire seco/húmedo",
    "nutrient": "Nutrientes", "ph": "pH", "salinity": "Salinidad", "disease": "Enfermedades", "pest": "Plagas",
}


@dataclass
class CropEngine:
    prof: CropProfile
    soil: Soil
    chem: Chem = field(default_factory=Chem)
    disease_control: float = 0.0     # 0 = sin fungicidas ... 1 = control total
    pest_control: float = 0.0

    def __post_init__(self):
        self.P = stress_params(self.prof)
        self.t_h = 0.0
        self.ts = 0.0
        self.soil_t = self.chem.soil_t
        self.n = self.chem.n
        self.pp = self.chem.p
        self.k = self.chem.k
        self.ec0 = self.chem.ec
        self.theta0: float | None = None
        # estados
        self.H = 0.0                 # índice de hipoxia (1 = falta de oxígeno)
        self.root_dmg = 0.0
        self.leaf_dmg = 0.0          # frío/helada/calor: daño al follaje
        self.chill = 0.0
        self.repro_loss = 0.0        # calor / frío / sequía en floración
        self.ber = 0.0
        self.bolt = 0.0
        self.tipburn = 0.0
        self.risk = {"botrytis": 0.0, "blight": 0.0, "powdery": 0.0, "damping": 0.0, "mites": 0.0, "aphids": 0.0, "whitefly": 0.0}
        self.sev = {k: 0.0 for k in ("botrytis", "blight", "powdery", "damping", "mites", "aphids", "whitefly")}
        self.hutton = 0
        self.rh90_h = 0.0
        self.min_t_day = 99.0
        self.biomass = 0.0
        self.dli = 0.0
        self.dli_prev: float | None = None
        self.dli_high_days = 0
        self.day = 0
        self.prev_ks = 1.0
        self.salt_acc = 0.0
        self.steps = 0
        self.hours = {"waterlog": 0.0, "heat": 0.0, "cold": 0.0, "wet_air": 0.0, "dry_air": 0.0, "water_stress": 0.0}
        self.events: list[dict] = []
        self._by_code: dict[str, dict] = {}
        self.dry_day_h = 0.0
        self.night_sum = self.night_h = 0.0
        self.night_mean = 0.0
        self.night_hot = False
        self._active: dict[str, bool] = {}
        self._cleared_at: dict[str, float] = {}
        self.last_stage = None
        self.harvested = False
        self.dead = False
        self._pot_prev: float | None = None
        self.total_h = 0.0

    # ---------- eventos ----------
    def _fire(self, code: str, level: str, title: str, cause: str, consequence: str, action: str) -> None:
        """Un evento por código: si se repite suma episodios y horas (así la línea de tiempo no se llena de ruido)."""
        if self._active.get(code):
            return
        self._active[code] = True
        ev = self._by_code.get(code)
        if ev is not None:
            if self.t_h - self._cleared_at.get(code, -1e9) > 48.0:
                ev["episodes"] += 1
            ev["last_t_hour"] = round(self.t_h, 2)
            if _LEVEL.get(level, 0) >= _LEVEL.get(ev["level"], 0):
                ev["level"] = level
                ev["cause"], ev["consequence"] = cause, consequence      # conserva el caso más grave
            return
        if len(self.events) < MAX_EVENTS:
            ev = {"code": code, "level": level, "t_hour": round(self.t_h, 2), "last_t_hour": round(self.t_h, 2), "ts": self.ts,
                  "title": title, "cause": cause, "consequence": consequence, "action": action, "episodes": 1, "hours": 0.0}
            self.events.append(ev)
            self._by_code[code] = ev

    def _tick_events(self, dt_h: float) -> None:
        for code, on in self._active.items():
            if on and code in self._by_code:
                self._by_code[code]["hours"] = round(self._by_code[code]["hours"] + dt_h, 2)
                self._by_code[code]["last_t_hour"] = round(self.t_h, 2)

    def _clear(self, code: str) -> None:
        if self._active.get(code):
            self._active[code] = False
            self._cleared_at[code] = self.t_h

    def _cond(self, code: str, on: bool, *args) -> None:
        if on:
            self._fire(code, *args)
        else:
            self._clear(code)

    # ---------- un paso ----------
    def step(self, *, dt_h: float, t_h: float, ts: float, air_t: float, rh: float, lux: float, theta: float, ks: float,
             gdd_th: float, gdd_eff: float, stage_idx: int, irrigation_mm: float = 0.0, rain_mm: float = 0.0,
             fert: tuple[float, float, float] | None = None) -> dict:
        P, prof = self.P, self.prof
        self.t_h, self.ts = t_h, ts
        self.steps += 1
        self.total_h += dt_h
        stage = prof.stages[stage_idx]
        repro = stage.code in prof.repro_stages
        if self.theta0 is None:
            self.theta0 = max(theta, 1e-3)
        if self.soil_t is None:
            self.soil_t = air_t
        self.soil_t += (air_t - self.soil_t) * (1 - math.exp(-dt_h / 10.0))
        soil_t = self.soil_t
        vpd = vpd_kpa(air_t, rh) or 0.0
        night = lux < 500.0
        warm = _clip(1.0 + (soil_t - 20.0) * 0.06, 0.5, 2.0)    # el oxígeno se agota más rápido con suelo caliente
        sens_young = 1.8 if stage_idx == 0 else 1.0

        # ---- temperatura nocturna media (la que importa para el cuajado): se evalúa al amanecer ----
        if night:
            self.night_sum += air_t * dt_h
            self.night_h += dt_h
        elif self.night_h > 0:
            self.night_mean = self.night_sum / self.night_h
            self.night_hot = self.night_mean > P["repro_night_c"]
            self.night_sum = self.night_h = 0.0

        # ---- luz diaria (DLI) y fotoperiodo ----
        self.dli += lux * LUX_TO_PPFD * dt_h * 3600.0 / 1e6
        if int(t_h // 24) > self.day:
            self.day = int(t_h // 24)
            self.dry_day_h = 0.0
            self.dli_prev, self.dli = self.dli, 0.0
            if P["tipburn_dli"] and self.dli_prev > P["tipburn_dli"]:
                self.dli_high_days += 1
            else:
                self.dli_high_days = 0
            if self.hutton >= 0:
                if self.rh90_h >= 11.0 and self.min_t_day >= 10.0:
                    self.hutton += 1
                else:
                    self.hutton = 0
            self.rh90_h, self.min_t_day = 0.0, 99.0
        self.min_t_day = min(self.min_t_day, air_t)
        if rh >= 90.0:
            self.rh90_h += dt_h

        # ---- agua: falta ----
        f_water = _clip(ks)
        if ks < 0.95:
            self.hours["water_stress"] += dt_h
        rewet = (irrigation_mm + rain_mm) > 2.0 and self.prev_ks < 0.8
        self.prev_ks = ks
        self._cond("drought", ks < 0.7, "warn" if ks >= 0.4 else "critical", "Estrés hídrico",
                   f"El suelo quedó seco (coeficiente de estrés {ks:.2f}): la planta cierra estomas.",
                   "Crece menos y las hojas se marchitan; en floración baja el rendimiento.", "Regar y revisar la frecuencia de riego.")

        # ---- agua: exceso (hipoxia y pudrición de raíz) ----
        sat_cut = self.soil.theta_fc + P["waterlog_frac"] * (self.soil.theta_sat - self.soil.theta_fc)
        waterlogged = theta >= sat_cut
        if waterlogged:
            self.hours["waterlog"] += dt_h
            self.H += dt_h * warm / P["hypoxia_onset_h"]
            if self.H >= 1.0:
                rate = dt_h * warm / P["root_lethal_h"] * sens_young
                rate *= 1.0 + 0.5 * P["susc_rootrot"] * (1.0 if soil_t > 18.0 else 0.4)
                self.root_dmg = min(1.0, self.root_dmg + rate)
            n_loss = 0.03 * dt_h / 24.0                          # desnitrificación ~1–5 %/día saturado
            if self.n is not None:
                self.n *= 1 - n_loss
        else:
            self.H = max(0.0, self.H - dt_h / 24.0)
            if self.H < 0.3 and self.root_dmg < 0.95:
                self.root_dmg = max(0.0, self.root_dmg - dt_h / (21 * 24.0))   # raíces nuevas, lento
        if (irrigation_mm + rain_mm) > 20.0 * dt_h and self.n is not None:      # lavado por lluvia/riego abundante
            self.n *= 1 - min(0.1, 0.03 * (irrigation_mm + rain_mm) / 20.0)
        root_health = 1.0 - self.root_dmg
        f_hyp = 1.0 - 0.7 * _clip(self.H)
        self._cond("hypoxia_warn", self.H >= 0.5, "warn", "Suelo encharcado: se está agotando el oxígeno",
                   f"El suelo lleva {self.hours['waterlog']:.0f} h saturado (≥{P['waterlog_frac']*100:.0f} % entre capacidad de campo y saturación).",
                   "Las raíces respiran menos; empieza a faltar oxígeno y se pierde nitrógeno.", "Dejar de regar y mejorar el drenaje (huecos, sustrato aireado).")
        self._cond("hypoxia", self.H >= 1.0, "critical", "Hipoxia en la raíz",
                   "Más de ~48–96 h sin oxígeno en la zona radicular (más rápido con suelo caliente).",
                   "Las raíces dejan de absorber agua y nutrientes: hojas amarillas y marchitas aunque el suelo esté mojado.",
                   "Drenar ya, no regar hasta que baje la humedad y evitar suelo compactado.")
        self._cond("root_rot", self.root_dmg >= 0.25, "critical", "Pudrición de raíz (Pythium/Phytophthora)",
                   f"Hipoxia prolongada con suelo a {soil_t:.0f} °C: las raíces dañadas son invadidas por hongos del suelo.",
                   f"Se perdió ~{self.root_dmg*100:.0f} % de la raíz; si llega a 100 % la planta muere.",
                   "Drenar, reducir el riego y, si persiste, replantar en sustrato nuevo; revisar raíces blancas vs marrones.")
        self._cond("root_dead", self.root_dmg >= 1.0, "critical", "La planta murió por pudrición de raíz",
                   "Daño radicular total por encharcamiento sostenido.", "No hay recuperación posible.", "Replantar y corregir el drenaje primero.")

        # ---- temperatura ----
        lo_opt, hi_opt = P["temp_opt"]
        if air_t < lo_opt:
            f_temp = _clip((air_t - P["cold_c"]) / max(lo_opt - P["cold_c"], 1e-6))
        elif air_t <= hi_opt:
            f_temp = 1.0
        elif air_t <= P["heat_c"]:
            f_temp = 1.0 - 0.1 * (air_t - hi_opt) / max(P["heat_c"] - hi_opt, 1e-6)
        else:
            f_temp = _clip(0.9 - 0.8 * (air_t - P["heat_c"]) / max(P["heat_crit_c"] - P["heat_c"], 1e-6), 0.1, 0.9)
        if air_t > P["heat_c"]:
            self.hours["heat"] += dt_h
        if air_t < P["cold_c"]:
            self.hours["cold"] += dt_h
        if air_t > P["heat_crit_c"]:
            self.leaf_dmg = min(1.0, self.leaf_dmg + dt_h * 0.02 * (1 + (air_t - P["heat_crit_c"]) / 3))
        if air_t < P["chill_c"] and air_t > P["frost_c"]:
            self.chill = min(1.0, self.chill + dt_h / 72.0 * (1 + (P["chill_c"] - air_t) / 3))
            self.leaf_dmg = min(1.0, self.leaf_dmg + dt_h / 240.0)
        elif air_t >= P["chill_c"]:
            self.chill = max(0.0, self.chill - dt_h / 96.0)
        if air_t <= P["frost_c"]:
            self.leaf_dmg = min(1.0, self.leaf_dmg + dt_h * 0.4 * (1 + (P["frost_c"] - air_t) / 2))
        self._cond("heat", air_t > P["heat_c"], "warn" if air_t < P["heat_crit_c"] else "critical", "Calor que frena la planta",
                   f"Temperatura del aire {air_t:.1f} °C, por encima de {P['heat_c']:.0f} °C.",
                   "Baja la fotosíntesis y aumenta la demanda de agua; sobre %.0f °C se queman las hojas." % P["heat_crit_c"],
                   "Dar sombra, ventilar o regar más seguido (no en pleno sol).")
        self._cond("cold", air_t < P["cold_c"], "warn", "Frío que frena el crecimiento",
                   f"Temperatura del aire {air_t:.1f} °C, por debajo de {P['cold_c']:.0f} °C.",
                   "El desarrollo casi se detiene y las raíces absorben menos.", "Proteger de la noche fría (cubierta) o mover la planta.")
        self._cond("chilling", self.chill >= 0.5, "critical", "Daño por frío (chilling)",
                   f"Horas con menos de {P['chill_c']:.0f} °C.", "Tejidos dañados: manchas, hojas caídas y menos fruto.", "Cubrir o proteger la planta.")
        self._cond("frost", air_t <= P["frost_c"] and self.leaf_dmg > 0.05, "critical", "Helada",
                   f"{air_t:.1f} °C: los tejidos se congelan.", "Quemadura del follaje; puede matar plantas sensibles.", "Cubrir la planta antes de la madrugada.")
        self._cond("leaf_dead", self.leaf_dmg >= 1.0, "critical", "La planta murió por frío o calor extremo",
                   "Daño acumulado al follaje.", "No hay recuperación posible.", "Replantar y proteger del clima extremo.")

        # ---- floración: calor, frío y sequía (rendimiento) ----
        if repro and not self.harvested:
            hot_day = (not night) and air_t > P["repro_heat_c"]
            hot_night = self.night_hot
            cold_fl = air_t < P["repro_cold_c"]
            rate = 0.0
            if hot_day:
                rate += 0.004 * (1 + (air_t - P["repro_heat_c"]) / 3)
            if hot_night:
                rate += 0.0025 * (1 + (self.night_mean - P["repro_night_c"]) / 3)
            if cold_fl:
                rate += 0.003 * (1 + (P["repro_cold_c"] - air_t) / 3)
            rate += P["repro_drought"] / 24.0 * (1 - ks) ** 1.5
            self.repro_loss = min(0.85, self.repro_loss + rate * dt_h)
            self._cond("repro_heat", hot_day or hot_night, "critical" if self.repro_loss > 0.15 else "warn", "Calor en la floración",
                       f"{air_t:.1f} °C durante la floración (límite {P['repro_heat_c']:.0f} °C de día / {P['repro_night_c']:.0f} °C de noche).",
                       "El polen se vuelve estéril y se caen flores: menos frutos (pérdida acumulada %.0f %%)." % (self.repro_loss * 100),
                       "Sombra y ventilación en las horas de más calor; mantener humedad constante.")
            self._cond("repro_cold", cold_fl, "warn", "Frío en la floración", f"{air_t:.1f} °C durante la floración.",
                       "Mal cuajado y frutos deformes.", "Proteger de las noches frías.")
        # blossom end rot (calcio): VPD alto y riego irregular en fructificación
        if P["ber"] and repro and not self.harvested:
            if vpd > P["vpd_high"]:
                self.ber += dt_h / 72.0
            if rewet:
                self.ber += 0.2
            self.ber = max(0.0, self.ber - dt_h / 240.0)
            self._cond("ber", self.ber >= 1.0, "warn", "Pudrición apical (falta de calcio en el fruto)",
                       "Riego irregular (sequía y luego agua) y/o aire muy seco: el calcio no llega al fruto.",
                       "Manchas negras en la punta del fruto; ~25 % del rendimiento puede perderse.", "Riego constante y pequeño; evitar picos de sequía.")

        # ---- luz ----
        d = self.dli_prev
        f_light = 1.0 if d is None else _clip(d / max(P["dli_min"], 1e-6), 0.2, 1.0) ** 0.7
        if d is not None:
            self._cond("low_light", d < 0.7 * P["dli_min"], "warn", "Poca luz",
                       f"La luz diaria fue {d:.1f} mol/m²/día (mínimo ~{P['dli_min']:.0f}).", "Crecimiento lento, tallos alargados y débiles.", "Más luz (reubicar o luz artificial).")
        if P["tipburn_dli"]:
            self._cond("tipburn", self.dli_high_days >= 3, "warn", "Quemadura de puntas (tipburn)",
                       f"3+ días seguidos con más de {P['tipburn_dli']:.0f} mol/m²/día de luz.", "Bordes de hoja marrones y menor calidad.", "Sombrear parcialmente y regar con regularidad.")
            if self.dli_high_days >= 3:
                self.tipburn = min(0.15, self.tipburn + dt_h / 24.0 * 0.01)

        # ---- aire: VPD ----
        if vpd > P["vpd_high"]:
            f_vpd = 1.0 - 0.5 * _clip((vpd - P["vpd_high"]) / 1.5)
            self.hours["dry_air"] += dt_h
        elif vpd < P["vpd_low"]:
            f_vpd = 1.0 if night else 0.92        # de noche no hay fotosíntesis que frenar
            self.hours["wet_air"] += dt_h
        else:
            f_vpd = 1.0
        if vpd > P["vpd_high"] and not night:
            self.dry_day_h += dt_h
        self._cond("vpd_high", self.dry_day_h >= 5.0, "warn", "Aire demasiado seco",
                   f"VPD {vpd:.2f} kPa (límite {P['vpd_high']:.1f}).", "La planta cierra estomas: no absorbe CO₂ ni calcio.", "Subir la humedad del aire o dar sombra.")

        # ---- nutrientes, pH, salinidad ----
        opt = prof.optimal_for(stage_idx)
        f_nut, worst = 1.0, None
        if fert:
            if self.n is not None:
                self.n += fert[0]
            if self.pp is not None:
                self.pp += fert[1]
            if self.k is not None:
                self.k += fert[2]
        dev_rate = max(0.0, potential_curve(gdd_th, prof.gdd["maturity"]) - (self._pot_prev if self._pot_prev is not None else potential_curve(gdd_th, prof.gdd["maturity"])))  # extracción ∝ crecimiento
        for name, val in (("n", self.n), ("p", self.pp), ("k", self.k)):
            if val is None:
                continue
            lo = opt.get(name, [None])[0]
            if lo:
                f = _clip(val / lo, 0.25, 1.0)
                if f < f_nut:
                    f_nut, worst = f, name
            if name == "n":
                self.n = val * (1 - 0.8 * dev_rate)
            elif name == "p":
                self.pp = val * (1 - 0.4 * dev_rate)
            else:
                self.k = val * (1 - 0.6 * dev_rate)
        names = {"n": "nitrógeno", "p": "fósforo", "k": "potasio"}
        self._cond("nutrient", f_nut < 0.75, "warn" if f_nut >= 0.5 else "critical", "Deficiencia de nutrientes",
                   f"Falta {names.get(worst, 'nutrientes')} (nivel por debajo del mínimo de la etapa).",
                   "Hojas amarillas o moradas, crecimiento lento, menos fruto.", "Fertilizar con el nutriente que falta (abonar en dosis pequeñas).")
        f_ph = 1.0
        if self.chem.ph is not None and "ph" in prof.optimal:
            lo, hi = prof.optimal["ph"]
            dist = max(lo - self.chem.ph, self.chem.ph - hi, 0.0)
            f_ph = _clip(1.0 - 0.22 * dist, 0.4, 1.0)
            self._cond("ph", dist > 0.7, "warn", "pH fuera de rango",
                       f"pH {self.chem.ph:.1f} (ideal {lo:g}–{hi:g}).", "Baja la disponibilidad de fósforo, hierro y calcio.", "Corregir con cal (si es ácido) o azufre/materia orgánica (si es alcalino).")
        f_salt = 1.0
        if self.ec0 is not None:
            conc = _clip(self.theta0 / max(theta, 1e-3), 0.5, 3.0)       # al secarse el suelo, las sales se concentran
            ece = self.ec0 / 1000.0 * P["ec_factor"] * conc
            loss = _clip(P["ec_slope_pct"] / 100.0 * max(0.0, ece - P["ec_threshold_ds"]), 0.0, 0.9)
            f_salt = 1.0 - loss
            self.salt_acc += loss * dt_h
            self._cond("salinity", loss > 0.05, "warn" if loss < 0.25 else "critical", "Salinidad alta",
                       f"Conductividad ≈ {ece:.1f} dS/m (tolerancia {P['ec_threshold_ds']:.1f}); se concentra al secarse el suelo.",
                       f"Pérdida de rendimiento estimada ≈ {loss*100:.0f} %: hojas con bordes quemados.", "Lavar el sustrato con riego abundante y drenaje; evitar exceso de fertilizante.")

        # ---- enfermedades y plagas ----
        dc, pc = 1.0 - _clip(self.disease_control), 1.0 - _clip(self.pest_control)
        wet = rh >= 90.0 or vpd < 0.25
        R, S = self.risk, self.sev
        def acc(name: str, on: bool, up_h: float, down_h: float, susc: float) -> None:
            R[name] = _clip(R[name] + (dt_h / up_h * susc if on and susc > 0 else -dt_h / down_h), 0.0, 2.0)
        acc("botrytis", wet and 12 <= air_t <= 25, 10.0, 24.0, P["susc_botrytis"] * dc)
        acc("powdery", 20 <= air_t <= 27 and 70 <= rh <= 88 and not wet, 96.0, 48.0, P["susc_powdery"] * dc)
        acc("damping", stage_idx == 0 and theta >= self.soil.theta_fc and soil_t < 22.0 and rh >= 85, 36.0, 48.0, P["susc_damping"] * dc)
        if P["susc_blight"] > 0:
            R["blight"] = _clip(self.hutton / 2.0 * P["susc_blight"] * dc, 0.0, 2.0)
        hot_dry = air_t >= 27 and rh <= 55
        acc("mites", hot_dry, 48.0 / (1 + max(0.0, air_t - 27) / 5), 72.0, P["susc_mites"] * pc)
        acc("aphids", 18 <= air_t <= 28 and 40 <= rh <= 80, 600.0, 72.0, P["susc_aphids"] * pc)
        acc("whitefly", 24 <= air_t <= 32, 360.0, 96.0, P["susc_whitefly"] * pc)
        grow_h = {"botrytis": 120.0, "blight": 72.0, "powdery": 480.0, "damping": 48.0, "mites": 240.0, "aphids": 480.0, "whitefly": 480.0}
        for name in S:
            if R[name] >= 1.0:
                S[name] = _clip(S[name] + dt_h / grow_h[name])
            elif R[name] < 0.5:
                S[name] = _clip(S[name] - dt_h / 480.0)       # con clima desfavorable el brote se frena y las hojas nuevas salen sanas
        f_dis = 1.0 - 0.5 * max(S["botrytis"], S["powdery"], S["blight"], S["damping"])
        f_pest = 1.0 - 0.4 * max(S["mites"], S["aphids"], S["whitefly"])
        texts = {
            "botrytis": ("Riesgo de moho gris (Botrytis)", f"Humedad del aire ≥90 % o VPD bajo con {air_t:.0f} °C: hojas mojadas por horas.", "Manchas grises y pudrición de hojas y frutos.", "Ventilar, no mojar las hojas y retirar partes enfermas."),
            "powdery": ("Riesgo de oídio", "Temperatura de 20–28 °C con humedad relativa media-alta y hojas secas.", "Polvo blanco en hojas: reduce la fotosíntesis.", "Ventilar y espaciar plantas; evitar exceso de nitrógeno."),
            "blight": ("Condiciones de tizón tardío", "Dos días seguidos con ≥11 h de humedad ≥90 % y noches sobre 10 °C.", "Manchas aceitosas y colapso rápido del follaje.", "Regar por la mañana y al pie; fungicida preventivo si lo usas."),
            "damping": ("Riesgo de damping-off (plántula)", "Suelo húmedo y frío con aire húmedo en la etapa de plántula.", "Las plántulas se doblan y mueren en la base.", "Menos riego, más aire y sustrato estéril."),
            "mites": ("Riesgo de arañita roja", f"Clima caliente y seco ({air_t:.0f} °C, {rh:.0f} % HR): se desarrolla en ~7 días.", "Hojas punteadas y bronceadas; pérdida de vigor.", "Subir humedad, revisar el envés de las hojas, jabón potásico."),
            "aphids": ("Riesgo de pulgones", "Temperaturas suaves sin lluvia favorecen su multiplicación.", "Hojas rizadas y transmisión de virus.", "Revisar brotes tiernos; jabón o enemigos naturales."),
            "whitefly": ("Riesgo de mosca blanca", "Temperaturas cálidas sostenidas.", "Debilita la planta y transmite virus.", "Trampas amarillas y revisión del envés."),
        }
        for name, (title, cause, cons, act) in texts.items():
            self._cond("risk_" + name, R[name] >= 1.0, "warn" if S[name] < 0.3 else "critical", title, cause,
                       cons + (f" (severidad {S[name]*100:.0f} %)" if S[name] > 0 else ""), act)

        # ---- espigado (hojas) ----
        if P["bolt_c"] and stage_idx >= len(prof.stages) - 2 and not self.harvested:
            over = air_t - P["bolt_c"]
            if over > 0:
                self.bolt = min(1.0, self.bolt + dt_h / 72.0 * (1 + over / 4))
            self._cond("bolting", self.bolt >= 1.0, "critical", "Espigado (sube a flor)", f"Calor sostenido sobre {P['bolt_c']:.0f} °C en la etapa final.",
                       "Las hojas se vuelven amargas: pérdida de calidad (~50 % del valor).", "Cosechar antes o dar sombra en las horas de calor.")

        self._tick_events(dt_h)

        # ---- crecimiento ----
        f_vals = {"water": f_water ** (1.4 if repro else 1.0), "hypoxia": f_hyp, "temp": f_temp, "light": f_light, "vpd": f_vpd,
                  "nutrient": f_nut, "ph": f_ph, "salinity": f_salt, "disease": f_dis, "pest": f_pest}
        growth = 1.0
        for v in f_vals.values():
            growth *= v
        growth *= root_health * (1.0 - 0.8 * self.leaf_dmg) * (1.0 - 0.5 * self.chill)
        if self.root_dmg >= 1.0 or self.leaf_dmg >= 1.0:
            self.dead = True
        if self.dead:
            growth = 0.0
        growth = _clip(growth)
        dev = _clip(ks) * (root_health ** 0.5)
        if self.harvested:
            growth = 0.0
        # biomasa relativa acumulada frente al potencial de la curva en S
        pot0 = potential_curve(gdd_th, prof.gdd["maturity"])
        if self._pot_prev is None:
            self._pot_prev = pot0
        d_pot = max(0.0, pot0 - self._pot_prev)
        self._pot_prev = pot0
        self.biomass += d_pot * growth
        if stage_idx != self.last_stage and not self.harvested:
            if self.last_stage is not None and stage_idx > self.last_stage:
                if len(self.events) < MAX_EVENTS:
                    self.events.append({"code": "stage_" + stage.code, "level": "info", "t_hour": round(t_h, 2), "last_t_hour": round(t_h, 2), "episodes": 1, "hours": 0.0, "ts": ts,
                                        "title": f"Entró a: {stage.name}", "cause": f"Calor acumulado {gdd_eff:.0f} °C·día.",
                                        "consequence": "Cambian las necesidades de agua y los estreses a los que es sensible.", "action": ""})
            self.last_stage = stage_idx
        if gdd_eff >= prof.gdd["maturity"] and not self.harvested:
            self.harvested = True
            if len(self.events) < MAX_EVENTS:
                self.events.append({"code": "harvest", "level": "info", "t_hour": round(t_h, 2), "last_t_hour": round(t_h, 2), "episodes": 1, "hours": 0.0, "ts": ts, "title": "Lista para cosechar",
                                    "cause": "Se completó el ciclo térmico.", "consequence": f"Rendimiento estimado ≈ {self.yield_pct(gdd_th):.0f} % del potencial.", "action": "Cosechar."})
        return {"growth": growth, "dev": dev, "root": root_health, "factors": f_vals, "vpd": vpd}

    # ---------- resultados ----------
    def vigor(self, gdd_th: float) -> float:
        if self.dead:
            return 0.0
        pot = potential_curve(gdd_th, self.prof.gdd["maturity"])
        if pot <= 1e-6:
            return 1.0
        return _clip(self.biomass / pot)

    def losses(self) -> dict[str, float]:
        out = {
            "floracion": self.repro_loss,
            "calcio_fruto": 0.25 * _clip(self.ber) if self.P["ber"] else 0.0,
            "espigado": 0.5 * self.bolt,
            "quemadura_puntas": self.tipburn,
        }
        return {k: round(v, 3) for k, v in out.items() if v > 0.001}

    def yield_pct(self, gdd_th: float | None = None) -> float:
        """Rendimiento (% del potencial). A mitad de ciclo es una PROYECCIÓN: vigor actual × pérdidas ya ocurridas."""
        y = _clip(self.biomass) if gdd_th is None else self.vigor(gdd_th)
        for v in self.losses().values():
            y *= 1.0 - v
        if self.dead:
            y = 0.0
        return round(y * 100.0, 1)

    def health(self) -> float:
        h = (1 - self.root_dmg) * (1 - 0.8 * self.leaf_dmg) * (1 - 0.6 * max(self.sev["botrytis"], self.sev["powdery"], self.sev["blight"]))
        h *= 1 - 0.35 * max(self.sev["mites"], self.sev["aphids"], self.sev["whitefly"])
        return 0.0 if self.dead else _clip(h * (1 - 0.35 * _clip(self.H)))

    def visual(self, f_vals: dict, gdd_th: float) -> dict:
        """Intensidades 0–1 para dibujar la planta: amarillamiento, raíz podrida, quemadura, enanismo, etc."""
        yellow = max(1 - f_vals.get("nutrient", 1.0), 0.8 * _clip(self.H), 0.6 * self.root_dmg, 0.5 * max(self.sev["botrytis"], self.sev["powdery"], self.sev["blight"]))
        return {
            "yellow": round(_clip(yellow), 2), "rot": round(self.root_dmg, 2), "scorch": round(_clip(self.leaf_dmg + 0.4 * self.chill), 2),
            "stunt": round(1 - self.vigor(gdd_th), 2), "spots": round(max(self.sev["botrytis"], self.sev["powdery"], self.sev["blight"], self.sev["mites"]), 2),
            "dead": self.dead, "health": round(self.health(), 2),
        }

    def summary(self, gdd_th: float) -> dict:
        S = self.sev
        return {
            "yield_pct": self.yield_pct(gdd_th), "vigor_pct": round(self.vigor(gdd_th) * 100, 1), "health_pct": round(self.health() * 100, 1),
            "root_health_pct": round((1 - self.root_dmg) * 100, 1), "dead": self.dead, "harvested": self.harvested,
            "losses": self.losses(),
            "hours": {k: round(v, 1) for k, v in self.hours.items()},
            "diseases": {k: round(v, 2) for k, v in S.items() if v > 0.001},
            "risks": {k: round(v, 2) for k, v in self.risk.items()},
            "salinity_loss_pct": None if self.ec0 is None else round(self.salt_acc / max(self.total_h, 1e-6) * 100, 1),
        }
