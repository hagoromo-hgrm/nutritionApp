import { describe, expect, it } from 'vitest'
import {
  ESTIMATABLE_NUTRIENT_KEYS,
  estimateNutrients,
  type NutrientEstimateRequest,
} from '../src/services/nutrientEstimator'
import contract from './fixtures/estimation-contract/core-invariants.json'

function makeRequest(): NutrientEstimateRequest {
  return {
    requestId: 'shared-contract-browser',
    productName: contract.scenario.name,
    baseAmount: 1,
    baseUnit: '袋',
    referenceMassG: contract.scenario.referenceMassG,
    referenceMassSource: '共有推計契約fixture',
    ingredientsText: contract.scenario.ingredientsText,
    ingredientsSource: { provider: 'shared_contract', verified: true },
    knownNutrients: contract.scenario.knownNutrients,
    requestedNutrients: ESTIMATABLE_NUTRIENT_KEYS,
    requestedAt: '2026-07-30T00:00:00.000Z',
  }
}

describe('browser/Python共有推計契約', () => {
  it('本番の役割、対象栄養素、決定性、比率、内訳上限を満たす', () => {
    expect(contract.roles.production).toBe('browser-typescript')
    expect(contract.supportedNutrients).toEqual(ESTIMATABLE_NUTRIENT_KEYS)

    const first = estimateNutrients(makeRequest())
    const second = estimateNutrients(makeRequest())
    expect(first).toEqual(second)

    const trace = first.optimization?.trace
    expect(trace?.ingredientNames).toEqual(contract.scenario.expectedIngredientNames)
    expect(trace?.ingredientRatios).toHaveLength(contract.scenario.expectedIngredientNames.length)
    const ratios = trace?.ingredientRatios ?? []
    expect(Math.abs(
      ratios.reduce((total, ratio) => total + ratio, 0) - contract.invariants.ratioSum,
    )).toBeLessThanOrEqual(contract.invariants.ratioTolerance)
    expect(ratios.every((ratio) => ratio >= 0)).toBe(contract.invariants.ratiosAreNonNegative)
    expect(ratios.every((ratio, index) => index === 0 || ratios[index - 1] >= ratio)).toBe(
      contract.invariants.ratiosAreNonIncreasing,
    )

    for (const bound of contract.invariants.compositionUpperBounds) {
      const estimate = first.estimates[bound.nutrient as keyof typeof first.estimates]
      expect(estimate.status).toBe('available')
      if (estimate.status !== 'available') continue
      expect(estimate.value).toBeLessThanOrEqual(bound.maximum)
      expect(estimate.range.max).toBeLessThanOrEqual(bound.maximum)
    }
  })
})
