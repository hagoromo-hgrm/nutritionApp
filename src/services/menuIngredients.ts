import { EMPTY_NUTRIENTS, type Food, type Menu, type MenuIngredient } from '../types'
import { calculateNutrients, getFoodQuantityUnits, sumNutrients } from './nutrition'

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
    if (ingredient.kind === 'menu') return ingredient.unit !== '食'
    const food = foodsById.get(ingredient.itemId)
    return food ? !getFoodQuantityUnits(food).includes(ingredient.unit) : false
  }))
}

function createMenuFood(menu: Menu, menusById: Map<string, Menu>, foodsById: Map<string, Food>, ancestors: Set<string>): Food {
  if (ancestors.has(menu.id)) {
    return {
      id: `menu:${menu.id}`, name: menu.name, maker: '', barcode: '', source: 'user', sourceVersion: `メニュー「${menu.category}」`,
      baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients: { ...EMPTY_NUTRIENTS }, createdAt: menu.createdAt, updatedAt: menu.updatedAt,
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
    baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients, createdAt: menu.createdAt, updatedAt: menu.updatedAt,
  }
}

/** メニューを1食分の食品として扱える形へ変換する。 */
export function menuToFood(menu: Menu, menus: Menu[], foods: Food[]): Food {
  return createMenuFood(menu, new Map(menus.map((item) => [item.id, item])), new Map(foods.map((food) => [food.id, food])), new Set())
}
