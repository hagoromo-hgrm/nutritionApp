import type { Food, FoodAlias, FoodGroup, FoodRelatedTerm, FoodUsageStat, MealType, SearchScoreBreakdown } from '../types'
import { foodMatchesSearchCategory, type FoodSearchCategory } from './foodClassification'
import { compareSearchCandidates, compareSearchRelevance, compactSearchText, matchParsedSearchText, parseSearchText, type SearchableTextField, type SearchRelevance } from './searchText'

export interface FoodSearchResult {
  group: FoodGroup
  food: Food
  variants: Food[]
  score: number
  matchedBy: string
  recentlyUsed: boolean
  scoreBreakdown: SearchScoreBreakdown
  /** Always populated by searchFoodResults; optional for legacy/manual wrappers. */
  relevance?: SearchRelevance
}

export interface FoodSearchPage {
  results: FoodSearchResult[]
  normalizedQuery: string
  nextCursor: string | null
}

export interface FoodSearchData {
  foods: Food[]
  groups: FoodGroup[]
  aliases: FoodAlias[]
  relatedTerms: FoodRelatedTerm[]
  usageStats: FoodUsageStat[]
  favoriteIds?: Set<string>
}

export interface FoodSearchOptions {
  limit?: number
  cursor?: string | null
  now?: Date
  category?: FoodSearchCategory
  mealType?: MealType
}

const FIELD_PRIORITY = {
  display: 60,
  alias: 50,
  maker: 40,
  reading: 30,
  official: 20,
  related: 10,
} as const

/** 日本語検索向けに幅・大小・かな・区切りをそろえる。バーコードはここへ渡さない。 */
export function normalizeSearchText(value: string): string {
  return compactSearchText(value)
}

export interface FoodPersonalizationScore {
  frequency: number
  recent: number
  mealType: number
  favorite: number
  total: number
  recentlyUsed: boolean
}

function recentScore(stat: FoodUsageStat | undefined, now: Date): { score: number; recentlyUsed: boolean } {
  if (!stat?.lastSelectedAt) return { score: 0, recentlyUsed: false }
  const elapsedDays = Math.max(0, (now.getTime() - new Date(stat.lastSelectedAt).getTime()) / 86_400_000)
  if (!Number.isFinite(elapsedDays)) return { score: 0, recentlyUsed: false }
  return { score: 4 * 2 ** (-elapsedDays / 45), recentlyUsed: elapsedDays <= 30 }
}

/** Secondary ranking signal. Apply only after shared relevance compares equal. */
export function scoreFoodPersonalization(
  stat: FoodUsageStat | undefined,
  favorite: boolean,
  now: Date = new Date(),
  mealType?: MealType,
): FoodPersonalizationScore {
  const count = Math.max(0, stat?.selectionCount ?? 0)
  const distinctDays = Math.max(0, stat?.distinctUsageDays ?? 0)
  const countScore = Math.min(8, Math.log2(count + 1) * 2)
  const dayScore = Math.min(7, Math.log2(distinctDays + 1) * 2)
  const mealTypeScore = mealType
    ? Math.min(4, Math.log2(Math.max(0, stat?.mealTypeCounts?.[mealType] ?? 0) + 1) * 1.5)
    : 0
  const favoriteScore = favorite ? 2 : 0
  const frequency = countScore + dayScore + mealTypeScore + favoriteScore
  const recent = recentScore(stat, now)
  return {
    frequency,
    recent: recent.score,
    mealType: mealTypeScore,
    favorite: favoriteScore,
    total: Math.min(25, frequency + recent.score),
    recentlyUsed: recent.recentlyUsed,
  }
}

function variantLabel(food: Food): string {
  const name = food.displayName ?? food.name
  return name.replace(new RegExp(`^.*?\\u3000?\\[.*?\\]\\u3000?`), '').replace(new RegExp('^.*?\\u3000'), '') || name
}

export function searchFoodResults(query: string, data: FoodSearchData, options: FoodSearchOptions = {}): FoodSearchPage {
  const parsedQuery = parseSearchText(query)
  const normalizedQuery = parsedQuery.compact
  const now = options.now ?? new Date()
  const category = options.category ?? 'all'
  const limit = Math.max(1, Math.floor(options.limit ?? 20))
  const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
  const foodsByGroup = new Map<string, Food[]>()
  const fallbackGroups = new Map<string, FoodGroup>()
  for (const food of data.foods) {
    if (!foodMatchesSearchCategory(food, category)) continue
    const groupId = food.foodGroupId ?? `food:${food.id}`
    const variants = foodsByGroup.get(groupId) ?? []
    variants.push(food)
    foodsByGroup.set(groupId, variants)
    if (!food.foodGroupId) {
      fallbackGroups.set(groupId, { id: groupId, displayName: food.displayName ?? food.name, reading: food.reading ?? null, category: null, representativeScore: 0, defaultVariantId: food.id, isActive: true, metadataSource: 'rule', generationVersion: 'runtime-fallback', needsReview: true, createdAt: food.createdAt, updatedAt: food.updatedAt })
    }
  }
  const groupsById = new Map([...data.groups, ...fallbackGroups.values()].map((group) => [group.id, group] as const))
  const aliasesByGroup = new Map<string, FoodAlias[]>()
  for (const alias of data.aliases) {
    if (!alias.isActive) continue
    const list = aliasesByGroup.get(alias.foodGroupId) ?? []
    list.push(alias)
    aliasesByGroup.set(alias.foodGroupId, list)
  }
  const relatedByGroup = new Map<string, FoodRelatedTerm[]>()
  for (const term of data.relatedTerms) {
    if (!term.isActive) continue
    const list = relatedByGroup.get(term.foodGroupId) ?? []
    list.push(term)
    relatedByGroup.set(term.foodGroupId, list)
  }
  const usageByFood = new Map(data.usageStats.map((stat) => [stat.foodId, stat]))
  const results: FoodSearchResult[] = []
  for (const [groupId, variants] of foodsByGroup) {
    const group = groupsById.get(groupId)
    if (!group || !group.isActive) continue
    const aliases = aliasesByGroup.get(groupId) ?? []
    const related = (relatedByGroup.get(groupId) ?? []).map((term) => ({ term: term.term, weight: term.weight }))
    const rankedVariants = variants.map((food) => {
      const applicableAliases = aliases.filter((alias) => alias.foodVariantId === null || alias.foodVariantId === food.id)
      const fields: SearchableTextField[] = [
        { value: normalizeSearchText(group.displayName), name: 'display', priority: FIELD_PRIORITY.display, variantSpecific: false },
        ...applicableAliases.map((alias) => ({ value: normalizeSearchText(alias.alias), name: 'alias', priority: FIELD_PRIORITY.alias + Math.max(0, Math.min(9, Math.round(alias.priority / 20))), variantSpecific: alias.foodVariantId !== null })),
        { value: normalizeSearchText(food.maker), name: 'maker', priority: FIELD_PRIORITY.maker, variantSpecific: true },
        { value: group.reading ? normalizeSearchText(group.reading) : '', name: 'reading', priority: FIELD_PRIORITY.reading, variantSpecific: false },
        { value: normalizeSearchText(food.officialName ?? food.name), name: 'official', priority: FIELD_PRIORITY.official, variantSpecific: true },
        ...related.map((item) => ({ value: normalizeSearchText(item.term), name: 'related', priority: FIELD_PRIORITY.related, variantSpecific: false, relatedWeight: item.weight })),
      ]
      const match = matchParsedSearchText(parsedQuery, fields)
      const favorite = data.favoriteIds?.has(food.id) ?? false
      const personalization = scoreFoodPersonalization(usageByFood.get(food.id), favorite, now, options.mealType)
      const personal = personalization.frequency
      const recent = { score: personalization.recent, recentlyUsed: personalization.recentlyUsed }
      return { food, match, personal, recent }
    }).sort((left, right) => compareSearchRelevance(left.match.relevance, right.match.relevance)
      || (right.personal + right.recent.score) - (left.personal + left.recent.score)
      || left.food.id.localeCompare(right.food.id))
    const best = rankedVariants[0]
    if (!best) continue
    if (normalizedQuery && best.match.score < 0) continue
    const breakdown: SearchScoreBreakdown = {
      text: Math.max(0, best.match.score), representative: group.representativeScore, personalFrequency: best.personal, recent: best.recent.score,
      total: Math.max(0, best.match.score) + group.representativeScore + best.personal + best.recent.score,
    }
    const selectedFood = best.match.variantSpecific
      ? best.food
      : variants.find((food) => food.id === group.defaultVariantId) ?? best.food
    results.push({ group, food: selectedFood, variants: [...variants].sort((left, right) => variantLabel(left).localeCompare(variantLabel(right), 'ja') || left.id.localeCompare(right.id)), score: breakdown.total, matchedBy: best.match.matchedBy, recentlyUsed: best.recent.recentlyUsed, scoreBreakdown: breakdown, relevance: best.match.relevance })
  }
  results.sort((left, right) => compareSearchCandidates(left, right)
    || (right.scoreBreakdown.personalFrequency + right.scoreBreakdown.recent)
      - (left.scoreBreakdown.personalFrequency + left.scoreBreakdown.recent)
    || right.group.representativeScore - left.group.representativeScore
    || left.group.displayName.localeCompare(right.group.displayName, 'ja')
    || left.food.id.localeCompare(right.food.id))
  const page = results.slice(offset, offset + limit)
  const nextOffset = offset + limit < results.length ? String(offset + limit) : null
  return { results: page, normalizedQuery, nextCursor: nextOffset }
}
