import type { Table } from 'dexie'
import type { Food, FoodGroup } from '../types'
import type { NutritionDatabase } from './db'
import { foodMatchesSearchCategory, type FoodSearchCategory } from '../services/foodClassification'
import {
  compareFoodSearchOrder, compareFoodSearchVariants, createFoodSearchGroupAccumulator,
  fallbackFoodSearchGroup, foodSearchOrderKey, normalizeSearchText,
  type FoodSearchCandidate, type FoodSearchOptions, type FoodSearchOrderKey, type FoodSearchPage,
} from '../services/foodSearch'

const BATCH_SIZE = 128

async function* primaryKeyBatches<T extends { id: string }>(table: Table<T, string>): AsyncGenerator<T[]> {
  let lastId: string | undefined
  while (true) {
    const batch = await (lastId === undefined ? table.orderBy('id') : table.where('id').above(lastId)).limit(BATCH_SIZE).toArray()
    if (batch.length === 0) return
    yield batch
    lastId = batch[batch.length - 1].id
  }
}

async function* groupFoodBatches(db: NutritionDatabase, groupId: string): AsyncGenerator<Food[]> {
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const batch = await db.foods.where('foodGroupId').equals(groupId).offset(offset).limit(BATCH_SIZE).toArray()
    if (batch.length === 0) return
    yield batch
  }
}

interface SearchCursor {
  version: 1
  query: string
  category: FoodSearchCategory
  now: string
  after: FoodSearchOrderKey
}

function readCursor(value: string | null | undefined, query: string, category: FoodSearchCategory): SearchCursor | null {
  if (!value?.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const cursor = parsed as Partial<SearchCursor>
    const key = cursor.after
    if (cursor.version !== 1 || cursor.query !== query || cursor.category !== category || typeof cursor.now !== 'string' || !Number.isFinite(Date.parse(cursor.now)) || !key || typeof key.score !== 'number' || !Number.isFinite(key.score) || typeof key.representativeScore !== 'number' || !Number.isFinite(key.representativeScore) || typeof key.displayName !== 'string' || typeof key.foodId !== 'string') return null
    return cursor as SearchCursor
  } catch {
    return null
  }
}

/** 部分一致を落とさず走査し、順位境界より後の1ページだけ保持する。 */
export async function searchStoredFoodPage(db: NutritionDatabase, query: string, options: FoodSearchOptions = {}): Promise<FoodSearchPage> {
  const normalizedQuery = normalizeSearchText(query)
  const category = options.category ?? 'all'
  if (category === 'menu') return { results: [], normalizedQuery, nextCursor: null }
  const limit = Math.max(1, Math.min(100, options.limit ?? 20))
  const cursor = readCursor(options.cursor, normalizedQuery, category)
  const now = cursor ? new Date(cursor.now) : options.now ?? new Date()
  return db.transaction('r', [db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.favorites], async () => {
    // 旧データの無所属食品は同名の永続groupより優先する（純粋検索と同じ）。
    async function fallbackForGroup(groupId: string): Promise<Food | undefined> {
      if (groupId === '') return db.foods.where('foodGroupId').equals('').reverse().filter((food) => foodMatchesSearchCategory(food, category)).first()
      if (!groupId.startsWith('food:')) return undefined
      const food = await db.foods.get(groupId.slice(5))
      return food && food.foodGroupId === undefined && foodMatchesSearchCategory(food, category) ? food : undefined
    }

    async function scoreGroup(group: FoodGroup, fallback?: Food): Promise<FoodSearchCandidate | null> {
      if (!group.isActive) return null
      const accumulator = createFoodSearchGroupAccumulator(normalizedQuery, group, now)
      await db.foodAliases.where('foodGroupId').equals(group.id).each((alias) => accumulator.addAlias(alias))
      await db.foodRelatedTerms.where('foodGroupId').equals(group.id).each((term) => accumulator.addRelatedTerm(term))
      async function addBatch(batch: Food[]): Promise<void> {
        const foods = batch.filter((food) => foodMatchesSearchCategory(food, category))
        const ids = foods.map((food) => food.id)
        const [stats, favorites] = await Promise.all([db.foodUsageStats.bulkGet(ids), db.favorites.bulkGet(ids)])
        foods.forEach((food, index) => accumulator.addFood(food, stats[index], favorites[index] !== undefined))
      }
      for await (const batch of groupFoodBatches(db, group.id)) await addBatch(batch)
      if (fallback && fallback.foodGroupId === undefined) await addBatch([fallback])
      return accumulator.result()
    }

    async function scanPage(after: FoodSearchOrderKey | undefined, pageLimit: number): Promise<FoodSearchCandidate[]> {
      const candidates: FoodSearchCandidate[] = []
      function consider(candidate: FoodSearchCandidate | null): void {
        if (!candidate || (after && compareFoodSearchOrder(foodSearchOrderKey(candidate), after) <= 0)) return
        let low = 0
        let high = candidates.length
        const key = foodSearchOrderKey(candidate)
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (compareFoodSearchOrder(key, foodSearchOrderKey(candidates[middle])) < 0) high = middle
          else low = middle + 1
        }
        if (low <= pageLimit) {
          candidates.splice(low, 0, candidate)
          if (candidates.length > pageLimit + 1) candidates.pop()
        }
      }
      for await (const batch of primaryKeyBatches(db.foodGroups)) {
        for (const group of batch) {
          if (!await fallbackForGroup(group.id)) consider(await scoreGroup(group))
        }
      }
      let processedEmptyGroup = false
      for await (const batch of primaryKeyBatches(db.foods)) {
        for (const food of batch) {
          if (food.foodGroupId || !foodMatchesSearchCategory(food, category)) continue
          if (food.foodGroupId === '') {
            if (processedEmptyGroup) continue
            processedEmptyGroup = true
            const fallback = await fallbackForGroup('')
            if (fallback) consider(await scoreGroup(fallbackFoodSearchGroup(fallback), fallback))
          } else {
            consider(await scoreGroup(fallbackFoodSearchGroup(food), food))
          }
        }
      }
      return candidates
    }

    let after = cursor?.after
    // 数値cursorも受け付けるが、過去ページの全候補をメモリへためない。
    let legacyOffset = cursor ? 0 : Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
    while (legacyOffset > 0) {
      const count = Math.min(100, legacyOffset)
      const skipped = await scanPage(after, count)
      if (skipped.length <= count) return { results: [], normalizedQuery, nextCursor: null }
      after = foodSearchOrderKey(skipped[count - 1])
      legacyOffset -= count
    }
    const candidates = await scanPage(after, limit)
    const selected = candidates.slice(0, limit)
    const results: FoodSearchPage['results'] = []
    for (const candidate of selected) {
      const variants: Food[] = []
      for await (const batch of groupFoodBatches(db, candidate.group.id)) {
        variants.push(...batch.filter((food) => foodMatchesSearchCategory(food, category)))
      }
      if (candidate.group.generationVersion === 'runtime-fallback') {
        const fallback = await fallbackForGroup(candidate.group.id)
        if (fallback && fallback.foodGroupId === undefined) variants.push(fallback)
      }
      results.push({ ...candidate, variants: variants.sort(compareFoodSearchVariants) })
    }
    const nextCursor = candidates.length > limit ? JSON.stringify({ version: 1, query: normalizedQuery, category, now: now.toISOString(), after: foodSearchOrderKey(selected[selected.length - 1]) } satisfies SearchCursor) : null
    return { results, normalizedQuery, nextCursor }
  })
}
