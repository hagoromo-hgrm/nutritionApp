import { describe, expect, it } from 'vitest'
import type { NutrientEstimateAdoption } from '../src/components/NutrientEstimatePanel'
import { nutrientEstimatePanelRequestKey, type NutrientEstimateRequestKeyInput } from '../src/services/nutrientEstimateRequestKey'
import { emptyFoodDraft, foodToDraft, nutrientMetadataAfterManualEdit, previewToDraft, queueFoodEstimateAdoption, queueFoodEstimateEvaluation, queueFoodEstimateRejection, withoutPendingEstimation } from '../src/components/formDrafts'
import type { ExternalFoodPreview } from '../src/services/externalFoodApi'
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
  it('食品ドラフトは明示配合根拠をdeep copyして保持する', () => {
    const evidence = {
      schemaVersion: 1 as const,
      declarationFingerprint: 'ingredient-declaration:test',
      compositions: [{
        id: 'grain-blend',
        parent: { section: 'ingredient' as const, path: [0] },
        expectedChildNames: ['米粉', '水'],
        denominator: 'product' as const,
        weightStage: 'finished' as const,
        amounts: { kind: 'fractions' as const, children: [{ index: 0, value: 0.6 }, { index: 1, value: 0.4 }] },
        source: { kind: 'user_measurement' as const, reference: '計量記録', verified: true as const, checkedAt: '2026-10-04T00:00:00.000Z' },
      }],
    }
    const food: Food = {
      id: 'with_evidence', name: '配合食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
      baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null,
      nutrients: { energyKcal: null, proteinG: null, fatG: null, carbohydrateG: null, fiberG: null, saltG: null,
        calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null },
      estimationEvidence: evidence, createdAt: '', updatedAt: '',
    }

    const draft = foodToDraft(food, undefined, [], [])
    expect(draft.estimationEvidence).toEqual(evidence)
    expect(draft.estimationEvidence).not.toBe(evidence)
    expect(draft.estimationEvidence?.compositions).not.toBe(evidence.compositions)
    expect(draft.estimationEvidence?.compositions?.[0].amounts).not.toBe(evidence.compositions[0].amounts)
    expect(emptyFoodDraft().estimationEvidence).toBeUndefined()
  })

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

  it('旧推計フラグを持つ食品の確認状態をドラフトでも維持する', () => {
    const food = {
      id: 'legacy_estimated_food', name: '旧推計食品', maker: '', barcode: '', source: 'user' as const,
      sourceVersion: 'test', baseAmount: 100, baseUnit: 'g' as const, servingAmount: null, servingUnit: null,
      nutrients: {
        energyKcal: 100, proteinG: 2, fatG: 3, carbohydrateG: 10, fiberG: null, calciumMg: null,
        ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null,
        vitaminCMg: null, saturatedFatG: null, saltG: 0.1,
      },
      estimatedNutrients: { proteinG: true }, createdAt: '', updatedAt: '',
    } as Food & { estimatedNutrients: { proteinG: boolean } }

    const draft = foodToDraft(food, undefined, [], [])
    expect(draft.nutrients.proteinG).toBe('2')
    expect(draft.legacyFallbackBlocked).toBe(true)
    expect(draft.nutrientMetadata.proteinG).toBeUndefined()
  })

  it('Open Food Facts値は未確認のまま保ち、編集した栄養素だけ手入力根拠へ置き換える', () => {
    const preview: ExternalFoodPreview = {
      name: '外部商品', maker: 'メーカー', barcode: '0012345678901', quantity: '100 g', categories: [],
      ingredientsText: null, baseAmount: 100, baseUnit: 'g',
      nutrients: {
        energyKcal: 100, proteinG: 2, fatG: null, carbohydrateG: null, fiberG: null,
        calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null,
        vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null, saltG: null,
      },
    }
    const draft = previewToDraft(preview)
    const metadata = nutrientMetadataAfterManualEdit(draft.nutrientMetadata, 'proteinG', '2')

    expect(draft.nutrientMetadata.proteinG).toMatchObject({ origin: 'external_source', verified: false })
    expect(metadata.proteinG).toMatchObject({ origin: 'user_input', verified: true })
    expect(metadata.energyKcal).toMatchObject({ origin: 'external_source', verified: false })
  })

  it('同じ推計の残りを順次採用でき、手編集では古い評価を無効にする', () => {
    const allTargets = ['saturatedFatG', 'fiberG', 'calciumMg', 'ironMg', 'vitaminAMcg', 'vitaminEMg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminCMg'] as const
    const base: NutrientEstimateRequestKeyInput = {
      basis: { baseAmount: 100, baseUnit: 'g' },
      productName: 'テスト食品', estimatorGenreId: 'other_unknown', ingredientsText: null,
      referenceMassG: 100, referenceMassSource: '基準単位がg', ingredientsSource: null,
      currentNutrients: {
        saturatedFatG: null, fiberG: null, calciumMg: null, ironMg: null, vitaminAMcg: null,
        vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null,
      },
      knownNutrients: {}, knownNutrientEvidence: {},
    }
    const originalKey = nutrientEstimatePanelRequestKey(base)
    const afterOneAdoption = nutrientEstimatePanelRequestKey({
      ...base,
      currentNutrients: { ...base.currentNutrients, fiberG: 1.2 },
      currentEvaluationRequestedNutrients: allTargets,
    })
    const afterManualEdit = nutrientEstimatePanelRequestKey({
      ...base,
      currentNutrients: { ...base.currentNutrients, fiberG: 1.2 },
      knownNutrients: { fiberG: 1.2 },
      knownNutrientEvidence: {
        fiberG: { origin: 'user_input', verified: true, source: '手入力', resolution: 'explicit_metadata' },
      },
    })

    expect(afterOneAdoption).toBe(originalKey)
    expect(afterManualEdit).not.toBe(originalKey)
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
