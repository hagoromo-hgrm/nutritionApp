import { describe, expect, it } from 'vitest'
import type { NutrientEstimateAdoption } from '../src/components/NutrientEstimatePanel'
import { emptyFoodDraft, foodToDraft, queueFoodEstimateAdoption, queueFoodEstimateEvaluation, queueFoodEstimateRejection, withoutPendingEstimation } from '../src/components/formDrafts'
import type { Food } from '../src/types'
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
  it('食品編集で既存の入力用単位換算をすべて保持する', () => {
    const food: Food = {
      id: 'potato', name: 'じゃがいも 塊茎 皮なし 生', maker: '', barcode: '', source: 'mext', sourceVersion: 'test',
      baseAmount: 100, baseUnit: 'g', servingAmount: 1, servingUnit: '個',
      inputUnitConversions: [{ unit: '個', baseAmount: 90 }, { unit: '袋', baseAmount: 450 }],
      nutrients: { energyKcal: 59, proteinG: 1.8, fatG: 0.1, carbohydrateG: 17.3, fiberG: 8.9, saltG: 0, calciumMg: 4, ironMg: 0.4, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.08, vitaminB2Mg: 0.03, vitaminCMg: 28, saturatedFatG: 0.01 },
      createdAt: '', updatedAt: '',
    }

    expect(foodToDraft(food, undefined, [], []).inputUnitConversions).toEqual([
      { unit: '個', baseAmount: '90' },
      { unit: '袋', baseAmount: '450' },
    ])
  })

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
