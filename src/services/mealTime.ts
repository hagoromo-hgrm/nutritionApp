import type { MealType } from '../types'

interface ResolveMealEntryTimeInput {
  mealType: MealType
  proposedEatenAt: string
  existingMealTime?: string
  editingEatenAt?: string
}

/**
 * 非間食は区分の初回時刻を共有し、間食だけは記録ごとの時刻を保つ。
 * 追加入力で既存記録の時刻を書き換えないため、保存対象1件の時刻だけを解決する。
 */
export function resolveMealEntryTime({
  mealType,
  proposedEatenAt,
  existingMealTime,
  editingEatenAt,
}: ResolveMealEntryTimeInput): string {
  if (mealType === '間食') return editingEatenAt ?? proposedEatenAt
  return existingMealTime ?? editingEatenAt ?? proposedEatenAt
}
