"""Perfiles de cultivo: base de conocimiento declarativa (YAML), sin lógica por cultivo.
Agregar un cultivo = agregar un archivo en app/profiles/."""

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, model_validator

PROFILES_DIR = Path(__file__).parent / "profiles"

DEFAULT_WEIGHTS = {
    "soil_moisture": 3.0, "air_t": 1.5, "soil_t": 1.0, "ph": 1.0, "ec": 0.5,
    "n": 1.0, "p": 1.0, "k": 1.0, "vpd_kpa": 1.0, "light": 0.5,
}


class Stage(BaseModel):
    code: str
    name: str
    gdd_start: float = Field(ge=0)
    kc: float = Field(gt=0, le=2)
    root_depth_cm: float = Field(gt=0, le=300)
    optimal: dict[str, list[float]] = {}


class PlantVisual(BaseModel):
    max_height_cm: float
    height_full_gdd: float
    max_leaves: int
    leaves_full_gdd: float
    max_lai: float
    tassel_from_stage: str | None = None
    fruit_from_stage: str | None = None


class CropProfile(BaseModel):
    id: str
    name: str
    scientific: str = ""
    note: str = ""
    gdd: dict[str, float]
    water: dict[str, float]
    optimal: dict[str, list[float]]
    weights: dict[str, float] = {}
    stages: list[Stage]
    plant_visual: PlantVisual

    @model_validator(mode="after")
    def _check(self):
        starts = [s.gdd_start for s in self.stages]
        if not starts or starts[0] != 0 or starts != sorted(starts):
            raise ValueError(f"{self.id}: las etapas deben empezar en 0 y estar ordenadas por gdd_start")
        for var, rng in self.optimal.items():
            if len(rng) != 2 or rng[0] >= rng[1]:
                raise ValueError(f"{self.id}: rango inválido para {var}: {rng}")
        return self

    @property
    def base_c(self) -> float:
        return self.gdd["base_c"]

    @property
    def cap_c(self) -> float:
        return self.gdd["cap_c"]

    @property
    def p_depletion(self) -> float:
        return self.water["p_depletion"]

    def weight(self, var: str) -> float:
        return self.weights.get(var, DEFAULT_WEIGHTS.get(var, 1.0))

    def stage_index(self, gdd: float) -> int:
        idx = 0
        for i, s in enumerate(self.stages):
            if gdd >= s.gdd_start:
                idx = i
        return idx

    def stage_progress_pct(self, gdd: float) -> float:
        i = self.stage_index(gdd)
        start = self.stages[i].gdd_start
        end = self.stages[i + 1].gdd_start if i + 1 < len(self.stages) else self.gdd.get("maturity", start + 1)
        return round(max(0.0, min(100.0, (gdd - start) / max(end - start, 1e-6) * 100.0)), 1)

    def optimal_for(self, stage_idx: int) -> dict[str, list[float]]:
        merged = dict(self.optimal)
        merged.update(self.stages[stage_idx].optimal)
        return merged


@lru_cache(maxsize=1)
def load_profiles() -> dict[str, CropProfile]:
    profiles: dict[str, CropProfile] = {}
    for path in sorted(PROFILES_DIR.glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        p = CropProfile.model_validate(data)
        profiles[p.id] = p
    return profiles


def get_crop(crop_id: str) -> CropProfile:
    profiles = load_profiles()
    try:
        return profiles[crop_id]
    except KeyError:
        raise ValueError(f"cultivo desconocido: {crop_id!r} (válidos: {', '.join(profiles)})")
