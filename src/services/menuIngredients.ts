import { EMPTY_NUTRIENTS, type Food, type Menu, type MenuIngredient, type QuantityUnit } from '../types'
import { calculateNutrients, getFoodQuantityUnits, sumNutrients } from './nutrition'
import { isValidQuantityUnit } from '../utils/validation'

/** メニューの新形式の基準量。旧形式・不完全な値は1食へ読み替える。 */
export function getMenuBase(menu: Menu): { amount: number; unit: QuantityUnit } {
  if (typeof menu.baseAmount === 'number' && Number.isFinite(menu.baseAmount) && menu.baseAmount > 0 && menu.baseAmount <= 100000
    && typeof menu.baseUnit === 'string' && isValidQuantityUnit(menu.baseUnit)) {
    return { amount: menu.baseAmount, unit: menu.baseUnit }
  }
  return { amount: 1, unit: '食' }
}

/** 直前の換算単位形式を編集するときは、既定単位を新しい基準単位へ換算して栄養量を保つ。 */
export function getEditableMenuBase(menu: Menu): { amount: number; unit: QuantityUnit } {
  if (menu.baseAmount !== undefined || menu.baseUnit !== undefined) return getMenuBase(menu)
  if (menu.servingUnit && menu.servingUnit !== '食') {
    const conversion = menu.inputUnitConversions?.find((item) => item.unit === menu.servingUnit)
    const convertedAmount = conversion ? 1 / conversion.baseAmount : Number.NaN
    if (conversion && Number.isFinite(convertedAmount) && convertedAmount > 0 && convertedAmount <= 100000) {
      return { amount: convertedAmount, unit: conversion.unit }
    }
  }
  return getMenuBase(menu)
}

export function getMenuQuantityUnits(menu: Menu): string[] {
  const base = getMenuBase(menu)
  if (base.unit !== '食' || menu.baseAmount !== undefined || menu.baseUnit !== undefined) return [base.unit]
  // 旧形式の保存データだけは、当時の換算を読み取れるようにする。
  return [...new Set(['食', ...(menu.inputUnitConversions ?? []).map((conversion) => conversion.unit)])]
}

/** 旧形式のfoodIdsを、食品の基準量を使う明細へ読み替える。 */
export function getMenuIngredients(menu: Menu, foods: Food[]): MenuIngredient[] {
  if (menu.ingredients !== undefined) return menu.ingredients.map((ingredient) => ({ ...ingredient }))
  const foodsById = new Map(foods.map((food) => [food.id, food]))
  return menu.foodIds.map((foodId) => {
    const food = foodsById.get(foodId)
    return food
      ? { kind: 'food' as const, itemId: food.id, amount: food.baseAmount, unit: food.baseUnit }
      : { kind: 'food' as const, itemId: foodId, amount: 1, unit: 'その他' as const }
  })
}

export function getMenuFoodIds(menu: Menu): string[] {
  return menu.ingredients === undefined
    ? [...menu.foodIds]
    : menu.ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId)
}

export function getNestedMenuIds(menu: Menu): string[] {
  return (menu.ingredients ?? []).filter((ingredient) => ingredient.kind === 'menu').map((ingredient) => ingredient.itemId)
}

/** 候補メニューを現在のメニューへ追加したとき、現在メニューへ戻る経路ができるかを判定する。 */
export function wouldCreateMenuCycle(currentMenuId: string | null, candidateMenuId: string, menus: Menu[]): boolean {
  if (currentMenuId === null) return false
  if (currentMenuId === candidateMenuId) return true
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const visited = new Set<string>()
  const canReachCurrent = (menuId: string): boolean => {
    if (menuId === currentMenuId) return true
    if (visited.has(menuId)) return false
    visited.add(menuId)
    const menu = menusById.get(menuId)
    return menu ? getNestedMenuIds(menu).some(canReachCurrent) : false
  }
  return canReachCurrent(candidateMenuId)
}

export function hasMenuCycles(menus: Menu[]): boolean {
  return menus.some((menu) => getNestedMenuIds(menu).some((candidateId) => wouldCreateMenuCycle(menu.id, candidateId, menus)))
}

/** 料理メニュー食材の単位と、存在する食品の明示換算に一致しないメニューを返す。削除済み食品参照は履歴保持のため対象外とする。 */
export function menusWithUnsupportedIngredientUnits(menus: Menu[], foods: Food[]): Menu[] {
  const foodsById = new Map(foods.map((food) => [food.id, food]))
  return menus.filter((menu) => (menu.ingredients ?? []).some((ingredient) => {
    if (ingredient.kind === 'menu') {
      const nested = menus.find((candidate) => candidate.id === ingredient.itemId)
      return nested !== undefined && !getMenuQuantityUnits(nested).includes(ingredient.unit)
    }
    const food = foodsById.get(ingredient.itemId)
    return food ? !getFoodQuantityUnits(food).includes(ingredient.unit) : false
  }))
}

function createMenuFood(menu: Menu, menusById: Map<string, Menu>, foodsById: Map<string, Food>, ancestors: Set<string>): Food {
  const base = getMenuBase(menu)
  const legacyConversions = menu.baseAmount === undefined && menu.baseUnit === undefined
    ? menu.inputUnitConversions?.map((conversion) => ({ ...conversion }))
    : undefined
  if (ancestors.has(menu.id)) {
    return {
      id: `menu:${menu.id}`, name: menu.name, maker: '', barcode: '', source: 'user', sourceVersion: `メニュー「${menu.category}」`,
      baseAmount: base.amount, baseUnit: base.unit as Food['baseUnit'], servingAmount: menu.servingAmount ?? base.amount, servingUnit: menu.servingUnit ?? base.unit, inputUnitConversions: legacyConversions, nutrients: { ...EMPTY_NUTRIENTS }, createdAt: menu.createdAt, updatedAt: menu.updatedAt,
    }
  }
  const nextAncestors = new Set(ancestors).add(menu.id)
  const nutrients = sumNutrients(getMenuIngredients(menu, [...foodsById.values()]).map((ingredient) => {
    if (ingredient.kind === 'food') {
      const food = foodsById.get(ingredient.itemId)
      return food ? calculateNutrients(food, ingredient.amount, ingredient.unit) : { ...EMPTY_NUTRIENTS }
    }
    const nestedMenu = menusById.get(ingredient.itemId)
    if (!nestedMenu) return { ...EMPTY_NUTRIENTS }
    return calculateNutrients(createMenuFood(nestedMenu, menusById, foodsById, nextAncestors), ingredient.amount, ingredient.unit)
  }))
  return {
    id: `menu:${menu.id}`, name: menu.name, maker: '', barcode: '', source: 'user', sourceVersion: `メニュー「${menu.category}」`,
    baseAmount: base.amount, baseUnit: base.unit as Food['baseUnit'], servingAmount: menu.servingAmount ?? base.amount, servingUnit: menu.servingUnit ?? base.unit, inputUnitConversions: legacyConversions, nutrients, createdAt: menu.createdAt, updatedAt: menu.updatedAt,
  }
}

/** メニューを基準量・基準単位付きの食品として扱える形へ変換する。 */
export function menuToFood(menu: Menu, menus: Menu[], foods: Food[]): Food {
  return createMenuFood(menu, new Map(menus.map((item) => [item.id, item])), new Map(foods.map((food) => [food.id, food])), new Set())
}
