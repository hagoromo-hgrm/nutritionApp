import { describe, expect, it } from 'vitest'
import { evaluationMetrics, pairedEvaluationMetrics, type EvaluationObservation } from '../scripts/lib/nutrientEstimatorHeldoutMetrics'
const row = (values: Partial<EvaluationObservation>): EvaluationObservation => ({ available: true, kind: 'full', point: 1, truth: 1, absoluteError: 0, signedError: 0, outsideError: 0, rangeWidth: 2, pointInside: true, overlap: true, scale: 2, largeError: false, ...values })
describe('frozen held-out metrics', () => {
  it('excludes zero labels from MAPE while retaining them in MAE and bias', () => {
    const metrics = evaluationMetrics([row({ truth: 0, absoluteError: 2, signedError: 2 }), row({ truth: 2, absoluteError: 1, signedError: -1 })], true)
    expect(metrics.positiveMapeCount).toBe(1)
    expect(metrics.positiveMapePercent).toBe(50)
    expect(metrics.fixedPointMae).toBe(3)
    expect(metrics.fixedPointBias).toBe(1)
    expect(metrics.zeroLabelCount).toBe(1)
  })
  it('keeps range references out of point truth metrics and distinguishes interval measures', () => {
    const metrics = evaluationMetrics([row({ truth: null, absoluteError: null, signedError: null, pointInside: false, overlap: true, outsideError: 1 })], false)
    expect(metrics.fixedPointCount).toBe(0)
    expect(metrics.fixedPointMae).toBeNull()
    expect(metrics.positiveMapePercent).toBeNull()
    expect(metrics.pointInsideReferenceIntervalRate).toBe(0)
    expect(metrics.intervalOverlapRate).toBe(1)
  })
  it('compares errors only on jointly available paired references', () => {
    const result = pairedEvaluationMetrics([row({ absoluteError: 4 }), row({ available: false })], [row({ absoluteError: 1, kind: 'known_only' }), row({ absoluteError: 99 })], true)
    expect(result).toMatchObject({ commonAvailableCount: 1, becameAvailableCount: 1, methodChangedCount: 1, fixedPointMaeDelta: -6 })
    expect(() => pairedEvaluationMetrics([], [row({})], true)).toThrow('paired population')
  })
  it('preserves unavailable references and reports printed and 100g scales separately', () => {
    const rows = [row({ absoluteError: 1 }), row({ available: false, kind: null, absoluteError: null, signedError: null, outsideError: null, rangeWidth: null, pointInside: null, overlap: null })]
    expect(evaluationMetrics(rows, true)).toMatchObject({ referenceCount: 2, availableCount: 1, availability: .5, fixedPointMae: 2 })
    expect(evaluationMetrics(rows, false).fixedPointMae).toBe(1)
  })
})
