import { describe, expect, it } from 'vitest'
import { calibratedEstimateRange } from '../src/services/nutrientEstimatorCalibration'

describe('nutrient estimator zero calibration', () => {
  it('根拠が不確かな0には栄養素別の絶対幅を持たせる', () => {
    expect(calibratedEstimateRange({
      value: 0,
      nutrientKey: 'fiberG',
      confidence: 'low',
      zeroEvidence: 'uncertain',
    }).range).toEqual({ min: 0, max: 0.1 })
    expect(calibratedEstimateRange({
      value: 0,
      nutrientKey: 'vitaminCMg',
      confidence: 'low',
      zeroEvidence: 'uncertain',
    }).range).toEqual({ min: 0, max: 1 })
  })

  it('上位総量0から導出できる場合だけ確定した0を維持する', () => {
    expect(calibratedEstimateRange({
      value: 0,
      nutrientKey: 'fiberG',
      confidence: 'medium',
      zeroEvidence: 'derived_from_parent_zero',
    }).range).toEqual({ min: 0, max: 0 })
  })
})
