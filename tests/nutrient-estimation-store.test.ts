import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getFoodById, initializeDatabase, saveMealEntry } from '../src/db/db'
import {
  adoptEstimatedNutrients,
  createEstimationInput,
  createEstimationRequest,
  getEstimationDecisionsForFood,
  rejectEstimatedNutrients,
  revertEstimatedNutrient,
  saveEstimationRequest,
  saveEstimationResult,
} from '../src/services/nutrientEstimationStore'
import { ESTIMATABLE_NUTRIENT_KEYS, estimateNutrients, toStoredNutrientEstimateResult } from '../src/services/nutrientEstimator'
import { createNutrientEstimateRequestFingerprintFromSnapshot } from '../src/services/confirmedNutrientInputs'
import type { EstimationResult, Food, MealEntry } from '../src/types'

const nutrients = {
  energyKcal: 100, proteinG: 2, fatG: 3, carbohydrateG: 10, fiberG: null,
  calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null,
  vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null, saltG: 0.1,
}

const food: Food = {
  id: 'estimate_food', name: '推計テスト食品', maker: 'テスト社', barcode: '0012345678901', source: 'user', sourceVersion: 'test',
  baseAmount: 1, baseUnit: '個', servingAmount: null, servingUnit: null, nutrients,
  ingredientsText: '小麦粉、砂糖', ingredientsSource: { provider: 'package', verified: true },
  estimationReferenceMassG: 50, estimationReferenceMassSource: 'パッケージ内容量50g',
  createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
}

function resultFor(requestId: string, inputHash: string): EstimationResult {
  return {
    requestId, foodId: food.id, inputHash, status: 'completed', basis: { baseAmount: 1, baseUnit: '個' },
    estimates: {
      fiberG: { value: 1.25, range: { min: 1, max: 1.5 }, confidence: 'medium', method: 'test', warnings: [] },
      saturatedFatG: {
        value: 0,
        range: { min: 0, max: 0.1 },
        confidence: 'low',
        method: 'test',
        warnings: ['参考値です'],
        zeroEvidence: 'uncertain',
      },
      calciumMg: { value: 12, range: { min: 8, max: 16 }, confidence: 'low', method: 'test', warnings: ['参考値です'] },
    },
    globalWarnings: [], modelVersion: 'test-1', estimatedAt: '2026-07-25T00:01:00.000Z',
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeDatabase()
  await db.foods.put({ ...food, nutrients: { ...food.nutrients } })
})

describe('nutrient estimation store', () => {
  it('評価済みrequest evidenceをsnapshotへ独立コピーし、Food fallbackには混入しない', () => {
    const sourceEvidence = {
      schemaVersion: 1 as const,
      declarationFingerprint: 'ingredient-declaration:evaluated',
      compositions: [{
        id: 'grain-blend', parent: { section: 'ingredient' as const, path: [0] }, expectedChildNames: ['小麦粉', '砂糖'],
        denominator: 'product' as const, weightStage: 'finished' as const,
        amounts: { kind: 'fractions' as const, children: [{ index: 0, value: 0.7 }, { index: 1, value: 0.3 }] },
        source: { kind: 'user_measurement' as const, reference: '評価時の記録', verified: true as const, checkedAt: '2026-10-04T00:00:00.000Z' },
      }],
    }
    const evaluatedRequest = {
      requestId: 'evidence-evaluation', productName: food.name, baseAmount: 1, baseUnit: '個' as const,
      referenceMassG: 50, referenceMassSource: 'test', ingredientsText: food.ingredientsText ?? null,
      ingredientsSource: food.ingredientsSource ?? null, knownNutrients: {}, requestedNutrients: ['fiberG' as const],
      estimationEvidence: sourceEvidence, requestedAt: '2026-10-04T00:00:00.000Z',
    }
    const snapshot = createEstimationInput(food, { evaluatedRequest })
    sourceEvidence.compositions[0].amounts.children[0].value = 0.2

    expect(snapshot.estimationEvidence?.compositions?.[0].amounts).toEqual({
      kind: 'fractions', children: [{ index: 0, value: 0.7 }, { index: 1, value: 0.3 }],
    })
    expect(snapshot.estimationEvidence?.compositions).not.toBe(sourceEvidence.compositions)

    const foodFallbackSnapshot = createEstimationInput({ ...food, estimationEvidence: sourceEvidence })
    expect(foodFallbackSnapshot.estimationEvidence?.declarationFingerprint).toBe('ingredient-declaration:evaluated')
    expect(foodFallbackSnapshot.estimationEvidence?.compositions).not.toBe(sourceEvidence.compositions)
  })

  it('NutritionApp入力から端末内推計、履歴保存、欠損値採用まで接続する', async () => {
    const requestedAt = '2026-07-25T00:01:00.000Z'
    const request = createEstimationRequest(food, { requestId: 'request_browser_integration', now: requestedAt })
    const browserResult = estimateNutrients({
      requestId: request.requestId,
      baseAmount: food.baseAmount,
      baseUnit: food.baseUnit,
      referenceMassG: food.estimationReferenceMassG ?? null,
      referenceMassSource: food.estimationReferenceMassSource ?? null,
      ingredientsText: food.ingredientsText ?? null,
      ingredientsSource: food.ingredientsSource ?? null,
      requestedNutrients: ESTIMATABLE_NUTRIENT_KEYS,
      requestedAt,
    })
    await saveEstimationRequest(request)
    await saveEstimationResult(toStoredNutrientEstimateResult(browserResult, {
      foodId: food.id,
      inputHash: request.inputHash,
      baseAmount: food.baseAmount,
      baseUnit: food.baseUnit,
    }))
    await adoptEstimatedNutrients(request.requestId, ['fiberG', 'calciumMg'])

    const adopted = await getFoodById(food.id)
    expect(browserResult.estimates.fiberG.status).toBe('available')
    expect(browserResult.estimates.calciumMg.status).toBe('available')
    expect(adopted?.nutrients.fiberG).toBe(browserResult.estimates.fiberG.value)
    expect(adopted?.nutrients.calciumMg).toBe(browserResult.estimates.calciumMg.value)
    expect(adopted?.nutrientMetadata?.fiberG?.sourceFoodIds).toContain('mext_01015')
    expect(adopted?.nutrientMetadata?.calciumMg?.sourceFoodIds).toContain('mext_01015')
    expect(adopted?.nutrientMetadata?.fiberG?.calibration).toMatchObject({
      targetCoverage: 0.9,
      sampleSize: 0,
      scope: 'fallback',
    })
    expect(adopted?.nutrientMetadata?.fiberG?.adoptionClass).toBe('limited_confirmation')
  })

  it('明示された基準重量だけを推計入力へ渡し、単位からgを推測しない', () => {
    expect(createEstimationInput(food).referenceMassG).toBe(50)
    const withoutMass = { ...food, estimationReferenceMassG: null, estimationReferenceMassSource: null }
    expect(createEstimationInput(withoutMass).referenceMassG).toBeNull()
    const gramFood = { ...withoutMass, baseAmount: 100, baseUnit: 'g' as const }
    expect(createEstimationInput(gramFood).referenceMassG).toBe(100)
  })

  it('保存する要求スナップショットは実評価入力・根拠・指紋をそのまま保持する', () => {
    const editedFood: Food = {
      ...food,
      name: '保存前に編集中の食品名',
      baseAmount: 50,
      baseUnit: 'g',
      inputUnitConversions: [{ unit: '1食', baseAmount: 50 }],
      nutrients: { ...food.nutrients, proteinG: 8 },
      estimatorGenreId: 'other_unknown',
      estimatorGenreSource: 'user',
    }
    const evaluatedRequest = {
      requestId: 'browser-evaluation',
      productName: editedFood.name,
      estimatorCategoryId: 'staple',
      estimatorGenreId: 'other_unknown' as const,
      estimatorGenreSource: 'user' as const,
      baseAmount: 50,
      baseUnit: 'g',
      inputUnitConversions: [{ unit: '1食', baseAmount: 50 }],
      referenceMassG: 50,
      referenceMassSource: '基準単位がg',
      ingredientsText: '米、食塩',
      ingredientsSource: { provider: 'package', verified: true as const },
      knownNutrients: { proteinG: 8 },
      knownNutrientEvidence: {
        proteinG: { origin: 'manufacturer_label' as const, verified: true, source: '食品表示', resolution: 'explicit_metadata' as const },
      },
      knownNutrientReferences: {
        proteinG: {
          origin: 'manufacturer_label' as const,
          verified: true,
          sourceReference: '食品表示',
          reference: { kind: 'fixed' as const, value: 8, decimalPlaces: 0 },
          basis: { amount: 50, unit: 'g' as const },
        },
      },
      knownNutrientReferenceBasis: { amount: 50, unit: 'g' as const },
      fitMode: 'legacy_point' as const,
      requestedNutrients: ['fiberG'] as const,
      requestedAt: '2026-10-04T00:00:00.000Z',
    }

    const snapshot = createEstimationInput(editedFood, { evaluatedRequest })

    expect(snapshot.name).toBe(editedFood.name)
    expect(snapshot.estimatorCategoryId).toBe('staple')
    expect(snapshot.estimatorGenreSource).toBe('user')
    expect(snapshot.baseAmount).toBe(50)
    expect(snapshot.inputUnitConversions).toEqual([{ unit: '1食', baseAmount: 50 }])
    expect(snapshot.knownNutrients).toEqual({ proteinG: 8 })
    expect(snapshot.knownNutrientEvidence?.proteinG).toMatchObject({ origin: 'manufacturer_label', verified: true })
    expect(snapshot.knownNutrientReferences?.proteinG?.reference).toEqual({ kind: 'fixed', value: 8, decimalPlaces: 0 })
    expect(snapshot.requestedNutrients).toEqual(['fiberG'])
    expect(snapshot.fitMode).toBe('legacy_point')
    expect(snapshot.requestFingerprint).toBe(createNutrientEstimateRequestFingerprintFromSnapshot(snapshot))

    const nullNamedSnapshot = createEstimationInput(editedFood, {
      evaluatedRequest: { ...evaluatedRequest, productName: null },
    })
    expect(nullNamedSnapshot.name).toBe(editedFood.name)
    expect(nullNamedSnapshot.productName).toBeNull()
    expect(nullNamedSnapshot.requestFingerprint).toBe(createNutrientEstimateRequestFingerprintFromSnapshot(nullNamedSnapshot))
  })

  it('旧推計・外部取得フラグ付きユーザー食品の未確認値を要求の既知入力へ昇格しない', () => {
    const blockedFood = { ...food, estimatedNutrients: { proteinG: true } } as Food & { estimatedNutrients: { proteinG: boolean } }
    const snapshot = createEstimationInput(blockedFood)
    expect(snapshot.knownNutrients).toEqual({})
    expect(snapshot.knownNutrientEvidence).toEqual({})
  })

  it('欠損値だけを採用し、食品・メタデータ・判断をまとめて保存して食事履歴へ遡及しない', async () => {
    const entry: MealEntry = {
      id: 'old_meal', eatenAt: '2026-07-25T00:00:00.000Z', mealType: '朝食', foodId: food.id,
      foodSnapshot: { name: food.name, maker: food.maker, barcode: food.barcode, baseAmount: 1, baseUnit: '個', nutrients: { ...food.nutrients } },
      amount: 1, amountUnit: '個', calculatedNutrients: { ...food.nutrients },
    }
    await saveMealEntry(entry)
    const request = createEstimationRequest(food, { requestId: 'request_adopt', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))

    const decisions = await adoptEstimatedNutrients(request.requestId, ['fiberG', 'saturatedFatG', 'calciumMg'])
    expect(decisions).toHaveLength(3)
    const adopted = await getFoodById(food.id)
    expect(adopted?.nutrients.fiberG).toBe(1.25)
    expect(adopted?.nutrients.calciumMg).toBe(12)
    expect(adopted?.nutrientMetadata?.fiberG).toMatchObject({ origin: 'estimated', requestId: request.requestId, modelVersion: 'test-1' })
    expect(adopted?.nutrientMetadata?.fiberG?.adoptionClass).toBe('standard_confirmation')
    expect(adopted?.nutrientMetadata?.saturatedFatG?.zeroEvidence).toBe('uncertain')
    expect((await db.mealEntries.get(entry.id))?.foodSnapshot.nutrients.fiberG).toBeNull()
    expect((await db.mealEntries.get(entry.id))?.foodSnapshot.nutrients.calciumMg).toBeNull()
    expect((await getEstimationDecisionsForFood(food.id)).items).toHaveLength(3)

    await expect(adoptEstimatedNutrients(request.requestId, ['fiberG'])).rejects.toThrow('変更')
  })

  it('採用後に食品が更新されると競合として採用を中止する', async () => {
    const request = createEstimationRequest(food, { requestId: 'request_conflict', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))
    await db.foods.put({ ...food, name: '編集済み食品', updatedAt: '2026-07-25T00:02:00.000Z' })
    await expect(adoptEstimatedNutrients(request.requestId, ['fiberG'])).rejects.toThrow('変更')
  })

  it('採用直後で変更がなければ取り消して直前値とメタデータへ戻せる', async () => {
    const request = createEstimationRequest(food, { requestId: 'request_revert', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))
    const [decision] = await adoptEstimatedNutrients(request.requestId, ['fiberG'])
    const reverted = await revertEstimatedNutrient(decision.decisionId)
    expect(reverted.decision).toBe('reverted')
    expect((await getFoodById(food.id))?.nutrients.fiberG).toBeNull()
    expect((await getFoodById(food.id))?.nutrientMetadata?.fiberG).toBeUndefined()
  })

  it('同じ操作で採用した複数栄養素を順番に取り消せる', async () => {
    const request = createEstimationRequest(food, { requestId: 'request_revert_batch', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-07-25T00:02:00.000Z'))
      const decisions = await adoptEstimatedNutrients(request.requestId, ['fiberG', 'calciumMg', 'saturatedFatG'])
      const adoptionVersion = decisions[0].foodUpdatedAtAfterDecision

      vi.setSystemTime(new Date('2026-07-25T00:03:00.000Z'))
      await revertEstimatedNutrient(decisions[0].decisionId)
      vi.setSystemTime(new Date('2026-07-25T00:04:00.000Z'))
      await revertEstimatedNutrient(decisions[1].decisionId)
      vi.setSystemTime(new Date('2026-07-25T00:05:00.000Z'))
      await revertEstimatedNutrient(decisions[2].decisionId)

      const reverted = await getFoodById(food.id)
      expect(reverted?.nutrients.fiberG).toBeNull()
      expect(reverted?.nutrients.calciumMg).toBeNull()
      expect(reverted?.nutrients.saturatedFatG).toBeNull()
      expect(reverted?.nutrientMetadata?.fiberG).toBeUndefined()
      expect(reverted?.nutrientMetadata?.calciumMg).toBeUndefined()
      expect(reverted?.nutrientMetadata?.saturatedFatG).toBeUndefined()
      expect((await db.estimationDecisions.get(decisions[0].decisionId))?.foodUpdatedAtAfterDecision).toBe(adoptionVersion)
      expect((await db.estimationDecisions.get(decisions[1].decisionId))?.foodUpdatedAtAfterDecision).toBe(adoptionVersion)
      expect((await db.estimationDecisions.get(decisions[2].decisionId))?.foodUpdatedAtAfterDecision).toBe(adoptionVersion)
    } finally {
      vi.useRealTimers()
    }
  })

  it('同じ操作の一部を取り消した後でも、別操作で食品が変われば残りの自動取り消しを拒否する', async () => {
    const request = createEstimationRequest(food, { requestId: 'request_revert_conflict', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))
    const decisions = await adoptEstimatedNutrients(request.requestId, ['fiberG', 'calciumMg'])
    await revertEstimatedNutrient(decisions[0].decisionId)

    const partlyReverted = await getFoodById(food.id)
    if (!partlyReverted) throw new Error('テスト対象の食品が見つかりません。')
    await db.foods.put({
      ...partlyReverted,
      name: '取り消し後に手動編集した食品',
      updatedAt: '2099-01-01T00:00:00.000Z',
    })

    await expect(revertEstimatedNutrient(decisions[1].decisionId)).rejects.toThrow('変更')
    expect((await getFoodById(food.id))?.nutrients.calciumMg).toBe(12)
  })

  it('不採用判断は食品値を書き換えない', async () => {
    const request = createEstimationRequest(food, { requestId: 'request_reject', now: '2026-07-25T00:01:00.000Z' })
    await saveEstimationRequest(request)
    await saveEstimationResult(resultFor(request.requestId, request.inputHash))
    const [decision] = await rejectEstimatedNutrients(request.requestId, ['fiberG'])
    expect(decision.decision).toBe('rejected')
    expect((await getFoodById(food.id))?.nutrients.fiberG).toBeNull()
  })
})
