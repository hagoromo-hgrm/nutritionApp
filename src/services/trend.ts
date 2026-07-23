import { sumAvailableNutrients, sumEntries } from './nutrition'
import { MEAL_TYPES, type MealEntry, type MealType, type Nutrients } from '../types'
import { addDays, formatDateKey } from '../utils/date'

export interface DailyNutrientTrendPoint {
  date: string
  nutrients: Nutrients
  availableNutrients: Nutrients
  availableNutrientsByMealType: Record<MealType, Nutrients>
}

export function buildDailyNutrientTrend(entries: MealEntry[], from: string, to: string, maxDays = 31): DailyNutrientTrendPoint[] {
  if (!from || !to || from > to || maxDays < 1) return []

  const entriesByDate = new Map<string, MealEntry[]>()
  for (const entry of entries) {
    const date = formatDateKey(entry.eatenAt)
    const dateEntries = entriesByDate.get(date) ?? []
    dateEntries.push(entry)
    entriesByDate.set(date, dateEntries)
  }

  const points: DailyNutrientTrendPoint[] = []
  let date = from
  while (date <= to && points.length < maxDays) {
    const dateEntries = entriesByDate.get(date) ?? []
    const availableNutrientsByMealType = Object.fromEntries(
      MEAL_TYPES.map((mealType) => [
        mealType,
        sumAvailableNutrients(dateEntries.filter((entry) => entry.mealType === mealType)),
      ]),
    ) as Record<MealType, Nutrients>
    points.push({
      date,
      nutrients: sumEntries(dateEntries),
      availableNutrients: sumAvailableNutrients(dateEntries),
      availableNutrientsByMealType,
    })
    date = addDays(date, 1)
  }
  return points
}
