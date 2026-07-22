import {
  EMPTY_NUTRIENTS,
  NUTRIENT_KEYS,
  type Food,
  type FoodSnapshot,
  type FoodUnit,
  type MealFoodIngredientSnapshot,
  type MealIngredientSnapshot,
  type MealMenuIngredientSnapshot,
  type MealMenuSnapshot,
  type Menu,
  type Nutrients,
} from '../types'
import { isNutrients, isValidUnit } from '../utils/validation'
import { calculateNutrients, sumNutrients } from './nutrition'
import { getMenuIngredients } from './menuIngredients'

function foodSnapshot(food: Food): FoodSnapshot {
  return {
    name: food.displayName ?? food.name,
    officialName: food.officialName,
    displayName: food.displayName,
    maker: food.maker,
    barcode: food.barcode,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    nutrients: { ...food.nutrients },
  }
}

function missingFoodSnapshot(itemId: string, unit: FoodUnit): FoodSnapshot {
  return {
    name: `削除済み食品（${itemId}）`,
    maker: '',
    barcode: '',
    baseAmount: 1,
    baseUnit: unit,
    nutrients: { ...EMPTY_NUTRIENTS },
  }
}

export function createMealFoodIngredientSnapshot(
  food: Food,
  amount = food.baseAmount,
  unit = food.baseUnit,
): MealFoodIngredientSnapshot {
  return { kind: 'food', itemId: food.id, amount, unit, foodSnapshot: foodSnapshot(food) }
}

function createMenuIngredientSnapshot(
  menuId: string,
  amount: number,
  unit: FoodUnit,
  menusById: Map<string, Menu>,
  foodsById: Map<string, Food>,
  allFoods: Food[],
  ancestors: Set<string>,
): MealMenuIngredientSnapshot {
  const menu = menusById.get(menuId)
  if (!menu || ancestors.has(menuId)) {
    return {
      kind: 'menu', itemId: menuId, name: menu?.name ?? `削除済みメニュー（${menuId}）`, amount, unit,
      ingredients: [], missing: true,
    }
  }
  const nextAncestors = new Set(ancestors).add(menuId)
  const ingredients = getMenuIngredients(menu, allFoods).map((ingredient): MealIngredientSnapshot => {
    if (ingredient.kind === 'food') {
      const food = foodsById.get(ingredient.itemId)
      return food
        ? createMealFoodIngredientSnapshot(food, ingredient.amount, ingredient.unit)
        : { kind: 'food', itemId: ingredient.itemId, amount: ingredient.amount, unit: ingredient.unit, foodSnapshot: missingFoodSnapshot(ingredient.itemId, ingredient.unit) }
    }
    return createMenuIngredientSnapshot(
      ingredient.itemId, ingredient.amount, ingredient.unit, menusById, foodsById, allFoods, nextAncestors,
    )
  })
  return { kind: 'menu', itemId: menu.id, name: menu.name, amount, unit, ingredients, missing: false }
}

export function createMealMenuIngredientSnapshot(
  menu: Menu,
  menus: Menu[],
  foods: Food[],
  amount = 1,
  unit: FoodUnit = '食',
): MealMenuIngredientSnapshot {
  return createMenuIngredientSnapshot(
    menu.id, amount, unit, new Map(menus.map((item) => [item.id, item])),
    new Map(foods.map((food) => [food.id, food])), foods, new Set(),
  )
}

export function createMealMenuSnapshot(menu: Menu, menus: Menu[], foods: Food[]): MealMenuSnapshot {
  const root = createMealMenuIngredientSnapshot(menu, menus, foods)
  return { sourceMenuId: menu.id, sourceMenuName: menu.name, ingredients: root.ingredients }
}

function snapshotFoodAsFood(snapshot: FoodSnapshot, id: string): Food {
  return {
    id,
    name: snapshot.name,
    officialName: snapshot.officialName,
    displayName: snapshot.displayName,
    maker: snapshot.maker,
    barcode: snapshot.barcode,
    source: 'user',
    sourceVersion: '食事記録の構成食材スナップショット',
    baseAmount: snapshot.baseAmount,
    baseUnit: snapshot.baseUnit,
    servingAmount: null,
    servingUnit: null,
    nutrients: snapshot.nutrients,
    createdAt: '',
    updatedAt: '',
  }
}

function scaleNutrients(nutrients: Nutrients, amount: number, unit: FoodUnit): Nutrients {
  if (unit !== '食' || !Number.isFinite(amount) || amount <= 0) return { ...EMPTY_NUTRIENTS }
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const value = nutrients[key]
    return [key, value === null ? null : value * amount]
  })) as Nutrients
}

export function calculateMealIngredientSnapshotNutrients(ingredient: MealIngredientSnapshot): Nutrients {
  if (ingredient.kind === 'food') {
    return calculateNutrients(snapshotFoodAsFood(ingredient.foodSnapshot, ingredient.itemId), ingredient.amount, ingredient.unit)
  }
  if (ingredient.missing) return { ...EMPTY_NUTRIENTS }
  return scaleNutrients(sumNutrients(ingredient.ingredients.map(calculateMealIngredientSnapshotNutrients)), ingredient.amount, ingredient.unit)
}

/** 料理メニュー1食分の栄養値を、食事側へ複製した構成だけから計算する。 */
export function calculateMealMenuSnapshotNutrients(snapshot: MealMenuSnapshot): Nutrients {
  return sumNutrients(snapshot.ingredients.map(calculateMealIngredientSnapshotNutrients))
}

export function calculateMealMenuEntryNutrients(snapshot: MealMenuSnapshot, amount: number, unit: FoodUnit): Nutrients {
  return scaleNutrients(calculateMealMenuSnapshotNutrients(snapshot), amount, unit)
}

function cloneIngredient(ingredient: MealIngredientSnapshot): MealIngredientSnapshot {
  if (ingredient.kind === 'food') {
    return {
      ...ingredient,
      foodSnapshot: { ...ingredient.foodSnapshot, nutrients: { ...ingredient.foodSnapshot.nutrients } },
    }
  }
  return { ...ingredient, ingredients: ingredient.ingredients.map(cloneIngredient) }
}

export function cloneMealMenuSnapshot(snapshot: MealMenuSnapshot): MealMenuSnapshot {
  return { ...snapshot, ingredients: snapshot.ingredients.map(cloneIngredient) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFoodSnapshot(value: unknown): value is FoodSnapshot {
  if (!isRecord(value)) return false
  return typeof value.name === 'string' && typeof value.maker === 'string' && typeof value.barcode === 'string'
    && typeof value.baseAmount === 'number' && Number.isFinite(value.baseAmount) && value.baseAmount > 0
    && isValidUnit(String(value.baseUnit)) && isNutrients(value.nutrients)
    && (value.officialName === undefined || typeof value.officialName === 'string')
    && (value.displayName === undefined || typeof value.displayName === 'string')
}

function isMealIngredientSnapshot(value: unknown): value is MealIngredientSnapshot {
  if (!isRecord(value) || (value.kind !== 'food' && value.kind !== 'menu') || typeof value.itemId !== 'string' || !value.itemId
    || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0 || value.amount > 100000
    || !isValidUnit(String(value.unit))) return false
  if (value.kind === 'food') return isFoodSnapshot(value.foodSnapshot)
  return typeof value.name === 'string' && typeof value.missing === 'boolean'
    && Array.isArray(value.ingredients) && value.ingredients.every(isMealIngredientSnapshot)
}

export function isMealMenuSnapshot(value: unknown): value is MealMenuSnapshot {
  return isRecord(value) && typeof value.sourceMenuId === 'string' && Boolean(value.sourceMenuId)
    && typeof value.sourceMenuName === 'string' && Array.isArray(value.ingredients)
    && value.ingredients.every(isMealIngredientSnapshot)
}
