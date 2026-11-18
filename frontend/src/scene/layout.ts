// Medidas de la escena (1 unidad = 10 cm). La cara superior de la mesa está en y = 0.
// La maqueta viene del CAD (cad/simon_matera.py → public/maqueta.json) en mm con Z hacia arriba y el frente en −Y;
// MS la pasa a unidades de escena y Maqueta.tsx la gira a Y arriba (el frente queda hacia la cámara, +Z).
export const MS = 0.0195
export const SOIL_TOP = 93.5 * MS // cara superior del sustrato
/** Bandeja de tierra: 206 × 117 mm centrada en x = −35.5 mm del modelo. */
export const PLANTER_W = 200 * MS
export const PLANTER_D = 111 * MS
export const PLANTER_WALL = 0
export const PLANT_POS: [number, number, number] = [-35.5 * MS, SOIL_TOP, 0]
export const FLOOR_Y = -6.8
export const TABLE_W = 12
export const TABLE_D = 6.6
export const TANK_POS: [number, number, number] = [105 * MS, 0, 0]
export const PUMP_POS: [number, number, number] = [168 * MS, 0, 0]
export const PROBE_POS: [number, number, number] = [-45 * MS, 0, -52 * MS]

/** Punto al que se acerca la cámara al pulsar cada parte. */
export const FOCUS_TARGET: Record<'soil' | 'tank' | 'plant', [number, number, number]> = {
  soil: [PLANT_POS[0], 1.6, 0.3],
  tank: [TANK_POS[0], 1.1, 0.3],
  plant: [PLANT_POS[0], 4.4, 0],
}

/** Estado de la lámpara (la escribe Maqueta cada fotograma; lo lee Lights para colocar el foco). */
export const lamp = { y: 6.2, on: 0.5, z: -0.5 }
