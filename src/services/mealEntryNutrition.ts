import { type MealEntry, type Nutrients } from '../types'
import { sumKnownNutrients, sumNutrients } from './nutrition'
import { calculateMealMenuEntryAvailableNutrients } from './mealMenuSnapshots'

/** 記録時のメニュースナップショットがある場合は、それだけから既知栄養値を計算する。 */
export function getMealEntryAvailableNutrients(entry: MealEntry): Nutrients {
  return entry.menuSnapshot
    ? calculateMealMenuEntryAvailableNutrients(entry.menuSnapshot, entry.amount, entry.amountUnit)
    : entry.calculatedNutrients
}

/** グラフ用に既知値だけを栄養素ごとに合計する。空の記録は従来どおり0を返す。 */
export function sumAvailableNutrients(entries: MealEntry[]): Nutrients {
  if (entries.length === 0) return sumNutrients([])
  return sumKnownNutrients(entries.map(getMealEntryAvailableNutrients))
}
