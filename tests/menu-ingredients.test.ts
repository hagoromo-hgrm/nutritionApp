import { describe, expect, it } from 'vitest'
import { EMPTY_NUTRIENTS, type Food, type Menu, type Nutrients } from '../src/types'
import { getEditableMenuBase, getMenuBase, getMenuFoodIds, getMenuIngredients, getMenuQuantityUnits, getNestedMenuIds, hasMenuCycles, menuToDisplayFood, menuToFood, wouldCreateMenuCycle } from '../src/services/menuIngredients'
import { calculateNutrients, getFoodDefaultServing } from '../src/services/nutrition'

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

  it('メニュー全体の基準量と任意単位を直接保持して分量計算する', () => {
    const potato = food('potato', 400)
    const croquettes: Menu = {
      ...menu('croquettes', [{ kind: 'food', itemId: potato.id, amount: 100, unit: 'g' }]),
      baseAmount: 2,
      baseUnit: '個',
      servingAmount: 1,
      servingUnit: '個',
    }
    const converted = menuToFood(croquettes, [croquettes], [potato])

    expect(getMenuBase(croquettes)).toEqual({ amount: 2, unit: '個' })
    expect(getMenuQuantityUnits(croquettes)).toEqual(['個'])
    expect(converted).toMatchObject({ baseAmount: 2, baseUnit: '個', servingAmount: 1, servingUnit: '個' })
    expect(converted.nutrients.energyKcal).toBe(400)
    expect(calculateNutrients(converted, 1, '個').energyKcal).toBe(200)
    const withoutServing = menuToFood({ ...croquettes, servingAmount: undefined, servingUnit: undefined }, [croquettes], [potato])
    expect(getFoodDefaultServing(withoutServing)).toEqual({ amount: 2, unit: '個' })
  })

  it('旧換算形式を編集するときは既定単位を新しい基準へ読み替える', () => {
    const legacy: Menu = {
      ...menu('legacy-unit'),
      inputUnitConversions: [{ unit: '皿', baseAmount: 0.5 }],
      servingAmount: 2,
      servingUnit: '皿',
    }
    expect(getMenuBase(legacy)).toEqual({ amount: 1, unit: '食' })
    expect(getEditableMenuBase(legacy)).toEqual({ amount: 2, unit: '皿' })
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

  it('表示用小計は栄養素ごとに既知寄与を合算し、通常計算のnull伝播を保つ', () => {
    const energyFood: Food = { ...food('energy', 100), nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 100 } }
    const proteinFood: Food = { ...food('protein', 100), nutrients: { ...EMPTY_NUTRIENTS, proteinG: 20 } }
    const mixed = menu('mixed', [
      { kind: 'food', itemId: energyFood.id, amount: 100, unit: 'g' },
      { kind: 'food', itemId: proteinFood.id, amount: 100, unit: 'g' },
    ])
    mixed.baseAmount = 2
    mixed.baseUnit = '食'
    const strict = menuToFood(mixed, [mixed], [energyFood, proteinFood])
    const display = menuToDisplayFood(mixed, [], [energyFood, proteinFood])

    expect(strict.nutrients.energyKcal).toBeNull()
    expect(strict.nutrients.proteinG).toBeNull()
    expect(display.nutrients.energyKcal).toBe(100)
    expect(display.nutrients.proteinG).toBe(20)
    expect(display.nutrients.fatG).toBeNull()
    expect(calculateNutrients(display, 1, '食')).toMatchObject({ energyKcal: 50, proteinG: 10, fatG: null })
  })

  it('欠損参照、循環参照、単位不一致を除いて既知の栄養寄与を残す', () => {
    const valid = food('valid', 120)
    const incompatible = food('incompatible', 500)
    const mixed = menu('mixed', [
      { kind: 'food', itemId: valid.id, amount: 100, unit: 'g' },
      { kind: 'food', itemId: incompatible.id, amount: 1, unit: 'oz' },
      { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
      { kind: 'menu', itemId: 'deleted-menu', amount: 1, unit: '食' },
      { kind: 'menu', itemId: 'mixed', amount: 1, unit: '食' },
    ])
    const display = menuToDisplayFood(mixed, [], [valid, incompatible])

    expect(display.nutrients.energyKcal).toBe(120)
    expect(display.nutrients.proteinG).toBe(10)
    expect(menuToFood(mixed, [], [valid, incompatible]).nutrients.energyKcal).toBeNull()
  })

  it('ネスト内の既知分を分量と基準量で換算し、子メニューの欠損は除外する', () => {
    const chicken = food('chicken', 200)
    const nested = menu('nested', [
      { kind: 'food', itemId: chicken.id, amount: 400, unit: 'g' },
      { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
    ])
    nested.baseAmount = 2
    nested.baseUnit = '食'
    const parent = menu('parent', [{ kind: 'menu', itemId: nested.id, amount: 2, unit: '食' }])
    parent.baseAmount = 4
    parent.baseUnit = '食'
    const display = menuToDisplayFood(parent, [nested], [chicken])

    expect(display.nutrients.energyKcal).toBe(800)
    expect(display.nutrients.proteinG).toBe(40)
    expect(calculateNutrients(display, 1, '食')).toMatchObject({ energyKcal: 200, proteinG: 10 })
    expect(menuToFood(parent, [nested], [chicken]).nutrients.energyKcal).toBeNull()
  })

  it('明示された0だけを既知の0として保持する', () => {
    const zeroFood: Food = { ...food('zero', 0), nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 0 } }
    const zero = menu('zero', [{ kind: 'food', itemId: zeroFood.id, amount: 100, unit: 'g' }])
    const missing = menu('missing', [{ kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' }])

    expect(menuToDisplayFood(zero, [zero], [zeroFood]).nutrients.energyKcal).toBe(0)
    expect(menuToDisplayFood(missing, [missing], []).nutrients.energyKcal).toBeNull()
  })
})
