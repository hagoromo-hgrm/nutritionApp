import type { FoodSearchResult } from '../services/foodSearch'
import { getFoodGroup as getMextFoodGroup } from '../services/mextFoodData'
import type { UserFoodSearchResult } from '../services/mextUserFoodData'
import type { Food, FoodGroup, QuantityUnit } from '../types'

export type SearchPurpose = 'meal' | 'food-master'

export interface SearchResultItem {
  id: string
  kind: 'user-food' | 'food' | 'menu' | 'general-menu' | 'set'
  title: string
  subtitle: string
  food: Food
  group: FoodGroup | null
  variants: Food[]
  score: number | null
  matchedBy: string | null
  recentlyUsed: boolean
  searchLogId: string | null
  searchRank: number | null
  userFoodResult?: UserFoodSearchResult
}

export interface SearchResultGroup {
  query: string
  items: SearchResultItem[]
  searchLogId: string | null
  nextCursor: string | null
}

export function getSearchResultUserFacingName(item: SearchResultItem): string {
  if (item.kind === 'food' && item.group) return item.group.displayName
  return item.title
}

export function buildMextFoodSearchResult(
  foodGroupId: string,
  foods: Food[],
  foodGroups: FoodGroup[],
  score = 0,
): FoodSearchResult | null {
  const variants = foods.filter((food) => food.foodGroupId === foodGroupId)
  if (variants.length === 0) return null
  const confirmedGroup = getMextFoodGroup(foodGroupId)
  const storedGroup = foodGroups.find((group) => group.id === foodGroupId)
  const representative = variants.find((food) => food.id === confirmedGroup.defaultSourceId)
    ?? variants.find((food) => food.id === storedGroup?.defaultVariantId)
    ?? variants[0]
  const group = storedGroup ?? {
    id: foodGroupId,
    displayName: confirmedGroup.displayName,
    reading: null,
    category: null,
    representativeScore: 0,
    defaultVariantId: confirmedGroup.defaultSourceId,
    isActive: true,
    metadataSource: 'rule' as const,
    generationVersion: 'mext-user-layer-v1',
    needsReview: false,
    createdAt: representative.createdAt,
    updatedAt: representative.updatedAt,
  }
  return {
    group,
    food: representative,
    variants,
    score,
    matchedBy: 'user-food-group',
    recentlyUsed: false,
    scoreBreakdown: { text: score, representative: 0, personalFrequency: 0, recent: 0, total: score },
  }
}

export function selectedUserFoodLabel(result: UserFoodSearchResult): string | null {
  if (result.targetType === 'user_food_variant' && result.foodGroupId) {
    try {
      return getMextFoodGroup(result.foodGroupId).displayName
    } catch {
      // Keep the selection-value fallback for data not available in the bundled MEXT master.
    }
  }
  for (const dimension of result.group.selectionDimensions) {
    const valueId = result.presetSelection[dimension.id]
    const value = dimension.values.find((item) => item.id === valueId)
    if (value) return value.displayName
  }
  return null
}

export function selectedUserFoodDimensionLabel(result: UserFoodSearchResult): string | null {
  for (const dimension of result.group.selectionDimensions) {
    if (dimension.values.some((value) => value.id === result.presetSelection[dimension.id])) return dimension.displayName
  }
  return null
}

export interface FoodVariantPickerState {
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
  initialFoodId?: string
  initialAmount?: string
  initialAmountUnit?: QuantityUnit
}
