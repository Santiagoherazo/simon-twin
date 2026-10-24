// Medidas de la escena (1 unidad = 10 cm). La cara superior de la mesa está en y = 0.
export const SOIL_TOP = 2.05
// Matera de cultivo interior: base negra ancha, ventana del sustrato y ventana del nivel de agua, lámpara LED en poste.
export const PLANTER_W = 5.8
export const PLANTER_D = 2.6
export const PLANTER_WALL = 0.12
export const FRONT_Z = PLANTER_D / 2 - PLANTER_WALL // cara frontal interior (donde se ve el corte)
export const PLANT_POS: [number, number, number] = [-1.5, SOIL_TOP, 0.05]
export const FLOOR_Y = -6.8
export const TABLE_W = 12
export const TABLE_D = 6.6
export const TANK_POS: [number, number, number] = [2.17, 0, PLANTER_D / 2]
export const PUMP_POS: [number, number, number] = [2.9, 0, 0.3]
export const NOZZLE: [number, number, number] = [-0.55, 3.2, 0.5]
export const PROBE_POS: [number, number, number] = [-0.75, 0, FRONT_Z + 0.03]

/** Punto al que se acerca la cámara al pulsar cada parte. */
export const FOCUS_TARGET: Record<'soil' | 'tank' | 'plant', [number, number, number]> = {
  soil: [-1.5, 1.2, 0.6],
  tank: [2.2, 1.1, 0.8],
  plant: [-1.5, 4.6, 0],
}

/** Estado de la lámpara (la escribe Planter cada fotograma; lo lee Lights para colocar el foco). */
export const lamp = { y: 6.4, on: 0.5 }
