import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteFood, exportBackup, getEntriesForDate, getSettings, initializeDatabase, recordFoodSelection, saveFood, saveMealEntries, saveMealEntry, saveMenu, searchFoodResults, searchMenus } from '../src/db/db'
import type { Food, MealEntry, Menu } from '../src/types'

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
    expect(await db.foodGroups.count()).toBeGreaterThan(2000)
    expect(await db.foodAliases.where('normalizedAlias').equals('塩').count()).toBe(1)
  })

  it('人参・大根の調理状態を同一グループにまとめ、品種や部位は分離する', async () => {
    const carrotRootIds = ['mext_06212', 'mext_06213', 'mext_06214', 'mext_06215', 'mext_06345']
    const carrotGroups = await Promise.all(carrotRootIds.map(async (id) => (await db.foods.get(id))?.foodGroupId))
    expect(new Set(carrotGroups).size).toBe(1)
    expect((await db.foods.get('mext_06218'))?.foodGroupId).not.toBe(carrotGroups[0])
    expect((await db.foods.get('mext_06132'))?.foodGroupId).toBe((await db.foods.get('mext_06134'))?.foodGroupId)
    expect((await db.foods.get('mext_06130'))?.foodGroupId).not.toBe((await db.foods.get('mext_06132'))?.foodGroupId)
    expect((await db.foods.get('mext_06136'))?.foodGroupId).not.toBe((await db.foods.get('mext_06132'))?.foodGroupId)
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

  it('食品グループ単位の関連度検索と個人利用統計を保存できる', async () => {
    const searched = await searchFoodResults('塩')
    expect(searched.page.results[0].group.displayName).toBe('食塩')
    expect(searched.page.results[0].variants.length).toBeGreaterThan(1)
    await recordFoodSelection(searched.logId, searched.page.results[0].group.id, searched.page.results[0].food.id, 1)
    expect((await db.foodUsageStats.get(searched.page.results[0].food.id))?.selectionCount).toBe(1)
    const backup = await exportBackup()
    expect(backup.foodGroups?.length).toBeGreaterThan(2000)
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

  it('メニューを保存して名前・区分で検索できる', async () => {
    await saveFood(userFood)
    const menu: Menu = {
      id: 'menu_test', name: '朝ごはん', category: '主食', foodIds: [userFood.id],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    await saveMenu(menu)
    expect(await searchMenus('朝')).toEqual([menu])
    expect(await searchMenus('主食')).toEqual([menu])
    expect(await searchMenus('テスト食品')).toEqual([menu])
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
