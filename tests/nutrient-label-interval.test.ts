import { describe, expect, it } from 'vitest'
import {
  intervalDistance,
  nutrientLabelReferenceInterval,
} from '../src/services/nutrientLabelInterval'

describe('nutrient label reference interval', () => {
  it('固定表示値へ表示桁と栄養素別許容差を適用する', () => {
    const interval = nutrientLabelReferenceInterval('calciumMg', {
      kind: 'fixed',
      value: 10,
      decimalPlaces: 1,
    })

    expect(interval.min).toBeCloseTo(7.96)
    expect(interval.max).toBeCloseTo(15.075)
  })

  it('表示上の0を真の0という点にしない', () => {
    const interval = nutrientLabelReferenceInterval('vitaminCMg', {
      kind: 'fixed',
      value: 0,
      decimalPlaces: 0,
    })

    expect(interval.min).toBe(0)
    expect(interval.max).toBeGreaterThan(0)
  })

  it('表示範囲はそのまま優先し、推定値表示は固定値より広くする', () => {
    expect(nutrientLabelReferenceInterval('fiberG', {
      kind: 'declared_range',
      min: 1,
      max: 2,
    })).toMatchObject({ min: 1, max: 2 })

    const fixed = nutrientLabelReferenceInterval('fiberG', {
      kind: 'fixed',
      value: 10,
      decimalPlaces: 0,
    })
    const estimated = nutrientLabelReferenceInterval('fiberG', {
      kind: 'estimated',
      value: 10,
      decimalPlaces: 0,
    })
    expect(estimated.min).toBeLessThan(fixed.min)
    expect(estimated.max).toBeGreaterThan(fixed.max)
  })

  it('区間内の誤差を0、区間外を端点からの距離にする', () => {
    expect(intervalDistance(1.5, { min: 1, max: 2 })).toBe(0)
    expect(intervalDistance(0.5, { min: 1, max: 2 })).toBe(0.5)
    expect(intervalDistance(3, { min: 1, max: 2 })).toBe(1)
  })
})
