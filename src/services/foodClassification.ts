import type { Food } from '../types'
import { isValidBarcode } from '../utils/validation'

export type FoodSearchCategory = 'all' | 'general' | 'menu' | 'commercial'

export const MEAL_SEARCH_CATEGORIES: readonly FoodSearchCategory[] = ['all', 'general', 'menu', 'commercial']
export const FOOD_MASTER_SEARCH_CATEGORIES: readonly FoodSearchCategory[] = ['all', 'general', 'commercial']

export function foodSearchCategoryIncludesFoods(category: FoodSearchCategory): boolean {
  return category !== 'menu'
}

export function foodSearchCategoryIncludesMenus(category: FoodSearchCategory): boolean {
  return category === 'all' || category === 'menu'
}

export function isCommercialFood(food: Food): boolean {
  return food.isCommercial === true || isValidBarcode(food.barcode)
}

export function foodMatchesSearchCategory(food: Food, category: FoodSearchCategory): boolean {
  if (!foodSearchCategoryIncludesFoods(category)) return false
  if (category === 'all') return true
  return category === 'commercial' ? isCommercialFood(food) : !isCommercialFood(food)
}
