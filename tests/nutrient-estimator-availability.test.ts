import { describe, expect, it } from 'vitest'
import summaryJson from '../docs/analysis/spu_estimator_evaluation.json'

interface MetricSummary {
  referenceCount: number
  availableCount: number
  availabilityPercent: number
}

interface AvailabilitySummary {
  modelVersion: string
  numericAvailabilityGate: {
    targetPercent: number
    actualPercent: number
    passed: boolean
  }
  methodology: {
    knownOnlyPartialValuesExcludedFromCalibration: boolean
    genrePriorValuesExcludedFromCalibration: boolean
  }
  overall: MetricSummary
  byEstimateKind: {
    full: MetricSummary
    knownOnly: MetricSummary
    genrePrior: MetricSummary
  }
  limitationReasons: {
    overall: Array<{
      code: string
      label: string
      count: number
      partialAvailableCount: number
      genrePriorAvailableCount: number
      unavailableCount: number
    }>
  }
}

const summary = summaryJson as AvailabilitySummary
const summaryText = JSON.stringify(summary)

describe('nutrient estimator numeric availability gate', () => {
  it('部分参考値を分離したまま数値提示率80%を満たす', () => {
    expect(summary.modelVersion).toBe('browser-rule-0.19.0')
    expect(summary.numericAvailabilityGate).toMatchObject({
      targetPercent: 80,
      passed: true,
    })
    expect(summary.numericAvailabilityGate.actualPercent).toBeGreaterThanOrEqual(80)
    expect(summary.overall.availableCount).toBe(
      summary.byEstimateKind.full.availableCount
      + summary.byEstimateKind.knownOnly.availableCount
      + summary.byEstimateKind.genrePrior.availableCount,
    )
    expect(summary.methodology.knownOnlyPartialValuesExcludedFromCalibration).toBe(true)
    expect(summary.methodology.genrePriorValuesExcludedFromCalibration).toBe(true)
  })

  it('対策対象となる理由を機械集計し、個別商品情報を公開集計へ含めない', () => {
    expect(summary.limitationReasons.overall).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ingredient_unresolved', label: '原材料未解決' }),
      expect.objectContaining({ code: 'reference_value_missing', label: '参照値欠損' }),
      expect.objectContaining({ code: 'additive_contribution_unknown', label: '添加物寄与割合不明' }),
    ]))
    expect(summary.limitationReasons.overall.every((reason) => (
      reason.count === reason.partialAvailableCount
        + reason.genrePriorAvailableCount
        + reason.unavailableCount
    ))).toBe(true)
    expect(summaryText).not.toContain('"recordId"')
    expect(summaryText).not.toContain('"productName"')
    expect(summaryText).not.toContain('"ingredientsText"')
  })
})
