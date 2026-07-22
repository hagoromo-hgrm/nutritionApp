import { describe, expect, it } from 'vitest'
import { createMenuSetMealBatch } from '../src/services/menuSetMeals'
import type { Food, Menu, MenuSet, Nutrients } from '../src/types'

const nutrients = (energyKcal: number): Nutrients => ({
  energyKcal, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0,
  calciumMg: 1, ironMg: 1, vitaminAMcg: 1, vitaminEMg: 1, vitaminB1Mg: 1,
  vitaminB2Mg: 1, vitaminCMg: 1, saturatedFatG: 1,
})

const rice: Food = {
  id: 'rice', name: 'ご飯', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
  baseAmount: 100, baseUnit: 'g', servingAmount: 150, servingUnit: 'g', nutrients: nutrients(160),
  createdAt: '', updatedAt: '',
}
const soupIngredient: Food = {
  ...rice, id: 'miso', name: 'みそ', baseAmount: 10, servingAmount: null, servingUnit: null,
  nutrients: nutrients(20),
}
const soup: Menu = {
  id: 'soup', name: 'みそ汁', category: '汁物', foodIds: ['miso'],
  ingredients: [{ kind: 'food', itemId: 'miso', amount: 10, unit: 'g' }], createdAt: '', updatedAt: '',
}
const breakfast: MenuSet = {
  id: 'breakfast', name: '朝食セット', menuIds: ['soup'], foodIds: ['rice'], createdAt: '', updatedAt: '',
}

describe('menu set meal batches', () => {
  it('セット名ではなく料理メニューと食品を個別の食事記録へ展開する', () => {
    let index = 0
    const batch = createMenuSetMealBatch({
      menuSet: breakfast, menus: [soup], foods: [rice, soupIngredient], mealType: '朝食',
      eatenAt: '2026-07-23T00:00:00.000Z', createId: () => `meal_${++index}`,
    })

    expect(batch.entries.map((entry) => entry.foodSnapshot.name)).toEqual(['みそ汁', 'ご飯'])
    expect(batch.entries.every((entry) => entry.foodSnapshot.name !== breakfast.name)).toBe(true)
    expect(batch.entries[0]).toMatchObject({ foodId: 'menu:soup', amount: 1, amountUnit: '食' })
    expect(batch.entries[0].menuSnapshot?.sourceMenuId).toBe('soup')
    expect(batch.entries[0].calculatedNutrients.energyKcal).toBe(20)
    expect(batch.entries[1]).toMatchObject({ foodId: 'rice', amount: 150, amountUnit: 'g' })
    expect(batch.entries[1].calculatedNutrients.energyKcal).toBe(240)
    expect(batch.missingMenuIds).toEqual([])
    expect(batch.missingFoodIds).toEqual([])
  })

  it('削除済みのセット項目を欠損として報告し、ゼロの食事記録を作らない', () => {
    const batch = createMenuSetMealBatch({
      menuSet: { ...breakfast, menuIds: ['missing-menu'], foodIds: ['rice', 'missing-food'] },
      menus: [soup], foods: [rice, soupIngredient], mealType: '夕食', eatenAt: '', createId: () => 'meal',
    })

    expect(batch.entries).toHaveLength(1)
    expect(batch.entries[0].foodId).toBe('rice')
    expect(batch.missingMenuIds).toEqual(['missing-menu'])
    expect(batch.missingFoodIds).toEqual(['missing-food'])
  })
})
