import type { FoodSnapshot, MealEntry } from '../types'
import { getFoodGroup as getMextFoodGroup, getFoodVariantBySourceId } from './mextFoodData'
import { getUserFoodGroup, getUserFoodGroupForFoodGroup } from './mextUserFoodData'

/** 食事履歴では検索時の一般名を優先し、正式名称は属性確認画面に限定する。 */
export function getFoodSnapshotDisplayName(
  snapshot: Pick<FoodSnapshot, 'userFacingName' | 'displayName' | 'name'>,
): string {
  return snapshot.userFacingName?.trim() || snapshot.displayName?.trim() || snapshot.name
}

/**
 * 検索結果名を保存する前のMEXT記録を補正する。
 * 部位と卵種は検索結果で独立表示しているため、上位分類へ潰さない。
 */
export function getMextUserFacingFoodName(foodId: string): string | null {
  const variant = getFoodVariantBySourceId(foodId)
  if (!variant) return null
  const mapping = getUserFoodGroupForFoodGroup(variant.foodGroupId)
  if (!mapping) return null
  try {
    const group = getUserFoodGroup(mapping.userFoodGroupId)
    const isExpandedSearchResult = group.selectionDimensions.some((dimension) => (
      dimension.displayName === '部位' || dimension.id === 'egg_type'
    ))
    return isExpandedSearchResult ? getMextFoodGroup(variant.foodGroupId).displayName : group.displayName
  } catch {
    return null
  }
}

export function getMealEntryDisplayName(entry: Pick<MealEntry, 'foodId' | 'foodSnapshot'>): string {
  const storedUserFacingName = entry.foodSnapshot.userFacingName?.trim()
  if (storedUserFacingName) return storedUserFacingName
  const mextUserFacingName = getMextUserFacingFoodName(entry.foodId)
  if (mextUserFacingName) return mextUserFacingName
  return getFoodSnapshotDisplayName(entry.foodSnapshot)
}
