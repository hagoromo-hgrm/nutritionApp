import type { Food } from '../types'
import { isValidBarcode } from '../utils/validation'

export type FoodSearchCategory = 'all' | 'general' | 'commercial'

export function isCommercialFood(food: Food): boolean {
  return food.isCommercial === true || isValidBarcode(food.barcode)
}

export function foodMatchesSearchCategory(food: Food, category: FoodSearchCategory): boolean {
  if (category === 'all') return true
  return category === 'commercial' ? isCommercialFood(food) : !isCommercialFood(food)
}
