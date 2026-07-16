import { sumEntries } from './nutrition'
import type { MealEntry, Nutrients } from '../types'
import { addDays, formatDateKey } from '../utils/date'

export interface DailyNutrientTrendPoint {
  date: string
  nutrients: Nutrients
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
    points.push({ date, nutrients: sumEntries(entriesByDate.get(date) ?? []) })
    date = addDays(date, 1)
  }
  return points
}
