import { EMPTY_NUTRIENTS, NUTRIENT_KEYS, type BodyProfile, type Food, type MealEntry, type NutrientKey, type Nutrients, type NutritionGoals, type QuantityUnit } from '../types'
import { isValidQuantityUnit } from '../utils/validation'

export function quantityUnitConversionFor(food: Food, unit: QuantityUnit) {
  return food.inputUnitConversions?.find((conversion) => conversion.unit === unit)
}

/** 明示された換算だけを使い、未登録の単位は基準量へ変換しない。 */
export function resolveAmountInBaseUnits(food: Food, amount: number, amountUnit: QuantityUnit): number | null {
  if (food.baseAmount <= 0 || !Number.isFinite(amount) || amount <= 0 || !isValidQuantityUnit(amountUnit)) return null
  if (food.baseUnit === amountUnit) return amount
  const conversion = quantityUnitConversionFor(food, amountUnit)
  if (!conversion || !Number.isFinite(conversion.baseAmount) || conversion.baseAmount <= 0) return null
  return amount * conversion.baseAmount
}

export function calculateNutrients(food: Food, amount: number, amountUnit: QuantityUnit): Nutrients {
  const baseAmount = resolveAmountInBaseUnits(food, amount, amountUnit)
  if (baseAmount === null) {
    return { ...EMPTY_NUTRIENTS }
  }
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const value = food.nutrients[key]
    return [key, value === null ? null : (value * baseAmount) / food.baseAmount]
  })) as Nutrients
}

export function getFoodQuantityUnits(food: Food): QuantityUnit[] {
  const units = [food.baseUnit, ...(food.inputUnitConversions ?? []).map((conversion) => conversion.unit)]
  return [...new Set(units.filter((unit) => isValidQuantityUnit(unit)))]
}

export function getFoodDefaultServing(food: Food): { amount: number; unit: QuantityUnit } {
  const unit = food.servingUnit ?? food.baseUnit
  if (food.servingAmount !== null && Number.isFinite(food.servingAmount) && food.servingAmount > 0 && getFoodQuantityUnits(food).includes(unit)) {
    return { amount: food.servingAmount, unit }
  }
  return { amount: food.baseAmount, unit: food.baseUnit }
}

/** 基準量を1単位として分量を増やす。gだけでなく個・丁・小さじ等にも使う。 */
export function incrementByBaseAmount(amount: number, baseAmount: number, maximum = 100000): number {
  const current = Number.isFinite(amount) && amount > 0 ? amount : 0
  return Math.min(maximum, current + baseAmount)
}

export function incrementByQuantityUnit(amount: number, food: Food, unit: QuantityUnit, maximum = 100000): number {
  return incrementByBaseAmount(amount, unit === food.baseUnit ? food.baseAmount : 1, maximum)
}

export function sumNutrients(values: Nutrients[]): Nutrients {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    if (values.some((value) => value[key] === null)) return [key, null]
    return [key, values.reduce((sum, value) => sum + (value[key] ?? 0), 0)]
  })) as Nutrients
}

export function sumEntries(entries: MealEntry[]): Nutrients {
  return sumNutrients(entries.map((entry) => entry.calculatedNutrients))
}

/**
 * グラフ描画用に、記録済みの値だけを栄養素ごとに小計する。
 * 欠損値は推定もゼロ補完もせず、その栄養素が全件欠損の場合は未集計のままにする。
 */
export function sumAvailableNutrients(entries: MealEntry[]): Nutrients {
  if (entries.length === 0) {
    return sumEntries(entries)
  }

  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const availableValues = entries
      .map((entry) => entry.calculatedNutrients[key])
      .filter((value): value is number => typeof value === 'number')
    return [key, availableValues.length === 0
      ? null
      : availableValues.reduce((sum, value) => sum + value, 0)]
  })) as Nutrients
}

export function sumByMealType(entries: MealEntry[]): Record<string, Nutrients> {
  return entries.reduce<Record<string, Nutrients>>((result, entry) => {
    result[entry.mealType] = result[entry.mealType]
      ? sumNutrients([result[entry.mealType], entry.calculatedNutrients])
      : { ...entry.calculatedNutrients }
    return result
  }, {})
}

export function formatNutrient(value: number | null, digits = 1): string {
  if (value === null) return '未集計'
  const rounded = Number(value.toFixed(digits))
  return Math.abs(rounded) >= 1000 ? String(Math.round(rounded)) : rounded.toFixed(digits)
}

export function formatGraphNutrient(value: number | null, digits = 1): string {
  return value === null ? '--.-' : formatNutrient(value, digits)
}

export function goalRate(value: number | null, goal: number | null): number | null {
  if (value === null || goal === null || goal <= 0) return null
  return (value / goal) * 100
}

export function nutrientLabel(key: NutrientKey): string {
  return ({
    energyKcal: 'エネルギー', proteinG: 'P', fatG: 'F', carbohydrateG: 'C', fiberG: '食物繊維', saltG: '食塩',
    calciumMg: 'カルシウム', ironMg: '鉄', vitaminAMcg: 'ビタミンA', vitaminEMg: 'ビタミンE',
    vitaminB1Mg: 'ビタミンB1', vitaminB2Mg: 'ビタミンB2', vitaminCMg: 'ビタミンC', saturatedFatG: '飽和脂肪酸',
  })[key]
}

export function estimateDailyEnergyTarget(profile: BodyProfile): number | null {
  if (profile.heightCm === null || profile.weightKg === null || profile.ageYears === null || profile.sex === 'unspecified') return null
  if (!Number.isFinite(profile.heightCm) || !Number.isFinite(profile.weightKg) || !Number.isFinite(profile.ageYears)
    || profile.heightCm <= 0 || profile.weightKg <= 0 || profile.ageYears <= 0) return null
  const sexOffset = profile.sex === 'male' ? 5 : -161
  const basalMetabolicRate = (10 * profile.weightKg) + (6.25 * profile.heightCm) - (5 * profile.ageYears) + sexOffset
  const activityFactor = { low: 1.2, moderate: 1.375, high: 1.55 }[profile.activityLevel]
  return Math.round((basalMetabolicRate * activityFactor) / 10) * 10
}

/**
 * 身体情報から算出する値は、食事記録を振り返るための参考目標として扱う。
 * 食事摂取基準の個別判定ではなく、エネルギーに対する一般的な配分を表示する。
 */
export function estimateDailyGoals(profile: BodyProfile): NutritionGoals | null {
  const energyKcal = estimateDailyEnergyTarget(profile)
  if (energyKcal === null) return null
  const round = (value: number) => Number(value.toFixed(1))
  const ageYears = profile.ageYears ?? 30
  return {
    energyKcal,
    proteinG: round((energyKcal * 0.15) / 4),
    fatG: round((energyKcal * 0.25) / 9),
    carbohydrateG: round((energyKcal * 0.60) / 4),
    fiberG: round((energyKcal / 1000) * 14),
    saltG: profile.sex === 'male' ? 7.5 : 6.5,
    calciumMg: profile.sex === 'male' ? (ageYears >= 75 ? 700 : 750) : (ageYears >= 75 ? 600 : 650),
    ironMg: profile.sex === 'male' ? 7.5 : 10.5,
    vitaminAMcg: profile.sex === 'male' ? 850 : 650,
    vitaminEMg: profile.sex === 'male' ? 6.5 : 5,
    vitaminB1Mg: profile.sex === 'male' ? 1.2 : 0.9,
    vitaminB2Mg: profile.sex === 'male' ? 1.7 : 1.2,
    vitaminCMg: 100,
    saturatedFatG: round((energyKcal * 0.07) / 9),
  }
}

export interface NutrientRange {
  min: number | null
  max: number | null
}

export function nutrientRangeForGoals(goals: NutritionGoals, key: NutrientKey): NutrientRange {
  const goal = goals[key]
  if (goal === null || goal <= 0) return { min: null, max: null }
  if (key === 'energyKcal') return { min: Math.max(0, goal - 200), max: goal + 200 }
  if (key === 'proteinG' && goals.energyKcal !== null) return { min: (goals.energyKcal * 0.10) / 4, max: (goals.energyKcal * 0.20) / 4 }
  if (key === 'fatG' && goals.energyKcal !== null) return { min: (goals.energyKcal * 0.20) / 9, max: (goals.energyKcal * 0.30) / 9 }
  if (key === 'carbohydrateG' && goals.energyKcal !== null) return { min: (goals.energyKcal * 0.55) / 4, max: (goals.energyKcal * 0.65) / 4 }
  if (key === 'saturatedFatG' || key === 'saltG') return { min: null, max: goal }
  return { min: goal, max: null }
}

export function scaleNutritionGoals(goals: NutritionGoals, factor: number): NutritionGoals {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, goals[key] === null ? null : goals[key] * factor])) as unknown as NutritionGoals
}

export function calculateBmi(profile: BodyProfile): number | null {
  if (profile.heightCm === null || profile.weightKg === null || profile.heightCm <= 0 || profile.weightKg <= 0) return null
  return profile.weightKg / ((profile.heightCm / 100) ** 2)
}
