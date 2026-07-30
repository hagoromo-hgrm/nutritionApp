import { MEAL_TYPES, type MealEntry, type MealType, type Nutrients } from '../types'
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
  subtotals: ReturnType<typeof sumByMealType>
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

export function buildTodayDetailSummary(entries: MealEntry[]): TodayDetailSummary {
  return {
    nutrients: sumEntries(entries),
    availableNutrients: sumAvailableNutrients(entries),
    subtotals: sumByMealType(entries),
    availableSubtotals: Object.fromEntries(
      MEAL_TYPES.map((mealType) => [
        mealType,
        sumAvailableNutrients(entries.filter((entry) => entry.mealType === mealType)),
      ]),
    ) as Record<MealType, Nutrients>,
  }
}
