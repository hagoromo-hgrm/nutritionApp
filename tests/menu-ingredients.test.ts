import { describe, expect, it } from 'vitest'
import { EMPTY_NUTRIENTS, type Food, type Menu, type Nutrients } from '../src/types'
import { getMenuFoodIds, getMenuIngredients, getNestedMenuIds, hasMenuCycles, menuToFood, wouldCreateMenuCycle } from '../src/services/menuIngredients'

const nutrients = (energyKcal: number): Nutrients => ({
  energyKcal, proteinG: 10, fatG: 5, carbohydrateG: 20, fiberG: 2, saltG: 1,
  calciumMg: 10, ironMg: 1, vitaminAMcg: 10, vitaminEMg: 1, vitaminB1Mg: 0.1, vitaminB2Mg: 0.1, vitaminCMg: 1, saturatedFatG: 1,
})
const food = (id: string, energyKcal: number, baseAmount = 100, baseUnit: Food['baseUnit'] = 'g'): Food => ({
  id, name: id, maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount, baseUnit,
  servingAmount: null, servingUnit: null, nutrients: nutrients(energyKcal), createdAt: '', updatedAt: '',
})
const menu = (id: string, ingredients: Menu['ingredients'] = []): Menu => ({
  id, name: id, category: '主菜', foodIds: [], ingredients, createdAt: '', updatedAt: '',
})

describe('menu ingredients', () => {
  it('旧形式のfoodIdsを食品の基準量明細へ読み替え、栄養値も従来どおり計算する', () => {
    const rice = food('rice', 200)
    const oldMenu: Menu = { ...menu('old'), foodIds: [rice.id], ingredients: undefined }
    expect(getMenuIngredients(oldMenu, [rice])).toEqual([{ kind: 'food', itemId: rice.id, amount: 100, unit: 'g' }])
    expect(getMenuFoodIds(oldMenu)).toEqual(['rice'])
    expect(menuToFood(oldMenu, [oldMenu], [rice]).nutrients.energyKcal).toBe(200)
  })

  it('ingredientsが存在する場合はfoodIdsより優先し、食品とネストメニューを区別する', () => {
    const current = menu('current', [
      { kind: 'food', itemId: 'food_1', amount: 30, unit: 'g' },
      { kind: 'menu', itemId: 'nested', amount: 1, unit: '食' },
    ])
    current.foodIds = ['legacy_food']
    expect(getMenuIngredients(current, [])).toEqual(current.ingredients)
    expect(getMenuFoodIds(current)).toEqual(['food_1'])
    expect(getNestedMenuIds(current)).toEqual(['nested'])
  })

  it('食品明細の保存分量を栄養計算へ反映する', () => {
    const beef = food('beef', 400)
    expect(menuToFood(menu('dish', [{ kind: 'food', itemId: beef.id, amount: 25, unit: 'g' }]), [], [beef]).nutrients.energyKcal).toBe(100)
  })

  it('ネスト先メニューを小数を含む指定食数で計算する', () => {
    const chicken = food('chicken', 300)
    const nested = menu('nested', [{ kind: 'food', itemId: chicken.id, amount: 100, unit: 'g' }])
    const parent = menu('parent', [{ kind: 'menu', itemId: nested.id, amount: 0.5, unit: '食' }])
    expect(menuToFood(parent, [parent, nested], [chicken]).nutrients.energyKcal).toBe(150)
  })

  it('自己参照・推移的な循環を判定する', () => {
    const first = menu('first')
    const second = menu('second', [{ kind: 'menu', itemId: 'third', amount: 1, unit: '食' }])
    const third = menu('third', [{ kind: 'menu', itemId: 'first', amount: 1, unit: '食' }])
    expect(wouldCreateMenuCycle('first', 'first', [first, second, third])).toBe(true)
    expect(wouldCreateMenuCycle('first', 'second', [first, second, third])).toBe(true)
    expect(wouldCreateMenuCycle(null, 'first', [first])).toBe(false)
    expect(hasMenuCycles([menu('a', [{ kind: 'menu', itemId: 'b', amount: 1, unit: '食' }]), menu('b', [{ kind: 'menu', itemId: 'a', amount: 1, unit: '食' }])])).toBe(true)
  })

  it('循環や欠損参照をEMPTY_NUTRIENTSとして安全に処理する', () => {
    const first = menu('first', [{ kind: 'menu', itemId: 'second', amount: 1, unit: '食' }])
    const second = menu('second', [{ kind: 'menu', itemId: 'first', amount: 1, unit: '食' }])
    const missing = menu('missing', [{ kind: 'food', itemId: 'not-found', amount: 10, unit: 'g' }])
    const legacyMissing: Menu = { ...menu('legacy-missing'), foodIds: ['not-found'], ingredients: undefined }
    expect(menuToFood(first, [first, second], []).nutrients).toEqual(EMPTY_NUTRIENTS)
    expect(menuToFood(missing, [missing], []).nutrients).toEqual(EMPTY_NUTRIENTS)
    expect(menuToFood(legacyMissing, [legacyMissing], []).nutrients).toEqual(EMPTY_NUTRIENTS)
  })
})
