import { calculateMealMenuSnapshotNutrients } from '../services/mealMenuSnapshots'
import { getMenuIngredients, menuToFood } from '../services/menuIngredients'
import { getMenuSetFoodItems } from '../services/menuSetMeals'
import { calculateNutrients, formatNutrient, getFoodDefaultServingNutrition, sumNutrients } from '../services/nutrition'
import {
  type Food,
  type FoodGroup,
  type GeneralMenu,
  type MealEntry,
  type MealMenuSnapshot,
  type Menu,
  type MenuSet,
  type NutrientMetadataMap,
  type Nutrients,
} from '../types'

export function snapshotToFood(entry: MealEntry): Food {
  return {
    id: entry.foodId, name: entry.foodSnapshot.name, displayName: entry.foodSnapshot.displayName ?? entry.foodSnapshot.name, officialName: entry.foodSnapshot.officialName, maker: entry.foodSnapshot.maker, barcode: entry.foodSnapshot.barcode,
    source: 'user', sourceVersion: '食事記録スナップショット', baseAmount: entry.foodSnapshot.baseAmount,
    baseUnit: entry.foodSnapshot.baseUnit as Food['baseUnit'], servingAmount: null, servingUnit: null,
    inputUnitConversions: entry.foodSnapshot.inputUnitConversions?.map((conversion) => ({ ...conversion })), nutrients: entry.foodSnapshot.nutrients,
    nutrientMetadata: entry.foodSnapshot.nutrientMetadata
      ? Object.fromEntries(Object.entries(entry.foodSnapshot.nutrientMetadata).map(([key, metadata]) => [key, {
        ...metadata,
        sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
        calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
      }])) as NutrientMetadataMap
      : undefined,
    createdAt: entry.eatenAt, updatedAt: entry.eatenAt,
  }
}

export function menuSetPreviewFood(menuSet: MenuSet, menus: Menu[], generalMenus: GeneralMenu[], foods: Food[]): Food {
  const menuNutrients = menuSet.menuIds.map((menuId) => menus.find((menu) => menu.id === menuId)).filter((menu): menu is Menu => Boolean(menu)).map((menu) => menuToFood(menu, menus, foods)).map((food) => getFoodDefaultServingNutrition(food).nutrients)
  const generalMenuNutrients = (menuSet.generalMenuIds ?? []).map((menuId) => generalMenus.find((menu) => menu.id === menuId)).filter((menu): menu is GeneralMenu => Boolean(menu)).map((menu) => generalMenuToFood(menu, menus, foods)).map((food) => getFoodDefaultServingNutrition(food).nutrients)
  const foodNutrients = getMenuSetFoodItems(menuSet, foods).map((item) => {
    const food = foods.find((candidate) => candidate.id === item.foodId)
    return food ? calculateNutrients(food, item.amount, item.unit) : null
  }).filter((nutrients): nutrients is Nutrients => nutrients !== null)
  const nutrients = sumNutrients([...menuNutrients, ...generalMenuNutrients, ...foodNutrients])
  return {
    id: `menu-set:${menuSet.id}`, name: menuSet.name, maker: '', barcode: '', source: 'user', sourceVersion: 'Myセット',
    baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients, createdAt: menuSet.createdAt, updatedAt: menuSet.updatedAt,
  }
}

export function generalMenuToFood(menu: GeneralMenu, menus: Menu[], foods: Food[]): Food {
  const converted = menuToFood(menu, [menu, ...menus], foods)
  return {
    ...converted,
    id: `general-menu:${menu.id}`,
    sourceVersion: `一般メニュー「${menu.category}」`,
  }
}

export function temporaryMenuToFood(snapshot: MealMenuSnapshot): Food {
  const now = new Date().toISOString()
  return {
    id: snapshot.sourceMenuId,
    name: snapshot.sourceMenuName,
    displayName: snapshot.sourceMenuName,
    maker: '',
    barcode: '',
    source: 'user',
    sourceVersion: '一時メニュー',
    baseAmount: snapshot.baseAmount ?? 1,
    baseUnit: (snapshot.baseUnit ?? '食') as Food['baseUnit'],
    servingAmount: snapshot.baseAmount ?? 1,
    servingUnit: snapshot.baseUnit ?? '食',
    nutrients: calculateMealMenuSnapshotNutrients(snapshot),
    createdAt: now,
    updatedAt: now,
  }
}

export function displayFoodName(food: Food): string {
  const name = food.displayName ?? food.name
  return food.maker ? `${name}（${food.maker}）` : name
}

export function foodListNutritionLabel(food: Food, includeQuantity = true): string {
  const serving = getFoodDefaultServingNutrition(food)
  return `${includeQuantity ? `${serving.amount}${serving.unit} · ` : ''}${formatNutrient(serving.nutrients.energyKcal)}kcal`
}

export function displaySearchFoodName(group: FoodGroup, food: Food): string {
  return food.maker ? `${group.displayName}（${food.maker}）` : group.displayName
}

export function menuIngredientNames(menu: Menu, menus: Menu[], foods: Food[]): string {
  return getMenuIngredients(menu, foods)
    .map((ingredient) => {
      if (ingredient.kind !== 'food') return menus.find((candidate) => candidate.id === ingredient.itemId)?.name
      const food = foods.find((candidate) => candidate.id === ingredient.itemId)
      return food ? displayFoodName(food) : undefined
    })
    .filter((name): name is string => Boolean(name))
    .join('、')
}
