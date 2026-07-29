import type { Food, FoodSnapshot, GeneralMenu, MealEntry, MealType, Menu, MenuSet, MenuSetFoodItem } from '../types'
import { calculateNutrients, getFoodDefaultServing, sumEntries } from './nutrition'
import { menuToFood } from './menuIngredients'
import {
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotNutrients,
  createGeneralMealMenuSnapshot,
  createMealMenuSnapshot,
} from './mealMenuSnapshots'
import { getMextUserFacingFoodName } from './mealEntryDisplay'

interface CreateMenuSetMealBatchOptions {
  menuSet: MenuSet
  menus: Menu[]
  generalMenus?: GeneralMenu[]
  foods: Food[]
  mealType: MealType
  eatenAt: string
  createId: () => string
}

export interface MenuSetMealBatch {
  entries: MealEntry[]
  missingMenuIds: string[]
  missingGeneralMenuIds: string[]
  missingFoodIds: string[]
}

function createFoodSnapshot(food: Food): FoodSnapshot {
  return {
    name: food.displayName ?? food.name,
    officialName: food.officialName,
    displayName: food.displayName,
    userFacingName: getMextUserFacingFoodName(food.id) ?? food.displayName ?? food.name,
    maker: food.maker,
    barcode: food.barcode,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: food.inputUnitConversions?.map((conversion) => ({ ...conversion })),
    nutrients: { ...food.nutrients },
    nutrientMetadata: food.nutrientMetadata
      ? Object.fromEntries(Object.entries(food.nutrientMetadata).map(([key, metadata]) => [key, {
        ...metadata,
        sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
        calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
      }]))
      : undefined,
  }
}

/** 新形式を優先し、旧foodIdsは食品の既定量へ読み替える。 */
export function getMenuSetFoodItems(menuSet: MenuSet, foods: Food[]): MenuSetFoodItem[] {
  if (menuSet.foodItems !== undefined) return menuSet.foodItems.map((item) => ({ ...item }))
  const foodsById = new Map(foods.map((food) => [food.id, food]))
  return (menuSet.foodIds ?? []).map((foodId) => {
    const food = foodsById.get(foodId)
    const serving = food ? getFoodDefaultServing(food) : { amount: 1, unit: 'その他' as const }
    return { foodId, amount: serving.amount, unit: serving.unit }
  })
}

export interface MenuSetCalorieItem {
  id: string
  energyKcal: number | null
}

export interface MenuSetCalorieSummary {
  items: MenuSetCalorieItem[]
  energyKcal: number | null
}

interface MenuSetCalorieSummaryOptions {
  menuSet: MenuSet
  menus: Menu[]
  generalMenus?: GeneralMenu[]
  foods: Food[]
}

/**
 * Myセット表示用のカロリーを、食事へのセット展開と同じ計算経路から求める。
 * 削除済み参照や算出不能な項目は0補完せず、項目とセット合計の欠損を維持する。
 */
export function getMenuSetCalorieSummary(options: MenuSetCalorieSummaryOptions): MenuSetCalorieSummary {
  const { menuSet, menus, generalMenus = [], foods } = options
  const batch = createMenuSetMealBatch({
    menuSet,
    menus,
    generalMenus,
    foods,
    mealType: '朝食',
    eatenAt: '',
    createId: () => 'menu-set-calorie-preview',
  })
  const entriesByFoodId = new Map<string, MealEntry[]>()
  for (const entry of batch.entries) {
    const entries = entriesByFoodId.get(entry.foodId) ?? []
    entries.push(entry)
    entriesByFoodId.set(entry.foodId, entries)
  }
  const takeEnergy = (id: string): number | null => entriesByFoodId.get(id)?.shift()?.calculatedNutrients.energyKcal ?? null
  const items: MenuSetCalorieItem[] = [
    ...menuSet.menuIds.map((id) => ({ id: `menu:${id}`, energyKcal: takeEnergy(`menu:${id}`) })),
    ...(menuSet.generalMenuIds ?? []).map((id) => ({ id: `general-menu:${id}`, energyKcal: takeEnergy(`general-menu:${id}`) })),
    ...getMenuSetFoodItems(menuSet, foods).map((item) => ({ id: `food:${item.foodId}`, energyKcal: takeEnergy(item.foodId) })),
  ]
  return {
    items,
    energyKcal: items.some((item) => item.energyKcal === null)
      ? null
      : sumEntries(batch.entries).energyKcal,
  }
}

/** メニューセットを、セット名ではなく構成項目ごとの独立した食事記録へ展開する。 */
export function createMenuSetMealBatch(options: CreateMenuSetMealBatchOptions): MenuSetMealBatch {
  const { menuSet, menus, generalMenus = [], foods, mealType, eatenAt, createId } = options
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const generalMenusById = new Map(generalMenus.map((menu) => [menu.id, menu]))
  const foodsById = new Map(foods.map((food) => [food.id, food]))
  const entries: MealEntry[] = []
  const missingMenuIds: string[] = []
  const missingGeneralMenuIds: string[] = []
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

  for (const generalMenuId of menuSet.generalMenuIds ?? []) {
    const generalMenu = generalMenusById.get(generalMenuId)
    if (!generalMenu) {
      missingGeneralMenuIds.push(generalMenuId)
      continue
    }
    const convertedMenuFood = menuToFood(generalMenu, [...menus, generalMenu], foods)
    const menuFood = { ...convertedMenuFood, id: `general-menu:${generalMenu.id}`, sourceVersion: `一般メニュー「${generalMenu.category}」` }
    const menuSnapshot = createGeneralMealMenuSnapshot(generalMenu, menus, foods)
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

  for (const item of getMenuSetFoodItems(menuSet, foods)) {
    const food = foodsById.get(item.foodId)
    if (!food) {
      missingFoodIds.push(item.foodId)
      continue
    }
    entries.push({
      id: createId(),
      eatenAt,
      mealType,
      foodId: food.id,
      foodSnapshot: createFoodSnapshot(food),
      amount: item.amount,
      amountUnit: item.unit,
      calculatedNutrients: calculateNutrients(food, item.amount, item.unit),
    })
  }

  return { entries, missingMenuIds, missingGeneralMenuIds, missingFoodIds }
}
