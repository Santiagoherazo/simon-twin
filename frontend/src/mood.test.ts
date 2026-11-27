import { describe, expect, it } from 'vitest'
import { moodFromState, type Mood } from './mood'
import type { TwinState } from './types'

const state = (o: Partial<TwinState> = {}): TwinState => ({
  readings: { tank_ok: true } as TwinState['readings'],
  alerts: [],
  suitability: { overall: 95, variables: [] },
  ...o,
} as unknown as TwinState)

const drought = { code: 'model_drought', level: 'critical' as const, message: 'Estrés hídrico' }

describe('ánimo de la planta', () => {
  it('no llora por sequía pasada si la sonda marca húmedo', () => {
    expect(moodFromState(state({ readings: { vwc_pct: 71, tank_ok: true } as TwinState['readings'], alerts: [drought] }))).toBe('happy')
  })
  it('sí llora con la sonda seca', () => {
    expect(moodFromState(state({ readings: { vwc_pct: 25, tank_ok: true } as TwinState['readings'], alerts: [drought] }))).toBe('sad')
  })
  it('el encharcamiento sigue siendo aviso, no llanto', () => {
    const hypoxia = { code: 'model_hypoxia_warn', level: 'warn' as const, message: 'Suelo encharcado' }
    expect(moodFromState(state({ readings: { vwc_pct: 71, tank_ok: true } as TwinState['readings'], alerts: [drought, hypoxia] })) as Mood).toBe('worried')
  })
})
