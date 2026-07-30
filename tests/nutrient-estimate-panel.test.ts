import { describe, expect, it } from 'vitest'
import {
  ESTIMATABLE_NUTRIENT_KEYS,
  requestedEstimatableNutrientKeys,
} from '../src/services/nutrientEstimator'

describe('nutrient estimate result visibility', () => {
  it('推計要求へ含めた栄養素だけを結果表示対象にする', () => {
    expect(requestedEstimatableNutrientKeys(['fiberG', 'vitaminCMg'])).toEqual(['fiberG', 'vitaminCMg'])
    expect(requestedEstimatableNutrientKeys([])).toEqual([])
  })

  it('推計対象が省略された旧形式では全対象を表示する', () => {
    expect(requestedEstimatableNutrientKeys(undefined)).toEqual(ESTIMATABLE_NUTRIENT_KEYS)
  })
})
