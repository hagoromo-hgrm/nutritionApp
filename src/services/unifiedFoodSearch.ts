import type { Food, FoodGroup, FoodUsageStat, MealType, SearchScoreBreakdown } from '../types'
import type { FoodSearchCategory } from './foodClassification'
import {
  scoreFoodPersonalization,
  searchFoodResults,
  type FoodSearchData,
  type FoodSearchResult,
} from './foodSearch'
import { getFoodGroup as getMextFoodGroup, getSourceId } from './mextFoodData'
import { searchUserFoodGroups, type UserFoodSearchResult } from './mextUserFoodData'
import { compareSearchCandidates } from './searchText'

export interface UnifiedFoodSearchResult extends FoodSearchResult {
  candidateKey: string
  userFoodResult?: UserFoodSearchResult
}

export interface UnifiedFoodSearchOptions {
  category?: FoodSearchCategory
  mealType?: MealType
  now?: Date
}

function stableSelectionKey(selection: Readonly<Record<string, string>>): string {
  return Object.entries(selection)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
}

function buildStoredGroup(foodGroupId: string, variants: Food[], groups: FoodGroup[]): FoodGroup | null {
  const stored = groups.find((group) => group.id === foodGroupId)
  if (stored) return stored
  const representative = variants[0]
  if (!representative) return null
  try {
    const mext = getMextFoodGroup(foodGroupId)
    return {
      id: foodGroupId,
      displayName: mext.displayName,
      reading: null,
      category: null,
      representativeScore: 0,
      defaultVariantId: mext.defaultSourceId,
      isActive: true,
      metadataSource: 'rule',
      generationVersion: 'mext-user-layer-v1',
      needsReview: false,
      createdAt: representative.createdAt,
      updatedAt: representative.updatedAt,
    }
  } catch {
    return null
  }
}

function resolveUserPreviewFood(result: UserFoodSearchResult, variants: Food[], group: FoodGroup): Food {
  if (result.foodGroupId && result.attributeSelection) {
    try {
      const sourceId = getSourceId(result.foodGroupId, result.attributeSelection)
      const matched = variants.find((food) => food.id === sourceId)
      if (matched) return matched
    } catch {
      // Search hints are intentionally best-effort; the picker performs final constraint validation.
    }
  }
  return variants.find((food) => food.id === group.defaultVariantId) ?? variants[0]
}

function userCandidate(
  result: UserFoodSearchResult,
  data: FoodSearchData,
  usageByFood: ReadonlyMap<string, FoodUsageStat>,
  options: UnifiedFoodSearchOptions,
): UnifiedFoodSearchResult | null {
  const coveredFoodGroupIds = result.foodGroupId ? [result.foodGroupId] : result.group.memberFoodGroupIds
  const allCoveredFoods = data.foods.filter((food) => food.foodGroupId && coveredFoodGroupIds.includes(food.foodGroupId))
  const previewFoodGroupId = result.foodGroupId
    ?? result.group.defaultFoodGroupId
    ?? allCoveredFoods[0]?.foodGroupId
  if (!previewFoodGroupId) return null
  const variants = data.foods.filter((food) => food.foodGroupId === previewFoodGroupId)
  const group = buildStoredGroup(previewFoodGroupId, variants, data.groups)
  if (!group || variants.length === 0) return null

  const now = options.now ?? new Date()
  const rankedPersonalization = allCoveredFoods.map((food) => ({
    food,
    score: scoreFoodPersonalization(
      usageByFood.get(food.id),
      data.favoriteIds?.has(food.id) ?? false,
      now,
      options.mealType,
    ),
  })).sort((left, right) => right.score.total - left.score.total || left.food.id.localeCompare(right.food.id))
  const personal = rankedPersonalization[0]?.score
    ?? scoreFoodPersonalization(undefined, false, now, options.mealType)
  const preview = resolveUserPreviewFood(result, variants, group)
  const breakdown: SearchScoreBreakdown = {
    text: result.score,
    representative: group.representativeScore,
    personalFrequency: personal.frequency,
    recent: personal.recent,
    total: result.score + group.representativeScore + personal.total,
  }
  return {
    candidateKey: `user:${result.group.id}:${result.foodGroupId ?? stableSelectionKey(result.presetSelection)}`,
    group,
    food: preview,
    variants,
    score: breakdown.total,
    matchedBy: 'user-food-group',
    recentlyUsed: personal.recentlyUsed,
    scoreBreakdown: breakdown,
    relevance: result.relevance,
    userFoodResult: result,
  }
}

/** Build one stable, ranked candidate list before any UI pagination is applied. */
export function searchUnifiedFoodResults(
  query: string,
  data: FoodSearchData,
  options: UnifiedFoodSearchOptions = {},
): UnifiedFoodSearchResult[] {
  const category = options.category ?? 'all'
  const regular = searchFoodResults(query, data, {
    category,
    mealType: options.mealType,
    now: options.now,
    limit: Math.max(1, data.groups.length + data.foods.length),
  }).results
  const usageByFood = new Map(data.usageStats.map((stat) => [stat.foodId, stat]))
  const userResults = query.trim() && (category === 'all' || category === 'general')
    ? searchUserFoodGroups(query, { expandPartShortcuts: true })
    : []
  const userCandidates = userResults.flatMap((result) => {
    const candidate = userCandidate(result, data, usageByFood, options)
    return candidate ? [candidate] : []
  })
  const coveredFoodGroupIds = new Set(userCandidates.flatMap((candidate) => {
    const result = candidate.userFoodResult
    if (!result) return []
    return result.foodGroupId ? [result.foodGroupId] : result.group.memberFoodGroupIds
  }))
  const regularCandidates: UnifiedFoodSearchResult[] = regular
    .filter((result) => !coveredFoodGroupIds.has(result.group.id))
    .map((result) => ({ ...result, candidateKey: `food:${result.group.id}` }))

  return [...userCandidates, ...regularCandidates].sort((left, right) => compareSearchCandidates(left, right)
    || (right.scoreBreakdown.personalFrequency + right.scoreBreakdown.recent)
      - (left.scoreBreakdown.personalFrequency + left.scoreBreakdown.recent)
    || right.group.representativeScore - left.group.representativeScore
    || left.group.displayName.localeCompare(right.group.displayName, 'ja')
    || left.candidateKey.localeCompare(right.candidateKey))
}
