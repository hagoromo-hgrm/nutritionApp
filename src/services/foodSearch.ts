import type { Food, FoodAlias, FoodGroup, FoodRelatedTerm, FoodUsageStat, SearchScoreBreakdown } from '../types'

export interface FoodSearchResult {
  group: FoodGroup
  food: Food
  variants: Food[]
  score: number
  matchedBy: string
  recentlyUsed: boolean
  scoreBreakdown: SearchScoreBreakdown
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
}

const EXACT_DISPLAY = 100
const EXACT_ALIAS = 95
const PREFIX_DISPLAY = 80
const PREFIX_ALIAS = 75
const EXACT_READING = 70
const PARTIAL_DISPLAY = 60
const PARTIAL_ALIAS = 55
const PARTIAL_READING = 50
const PARTIAL_OFFICIAL = 40
const RELATED = 25

/** 日本語検索向けに幅・大小・かな・区切りをそろえる。バーコードはここへ渡さない。 */
export function normalizeSearchText(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const hiragana = [...normalized].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 0x30a1 && codePoint <= 0x30f6 ? String.fromCodePoint(codePoint - 0x60) : character
  }).join('')
  return hiragana.replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}_]+/gu, '')
}

function textScore(query: string, displayName: string, aliases: string[], reading: string | null, officialName: string, related: Array<{ term: string; weight: number }>): { score: number; matchedBy: string } {
  if (!query) return { score: 0, matchedBy: 'empty' }
  const display = normalizeSearchText(displayName)
  const normalizedAliases = aliases.map(normalizeSearchText).filter(Boolean)
  const normalizedReading = reading ? normalizeSearchText(reading) : ''
  const official = normalizeSearchText(officialName)
  if (display === query) return { score: EXACT_DISPLAY, matchedBy: 'display-exact' }
  if (normalizedAliases.includes(query)) return { score: EXACT_ALIAS, matchedBy: 'alias-exact' }
  if (display.startsWith(query)) return { score: PREFIX_DISPLAY, matchedBy: 'display-prefix' }
  if (normalizedAliases.some((alias) => alias.startsWith(query))) return { score: PREFIX_ALIAS, matchedBy: 'alias-prefix' }
  if (normalizedReading === query) return { score: EXACT_READING, matchedBy: 'reading-exact' }
  if (display.includes(query)) return { score: PARTIAL_DISPLAY, matchedBy: 'display-partial' }
  if (normalizedAliases.some((alias) => alias.includes(query))) return { score: PARTIAL_ALIAS, matchedBy: 'alias-partial' }
  if (normalizedReading.includes(query)) return { score: PARTIAL_READING, matchedBy: 'reading-partial' }
  if (official.includes(query)) return { score: PARTIAL_OFFICIAL, matchedBy: 'official-partial' }
  const matchingRelated = related.filter((item) => normalizeSearchText(item.term).includes(query))
  if (matchingRelated.length > 0) return { score: RELATED * Math.max(...matchingRelated.map((item) => item.weight)), matchedBy: 'related' }
  return { score: -1, matchedBy: 'none' }
}

function personalScore(stat: FoodUsageStat | undefined, favorite: boolean): number {
  if (!stat && !favorite) return 0
  const countScore = stat ? Math.min(25, Math.log2(stat.selectionCount + 1) * 7) : 0
  return Math.min(25, countScore + (favorite ? 5 : 0))
}

function recentScore(stat: FoodUsageStat | undefined, now: Date): { score: number; recentlyUsed: boolean } {
  if (!stat?.lastSelectedAt) return { score: 0, recentlyUsed: false }
  const elapsedDays = Math.max(0, (now.getTime() - new Date(stat.lastSelectedAt).getTime()) / 86_400_000)
  if (!Number.isFinite(elapsedDays) || elapsedDays > 90) return { score: 0, recentlyUsed: false }
  return { score: Math.max(0, 15 * (1 - elapsedDays / 90)), recentlyUsed: elapsedDays <= 30 }
}

function variantLabel(food: Food): string {
  const name = food.displayName ?? food.name
  return name.replace(new RegExp(`^.*?\\u3000?\\[.*?\\]\\u3000?`), '').replace(new RegExp('^.*?\\u3000'), '') || name
}

export function searchFoodResults(query: string, data: FoodSearchData, options: FoodSearchOptions = {}): FoodSearchPage {
  const normalizedQuery = normalizeSearchText(query)
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(100, options.limit ?? 20))
  const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
  const foodsByGroup = new Map<string, Food[]>()
  const fallbackGroups = new Map<string, FoodGroup>()
  for (const food of data.foods) {
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
      const match = textScore(normalizedQuery, group.displayName, aliases.map((alias) => alias.alias), group.reading, food.officialName ?? food.name, related)
      const favorite = data.favoriteIds?.has(food.id) ?? false
      const personal = personalScore(usageByFood.get(food.id), favorite)
      const recent = recentScore(usageByFood.get(food.id), now)
      return { food, match, personal, recent }
    }).sort((left, right) => right.match.score - left.match.score || right.personal - left.personal || right.recent.score - left.recent.score || left.food.id.localeCompare(right.food.id))
    const best = rankedVariants[0]
    if (!best) continue
    if (normalizedQuery && best.match.score < 0) continue
    const breakdown: SearchScoreBreakdown = {
      text: Math.max(0, best.match.score), representative: group.representativeScore, personalFrequency: best.personal, recent: best.recent.score,
      total: Math.max(0, best.match.score) + group.representativeScore + best.personal + best.recent.score,
    }
    const selectedFood = variants.find((food) => food.id === group.defaultVariantId) ?? best.food
    results.push({ group, food: selectedFood, variants: [...variants].sort((left, right) => variantLabel(left).localeCompare(variantLabel(right), 'ja') || left.id.localeCompare(right.id)), score: breakdown.total, matchedBy: best.match.matchedBy, recentlyUsed: best.recent.recentlyUsed, scoreBreakdown: breakdown })
  }
  results.sort((left, right) => right.score - left.score || right.group.representativeScore - left.group.representativeScore || left.group.displayName.localeCompare(right.group.displayName, 'ja') || left.food.id.localeCompare(right.food.id))
  const page = results.slice(offset, offset + limit)
  const nextOffset = offset + limit < results.length ? String(offset + limit) : null
  return { results: page, normalizedQuery, nextCursor: nextOffset }
}
