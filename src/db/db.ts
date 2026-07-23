import Dexie, { type Table } from 'dexie'
import {
  DEFAULT_SETTINGS,
  DEFAULT_BODY_PROFILE,
  NUTRIENT_KEYS,
  type AppSettings,
  type BackupData,
  type FavoriteRecord,
  type Food,
  type FoodAlias,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodUsageStat,
  type MealEntry,
  type MetadataRecord,
  type Menu,
  type MenuSet,
  type Nutrients,
  type SearchLog,
} from '../types'
import { createId } from '../utils/id'
import { estimateDailyGoals } from '../services/nutrition'
import { normalizeFoodAttributePreferences } from '../services/foodAttributePreferences'
import { getMenuFoodIds, getNestedMenuIds, wouldCreateMenuCycle } from '../services/menuIngredients'
import { normalizeSearchText, searchFoodResults as searchFoodResultsPure, type FoodSearchPage } from '../services/foodSearch'
import type { FoodSearchCategory } from '../services/foodClassification'
import {
  getFoodGroup as getMextFoodGroup,
  getFoodVariantBySourceId,
  mextFoodGroups,
  type MextFoodGroup,
} from '../services/mextFoodData'

const INITIAL_FOODS_VERSION = 9
const SEARCH_METADATA_VERSION = 8
const LEGACY_INITIAL_FOOD_IDS = [
  'mext_rice_white',
  'mext_chicken_breast',
  'mext_egg',
  'mext_banana',
  'mext_milk',
  'mext_tofu',
] as const
const mextFoodGroupIds = new Set(mextFoodGroups.map((group) => group.id))

function isUserManualGroup(group: FoodGroup | undefined): boolean {
  return group?.metadataSource === 'manual' && group.generationVersion === 'manual-v1'
}

export class NutritionDatabase extends Dexie {
  foods!: Table<Food, string>
  mealEntries!: Table<MealEntry, string>
  favorites!: Table<FavoriteRecord, string>
  settings!: Table<AppSettings, string>
  metadata!: Table<MetadataRecord, string>
  menus!: Table<Menu, string>
  menuSets!: Table<MenuSet, string>
  foodGroups!: Table<FoodGroup, string>
  foodAliases!: Table<FoodAlias, string>
  foodRelatedTerms!: Table<FoodRelatedTerm, string>
  foodUsageStats!: Table<FoodUsageStat, string>
  searchLogs!: Table<SearchLog, string>

  constructor() {
    super('nutrition-pwa')
    this.version(1).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
    })
    this.version(2).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
    })
    this.version(3).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
    })
    this.version(4).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
    }).upgrade(async (transaction) => {
      const normalize = (value: Partial<Nutrients> | undefined): Nutrients => Object.fromEntries(NUTRIENT_KEYS.map((key) => {
        const nutrient = value?.[key]
        return [key, typeof nutrient === 'number' && Number.isFinite(nutrient) ? nutrient : null]
      })) as Nutrients
      const foodTable = transaction.table('foods')
      const foods = await foodTable.toArray() as Food[]
      if (foods.length > 0) await foodTable.bulkPut(foods.map((food) => ({ ...food, nutrients: normalize(food.nutrients) })))
      const mealTable = transaction.table('meal_entries')
      const entries = await mealTable.toArray() as MealEntry[]
      if (entries.length > 0) await mealTable.bulkPut(entries.map((entry) => ({
        ...entry,
        foodSnapshot: { ...entry.foodSnapshot, nutrients: normalize(entry.foodSnapshot.nutrients) },
        calculatedNutrients: normalize(entry.calculatedNutrients),
      })))
    })
    this.version(5).stores({
      foods: 'id, name, maker, barcode, source, foodGroupId, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
      food_groups: 'id, displayName, category, updatedAt',
      food_aliases: 'id, foodGroupId, foodVariantId, normalizedAlias, isActive',
      food_related_terms: 'id, foodGroupId, normalizedTerm, isActive',
      food_usage_stats: 'foodId, selectionCount, lastSelectedAt, updatedAt',
      search_logs: 'id, createdAt, normalizedQuery, selectedFoodGroupId, selectedFoodVariantId, unselected',
    })
    this.mealEntries = this.table('meal_entries')
    this.menus = this.table('menus')
    this.menuSets = this.table('menu_sets')
    this.foodGroups = this.table('food_groups')
    this.foodAliases = this.table('food_aliases')
    this.foodRelatedTerms = this.table('food_related_terms')
    this.foodUsageStats = this.table('food_usage_stats')
    this.searchLogs = this.table('search_logs')
  }
}

export const db = new NutritionDatabase()

function mextGroupForSearch(group: MextFoodGroup, createdAt: string, updatedAt: string): FoodGroup {
  return {
    id: group.id,
    displayName: group.displayName,
    reading: null,
    category: group.parentConcept ?? group.foodForm,
    representativeScore: 0,
    defaultVariantId: group.defaultSourceId,
    isActive: true,
    metadataSource: 'imported',
    generationVersion: 'mext-app-v2',
    needsReview: false,
    createdAt,
    updatedAt,
  }
}

function mextSearchAliases(): FoodAlias[] {
  return mextFoodGroups.flatMap((group) => group.searchTerms.map((alias, index) => ({
    id: `mext-app:${group.id}:${String(index).padStart(3, '0')}`,
    foodGroupId: group.id,
    foodVariantId: null,
    alias,
    normalizedAlias: normalizeSearchText(alias),
    aliasType: 'synonym' as const,
    priority: 80,
    isActive: true,
    metadataSource: 'imported' as const,
  })))
}

function enrichFoodForSearch(food: Food): Food {
  const mextVariant = food.source === 'mext' ? getFoodVariantBySourceId(food.id) : undefined
  const groupId = mextVariant?.foodGroupId ?? food.foodGroupId ?? `food:${food.id}`
  const mextGroup = mextFoodGroupIds.has(groupId) ? getMextFoodGroup(groupId) : undefined
  return {
    ...food,
    foodGroupId: groupId,
    displayName: mextGroup?.displayName ?? food.displayName ?? food.name,
    officialName: food.officialName ?? food.name,
  }
}

async function ensureSearchMetadata(): Promise<void> {
  await db.transaction('rw', [db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.metadata, db.searchLogs], async () => {
    const foods = await db.foods.toArray()
    const existingGroups = new Map((await db.foodGroups.toArray()).map((group) => [group.id, group]))
    const metadataVersion = await db.metadata.get('search-metadata-version')
    const metadataChanged = metadataVersion?.value !== SEARCH_METADATA_VERSION
    const now = new Date().toISOString()
    const groupsToPut = new Map<string, FoodGroup>()
    const foodsToPut: Food[] = []
    const validGroupIds = new Set<string>()
    for (const group of mextFoodGroups) {
      const existingGroup = existingGroups.get(group.id)
      groupsToPut.set(group.id, mextGroupForSearch(group, existingGroup?.createdAt ?? now, now))
      validGroupIds.add(group.id)
    }
    for (const food of foods) {
      const previousGroupId = food.foodGroupId ?? `food:${food.id}`
      const previousGroup = existingGroups.get(previousGroupId)
      const mextVariant = food.source === 'mext' ? getFoodVariantBySourceId(food.id) : undefined
      const groupId = mextVariant?.foodGroupId
        ?? (mextFoodGroupIds.has(previousGroupId) || isUserManualGroup(previousGroup) ? previousGroupId : `food:${food.id}`)
      const existingGroup = existingGroups.get(groupId)
      validGroupIds.add(groupId)
      if (!mextVariant && !existingGroup) {
        groupsToPut.set(groupId, { id: groupId, displayName: food.displayName ?? food.name, reading: food.reading ?? null, category: null, representativeScore: 0, defaultVariantId: food.id, isActive: true, metadataSource: 'rule', generationVersion: 'runtime-fallback', needsReview: true, createdAt: food.createdAt, updatedAt: food.updatedAt })
      }
      const enriched = enrichFoodForSearch({ ...food, foodGroupId: groupId })
      if (food.foodGroupId !== enriched.foodGroupId || food.displayName !== enriched.displayName) foodsToPut.push(enriched)
    }
    if (groupsToPut.size > 0) await db.foodGroups.bulkPut([...groupsToPut.values()])
    if (foodsToPut.length > 0) await db.foods.bulkPut(foodsToPut)
    const staleGroupIds = [...existingGroups.values()]
      .filter((group) => !validGroupIds.has(group.id) && !isUserManualGroup(group))
      .map((group) => group.id)
    if (staleGroupIds.length > 0) await db.foodGroups.bulkDelete(staleGroupIds)
    const bundledAliases = mextSearchAliases()
    const currentAliases = new Map((await db.foodAliases.toArray()).map((alias) => [alias.id, alias]))
    const currentAliasIds = new Set(bundledAliases.map((alias) => alias.id))
    const obsoleteAliasIds = [...currentAliases.values()]
      .filter((alias) => !currentAliasIds.has(alias.id) && !alias.id.startsWith('manual:'))
      .map((alias) => alias.id)
    if (obsoleteAliasIds.length > 0) await db.foodAliases.bulkDelete(obsoleteAliasIds)
    const currentRelated = new Map((await db.foodRelatedTerms.toArray()).map((term) => [term.id, term]))
    const obsoleteRelatedIds = [...currentRelated.values()]
      .filter((term) => !term.id.startsWith('manual:'))
      .map((term) => term.id)
    if (obsoleteRelatedIds.length > 0) await db.foodRelatedTerms.bulkDelete(obsoleteRelatedIds)
    if (metadataChanged) {
      const aliasesToPut = bundledAliases.filter((alias) => currentAliases.get(alias.id)?.metadataSource !== 'manual')
      if (aliasesToPut.length > 0) await db.foodAliases.bulkPut(aliasesToPut)
      await db.metadata.put({ key: 'search-metadata-version', value: SEARCH_METADATA_VERSION })
      await db.searchLogs.clear()
    }
  })
}

export async function initializeDatabase(): Promise<void> {
  const { initialFoods } = await import('../data/initialFoods')
  const settings = await db.settings.get('app')
  if (!settings) await db.settings.put({ ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals } })

  const seeded = await db.metadata.get('initial-foods-seeded')
  const seedVersion = await db.metadata.get('initial-foods-version')
  if (!seeded) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
      const existing = await db.foods.count()
      if (existing === 0) await db.foods.bulkAdd(initialFoods.map(enrichFoodForSearch))
      await db.metadata.put({ key: 'initial-foods-seeded', value: true })
      await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
      await db.metadata.put({ key: 'schema-version', value: 5 })
    })
  } else if (seedVersion?.value !== INITIAL_FOODS_VERSION) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
      const bundledFoodIds = initialFoods.map((food) => food.id)
      const existingFoods = new Map(
        (await db.foods.bulkGet(bundledFoodIds))
          .filter((food): food is Food => Boolean(food))
          .map((food) => [food.id, food]),
      )
      const foodsToPut: Food[] = []
      for (const bundledFood of initialFoods) {
        const enrichedFood = enrichFoodForSearch(bundledFood)
        const existing = existingFoods.get(bundledFood.id)
        if (!existing) {
          foodsToPut.push(enrichedFood)
        } else if (
          existing.source === 'mext'
          && existing.createdAt === existing.updatedAt
          && (
            existing.sourceVersion.includes('増補2023年')
            || existing.sourceVersion.includes('初期サンプル')
          )
        ) {
          foodsToPut.push(enrichedFood)
        }
      }
      if (foodsToPut.length > 0) await db.foods.bulkPut(foodsToPut)
      const legacyFoods = await db.foods.bulkGet([...LEGACY_INITIAL_FOOD_IDS])
      const legacyIdsToDelete = legacyFoods
        .filter((food): food is Food => Boolean(food))
        .filter((food) => food.source === 'mext' && food.sourceVersion.includes('初期サンプル'))
        .map((food) => food.id)
      if (legacyIdsToDelete.length > 0) await db.foods.bulkDelete(legacyIdsToDelete)
      await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
      await db.metadata.put({ key: 'schema-version', value: 5 })
    })
  }
  await ensureSearchMetadata()
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.settings.get('app')
  const normalized = stored
    ? {
      ...DEFAULT_SETTINGS, ...stored, goals: { ...DEFAULT_SETTINGS.goals, ...stored.goals },
      mealTimeMode: stored.mealTimeMode ?? 'auto', bodyProfile: { ...DEFAULT_BODY_PROFILE, ...stored.bodyProfile },
      foodAttributePreferences: normalizeFoodAttributePreferences(stored.foodAttributePreferences),
    }
    : { ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals }, bodyProfile: { ...DEFAULT_BODY_PROFILE }, foodAttributePreferences: {} }
  const estimated = estimateDailyGoals(normalized.bodyProfile)
  const goals = { ...normalized.goals }
  if (estimated) {
    for (const key of NUTRIENT_KEYS) {
      if (goals[key] === null && estimated[key] !== null) goals[key] = estimated[key]
    }
  }
  const next = { ...normalized, goals }
  if (stored && NUTRIENT_KEYS.some((key) => stored.goals[key] !== next.goals[key])) await db.settings.put(next)
  return next
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(settings)
}

export async function searchFoods(query: string): Promise<Food[]> {
  const page = await searchFoodResults(query, { limit: 100 })
  return page.page.results.map((result) => result.variants).flat()
}

export async function searchFoodResults(query: string, options: { limit?: number; cursor?: string | null; category?: FoodSearchCategory } = {}): Promise<{ page: FoodSearchPage; logId: string }> {
  const startedAt = performance.now()
  const [foods, groups, aliases, relatedTerms, usageStats, favoriteIds] = await Promise.all([
    db.foods.toArray(), db.foodGroups.toArray(), db.foodAliases.toArray(), db.foodRelatedTerms.toArray(), db.foodUsageStats.toArray(), getFavoriteIds(),
  ])
  const page = searchFoodResultsPure(query, { foods, groups, aliases, relatedTerms, usageStats, favoriteIds }, options)
  const log: SearchLog = {
    id: createId('search'), createdAt: new Date().toISOString(), query, normalizedQuery: page.normalizedQuery,
    resultCount: page.results.length, processingMs: Math.max(0, performance.now() - startedAt),
    items: page.results.map((result, index) => ({ foodGroupId: result.group.id, foodVariantId: result.food.id, rank: index + 1, score: result.score, matchedBy: result.matchedBy, scoreBreakdown: result.scoreBreakdown })),
    selectedFoodGroupId: null, selectedFoodVariantId: null, selectedRank: null, selectionElapsedMs: null, unselected: false,
  }
  try { await db.searchLogs.put(log) } catch { /* ログ保存失敗で検索本体を止めない */ }
  return { page, logId: log.id }
}

export async function recordFoodSelection(logId: string, groupId: string, foodId: string, rank: number): Promise<void> {
  const now = new Date().toISOString()
  try {
    await db.transaction('rw', [db.foodUsageStats, db.searchLogs], async () => {
      const current = await db.foodUsageStats.get(foodId)
      await db.foodUsageStats.put({ foodId, selectionCount: (current?.selectionCount ?? 0) + 1, lastSelectedAt: now, updatedAt: now })
      const log = await db.searchLogs.get(logId)
      if (log) await db.searchLogs.put({ ...log, selectedFoodGroupId: groupId, selectedFoodVariantId: foodId, selectedRank: rank, selectionElapsedMs: Math.max(0, Date.now() - new Date(log.createdAt).getTime()), unselected: false })
    })
  } catch { /* 利用統計は補助情報。選択自体の成功を妨げない。 */ }
}

export async function markSearchLogUnselected(logId: string): Promise<void> {
  try {
    const log = await db.searchLogs.get(logId)
    if (log && log.selectedFoodVariantId === null) await db.searchLogs.put({ ...log, unselected: true })
  } catch { /* ログ更新失敗は検索画面の操作を妨げない。 */ }
}

export async function getAllFoodGroups(): Promise<FoodGroup[]> { return db.foodGroups.orderBy('displayName').toArray() }
export async function getAllFoodAliases(): Promise<FoodAlias[]> { return db.foodAliases.toArray() }
export async function getAllFoodRelatedTerms(): Promise<FoodRelatedTerm[]> { return db.foodRelatedTerms.toArray() }
export async function getAllFoodUsageStats(): Promise<FoodUsageStat[]> { return db.foodUsageStats.toArray() }
export async function getSearchLogs(): Promise<SearchLog[]> { return db.searchLogs.orderBy('createdAt').toArray() }

export async function getFoodById(id: string): Promise<Food | undefined> {
  return db.foods.get(id)
}

export async function getFoodByBarcode(barcode: string): Promise<Food | undefined> {
  return db.foods.where('barcode').equals(barcode).first()
}

export async function saveFood(food: Food): Promise<void> {
  const previous = await db.foods.get(food.id)
  const merged: Food = {
    ...previous,
    ...food,
    foodGroupId: food.foodGroupId ?? previous?.foodGroupId,
    displayName: food.displayName ?? previous?.displayName,
    officialName: food.officialName ?? previous?.officialName,
  }
  const enriched = enrichFoodForSearch(merged)
  const existingGroup = await db.foodGroups.get(enriched.foodGroupId ?? '')
  await db.transaction('rw', [db.foods, db.foodGroups], async () => {
    await db.foods.put(enriched)
    if (!existingGroup && enriched.foodGroupId) {
      await db.foodGroups.put({ id: enriched.foodGroupId, displayName: enriched.displayName ?? enriched.name, reading: enriched.reading ?? null, category: null, representativeScore: 0, defaultVariantId: enriched.id, isActive: true, metadataSource: 'rule', generationVersion: 'runtime-fallback', needsReview: true, createdAt: enriched.createdAt, updatedAt: enriched.updatedAt })
    }
  })
}

export interface FoodMetadataUpdate {
  group: FoodGroup
  aliases: FoodAlias[]
  relatedTerms: FoodRelatedTerm[]
}

/** 食品と検索メタデータを一緒に保存し、途中状態を検索対象へ公開しない。 */
export async function saveFoodWithMetadata(food: Food, metadata: FoodMetadataUpdate): Promise<void> {
  const previous = await db.foods.get(food.id)
  const merged: Food = {
    ...previous,
    ...food,
    foodGroupId: food.foodGroupId ?? previous?.foodGroupId,
    displayName: food.displayName ?? previous?.displayName,
    officialName: food.officialName ?? previous?.officialName,
  }
  const enriched = enrichFoodForSearch(merged)
  const group = { ...metadata.group, defaultVariantId: metadata.group.defaultVariantId ?? enriched.id }
  await db.transaction('rw', [db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms], async () => {
    await db.foods.put(enriched)
    await db.foodGroups.put(group)
    const currentAliases = await db.foodAliases.where('foodGroupId').equals(group.id).toArray()
    const manualAliasIds = currentAliases.filter((alias) => alias.metadataSource === 'manual').map((alias) => alias.id)
    if (manualAliasIds.length > 0) await db.foodAliases.bulkDelete(manualAliasIds)
    const currentRelatedTerms = await db.foodRelatedTerms.where('foodGroupId').equals(group.id).toArray()
    const manualRelatedIds = currentRelatedTerms.filter((term) => term.metadataSource === 'manual').map((term) => term.id)
    if (manualRelatedIds.length > 0) await db.foodRelatedTerms.bulkDelete(manualRelatedIds)
    if (metadata.aliases.length > 0) await db.foodAliases.bulkPut(metadata.aliases)
    if (metadata.relatedTerms.length > 0) await db.foodRelatedTerms.bulkPut(metadata.relatedTerms)
  })
}

export function createNewFoodGroupId(): string {
  return createId('food-group')
}

export async function deleteFood(id: string): Promise<void> {
  await db.transaction('rw', [db.foods, db.favorites], async () => {
    await db.foods.delete(id)
    await db.favorites.delete(id)
  })
}

export async function getAllFoods(): Promise<Food[]> {
  return db.foods.orderBy('name').toArray()
}

export async function searchMenus(query: string): Promise<Menu[]> {
  const normalized = normalizeSearchText(query)
  const menus = await db.menus.orderBy('name').toArray()
  if (!normalized) return menus
  const ingredientFoods = await db.foods.bulkGet([...new Set(menus.flatMap(getMenuFoodIds))])
  const foodsById = new Map(ingredientFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food]))
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const aliases = await db.foodAliases.toArray()
  const aliasesByGroup = new Map<string, string[]>()
  for (const alias of aliases) aliasesByGroup.set(alias.foodGroupId, [...(aliasesByGroup.get(alias.foodGroupId) ?? []), alias.alias])
  const foodMatches = (food: Food) => [food.displayName ?? food.name, food.officialName ?? food.name, food.maker, food.reading ?? '', ...(food.foodGroupId ? aliasesByGroup.get(food.foodGroupId) ?? [] : [])]
    .some((field) => normalizeSearchText(field).includes(normalized))
  const textMatches = (field: string) => normalizeSearchText(field).includes(normalized)
  const menuMatches = (menu: Menu, visited: Set<string>): boolean => {
    if (visited.has(menu.id)) return false
    const nextVisited = new Set(visited).add(menu.id)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some((foodId) => {
        const food = foodsById.get(foodId)
        return food ? foodMatches(food) : false
      })
      || getNestedMenuIds(menu).some((menuId) => {
        const nested = menusById.get(menuId)
        return nested ? menuMatches(nested, nextVisited) : false
      })
  }
  return menus.filter((menu) => menuMatches(menu, new Set()))
}

export async function searchMenuSets(query: string): Promise<MenuSet[]> {
  const normalized = normalizeSearchText(query)
  const sets = await db.menuSets.orderBy('name').toArray()
  if (!normalized) return sets
  const menus = await db.menus.toArray()
  const menuById = new Map(menus.map((menu) => [menu.id, menu]))
  const foodIds = [...new Set([...sets.flatMap((set) => set.foodIds ?? []), ...menus.flatMap(getMenuFoodIds)])]
  const ingredientFoods = await db.foods.bulkGet(foodIds)
  const foodsById = new Map(ingredientFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food]))
  const aliases = await db.foodAliases.toArray()
  const aliasesByGroup = new Map<string, string[]>()
  for (const alias of aliases) aliasesByGroup.set(alias.foodGroupId, [...(aliasesByGroup.get(alias.foodGroupId) ?? []), alias.alias])
  const foodMatches = (foodId: string) => {
    const food = foodsById.get(foodId)
    return food ? [food.displayName ?? food.name, food.officialName ?? food.name, food.maker, food.reading ?? '', ...(food.foodGroupId ? aliasesByGroup.get(food.foodGroupId) ?? [] : [])].some((field) => normalizeSearchText(field).includes(normalized)) : false
  }
  const textMatches = (field: string) => normalizeSearchText(field).includes(normalized)
  const menuMatches = (menuId: string, visited = new Set<string>()): boolean => {
    const menu = menuById.get(menuId)
    if (!menu || visited.has(menuId)) return false
    const nextVisited = new Set(visited).add(menuId)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some(foodMatches)
      || getNestedMenuIds(menu).some((nestedMenuId) => menuMatches(nestedMenuId, nextVisited))
  }
  return sets.filter((set) => textMatches(set.name) || (set.foodIds ?? []).some(foodMatches) || set.menuIds.some((menuId) => menuMatches(menuId)))
}

export async function getAllMenus(): Promise<Menu[]> {
  return db.menus.orderBy('name').toArray()
}

export async function getAllMenuSets(): Promise<MenuSet[]> {
  return db.menuSets.orderBy('name').toArray()
}

export async function saveMenu(menu: Menu): Promise<void> {
  await db.transaction('rw', db.menus, async () => {
    const menus = await db.menus.toArray()
    if (getNestedMenuIds(menu).some((menuId) => wouldCreateMenuCycle(menu.id, menuId, menus))) {
      throw new Error('料理メニューを循環して参照することはできません。')
    }
    await db.menus.put(menu)
  })
}

export async function deleteMenu(id: string): Promise<void> {
  await db.transaction('rw', [db.menus, db.menuSets], async () => {
    const referencedBy = (await db.menus.toArray()).filter((menu) => menu.id !== id && getNestedMenuIds(menu).includes(id))
    if (referencedBy.length > 0) throw new Error(`「${referencedBy[0].name}」の食材として使用されているため削除できません。`)
    await db.menus.delete(id)
    const sets = await db.menuSets.toArray()
    await Promise.all(sets.filter((set) => set.menuIds.includes(id)).map((set) => db.menuSets.put({ ...set, menuIds: set.menuIds.filter((menuId) => menuId !== id), updatedAt: new Date().toISOString() })))
  })
}

export async function saveMenuSet(menuSet: MenuSet): Promise<void> {
  await db.menuSets.put(menuSet)
}

export async function deleteMenuSet(id: string): Promise<void> {
  await db.menuSets.delete(id)
}

export async function getEntriesForDate(dateKey: string): Promise<MealEntry[]> {
  const start = new Date(`${dateKey}T00:00:00+09:00`).toISOString()
  const nextDate = new Date(`${dateKey}T00:00:00+09:00`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const end = nextDate.toISOString()
  return db.mealEntries.where('eatenAt').between(start, end, true, false).toArray()
}

export async function getEntriesBetween(from: string, to: string): Promise<MealEntry[]> {
  const start = new Date(`${from}T00:00:00+09:00`).toISOString()
  const endDate = new Date(`${to}T00:00:00+09:00`)
  endDate.setUTCDate(endDate.getUTCDate() + 1)
  return db.mealEntries.where('eatenAt').between(start, endDate.toISOString(), true, false).toArray()
}

export async function saveMealEntry(entry: MealEntry): Promise<void> {
  await db.mealEntries.put(entry)
}

export async function saveMealEntries(entries: MealEntry[]): Promise<void> {
  await db.transaction('rw', db.mealEntries, async () => {
    if (entries.length > 0) await db.mealEntries.bulkPut(entries)
  })
}

export async function deleteMealEntry(id: string): Promise<void> {
  await db.mealEntries.delete(id)
}

export async function getFavoriteIds(): Promise<Set<string>> {
  const records = await db.favorites.toArray()
  return new Set(records.map((record) => record.foodId))
}

export async function setFavorite(foodId: string, favorite: boolean): Promise<void> {
  if (favorite) await db.favorites.put({ foodId, createdAt: new Date().toISOString() })
  else await db.favorites.delete(foodId)
}

export async function getFavoriteFoods(): Promise<Food[]> {
  const favoriteIds = await getFavoriteIds()
  const foods = await getAllFoods()
  return foods.filter((food) => favoriteIds.has(food.id))
}

export async function getRecentFoods(limit = 20): Promise<Food[]> {
  if (limit <= 0) return []
  const recent: Food[] = []
  const seen = new Set<string>()
  const batchSize = Math.max(20, limit * 2)
  let offset = 0
  while (recent.length < limit) {
    const entries = await db.mealEntries.orderBy('eatenAt').reverse().offset(offset).limit(batchSize).toArray()
    if (entries.length === 0) break
    offset += entries.length
    const ids = entries.map((entry) => entry.foodId).filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    const foods = await db.foods.bulkGet(ids)
    for (const food of foods) {
      if (food) recent.push(food)
      if (recent.length >= limit) break
    }
  }
  return recent
}

export async function exportBackup(): Promise<BackupData> {
  await getSettings()
  return db.transaction('r', [db.foods, db.mealEntries, db.favorites, db.settings, db.menus, db.menuSets, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.searchLogs], async () => {
    const settings = await db.settings.get('app')
    if (!settings) throw new Error('設定を読み込めませんでした。')
    const [foods, mealEntries, favorites, foodGroups, foodAliases, foodRelatedTerms, foodUsageStats, searchLogs, menus, menuSets] = await Promise.all([
      db.foods.toArray(), db.mealEntries.toArray(), db.favorites.toArray(), db.foodGroups.toArray(), db.foodAliases.toArray(),
      db.foodRelatedTerms.toArray(), db.foodUsageStats.toArray(), db.searchLogs.toArray(), db.menus.toArray(), db.menuSets.toArray(),
    ])
    return {
      format: 'nutrition-pwa-backup',
      dataFormatVersion: settings.dataFormatVersion,
      exportedAt: new Date().toISOString(),
      foods,
      mealEntries,
      favorites,
      foodGroups,
      foodAliases,
      foodRelatedTerms,
      foodUsageStats,
      searchLogs,
      menus,
      menuSets,
      settings,
    }
  })
}

export interface ReplaceAllDataResult {
  committed: true
  searchMetadataReady: boolean
}

export async function replaceAllData(backup: BackupData): Promise<ReplaceAllDataResult> {
  await db.transaction('rw', [db.foods, db.mealEntries, db.favorites, db.settings, db.metadata, db.menus, db.menuSets, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.searchLogs], async () => {
    await db.foods.clear()
    await db.mealEntries.clear()
    await db.favorites.clear()
    await db.settings.clear()
    await db.metadata.clear()
    await db.menus.clear()
    await db.menuSets.clear()
    await db.foodGroups.clear()
    await db.foodAliases.clear()
    await db.foodRelatedTerms.clear()
    await db.foodUsageStats.clear()
    await db.searchLogs.clear()
    if (backup.foods.length) await db.foods.bulkAdd(backup.foods)
    if (backup.mealEntries.length) await db.mealEntries.bulkAdd(backup.mealEntries)
    if (backup.favorites.length) await db.favorites.bulkAdd(backup.favorites)
    if (backup.menus?.length) await db.menus.bulkAdd(backup.menus)
    if (backup.menuSets?.length) await db.menuSets.bulkAdd(backup.menuSets)
    if (backup.foodGroups?.length) await db.foodGroups.bulkAdd(backup.foodGroups)
    if (backup.foodAliases?.length) await db.foodAliases.bulkAdd(backup.foodAliases)
    if (backup.foodRelatedTerms?.length) await db.foodRelatedTerms.bulkAdd(backup.foodRelatedTerms)
    if (backup.foodUsageStats?.length) await db.foodUsageStats.bulkAdd(backup.foodUsageStats)
    if (backup.searchLogs?.length) await db.searchLogs.bulkAdd(backup.searchLogs)
    await db.settings.put(backup.settings)
    await db.metadata.put({ key: 'schema-version', value: 5 })
    await db.metadata.put({ key: 'initial-foods-seeded', value: true })
    await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
    if (backup.foodAliases !== undefined && backup.foodRelatedTerms !== undefined) {
      await db.metadata.put({ key: 'search-metadata-version', value: SEARCH_METADATA_VERSION })
    }
  })
  try {
    await ensureSearchMetadata()
    return { committed: true, searchMetadataReady: true }
  } catch {
    return { committed: true, searchMetadataReady: false }
  }
}

export function createNewFoodId(): string {
  return createId('food')
}

export function createNewMealId(): string {
  return createId('meal')
}

export function createNewMenuId(): string {
  return createId('menu')
}

export function createNewMenuSetId(): string {
  return createId('menu-set')
}
