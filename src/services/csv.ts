import type { MealEntry } from '../types'
import { formatDateKey } from '../utils/date'

export const CSV_HEADERS = [
  'id', 'date', 'eaten_at', 'meal_type', 'food_id', 'food_name', 'maker', 'barcode', 'amount', 'amount_unit',
  'base_amount', 'base_unit', 'energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'fiber_g', 'salt_g',
  'calcium_mg', 'iron_mg', 'vitamin_a_mcg', 'vitamin_e_mg', 'vitamin_b1_mg', 'vitamin_b2_mg', 'vitamin_c_mg', 'saturated_fat_g',
] as const

function escapeCsv(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function mealsToCsv(entries: MealEntry[]): string {
  const rows = entries.map((entry) => [
    entry.id, formatDateKey(entry.eatenAt), entry.eatenAt, entry.mealType, entry.foodId,
    entry.foodSnapshot.name, entry.foodSnapshot.maker, entry.foodSnapshot.barcode, entry.amount, entry.amountUnit,
    entry.foodSnapshot.baseAmount, entry.foodSnapshot.baseUnit, entry.calculatedNutrients.energyKcal,
    entry.calculatedNutrients.proteinG, entry.calculatedNutrients.fatG, entry.calculatedNutrients.carbohydrateG,
    entry.calculatedNutrients.fiberG, entry.calculatedNutrients.saltG, entry.calculatedNutrients.calciumMg,
    entry.calculatedNutrients.ironMg, entry.calculatedNutrients.vitaminAMcg, entry.calculatedNutrients.vitaminEMg,
    entry.calculatedNutrients.vitaminB1Mg, entry.calculatedNutrients.vitaminB2Mg, entry.calculatedNutrients.vitaminCMg,
    entry.calculatedNutrients.saturatedFatG,
  ])
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`
}
