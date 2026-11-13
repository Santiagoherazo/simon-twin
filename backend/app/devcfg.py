"""Configuración editable de cada dispositivo: sensores, actuadores e indicadores.

- El ESP32 la descarga (GET /devices/<id>/config) y se adapta sin reflashear.
- Las variables estándar (vwc_raw, air_t…) van a columnas de `telemetry`; las demás, a `telemetry.extra` (JSONB).
- Los indicadores son fórmulas sobre las variables (p. ej. `air_t - soil_t`) que el servidor calcula al guardar cada lectura.
"""

import ast
import json
import math
import re
from typing import Literal

import asyncpg
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
COLUMN_KEYS = {"vwc_raw", "soil_t", "ph", "ec", "n", "p", "k", "air_t", "air_rh", "lux", "tank_ok", "pump_on", "pump_ma"}
DERIVED_KEYS = {"vwc_pct", "vpd_kpa"}                      # calculadas por el servidor; reservadas
# Hardware soportado: DHT11, humedad de suelo capacitiva (analógica), DS18B20 enterrado, 4 LDR (analógicas),
# ultrasonido HC-SR04 (nivel del tanque), mini bomba y luz externa (relé), servo y pantalla OLED 0.91" (I2C).
SENSOR_DRIVERS = ("analog", "dht_t", "dht_h", "ds18b20", "hcsr04", "simulated")
ACTUATOR_DRIVERS = ("relay", "servo")
LEGACY_DRIVERS = {"digital", "bh1750", "digital_out", "pwm"}      # ya no existen: se avisa al guardar
I2C_PINS = {21, 22}                                               # SDA/SCL de la pantalla OLED
TANK_LOW_PCT = 15.0                                               # por debajo, tank_ok = False (alerta de tanque bajo)

# GPIO del ESP32 DevKit: 6-11 son la flash; 34-39 solo entrada; ADC2 no funciona con WiFi encendido
BAD_PINS = {6, 7, 8, 9, 10, 11, 20, 24, 28, 29, 30, 31}
INPUT_ONLY = {34, 35, 36, 37, 38, 39}
ADC2_PINS = {0, 2, 4, 12, 13, 14, 15, 25, 26, 27}
ADC1_PINS = {32, 33, 34, 35, 36, 37, 38, 39}

DRIVER_CATALOG = [
    {"driver": "analog", "kind": "sensor", "label": "Analógico (suelo, LDR)", "needs_pin": True,
     "help": "Lee un voltaje. Valor = lectura × escala + desplazamiento. Usa pines ADC1 (32-39): ADC2 falla con WiFi."},
    {"driver": "dht_t", "kind": "sensor", "label": "DHT11 · temperatura del aire", "needs_pin": True,
     "help": "param = 11 (DHT11). Requiere la librería «DHT sensor library» (Adafruit)."},
    {"driver": "dht_h", "kind": "sensor", "label": "DHT11 · humedad del aire", "needs_pin": True, "help": "Mismo pin y param que la temperatura."},
    {"driver": "ds18b20", "kind": "sensor", "label": "DS18B20 · temperatura del suelo", "needs_pin": True,
     "help": "Sonda enterrada. Pin de datos con resistencia de 4,7 kΩ a 3,3 V. Requiere OneWire y DallasTemperature."},
    {"driver": "hcsr04", "kind": "sensor", "label": "Ultrasonido HC-SR04 (distancia)", "needs_pin": True,
     "help": "Pin = TRIG, param = ECHO. Mide la distancia en cm hasta el agua. El ECHO sale a 5 V: bájalo a 3,3 V con un divisor de 2 resistencias."},
    {"driver": "simulated", "kind": "sensor", "label": "Simulado (pruebas)", "needs_pin": False,
     "help": "Valor aleatorio entre sim_min y sim_max, para probar sin hardware."},
    {"driver": "relay", "kind": "actuator", "label": "Relé (bomba, luz externa)", "needs_pin": True,
     "help": "Salida digital con tiempo máximo de seguridad: nunca queda encendido más que max_seconds."},
    {"driver": "servo", "kind": "actuator", "label": "Servo", "needs_pin": True,
     "help": "Postigo de la luz indirecta: al abrir va a angle_on y SE QUEDA ahí hasta que lo cierren (vuelve a angle_off). 0-180°. Alimentalo con 5 V externos, no desde el pin del ESP32."},
]


class Sensor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str = Field(min_length=1, max_length=40)
    driver: Literal["analog", "dht_t", "dht_h", "ds18b20", "hcsr04", "simulated"]
    pin: int | None = Field(default=None, ge=0, le=39)
    param: int | None = Field(default=None, ge=0, le=255)
    unit: str = Field(default="", max_length=12)
    scale: float = Field(default=1.0, allow_inf_nan=False)
    offset: float = Field(default=0.0, allow_inf_nan=False)
    sim_min: float | None = Field(default=None, allow_inf_nan=False)
    sim_max: float | None = Field(default=None, allow_inf_nan=False)
    min_ok: float | None = Field(default=None, allow_inf_nan=False)
    max_ok: float | None = Field(default=None, allow_inf_nan=False)
    enabled: bool = True

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v) or v in DERIVED_KEYS:
            raise ValueError("nombre inválido: minúsculas, números y _ (1-32), y no puede ser vwc_pct/vpd_kpa")
        return v


class Actuator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str = Field(min_length=1, max_length=40)
    driver: Literal["relay", "servo"] = "relay"
    pin: int | None = Field(default=None, ge=0, le=39)       # None = virtual (solo simulado)
    active_high: bool = True
    angle_on: int = Field(default=90, ge=0, le=180)          # solo servo: posición al activarse
    angle_off: int = Field(default=0, ge=0, le=180)          # solo servo: posición en reposo
    max_seconds: int = Field(default=120, ge=1, le=3600)
    auto_variable: str | None = None
    auto_on_below: float | None = Field(default=None, allow_inf_nan=False)
    auto_on_above: float | None = Field(default=None, allow_inf_nan=False)
    auto_off_at: float | None = Field(default=None, allow_inf_nan=False)
    auto_seconds: int = Field(default=30, ge=1, le=3600)
    cooldown_s: int = Field(default=600, ge=0, le=86400)
    enabled: bool = True

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError("nombre inválido: minúsculas, números y _ (1-32)")
        return v


class Indicator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    label: str = Field(min_length=1, max_length=40)
    formula: str = Field(min_length=1, max_length=200)
    unit: str = Field(default="", max_length=12)
    min_ok: float | None = Field(default=None, allow_inf_nan=False)
    max_ok: float | None = Field(default=None, allow_inf_nan=False)
    enabled: bool = True

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v) or v in DERIVED_KEYS or v in COLUMN_KEYS:
            raise ValueError("nombre inválido o reservado")
        return v


class Display(BaseModel):
    """Pantalla OLED 0.91" (SSD1306 128×32, I2C en GPIO 21/22). Rota entre las variables elegidas, 3 por página."""
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    driver: Literal["ssd1306_128x32"] = "ssd1306_128x32"
    address: int = Field(default=0x3C, ge=8, le=119)
    show: list[str] = Field(default_factory=list, max_length=8)   # claves de sensores/actuadores; vacío = todas
    rotate_s: int = Field(default=4, ge=2, le=60)


class DeviceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_interval_s: int = Field(default=10, ge=2, le=3600)
    sensors: list[Sensor] = Field(default_factory=list, max_length=24)
    actuators: list[Actuator] = Field(default_factory=list, max_length=8)
    indicators: list[Indicator] = Field(default_factory=list, max_length=16)
    display: Display = Field(default_factory=Display)

    @model_validator(mode="after")
    def _coherent(self):
        keys = [s.key for s in self.sensors] + [i.key for i in self.indicators]
        dup = {k for k in keys if keys.count(k) > 1}
        if dup:
            raise ValueError(f"nombres repetidos entre sensores e indicadores: {', '.join(sorted(dup))}")
        akeys = [a.key for a in self.actuators]
        if len(set(akeys)) != len(akeys):
            raise ValueError("actuadores con el mismo nombre")
        sensor_keys = {s.key for s in self.sensors if s.enabled}
        for a in self.actuators:
            if a.auto_variable is not None and a.auto_variable not in sensor_keys:
                raise ValueError(f"actuador {a.key}: la variable de la regla automática «{a.auto_variable}» no es un sensor activo")
            if a.auto_variable is not None and a.auto_on_below is None and a.auto_on_above is None:
                raise ValueError(f"actuador {a.key}: define auto_on_below o auto_on_above")
        shown = {s.key for s in self.sensors if s.enabled} | set(akeys)
        for k in self.display.show:
            if k not in shown:
                raise ValueError(f"pantalla: «{k}» no es un sensor ni un actuador activo (los indicadores los calcula el servidor y el ESP32 no los tiene)")
        known = sensor_keys | {i.key for i in self.indicators} | COLUMN_KEYS | DERIVED_KEYS | {f"{a}_on" for a in akeys}
        for i in self.indicators:
            try:
                names = formula_names(i.formula)
            except ValueError as e:
                raise ValueError(f"indicador {i.key}: {e}") from e
            bad = names - known
            if bad:
                raise ValueError(f"indicador {i.key}: variables desconocidas {', '.join(sorted(bad))}")
        return self


def pin_warnings(cfg: DeviceConfig) -> list[str]:
    """Avisos de cableado (no bloquean el guardado)."""
    out: list[str] = []
    used: dict[int, str] = {}
    if cfg.display.enabled:                       # el bus I2C de la pantalla ocupa GPIO 21 y 22
        used[21], used[22] = "la pantalla OLED (SDA)", "la pantalla OLED (SCL)"
    for s in cfg.sensors:
        if not s.enabled or s.driver == "simulated":
            continue
        if s.pin is None:
            out.append(f"sensor {s.key}: falta el pin")
            continue
        _check(out, used, s.pin, f"sensor {s.key}", shared=s.driver in ("dht_t", "dht_h"))
        if s.driver == "analog" and s.pin in ADC2_PINS:
            out.append(f"sensor {s.key}: el pin {s.pin} es ADC2 y no lee con WiFi encendido; usa uno de 32-39")
        if s.driver == "analog" and s.pin not in ADC1_PINS | ADC2_PINS:
            out.append(f"sensor {s.key}: el pin {s.pin} no tiene ADC")
        if s.driver in ("dht_t", "dht_h") and s.param != 11:
            out.append(f"sensor {s.key}: param debe ser 11 (DHT11)")
        if s.driver == "hcsr04":
            if s.pin in INPUT_ONLY:
                out.append(f"sensor {s.key}: TRIG (pin {s.pin}) es una salida y ese pin es solo de entrada")
            if s.param is None:
                out.append(f"sensor {s.key}: falta el pin ECHO (param)")
            else:
                _check(out, used, s.param, f"sensor {s.key} (ECHO)")
    for s in cfg.sensors:
        if s.enabled and s.driver == "simulated" and (s.sim_min is None or s.sim_max is None or s.sim_min > s.sim_max):
            out.append(f"sensor {s.key}: define sim_min ≤ sim_max")
    for a in cfg.actuators:
        if a.enabled and a.pin is not None:
            _check(out, used, a.pin, f"actuador {a.key}")
            if a.pin in INPUT_ONLY:
                out.append(f"actuador {a.key}: el pin {a.pin} es solo de entrada")
        if a.enabled and a.driver == "servo" and a.angle_on == a.angle_off:
            out.append(f"actuador {a.key}: angle_on y angle_off son iguales: el postigo no se movería")
    return out


def legacy_warnings(raw: dict) -> list[str]:
    """Avisos para una configuración guardada con hardware que ya no está soportado (no se puede validar)."""
    bad = sorted({x["driver"] for x in list(raw.get("sensors", [])) + list(raw.get("actuators", [])) if x.get("driver") in LEGACY_DRIVERS})
    if not bad:
        return []
    return [f"La configuración guardada usa hardware que ya no se soporta ({', '.join(bad)}). "
            "Pulsa «Cargar hardware confirmado», revisa los pines y guarda."]


def _check(out: list[str], used: dict[int, str], pin: int, who: str, shared: bool = False) -> None:
    if pin in BAD_PINS:
        out.append(f"{who}: el pin {pin} está reservado por la memoria flash del ESP32")
    if pin in used and not (shared and used[pin].endswith("*")):
        out.append(f"{who}: el pin {pin} ya lo usa {used[pin].rstrip('*')}")
    used.setdefault(pin, who + ("*" if shared else ""))


# ------------------------------------------------------------------ fórmulas seguras -------

_FUNCS = {"min": min, "max": max, "abs": abs, "round": round, "sqrt": math.sqrt, "exp": math.exp, "log": math.log, "pow": pow}
_BIN = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv)
_CMP = (ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq)


def _walk(node, names: set[str]) -> None:
    if isinstance(node, ast.Expression):
        _walk(node.body, names)
    elif isinstance(node, ast.BinOp) and isinstance(node.op, _BIN):
        _walk(node.left, names); _walk(node.right, names)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Not)):
        _walk(node.operand, names)
    elif isinstance(node, ast.Constant) and isinstance(node.value, (int, float, bool)):
        pass
    elif isinstance(node, ast.Name):
        if node.id in _FUNCS:
            raise ValueError(f"«{node.id}» es una función: úsala con paréntesis")
        names.add(node.id)
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        for a in node.args:
            _walk(a, names)
    elif isinstance(node, ast.IfExp):
        _walk(node.test, names); _walk(node.body, names); _walk(node.orelse, names)
    elif isinstance(node, ast.Compare) and all(isinstance(o, _CMP) for o in node.ops):
        _walk(node.left, names)
        for c in node.comparators:
            _walk(c, names)
    elif isinstance(node, ast.BoolOp):
        for v in node.values:
            _walk(v, names)
    else:
        raise ValueError(f"expresión no permitida ({type(node).__name__})")


class _Floaty(ast.NodeTransformer):
    """Constantes enteras -> float: así 9**9**9 desborda al instante en vez de calcular un entero gigante."""

    def visit_Constant(self, node):
        if isinstance(node.value, int) and not isinstance(node.value, bool):
            return ast.copy_location(ast.Constant(float(node.value)), node)
        return node


def formula_names(formula: str) -> set[str]:
    """Variables que usa la fórmula; falla si contiene algo que no sea aritmética/comparaciones/min/max/…"""
    try:
        tree = ast.parse(formula.strip(), mode="eval")
    except SyntaxError as e:
        raise ValueError("fórmula con error de sintaxis") from e
    names: set[str] = set()
    _walk(tree, names)
    return names


def eval_formula(formula: str, env: dict) -> float | None:
    """None si falta alguna variable o hay un error matemático (división por cero…)."""
    try:
        names = formula_names(formula)
        if any(env.get(n) is None for n in names):
            return None
        scope = {n: float(env[n]) if not isinstance(env[n], bool) else env[n] for n in names}
        tree = ast.fix_missing_locations(_Floaty().visit(ast.parse(formula.strip(), mode="eval")))
        v = eval(compile(tree, "<formula>", "eval"), {"__builtins__": {}, **_FUNCS}, scope)  # noqa: S307 (AST ya validado)
        v = float(v)
        return round(v, 4) if math.isfinite(v) else None
    except (ValueError, ZeroDivisionError, OverflowError, TypeError):
        return None


# ------------------------------------------------------------------ persistencia -----------

async def load_config(pool: asyncpg.Pool, device_id: str) -> dict | None:
    dev = await pool.fetchrow("SELECT config_version, report_interval_s, display FROM devices WHERE device_id = $1", device_id)
    if dev is None:
        return None
    sensors = await pool.fetch("SELECT * FROM device_sensors WHERE device_id = $1 ORDER BY position, id", device_id)
    acts = await pool.fetch("SELECT * FROM device_actuators WHERE device_id = $1 ORDER BY position, id", device_id)
    inds = await pool.fetch("SELECT * FROM device_indicators WHERE device_id = $1 ORDER BY position, id", device_id)

    def clean(r, drop=("id", "device_id", "position")):
        d = {k: v for k, v in dict(r).items() if k not in drop}
        if "offset_v" in d:
            d["offset"] = d.pop("offset_v")
        return d

    disp = dev["display"]
    disp = json.loads(disp) if isinstance(disp, str) else (disp or Display().model_dump())
    return {
        "device_id": device_id, "version": dev["config_version"], "report_interval_s": dev["report_interval_s"],
        "sensors": [clean(r) for r in sensors], "actuators": [clean(r) for r in acts], "indicators": [clean(r) for r in inds],
        "display": disp,
    }


async def save_config(pool: asyncpg.Pool, device_id: str, cfg: DeviceConfig) -> int:
    """Reemplaza toda la configuración en una transacción y sube la versión. Devuelve la versión nueva."""
    async with pool.acquire() as con:
        async with con.transaction():
            ver = await con.fetchval(
                "UPDATE devices SET config_version = config_version + 1, report_interval_s = $2, display = $3::jsonb WHERE device_id = $1 RETURNING config_version",
                device_id, cfg.report_interval_s, json.dumps(cfg.display.model_dump()))
            if ver is None:
                raise KeyError(device_id)
            for t in ("device_sensors", "device_actuators", "device_indicators"):
                await con.execute(f"DELETE FROM {t} WHERE device_id = $1", device_id)
            for i, s in enumerate(cfg.sensors):
                await con.execute(
                    "INSERT INTO device_sensors (device_id, position, key, label, driver, pin, param, unit, scale, offset_v, sim_min, sim_max, min_ok, max_ok, enabled)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
                    device_id, i, s.key, s.label, s.driver, s.pin, s.param, s.unit, s.scale, s.offset, s.sim_min, s.sim_max, s.min_ok, s.max_ok, s.enabled)
            for i, a in enumerate(cfg.actuators):
                await con.execute(
                    "INSERT INTO device_actuators (device_id, position, key, label, driver, pin, active_high, angle_on, angle_off, max_seconds, auto_variable, auto_on_below, auto_on_above, auto_off_at, auto_seconds, cooldown_s, enabled)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
                    device_id, i, a.key, a.label, a.driver, a.pin, a.active_high, a.angle_on, a.angle_off, a.max_seconds, a.auto_variable, a.auto_on_below, a.auto_on_above, a.auto_off_at, a.auto_seconds, a.cooldown_s, a.enabled)
            for i, n in enumerate(cfg.indicators):
                await con.execute(
                    "INSERT INTO device_indicators (device_id, position, key, label, formula, unit, min_ok, max_ok, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    device_id, i, n.key, n.label, n.formula, n.unit, n.min_ok, n.max_ok, n.enabled)
    return ver


def config_hardware_confirmado() -> DeviceConfig:
    """Hardware confirmado: DHT11, humedad de suelo capacitiva, DS18B20 enterrado, 4 LDR en las esquinas,
    ultrasonido HC-SR04 (nivel del tanque), mini bomba, luz externa, servo (abre y cierra la luz indirecta) y pantalla OLED 0.91".

    Pines (ESP32 DevKit):  DHT11 → 4 · suelo → 36 · DS18B20 → 18 · LDR → 32/33/34/35 (todos ADC1)
    HC-SR04 → TRIG 23, ECHO 19 · bomba → 26 · luz externa → 27 · servo → 13 · OLED I2C → SDA 21, SCL 22.
    """
    ldr = lambda k, lab, pin: Sensor(key=k, label=lab, driver="analog", pin=pin, unit="%", scale=100 / 4095, min_ok=15)  # noqa: E731
    return DeviceConfig(
        report_interval_s=10,
        sensors=[
            Sensor(key="air_t", label="Temp. aire", driver="dht_t", pin=4, param=11, unit="°C", min_ok=15, max_ok=32),
            Sensor(key="air_rh", label="Humedad aire", driver="dht_h", pin=4, param=11, unit="%", min_ok=40, max_ok=85),
            Sensor(key="vwc_raw", label="Humedad suelo (ADC)", driver="analog", pin=36),
            Sensor(key="soil_t", label="Temp. suelo", driver="ds18b20", pin=18, unit="°C", min_ok=15, max_ok=28),
            ldr("ldr_nw", "Luz esquina NO", 32), ldr("ldr_ne", "Luz esquina NE", 33),
            ldr("ldr_sw", "Luz esquina SO", 34), ldr("ldr_se", "Luz esquina SE", 35),
            Sensor(key="tank_cm", label="Distancia al agua", driver="hcsr04", pin=23, param=19, unit="cm"),
        ],
        actuators=[
            Actuator(key="pump", label="Mini bomba", driver="relay", pin=26, max_seconds=120),
            Actuator(key="light", label="Luz externa", driver="relay", pin=27, max_seconds=3600),
            Actuator(key="servo", label="Luz indirecta", driver="servo", pin=13, angle_on=90, angle_off=0, max_seconds=30),
        ],
        indicators=[
            Indicator(key="luz_media", label="Luz media (4 LDR)", formula="(ldr_nw + ldr_ne + ldr_sw + ldr_se) / 4", unit="%"),
            Indicator(key="luz_desbalance", label="Diferencia de luz entre esquinas",
                      formula="max(ldr_nw, ldr_ne, ldr_sw, ldr_se) - min(ldr_nw, ldr_ne, ldr_sw, ldr_se)", unit="%", min_ok=0, max_ok=35),
            # Calibra 15 (tanque vacío) y 3 (lleno) con la distancia real que lees con el tanque vacío y lleno.
            Indicator(key="tank_pct", label="Nivel del tanque", formula="max(0, min(100, (15 - tank_cm) / (15 - 3) * 100))", unit="%", min_ok=TANK_LOW_PCT),
        ],
        display=Display(enabled=True, show=["air_t", "air_rh", "vwc_raw", "soil_t", "tank_cm", "pump"], rotate_s=4),
    )


def default_config_esp32() -> DeviceConfig:
    """Configuración inicial de esp32-01: el hardware confirmado."""
    return config_hardware_confirmado()
