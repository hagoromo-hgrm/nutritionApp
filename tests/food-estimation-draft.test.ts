import { describe, expect, it } from 'vitest'
import type { NutrientEstimateAdoption } from '../src/components/NutrientEstimatePanel'
import { emptyFoodDraft, queueFoodEstimateAdoption, queueFoodEstimateEvaluation, queueFoodEstimateRejection, withoutPendingEstimation } from '../src/components/formDrafts'
import { estimateNutrients, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import contract from './fixtures/estimation-contract/core-invariants.json'

function adoption(requestId: string, values: NutrientEstimateAdoption['values']): NutrientEstimateAdoption {
  const request: NutrientEstimateRequest = {
    requestId, productName: contract.scenario.name, baseAmount: 100, baseUnit: 'g',
    referenceMassG: 100, referenceMassSource: 'test',
    ingredientsText: contract.scenario.ingredientsText,
    ingredientsSource: { provider: 'test', verified: true },
    knownNutrients: contract.scenario.knownNutrients,
    requestedNutrients: ['fiberG', 'calciumMg'], requestedAt: '2026-09-12T00:00:00.000Z',
  }
  const result = estimateNutrients(request)
  return { requestId, request, result, basis: result.basis, values }
}

const fiberG = adoption('first', { fiberG: 1.23456789 })
const calciumMg = { ...fiberG, values: { calciumMg: 23.456789 } }
function stagedDraft() {
  const initial = emptyFoodDraft()
  initial.nutrients.proteinG = '12.3'
  return queueFoodEstimateAdoption(queueFoodEstimateAdoption(initial, fiberG), calciumMg)
}

describe('staged nutrient estimate decisions', () => {
  it('keeps every sequential adoption and its full precision under one request', () => {
    const draft = stagedDraft()
    expect(draft.nutrients.fiberG).toBe('1.2')
    expect(draft.nutrients.calciumMg).toBe('23.5')
    expect(draft.pendingEstimation?.adoption?.values).toEqual({ fiberG: 1.23456789, calciumMg: 23.456789 })
    expect(draft.pendingEstimation?.adoption?.requestId).toBe('first')
  })

  it('clears previous staged inputs when adopting a different request', () => {
    const next = adoption('second', { ironMg: 2.34567 })
    const draft = queueFoodEstimateAdoption(stagedDraft(), next)
    expect(draft.nutrients).toMatchObject({ fiberG: '', calciumMg: '', ironMg: '2.3', proteinG: '12.3' })
    expect(draft.pendingEstimation?.adoption?.values).toEqual({ ironMg: 2.34567 })
    expect(draft.pendingEstimation?.evaluation.request.requestId).toBe('second')
  })

  it('clears all staged inputs for a new evaluation or rejection', () => {
    const next = adoption('second', {})
    const evaluated = queueFoodEstimateEvaluation(stagedDraft(), next)
    const rejected = queueFoodEstimateRejection(stagedDraft(), fiberG, ['fiberG', 'calciumMg'])
    for (const draft of [evaluated, rejected]) {
      expect(draft.nutrients).toMatchObject({ fiberG: '', calciumMg: '', proteinG: '12.3' })
      expect(draft.pendingEstimation?.adoption).toBeNull()
    }
    expect(evaluated.pendingEstimation?.rejectedKeys).toEqual([])
    expect(rejected.pendingEstimation?.rejectedKeys).toEqual(['fiberG', 'calciumMg'])
  })

  it('clearing a decision preserves manually changed inputs', () => {
    const staged = stagedDraft()
    staged.nutrients.fiberG = '9.87'
    const draft = withoutPendingEstimation(staged)
    expect(draft.nutrients).toMatchObject({ fiberG: '9.87', calciumMg: '', proteinG: '12.3' })
    expect(draft.pendingEstimation).toBeNull()
  })
})
