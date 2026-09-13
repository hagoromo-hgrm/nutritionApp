import { NUTRIENT_KEYS, type NutritionGoalRecord, type NutritionGoals } from '../types'
import { addDays } from '../utils/date'
import { isValidIsoDateTime, isValidTokyoDateKey } from './weightHistory'

export function isValidNutritionGoals(value: unknown): value is NutritionGoals {
  if (typeof value !== 'object' || value === null) return false
  const goals = value as Record<string, unknown>
  return NUTRIENT_KEYS.every((key) => goals[key] === null
    || (typeof goals[key] === 'number' && Number.isFinite(goals[key]) && Number(goals[key]) >= 0))
}

export function isValidNutritionGoalRecord(value: unknown): value is NutritionGoalRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<NutritionGoalRecord>
  return isValidTokyoDateKey(record.effectiveFrom)
    && isValidIsoDateTime(record.recordedAt)
    && isValidNutritionGoals(record.goals)
}

export function nutritionGoalsEqual(left: NutritionGoals, right: NutritionGoals): boolean {
  return NUTRIENT_KEYS.every((key) => left[key] === right[key])
}

/** 履歴導入前の日付には最古のスナップショットを適用し、移行後の変更から保護する。 */
export function resolveNutritionGoals(records: NutritionGoalRecord[], date: string, fallback: NutritionGoals): NutritionGoals {
  if (records.length === 0) return fallback
  const ordered = [...records].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.recordedAt.localeCompare(right.recordedAt))
  let resolved = ordered[0].goals
  for (const record of ordered) {
    if (record.effectiveFrom > date) break
    resolved = record.goals
  }
  return resolved
}

export function averageNutritionGoalsForPeriod(records: NutritionGoalRecord[], from: string, to: string, fallback: NutritionGoals): NutritionGoals {
  const values: NutritionGoals[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) values.push(resolveNutritionGoals(records, date, fallback))
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const daily = values.map((goals) => goals[key])
    return [key, daily.some((value) => value === null) ? null : daily.reduce<number>((sum, value) => sum + Number(value), 0) / daily.length]
  })) as unknown as NutritionGoals
}
