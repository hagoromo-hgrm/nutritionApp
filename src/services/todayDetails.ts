import { MEAL_TYPES, NUTRIENT_KEYS, type MealEntry, type MealType, type Nutrients } from '../types'
import { addDays } from '../utils/date'
import { sumAvailableNutrients, sumByMealType, sumEntries } from './nutrition'

export const TODAY_DETAIL_RANGE_OPTIONS = [
  { id: 'day', label: '1日', days: 1 },
  { id: 'week', label: '1週間', days: 7 },
  { id: 'month', label: '1ヶ月', days: 30 },
] as const

export type TodayDetailRangeId = (typeof TODAY_DETAIL_RANGE_OPTIONS)[number]['id']

export interface TodayDetailPeriod {
  rangeId: TodayDetailRangeId
  from: string
  to: string
  days: number
}

export interface TodayDetailSummary {
  nutrients: Nutrients
  availableNutrients: Nutrients
  subtotals: Record<MealType, Nutrients>
  availableSubtotals: Record<MealType, Nutrients>
}

export function resolveTodayDetailPeriod(rangeId: TodayDetailRangeId, selectedDate: string): TodayDetailPeriod {
  const range = TODAY_DETAIL_RANGE_OPTIONS.find((option) => option.id === rangeId)
  if (!range) {
    throw new Error(`Unknown today detail range: ${rangeId}`)
  }

  return {
    rangeId,
    from: addDays(selectedDate, -(range.days - 1)),
    to: selectedDate,
    days: range.days,
  }
}

function averageNutrients(nutrients: Nutrients, days: number): Nutrients {
  const divisor = Number.isFinite(days) && days > 0 ? days : 1
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, nutrients[key] === null ? null : nutrients[key] / divisor]),
  ) as Nutrients
}

export function buildTodayDetailSummary(entries: MealEntry[], days = 1): TodayDetailSummary {
  const subtotals = sumByMealType(entries)
  return {
    nutrients: averageNutrients(sumEntries(entries), days),
    availableNutrients: averageNutrients(sumAvailableNutrients(entries), days),
    subtotals: Object.fromEntries(
      MEAL_TYPES.map((mealType) => [
        mealType,
        averageNutrients(subtotals[mealType] ?? sumEntries([]), days),
      ]),
    ) as Record<MealType, Nutrients>,
    availableSubtotals: Object.fromEntries(
      MEAL_TYPES.map((mealType) => [
        mealType,
        averageNutrients(
          sumAvailableNutrients(entries.filter((entry) => entry.mealType === mealType)),
          days,
        ),
      ]),
    ) as Record<MealType, Nutrients>,
  }
}
