import type { Food, FoodSnapshot, MealEntry, MealType, Menu, MenuSet } from '../types'
import { calculateNutrients, getFoodDefaultServing } from './nutrition'
import { menuToFood } from './menuIngredients'
import {
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotNutrients,
  createMealMenuSnapshot,
} from './mealMenuSnapshots'

interface CreateMenuSetMealBatchOptions {
  menuSet: MenuSet
  menus: Menu[]
  foods: Food[]
  mealType: MealType
  eatenAt: string
  createId: () => string
}

export interface MenuSetMealBatch {
  entries: MealEntry[]
  missingMenuIds: string[]
  missingFoodIds: string[]
}

function createFoodSnapshot(food: Food): FoodSnapshot {
  return {
    name: food.displayName ?? food.name,
    officialName: food.officialName,
    displayName: food.displayName,
    maker: food.maker,
    barcode: food.barcode,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: food.inputUnitConversions?.map((conversion) => ({ ...conversion })),
    nutrients: { ...food.nutrients },
  }
}

/** メニューセットを、セット名ではなく構成項目ごとの独立した食事記録へ展開する。 */
export function createMenuSetMealBatch(options: CreateMenuSetMealBatchOptions): MenuSetMealBatch {
  const { menuSet, menus, foods, mealType, eatenAt, createId } = options
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const foodsById = new Map(foods.map((food) => [food.id, food]))
  const entries: MealEntry[] = []
  const missingMenuIds: string[] = []
  const missingFoodIds: string[] = []

  for (const menuId of menuSet.menuIds) {
    const menu = menusById.get(menuId)
    if (!menu) {
      missingMenuIds.push(menuId)
      continue
    }
    const menuFood = menuToFood(menu, menus, foods)
    const menuSnapshot = createMealMenuSnapshot(menu, menus, foods)
    const snapshotNutrients = calculateMealMenuSnapshotNutrients(menuSnapshot)
    entries.push({
      id: createId(),
      eatenAt,
      mealType,
      foodId: menuFood.id,
      foodSnapshot: {
        ...createFoodSnapshot(menuFood),
        nutrients: { ...snapshotNutrients },
      },
      amount: 1,
      amountUnit: '食',
      calculatedNutrients: calculateMealMenuEntryNutrients(menuSnapshot, 1, '食'),
      menuSnapshot,
    })
  }

  for (const foodId of menuSet.foodIds ?? []) {
    const food = foodsById.get(foodId)
    if (!food) {
      missingFoodIds.push(foodId)
      continue
    }
    const serving = getFoodDefaultServing(food)
    const amount = serving.amount
    entries.push({
      id: createId(),
      eatenAt,
      mealType,
      foodId: food.id,
      foodSnapshot: createFoodSnapshot(food),
      amount,
      amountUnit: serving.unit,
      calculatedNutrients: calculateNutrients(food, amount, serving.unit),
    })
  }

  return { entries, missingMenuIds, missingFoodIds }
}
