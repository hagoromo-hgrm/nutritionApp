import { FOOD_UNITS, NUTRIENT_KEYS, type FoodUnit, type Nutrients } from '../types'

export function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function isValidBarcode(value: string): boolean {
  return /^\d{8,14}$/.test(value.trim())
}

export function isValidUnit(value: string): value is FoodUnit {
  return FOOD_UNITS.includes(value as FoodUnit)
}

export function isNutrients(value: unknown): value is Nutrients {
  if (!value || typeof value !== 'object') return false
  return NUTRIENT_KEYS.every((key) => {
    const nutrient = (value as Record<string, unknown>)[key]
    return nutrient === null || (typeof nutrient === 'number' && Number.isFinite(nutrient) && nutrient >= 0)
  })
}
