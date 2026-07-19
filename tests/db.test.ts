import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteFood, exportBackup, getEntriesForDate, getSettings, initializeDatabase, recordFoodSelection, saveFood, saveFoodWithMetadata, saveMealEntries, saveMealEntry, saveMenu, searchFoodResults, searchMenus } from '../src/db/db'
import type { Food, FoodAlias, FoodGroup, FoodRelatedTerm, MealEntry, Menu } from '../src/types'

const addedNutrients = { calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }

const userFood: Food = {
  id: 'user_food', name: 'テスト食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g',
  servingAmount: null, servingUnit: null, nutrients: { energyKcal: 100, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0, ...addedNutrients }, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeDatabase()
})

describe('IndexedDB data safety', () => {
  it('初期食品は食品ごとの基準単位を持つ', async () => {
    const rice = await db.foods.get('mext_rice_white')
    const egg = await db.foods.get('mext_egg')
    expect(rice?.baseUnit).toBe('合')
    expect(rice?.servingUnit).toBe('合')
    expect(egg?.baseUnit).toBe('個')
  })

  it('MEXTの収集済み食品を初期データとして検索できる', async () => {
    expect(await db.foods.count()).toBeGreaterThan(2500)
    const amaranth = await db.foods.get('mext_01001')
    expect(amaranth?.baseUnit).toBe('g')
    expect(amaranth?.nutrients.calciumMg).toBe(160)
    expect(amaranth?.sourceVersion).toContain('増補2023年')
    const foods = await db.foods.toArray()
    const egg = foods.find((food) => food.name.includes('鶏卵'))
    const rice = foods.find((food) => food.name.includes('水稲めし'))
    const seasoning = foods.find((food) => food.id === 'mext_17001')
    expect(egg?.baseUnit).toBe('個')
    expect(rice?.baseUnit).toBe('合')
    expect(seasoning?.baseAmount).toBe(1)
    expect(seasoning?.baseUnit).toBe('小さじ')
    expect(seasoning?.name).toContain('（小さじ1=')
    expect(foods.filter((food) => food.source === 'mext').some((food) => /^(＜|（|\()/.test(food.name))).toBe(false)
    expect(await db.foodGroups.count()).toBeGreaterThan(1900)
    expect(await db.foodAliases.where('normalizedAlias').equals('塩').count()).toBe(1)
  })

  it('人参・大根の調理状態を同一グループにまとめ、品種や部位は分離する', async () => {
    const carrotRootIds = ['mext_06212', 'mext_06213', 'mext_06214', 'mext_06215', 'mext_06345', 'mext_06347']
    const carrotGroups = await Promise.all(carrotRootIds.map(async (id) => (await db.foods.get(id))?.foodGroupId))
    expect(new Set(carrotGroups).size).toBe(1)
    expect((await db.foodGroups.get(carrotGroups[0] ?? ''))?.displayName).toBe('にんじん')
    expect((await db.foods.get('mext_06347'))?.variantAttributes).toMatchObject({ part: '根', skin: '皮つき', preparation: '生' })
    expect((await db.foods.get('mext_06218'))?.foodGroupId).not.toBe(carrotGroups[0])
    expect((await db.foods.get('mext_06132'))?.foodGroupId).toBe((await db.foods.get('mext_06134'))?.foodGroupId)
    expect((await db.foods.get('mext_06130'))?.foodGroupId).not.toBe((await db.foods.get('mext_06132'))?.foodGroupId)
    expect((await db.foods.get('mext_06136'))?.foodGroupId).not.toBe((await db.foods.get('mext_06132'))?.foodGroupId)
  })

  it('検索結果のfamily表示名に単独の調理状態を残さない', async () => {
    const stateTokens = new Set(['生', 'ゆで', '焼き', '水煮', '蒸し', '電子レンジ調理', '油いため', '素揚げ', '天ぷら', 'から揚げ', 'ソテー', 'フライ', '煮', '冷凍', '乾', '乾燥', '水戻し', '塩抜き', '水さらし', 'カット', '常法洗浄', '次亜塩素酸洗浄', 'おろし', '皮つき', '皮なし', '菌床栽培', '原木栽培'])
    const groups = await db.foodGroups.toArray()
    expect(groups.filter((group) => group.displayName.split(/\s+/).some((token) => stateTokens.has(token)))).toEqual([])
    expect((await db.foodGroups.get((await db.foods.get('mext_06347'))?.foodGroupId ?? ''))?.displayName).toBe('にんじん')
    expect((await db.foodGroups.get((await db.foods.get('mext_02066'))?.foodGroupId ?? ''))?.displayName).toBe('じゃがいも')
  })

  it('たまねぎ・しいたけ・もやしの確定分類と属性を保持する', async () => {
    const onionIds = ['mext_06153', 'mext_06154', 'mext_06155', 'mext_06336', 'mext_06389']
    const onionGroups = await Promise.all(onionIds.map(async (id) => (await db.foods.get(id))?.foodGroupId))
    expect(new Set(onionGroups).size).toBe(1)
    expect((await db.foods.get('mext_06389'))?.variantAttributes?.preparation).toBe('あめ色たまねぎ')
    expect((await db.foods.get('mext_06156'))?.foodGroupId).not.toBe(onionGroups[0])

    const freshShiitakeIds = ['mext_08039', 'mext_08040', 'mext_08041', 'mext_08057', 'mext_08042', 'mext_08043', 'mext_08044']
    const shiitakeGroups = await Promise.all(freshShiitakeIds.map(async (id) => (await db.foods.get(id))?.foodGroupId))
    expect(new Set(shiitakeGroups).size).toBe(1)
    expect((await db.foods.get('mext_08039'))?.variantAttributes?.cultivation).toBe('菌床栽培')
    expect((await db.foods.get('mext_08042'))?.variantAttributes?.cultivation).toBe('原木栽培')
    expect((await db.foods.get('mext_08013'))?.foodGroupId).not.toBe(shiitakeGroups[0])
    expect((await db.foods.get('mext_17022'))?.foodGroupId).not.toBe(shiitakeGroups[0])

    const sproutIds = ['mext_06286', 'mext_06287', 'mext_06288', 'mext_06289', 'mext_06290', 'mext_06291', 'mext_06292', 'mext_06398', 'mext_06412', 'mext_06413']
    const sproutGroups = await Promise.all(sproutIds.map(async (id) => (await db.foods.get(id))?.foodGroupId))
    expect(new Set(sproutGroups).size).toBe(1)
    expect((await db.foods.get('mext_06287'))?.variantAttributes?.sourceBean).toBe('だいず')
    expect((await db.foods.get('mext_06289'))?.variantAttributes?.sourceBean).toBe('ブラックマッペ')
    expect((await db.foods.get('mext_18039'))?.foodGroupId).not.toBe(sproutGroups[0])
  })

  it('LLMで確定したfamily分離と属性を保持する', async () => {
    expect((await db.foods.get('mext_04004'))?.foodGroupId).toBe('bean:azuki:an')
    expect((await db.foods.get('mext_04003'))?.foodGroupId).toBe('bean:azuki:canned')
    expect((await db.foods.get('mext_04004'))?.variantAttributes?.variety).toBe('こしあん（生）')

    expect((await db.foods.get('mext_17057'))?.foodGroupId).toBe('seasoning:mustard:karashi')
    expect((await db.foods.get('mext_17059'))?.foodGroupId).toBe('seasoning:mustard:mustard')
    expect((await db.foods.get('mext_17057'))?.variantAttributes?.processing).toBe('粉')
    expect((await db.foods.get('mext_17060'))?.variantAttributes?.processing).toBe('粒入り')

    expect((await db.foods.get('mext_15029'))?.foodGroupId).toBe('sweets:manju:castella')
    expect((await db.foods.get('mext_15159'))?.variantAttributes?.variety).toBe('つぶしあん')
    expect((await db.foods.get('mext_15160'))?.foodGroupId).toBe('sweets:manju:karukan')
    expect((await db.foods.get('mext_15035'))?.foodGroupId).toBe('sweets:manju:meat')

    expect((await db.foods.get('mext_15182'))?.variantAttributes).toMatchObject({ processing: 'アメリカンタイプ', variety: 'プレーン' })
    expect((await db.foods.get('mext_15173'))?.variantAttributes).toMatchObject({ processing: 'デンマークタイプ', variety: 'カスタードクリーム' })
    expect((await db.foods.get('mext_15077'))?.variantAttributes).toMatchObject({ processing: 'イーストドーナッツ', variety: 'プレーン' })
    expect((await db.foods.get('mext_15179'))?.variantAttributes).toMatchObject({ processing: 'ケーキドーナッツ', variety: 'カスタードクリーム' })

    expect((await db.foods.get('mext_17042'))?.foodGroupId).toBe('seasoning:dressing:semi-solid')
    expect((await db.foods.get('mext_17118'))?.variantAttributes?.variety).toBe('低カロリータイプ')
    expect((await db.foods.get('mext_15057'))?.foodGroupId).toBe('sweets:rice-cracker:age')
    expect((await db.foods.get('mext_15059'))?.foodGroupId).toBe('sweets:rice-cracker:arare')

    const anpanGroupId = (await db.foods.get('mext_15069'))?.foodGroupId
    expect(anpanGroupId).toBe((await db.foods.get('mext_15168'))?.foodGroupId)
    expect((await db.foodGroups.get(anpanGroupId ?? ''))?.metadataSource).toBe('llm')
    expect((await db.foods.get('mext_15069'))?.variantAttributes?.nameSpecification).toBe('こしあん入り')
    expect((await db.foods.get('mext_15168'))?.variantAttributes?.nameSpecification).toBe('つぶしあん入り')
  })

  it('食品グループ単位の関連度検索と個人利用統計を保存できる', async () => {
    const searched = await searchFoodResults('塩')
    expect(searched.page.results[0].group.displayName).toBe('食塩')
    expect(searched.page.results[0].variants.length).toBeGreaterThan(1)
    await recordFoodSelection(searched.logId, searched.page.results[0].group.id, searched.page.results[0].food.id, 1)
    expect((await db.foodUsageStats.get(searched.page.results[0].food.id))?.selectionCount).toBe(1)
    const backup = await exportBackup()
    expect(backup.foodGroups?.length).toBeGreaterThan(1900)
    expect(backup.searchLogs?.[0].selectedFoodGroupId).toBe('seasoning:salt')
    expect(backup.foodUsageStats?.[0].foodId).toBe(searched.page.results[0].food.id)
  })

  it('食品削除時も食事記録とスナップショットを残す', async () => {
    await saveFood(userFood)
    const entry: MealEntry = {
      id: 'meal_test', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: userFood.name, maker: userFood.maker, barcode: userFood.barcode, baseAmount: userFood.baseAmount, baseUnit: userFood.baseUnit, nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { energyKcal: 50, proteinG: 0.5, fatG: 0.5, carbohydrateG: 0.5, fiberG: 0.5, saltG: 0, ...addedNutrients },
    }
    await saveMealEntry(entry)
    await deleteFood(userFood.id)
    const entries = await getEntriesForDate('2026-07-15')
    expect(entries).toHaveLength(1)
    expect(entries[0].foodSnapshot.name).toBe('テスト食品')
    expect(await db.foods.get(userFood.id)).toBeUndefined()
  })

  it('手動食品のfamily・別名・属性を一括保存して検索できる', async () => {
    const now = '2026-07-15T00:00:00.000Z'
    const manualFood: Food = { ...userFood, id: 'manual_metadata_food', name: '自家製鶏肉', displayName: '鶏肉', foodGroupId: 'manual:chicken', variantAttributes: { species: '鶏', part: 'もも', skin: '皮なし', preparation: '焼き' }, createdAt: now, updatedAt: now }
    const group: FoodGroup = { id: 'manual:chicken', displayName: '鶏肉', reading: 'とりにく', category: '主菜', representativeScore: 0, defaultVariantId: manualFood.id, isActive: true, metadataSource: 'manual', generationVersion: 'manual-v1', needsReview: false, createdAt: now, updatedAt: now }
    const alias: FoodAlias = { id: 'manual:alias:chicken', foodGroupId: group.id, foodVariantId: null, alias: 'とり', normalizedAlias: 'とり', aliasType: 'synonym', priority: 80, isActive: true, metadataSource: 'manual' }
    const related: FoodRelatedTerm = { id: 'manual:related:chicken', foodGroupId: group.id, term: '炭火串焼き', normalizedTerm: '炭火串焼き', weight: 0.5, isActive: true, metadataSource: 'manual' }
    await saveFoodWithMetadata(manualFood, { group, aliases: [alias], relatedTerms: [related] })
    expect((await db.foods.get(manualFood.id))?.foodGroupId).toBe(group.id)
    expect((await searchFoodResults('とり')).page.results[0]?.group.displayName).toBe('鶏肉')
    expect((await searchFoodResults('炭火串焼き')).page.results[0]?.group.displayName).toBe('鶏肉')
  })

  it('メニューを保存して名前・区分で検索できる', async () => {
    await saveFood(userFood)
    const menu: Menu = {
      id: 'menu_test', name: '朝ごはん', category: '主食', foodIds: [userFood.id], aliases: ['モーニング'],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    await saveMenu(menu)
    expect(await searchMenus('朝')).toEqual([menu])
    expect(await searchMenus('主食')).toEqual([menu])
    expect(await searchMenus('テスト食品')).toEqual([menu])
    expect(await searchMenus('モーニング')).toEqual([menu])
  })

  it('初期設定に身体情報の既定値を持つ', async () => {
    const settings = await getSettings()
    expect(settings.bodyProfile?.sex).toBe('unspecified')
    expect(settings.bodyProfile?.activityLevel).toBe('moderate')
  })

  it('食事区分の時刻を複数記録へ一括保存できる', async () => {
    const first: MealEntry = {
      id: 'meal_first', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: userFood.name, maker: userFood.maker, barcode: userFood.barcode, baseAmount: userFood.baseAmount, baseUnit: userFood.baseUnit, nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { energyKcal: 50, proteinG: 0.5, fatG: 0.5, carbohydrateG: 0.5, fiberG: 0.5, saltG: 0, ...addedNutrients },
    }
    const second = { ...first, id: 'meal_second', eatenAt: '2026-07-15T03:00:00.000Z' }
    await saveMealEntries([first, second])
    const entries = await getEntriesForDate('2026-07-15')
    expect(entries.map((entry) => entry.id).sort()).toEqual(['meal_first', 'meal_second'])
  })
})
