from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Telemetry(BaseModel):
    """Mensaje de telemetría (MQTT simon/<device>/telemetry o POST /ingest/<device>).
    Todos los sensores son opcionales: un dispositivo manda solo lo que tiene."""

    model_config = ConfigDict(extra="ignore")

    v: int = 1                                   # versión del esquema
    ts: float | None = Field(default=None, allow_inf_nan=False)   # epoch en segundos (NTP)
    vwc_raw: int | None = Field(default=None, ge=0, le=4095)
    soil_t: float | None = Field(default=None, ge=-20, le=80, allow_inf_nan=False)   # °C suelo
    ph: float | None = Field(default=None, ge=0, le=14, allow_inf_nan=False)
    ec: float | None = Field(default=None, ge=0, le=20000, allow_inf_nan=False)     # µS/cm
    n: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)      # mg/kg
    p: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    k: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    air_t: float | None = Field(default=None, ge=-40, le=85, allow_inf_nan=False)    # °C aire
    air_rh: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)    # %
    lux: float | None = Field(default=None, ge=0, le=200000, allow_inf_nan=False)
    tank_ok: bool | None = None
    pump_on: bool | None = None
    pump_ma: float | None = Field(default=None, ge=0, le=5000, allow_inf_nan=False)


class ImportBody(BaseModel):
    """Importación masiva de histórico (p. ej. un CSV de la SD o de PLX-DAQ convertido a JSON).
    Cada fila DEBE traer ts."""
    rows: list[Telemetry] = Field(min_length=1)


class PumpCommand(BaseModel):
    seconds: int = Field(ge=1, le=600)


class DeviceCreate(BaseModel):
    device_id: str = Field(min_length=3, max_length=40)
    name: str | None = Field(default=None, max_length=80)
    crop: str = "maiz"
    soil_type: str = "franco"


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    crop: str | None = Field(default=None, max_length=40)
    soil_type: str | None = Field(default=None, max_length=40)
    vwc_raw_dry: int | None = Field(default=None, ge=0, le=4095)
    vwc_raw_wet: int | None = Field(default=None, ge=0, le=4095)
    sowing_date: str | None = Field(default=None, description="ISO 8601, p. ej. 2026-09-25")
    soil_depth_cm: float | None = Field(default=None, gt=0, le=300)
    pot_area_cm2: float | None = Field(default=None, gt=0, le=100000)
    pump_flow_ml_min: float | None = Field(default=None, gt=0, le=20000)


# ---- Simulación what-if ----------------------------------------------------------------

class SimEvent(BaseModel):
    at_hour: float = Field(ge=0, le=720)
    type: Literal["irrigation", "rain"]
    mm: float | None = Field(default=None, gt=0, le=200)
    seconds: float | None = Field(default=None, gt=0, le=3600, description="solo riego: segundos de bomba")


class SimWeather(BaseModel):
    mode: Literal["persist", "constant"] = "persist"   # persist = repite el patrón diario reciente
    temp_offset_c: float = Field(default=0.0, ge=-15, le=15)
    rh_offset: float = Field(default=0.0, ge=-40, le=40)
    lux_scale: float = Field(default=1.0, ge=0, le=3)
    # solo mode="constant": clima diario sintético
    air_t_mean: float = Field(default=24.0, ge=-5, le=45)
    air_t_amp: float = Field(default=5.0, ge=0, le=20)
    rh_mean: float = Field(default=65.0, ge=10, le=100)
    lux_peak: float = Field(default=45000.0, ge=0, le=120000)


class SimAutoIrrigation(BaseModel):
    enabled: bool = False
    mm: float = Field(default=15.0, gt=0, le=100)   # lámina por riego cuando el suelo baja del umbral


class SimOverrides(BaseModel):
    crop: str | None = None
    soil_type: str | None = None
    vwc_pct: float | None = Field(default=None, ge=0, le=100)
    gdd: float | None = Field(default=None, ge=0, le=5000)
    soil_depth_cm: float | None = Field(default=None, gt=0, le=300)


class SimulateRequest(BaseModel):
    hours: float = Field(default=72, ge=1, le=720)
    step_minutes: int = Field(default=30, ge=5, le=120)
    weather: SimWeather = SimWeather()
    events: list[SimEvent] = Field(default_factory=list, max_length=200)
    auto_irrigation: SimAutoIrrigation = SimAutoIrrigation()
    overrides: SimOverrides = SimOverrides()
