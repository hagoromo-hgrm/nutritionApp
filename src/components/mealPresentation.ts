import { type MealType } from '../types'

export type TrendRangeId = 'week' | 'month' | 'threeMonths' | 'year'

const ASSET_BASE_URL = import.meta.env.BASE_URL
export const MEAL_ICON_ASSETS: Record<MealType, string> = {
  朝食: `${ASSET_BASE_URL}assets/meal-icon-breakfast.png`,
  昼食: `${ASSET_BASE_URL}assets/meal-icon-lunch.png`,
  夕食: `${ASSET_BASE_URL}assets/meal-icon-dinner.png`,
  間食: `${ASSET_BASE_URL}assets/meal-icon-snack.png`,
}
export const SETTINGS_ICON_ASSET = `${ASSET_BASE_URL}assets/settings-icon.png`

export function mealTone(type: MealType): string {
  return ({ 朝食: 'breakfast', 昼食: 'lunch', 夕食: 'dinner', 間食: 'snack' })[type]
}
