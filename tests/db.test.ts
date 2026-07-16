import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteFood, getEntriesForDate, getSettings, initializeDatabase, saveFood, saveMealEntries, saveMealEntry, saveMenu, searchMenus } from '../src/db/db'
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
