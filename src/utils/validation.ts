import { FOOD_UNITS, NUTRIENT_KEYS, type FoodUnit, type FoodUnitConversion, type Nutrients, type QuantityUnit } from '../types'

export const MAX_QUANTITY_UNIT_LENGTH = 30

export function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function isValidBarcode(value: string): boolean {
  return /^\d{8,14}$/.test(value.trim())
}

export function isValidUnit(value: string): value is FoodUnit {
  return FOOD_UNITS.includes(value as FoodUnit)
}

/** 入力単位は固定候補に限定しないが、保存可能なラベルとしての最低限の制約を設ける。 */
export function isValidQuantityUnit(value: string): value is QuantityUnit {
  const trimmed = value.trim()
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  return trimmed.length > 0 && trimmed.length <= MAX_QUANTITY_UNIT_LENGTH && !hasControlCharacter
}

export function isFoodUnitConversion(value: unknown): value is FoodUnitConversion {
  if (!value || typeof value !== 'object') return false
  const conversion = value as Record<string, unknown>
  return typeof conversion.unit === 'string' && isValidQuantityUnit(conversion.unit)
    && typeof conversion.baseAmount === 'number' && Number.isFinite(conversion.baseAmount) && conversion.baseAmount > 0 && conversion.baseAmount <= 100000
}

export function isNutrients(value: unknown): value is Nutrients {
  if (!value || typeof value !== 'object') return false
  return NUTRIENT_KEYS.every((key) => {
    const nutrient = (value as Record<string, unknown>)[key]
    return nutrient === null || (typeof nutrient === 'number' && Number.isFinite(nutrient) && nutrient >= 0)
  })
}
