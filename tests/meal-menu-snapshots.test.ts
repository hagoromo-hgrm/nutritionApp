import { describe, expect, it } from 'vitest'
import {
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotNutrients,
  cloneMealMenuSnapshot,
  createMealFoodIngredientSnapshot,
  createMealMenuSnapshot,
  isMealMenuSnapshot,
} from '../src/services/mealMenuSnapshots'
import type { Food, Menu, Nutrients } from '../src/types'

const nutrients = (energyKcal: number): Nutrients => ({
  energyKcal, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0,
  calciumMg: 1, ironMg: 1, vitaminAMcg: 1, vitaminEMg: 1, vitaminB1Mg: 1,
  vitaminB2Mg: 1, vitaminCMg: 1, saturatedFatG: 1,
})

const food = (id: string, name: string, energyKcal: number, baseAmount = 100): Food => ({
  id, name, maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount, baseUnit: 'g',
  servingAmount: null, servingUnit: null, nutrients: nutrients(energyKcal), createdAt: '', updatedAt: '',
})

const rice = food('rice', 'ご飯', 150)
const egg = food('egg', '卵', 80, 1)
const child: Menu = {
  id: 'child', name: '卵料理', category: '主菜', foodIds: ['egg'],
  ingredients: [{ kind: 'food', itemId: 'egg', amount: 1, unit: 'g' }], createdAt: '', updatedAt: '',
}
const parent: Menu = {
  id: 'parent', name: 'アレンジご飯', category: '主食', foodIds: ['rice'],
  ingredients: [
    { kind: 'food', itemId: 'rice', amount: 200, unit: 'g' },
    { kind: 'menu', itemId: 'child', amount: 0.5, unit: '食' },
  ],
  createdAt: '', updatedAt: '',
}

describe('meal menu snapshots', () => {
  it('食品の既定入力単位と換算情報を構成スナップショットへ複製する', () => {
    const customFood = food('custom', 'パン', 200, 100)
    customFood.servingAmount = 2
    customFood.servingUnit = '切れ'
    customFood.inputUnitConversions = [{ unit: '切れ', baseAmount: 40 }]
    const ingredient = createMealFoodIngredientSnapshot(customFood)
    expect(ingredient).toMatchObject({ amount: 2, unit: '切れ' })
    expect(ingredient.foodSnapshot.inputUnitConversions).toEqual([{ unit: '切れ', baseAmount: 40 }])
    const cloned = cloneMealMenuSnapshot({ sourceMenuId: 'm', sourceMenuName: 'm', ingredients: [ingredient] })
    if (cloned.ingredients[0].kind !== 'food' || ingredient.kind !== 'food') throw new Error('食品食材がありません')
    cloned.ingredients[0].foodSnapshot.inputUnitConversions![0].baseAmount = 50
    expect(ingredient.foodSnapshot.inputUnitConversions?.[0].baseAmount).toBe(40)
  })

  it('カスタム単位の構成を明示換算し、未登録単位は拒否する', () => {
    const customFood = food('custom', 'パン', 200, 100)
    customFood.inputUnitConversions = [{ unit: '切れ', baseAmount: 40 }]
    const customMenu: Menu = {
      id: 'custom-menu', name: 'パン盛り', category: '主食', foodIds: ['custom'],
      ingredients: [{ kind: 'food', itemId: 'custom', amount: 2, unit: '切れ' }], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(customMenu, [customMenu], [customFood])
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(160)
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(isMealMenuSnapshot({ ...snapshot, ingredients: [{ ...snapshot.ingredients[0], unit: 'パック' }] })).toBe(false)
  })

  it('料理メニューと子メニューを食事側へ複製して栄養計算する', () => {
    const snapshot = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    expect(snapshot.sourceMenuName).toBe('アレンジご飯')
    expect(snapshot.ingredients[1]).toMatchObject({ kind: 'menu', name: '卵料理', amount: 0.5 })
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(340)
    expect(calculateMealMenuEntryNutrients(snapshot, 2, '食').energyKcal).toBe(680)
    expect(calculateMealMenuEntryNutrients(snapshot, 2, '個').energyKcal).toBeNull()
  })

  it('食事側の変更は原本と元のスナップショットを変更しない', () => {
    const original = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    const arranged = cloneMealMenuSnapshot(original)
    arranged.ingredients[0].amount = 100
    const nested = arranged.ingredients[1]
    if (nested.kind !== 'menu') throw new Error('子メニューがありません')
    nested.amount = 1
    nested.ingredients[0].amount = 2

    expect(calculateMealMenuSnapshotNutrients(arranged).energyKcal).toBe(310)
    expect(calculateMealMenuSnapshotNutrients(original).energyKcal).toBe(340)
    expect(parent.ingredients?.[0].amount).toBe(200)
  })

  it('欠損した構成食材をゼロとして集計しない', () => {
    const missingMenu: Menu = {
      id: 'missing', name: '欠損あり', category: '主食', foodIds: [],
      ingredients: [{ kind: 'food', itemId: 'not-found', amount: 10, unit: 'g' }], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(missingMenu, [missingMenu], [])
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBeNull()
  })

  it('バックアップ・CSV用の構造検証で不正な分量を拒否する', () => {
    const snapshot = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(isMealMenuSnapshot({ ...snapshot, ingredients: [{ ...snapshot.ingredients[0], amount: 0 }] })).toBe(false)
  })
})
