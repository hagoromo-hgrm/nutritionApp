import { describe, expect, it } from 'vitest'
import {
  intervalContains,
  intervalDistance,
  intervalSeparationDistance,
  normalizedIntervalHuberLoss,
  nutrientLabelReferenceInterval,
  nutrientReferenceNormalizationScale,
} from '../src/services/nutrientLabelInterval'

describe('nutrient label reference interval', () => {
  it('fixed labels use 2026 relative tolerances without adding display rounding width', () => {
    const calcium = nutrientLabelReferenceInterval('calciumMg', {
      kind: 'fixed',
      value: 10,
      decimalPlaces: 1,
    })
    const vitaminB1 = nutrientLabelReferenceInterval('vitaminB1Mg', {
      kind: 'fixed',
      value: 10,
      decimalPlaces: 0,
    })

    expect(calcium).toMatchObject({ min: 8, max: 15, maxInclusive: true, basisMode: 'relative_only' })
    expect(vitaminB1).toMatchObject({ min: 8, max: 18, maxInclusive: true })
    expect(calcium.ruleVersion).toBe('caa-label-tolerance-2026-10-01-v1')
  })

  it('applies low-content split intervals to g and ml bases at their own scale', () => {
    expect(nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2 }, { amount: 100, unit: 'g' }))
      .toMatchObject({ min: 1.5, max: 2.5, maxInclusive: false, basisMode: 'caa_low_content' })
    const nearThreshold = nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2.4 }, { amount: 100, unit: 'g' })
    expect(nearThreshold)
      .toMatchObject({ min: 1.9, max: 2.88, maxInclusive: true })
    expect(nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2.5 }, { amount: 100, unit: 'g' }))
      .toMatchObject({ min: 2, max: 3, maxInclusive: true })
    const aboveThreshold = nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 3 }, { amount: 100, unit: 'g' })
    expect(aboveThreshold)
      .toMatchObject({ min: 2.5, max: 3.6, maxInclusive: true })
    expect(intervalContains(3.6, aboveThreshold)).toBe(true)
    expect(nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 0.6 }, { amount: 30, unit: 'ml' }))
      .toMatchObject({ min: 0.45, max: 0.75, maxInclusive: false })
  })

  it('zero labels remain a positive-width, exclusive interval when the basis is explicit', () => {
    const interval = nutrientLabelReferenceInterval(
      'fatG',
      { kind: 'fixed', value: 0, decimalPlaces: 0 },
      { amount: 100, unit: 'g' },
    )

    expect(interval).toMatchObject({ min: 0, max: 0.5, minInclusive: true, maxInclusive: false })
    expect(intervalContains(0, interval)).toBe(true)
    expect(intervalContains(0.5, interval)).toBe(false)
    expect(intervalDistance(0.5, interval)).toBe(0)
  })

  it('uses relative-only tolerance and marks unknown basis instead of inferring density', () => {
    const interval = nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2 })
    expect(interval).toMatchObject({ min: 1.6, max: 2.4, basisMode: 'relative_only', basisStatus: 'unknown' })
    expect(nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2 }, null))
      .toEqual(interval)
  })

  it('uses energy, saturated-fat and salt-equivalent low-content thresholds', () => {
    expect(nutrientLabelReferenceInterval('energyKcal', { kind: 'fixed', value: 10 }, { amount: 100, unit: 'g' }))
      .toMatchObject({ min: 5, max: 15, maxInclusive: true })
    const saturatedFat = nutrientLabelReferenceInterval('saturatedFatG', { kind: 'fixed', value: 0.4 }, { amount: 100, unit: 'g' })
    expect(saturatedFat)
      .toMatchObject({ min: 0.3, max: 0.5, maxInclusive: false })
    expect(intervalContains(0.3, saturatedFat)).toBe(true)
    expect(intervalContains(0.5, saturatedFat)).toBe(false)
    expect(nutrientLabelReferenceInterval('saltG', { kind: 'fixed', value: 0.05 }, { amount: 100, unit: 'g' }))
      .toMatchObject({ min: 0.0373, max: 0.0627, maxInclusive: true })
  })

  it('keeps declared ranges unchanged and rejects estimated label references', () => {
    expect(nutrientLabelReferenceInterval('fiberG', {
      kind: 'declared_range',
      min: 1,
      max: 2,
    })).toMatchObject({ min: 1, max: 2, minInclusive: true, maxInclusive: true, basisMode: 'declared_range' })

    expect(() => nutrientLabelReferenceInterval('fiberG', { kind: 'estimated', value: 10 }))
      .toThrow(/推定表示値/)
  })

  it('rejects nonfinite, negative, reversed and malformed input', () => {
    expect(() => nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: Number.NaN }))
      .toThrow(/0以上/)
    expect(() => nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: -1 }))
      .toThrow(/0以上/)
    expect(() => nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 1, decimalPlaces: 1.5 }))
      .toThrow(/表示桁数/)
    expect(() => nutrientLabelReferenceInterval('fiberG', { kind: 'declared_range', min: 2, max: 1 }))
      .toThrow(/表示範囲/)
    expect(() => nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 1 }, { amount: 0, unit: 'g' }))
      .toThrow(/表示基準量/)
  })

  it('distinguishes endpoint containment from zero boundary distance', () => {
    const interval = nutrientLabelReferenceInterval('proteinG', { kind: 'fixed', value: 2 }, { amount: 100, unit: 'g' })
    expect(intervalContains(2.5, interval)).toBe(false)
    expect(intervalDistance(2.5, interval)).toBe(0)
    expect(intervalSeparationDistance({ min: 0, max: 1 }, { min: 1, max: 2 })).toBe(0)
    expect(intervalSeparationDistance({ min: 0, max: 0.5 }, { min: 1, max: 2 })).toBe(0.5)
  })

  it('shares normalized Huber loss for overlapping and outlying prediction intervals', () => {
    const reference = { min: 8, max: 10, minInclusive: true, maxInclusive: true }
    expect(normalizedIntervalHuberLoss({ min: 8.5, max: 9.5 }, reference, 1)).toBe(0)
    expect(normalizedIntervalHuberLoss({ min: 7, max: 7 }, reference, 1)).toBe(1)
    expect(normalizedIntervalHuberLoss({ min: 6, max: 6 }, reference, 1)).toBe(3)
    expect(nutrientReferenceNormalizationScale('energyKcal', 0)).toBe(0.5)
    expect(nutrientReferenceNormalizationScale('proteinG', 10)).toBe(0.2)
    expect(nutrientReferenceNormalizationScale('proteinG', 0)).toBe(0.05)
  })
})
