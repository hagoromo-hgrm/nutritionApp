import type { Food, FoodSnapshot, MealEntry } from '../types'

/** 食事履歴では検索時の一般名を優先し、正式名称は属性確認画面に限定する。 */
export function getFoodSnapshotDisplayName(snapshot: Pick<FoodSnapshot, 'displayName' | 'name'>): string {
  return snapshot.displayName?.trim() || snapshot.name
}

export function getMealEntryDisplayName(
  entry: Pick<MealEntry, 'foodSnapshot'>,
  currentFood?: Pick<Food, 'displayName' | 'name'>,
): string {
  if (currentFood) return currentFood.displayName?.trim() || currentFood.name
  return getFoodSnapshotDisplayName(entry.foodSnapshot)
}
