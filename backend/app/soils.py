"""Parámetros hídricos por tipo de suelo/sustrato (contenido volumétrico de agua, m³/m³).

Valores medios orientativos (FAO-56, tabla 19 y literatura de sustratos). Para tu suelo
real conviene medirlos: capacidad de campo = humedad tras regar a saturación y dejar
drenar 24-48 h; punto de marchitez ≈ humedad con la planta marchita sin recuperarse.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Soil:
    id: str
    name: str
    theta_sat: float   # saturación
    theta_fc: float    # capacidad de campo
    theta_wp: float    # punto de marchitez permanente

    @property
    def taw_per_cm(self) -> float:
        """Agua útil total por cm de profundidad, en mm."""
        return (self.theta_fc - self.theta_wp) * 10.0


SOILS: dict[str, Soil] = {
    s.id: s
    for s in [
        Soil("arenoso", "Arenoso", 0.43, 0.12, 0.05),
        Soil("franco_arenoso", "Franco arenoso", 0.41, 0.18, 0.08),
        Soil("franco", "Franco", 0.46, 0.27, 0.12),
        Soil("franco_arcilloso", "Franco arcilloso", 0.48, 0.34, 0.20),
        Soil("arcilloso", "Arcilloso", 0.50, 0.40, 0.27),
        Soil("sustrato", "Sustrato de maceta (turba/perlita)", 0.70, 0.50, 0.15),
    ]
}


def get_soil(soil_id: str) -> Soil:
    try:
        return SOILS[soil_id]
    except KeyError:
        raise ValueError(f"tipo de suelo desconocido: {soil_id!r} (válidos: {', '.join(SOILS)})")
