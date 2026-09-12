import 'fake-indexeddb/auto'
import { saveFoodAndEstimation } from '../src/services/foodEstimationSave'
import { createEstimationRequest } from '../src/services/nutrientEstimationStore'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, saveFoodWithMetadata, type FoodMetadataUpdate } from '../src/db/db'
import { createEstimationInputHash } from '../src/services/foodRevision'
import { EMPTY_NUTRIENTS, type Food } from '../src/types'

const now = '2026-09-12T00:00:00.000Z'
const food: Food = { id: 'food', name: '食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null, nutrients: { ...EMPTY_NUTRIENTS }, createdAt: now, updatedAt: now }
const metadata: FoodMetadataUpdate = { group: { id: 'group', displayName: '食品', reading: null, category: null, representativeScore: 0, defaultVariantId: food.id, isActive: true, metadataSource: 'manual', generationVersion: 'test', needsReview: false, createdAt: now, updatedAt: now }, aliases: [], relatedTerms: [] }

beforeEach(async () => { await db.delete(); await db.open() })

describe('food save conflict protection', () => {
  it('同じ更新日時でも、推計画面を開いた後の栄養値変更を保存前に検出する', async () => {
    await saveFoodWithMetadata(food, metadata)
    const original = (await db.foods.get(food.id))!
    const edited = { ...original, nutrients: { ...original.nutrients, fiberG: 99 } }
    await db.foods.put(edited)
    await expect(saveFoodWithMetadata(original, { ...metadata, group: { ...metadata.group, displayName: '古い編集' } }, createEstimationInputHash(original))).rejects.toThrow('別の操作')
    expect(await db.foods.get(food.id)).toEqual(edited)
    expect((await db.foodGroups.get('group'))?.displayName).toBe('食品')
  })

  it('削除された食品を古い推計画面の保存で復活させない', async () => {
    await saveFoodWithMetadata(food, metadata)
    const original = (await db.foods.get(food.id))!
    await db.foods.delete(food.id)
    await expect(saveFoodWithMetadata(original, metadata, createEstimationInputHash(original))).rejects.toThrow('別の操作')
    expect(await db.foods.get(food.id)).toBeUndefined()
  })

  it('新規食品と、変更されていない食品への編集は保存できる', async () => {
    await saveFoodWithMetadata(food, metadata, null)
    const original = (await db.foods.get(food.id))!
    await saveFoodWithMetadata({ ...original, name: '編集後' }, metadata, createEstimationInputHash(original))
    expect((await db.foods.get(food.id))?.name).toBe('編集後')
  })
})


describe('atomic food and estimation save', () => {
  it.each(['result', 'decision'] as const)('%sの保存失敗で食品・検索情報・推計履歴をすべて戻し、再試行できる', async (failurePoint) => {
    const request = createEstimationRequest(food, { requestId: 'request' })
    const decision = {
      request,
      result: { requestId: request.requestId, foodId: food.id, inputHash: request.inputHash, status: 'completed' as const,
        basis: { baseAmount: 100, baseUnit: 'g' as const },
        estimates: { fiberG: { value: 1.234, range: { min: 1, max: 2 }, confidence: 'low' as const, method: 'test', warnings: [] } },
        globalWarnings: [], modelVersion: 'test', estimatedAt: now },
      adoptedKeys: ['fiberG' as const], rejectedKeys: [],
    }
    const fail = () => { throw new Error('書き込み失敗') }
    const table = failurePoint === 'result' ? db.estimationResults : db.estimationDecisions
    table.hook('creating', fail)
    await expect(saveFoodAndEstimation(food, metadata, decision, null)).rejects.toThrow('書き込み失敗')
    table.hook('creating').unsubscribe(fail)
    for (const table of [db.foods, db.foodGroups, db.estimationRequests, db.estimationResults, db.estimationDecisions]) expect(await table.count()).toBe(0)
    const saved = await saveFoodAndEstimation(food, metadata, decision, null)
    expect(saved.nutrients.fiberG).toBe(1.234)
    expect(saved.nutrientMetadata?.fiberG?.origin).toBe('estimated')
    expect(await db.foods.count()).toBe(1)
    expect(await db.estimationDecisions.count()).toBe(1)
  })
})


it('身体情報があっても空欄にした目標を再読込で推定値に置換しない', async () => {
  const { getSettings, saveSettings } = await import('../src/db/db')
  const original = await getSettings()
  await saveSettings({ ...original, goals: { ...original.goals, energyKcal: 2000, proteinG: null }, bodyProfile: { heightCm: 170, weightKg: 65, ageYears: 35, sex: 'male', activityLevel: 'low' } })
  expect((await getSettings()).goals.proteinG).toBeNull()
  await db.close(); await db.open()
  expect((await getSettings()).goals.proteinG).toBeNull()
  expect((await getSettings()).goals.energyKcal).toBe(2000)
  expect((await db.settings.get('app'))?.goals.proteinG).toBeNull()
})
