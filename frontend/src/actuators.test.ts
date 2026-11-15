import { describe, expect, it } from 'vitest'
import { dur, kindOf, toSeconds } from './actuators'

describe('tiempo libre', () => {
  it('convierte número y unidad a segundos', () => {
    expect(toSeconds('90', 's')).toBe(90)
    expect(toSeconds('2,5', 'min')).toBe(150)
    expect(toSeconds('1.5', 'h')).toBe(5400)
    expect(toSeconds(' 12 ', 'h')).toBe(43200)
  })
  it('rechaza lo que no es un tiempo válido', () => {
    for (const raw of ['', ' ', '0', '-3', 'abc', 'NaN', 'Infinity']) expect(toSeconds(raw, 'min')).toBeNull()
  })
  it('lo muestra en palabras', () => {
    expect(dur(5)).toBe('5 s')
    expect(dur(90)).toBe('1 min 30 s')
    expect(dur(900)).toBe('15 min')
    expect(dur(3600)).toBe('1 h')
    expect(dur(5400)).toBe('1 h 30 min')
    expect(dur(86400)).toBe('24 h')
  })
  it('reconoce cada actuador', () => {
    expect(kindOf({ key: 'pump', label: 'Mini bomba' })).toBe('pump')
    expect(kindOf({ key: 'light', label: 'Luz externa' })).toBe('light')
    expect(kindOf({ key: 'servo', label: 'Luz indirecta' })).toBe('servo')
  })
})
