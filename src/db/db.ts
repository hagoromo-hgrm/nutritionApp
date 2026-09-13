import { createEstimationInputHash } from '../services/foodRevision'
import Dexie, { type Table } from 'dexie'
import {
  DEFAULT_SETTINGS,
  DEFAULT_BODY_PROFILE,
  DEFAULT_ESTIMATION_SETTINGS,
  NUTRIENT_KEYS,
  type AppSettings,
  type BackupData,
  type EstimationDecision,
  type EstimationRequest,
  type EstimationResult,
  type EstimationSettings,
  type FavoriteRecord,
  type Food,
  type FoodAlias,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodUsageProfile,
  type FoodUsageStat,
  type GeneralMenu,
  type MealEntry,
  type MealType,
  type MealUsageEntryPoint,
  type MealUsageEvidence,
  type MealUsageSearchContext,
  type MetadataRecord,
  type Menu,
  type MenuSet,
  type Nutrients,
  type SearchLog,
  type UnresolvedIngredientStat,
  type WeightRecord,
} from '../types'
import { createId } from '../utils/id'
import { getFoodQuantityUnits } from '../services/nutrition'
import { normalizeFoodAttributePreferences } from '../services/foodAttributePreferences'
import { validateBackup } from '../services/backup'
import { isRegistrationTimestamp, withLegacyRegistrationTime } from '../services/mealRegistrationTime'
import { getMenuFoodIds, getNestedMenuIds, wouldCreateMenuCycle } from '../services/menuIngredients'
import { normalizeSearchText } from '../services/foodSearch'
import { searchUnifiedFoodResults, type UnifiedFoodSearchResult } from '../services/unifiedFoodSearch'
import { normalizeMealEntryGroups, normalizeMealEntryOrder, sortMealEntries, sortMealEntryGroup } from '../services/mealEntryOrder'
import type { FoodSearchCategory } from '../services/foodClassification'
import { formatDateKey } from '../utils/date'
import { createWeightRecord, isValidTokyoDateKey, isValidWeightKg, sortWeightRecords } from '../services/weightHistory'
import {
  getFoodGroup as getMextFoodGroup,
  getFoodVariantBySourceId,
  mextFoodGroups,
  type MextFoodGroup,
} from '../services/mextFoodData'

const INITIAL_FOODS_VERSION = 11
const INITIAL_FOOD_IDS_METADATA_KEY = 'initial-food-ids'
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
const FOOD_SEARCH_SESSION_LIMIT = 24

interface FoodSearchSession {
  id: string
  query: string
  category: FoodSearchCategory
  mealType?: MealType
  normalizedQuery: string
  results: UnifiedFoodSearchResult[]
  logId: string
  createdAtMs: number
}

const foodSearchSessions = new Map<string, FoodSearchSession>()

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
  generalMenus!: Table<GeneralMenu, string>
  menuSets!: Table<MenuSet, string>
  foodGroups!: Table<FoodGroup, string>
  foodAliases!: Table<FoodAlias, string>
  foodRelatedTerms!: Table<FoodRelatedTerm, string>
  foodUsageStats!: Table<FoodUsageStat, string>
  searchLogs!: Table<SearchLog, string>
  estimationRequests!: Table<EstimationRequest, string>
  estimationResults!: Table<EstimationResult, string>
  estimationDecisions!: Table<EstimationDecision, string>
  estimationSettings!: Table<EstimationSettings, string>
  unresolvedIngredientStats!: Table<UnresolvedIngredientStat, string>
  weightRecords!: Table<WeightRecord, string>

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
    // 推計履歴は食品・状態・日時でページングする。既存ストアは作り直さず追加する。
    this.version(6).stores({
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
      estimation_requests: 'requestId, foodId, status, createdAt, updatedAt, [foodId+createdAt], [foodId+status]',
      estimation_results: 'requestId, foodId, status, estimatedAt, [foodId+estimatedAt]',
      estimation_decisions: 'decisionId, requestId, foodId, nutrientKey, decision, decidedAt, [foodId+decidedAt], [requestId+decidedAt]',
      estimation_settings: 'id, updatedAt',
    })
    this.version(7).stores({
      foods: 'id, name, maker, barcode, source, foodGroupId, estimatorGenreId, updatedAt',
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
      estimation_requests: 'requestId, foodId, status, createdAt, updatedAt, [foodId+createdAt], [foodId+status]',
      estimation_results: 'requestId, foodId, status, estimatedAt, [foodId+estimatedAt]',
      estimation_decisions: 'decisionId, requestId, foodId, nutrientKey, decision, decidedAt, [foodId+decidedAt], [requestId+decidedAt]',
      estimation_settings: 'id, updatedAt',
      unresolved_ingredient_stats: 'id, estimatorGenreId, count, lastSeenAt, [estimatorGenreId+lastSeenAt]',
    })
    this.version(8).stores({
      foods: 'id, name, maker, barcode, source, foodGroupId, estimatorGenreId, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      general_menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
      food_groups: 'id, displayName, category, updatedAt',
      food_aliases: 'id, foodGroupId, foodVariantId, normalizedAlias, isActive',
      food_related_terms: 'id, foodGroupId, normalizedTerm, isActive',
      food_usage_stats: 'foodId, selectionCount, lastSelectedAt, updatedAt',
      search_logs: 'id, createdAt, normalizedQuery, selectedFoodGroupId, selectedFoodVariantId, unselected',
      estimation_requests: 'requestId, foodId, status, createdAt, updatedAt, [foodId+createdAt], [foodId+status]',
      estimation_results: 'requestId, foodId, status, estimatedAt, [foodId+estimatedAt]',
      estimation_decisions: 'decisionId, requestId, foodId, nutrientKey, decision, decidedAt, [foodId+decidedAt], [requestId+decidedAt]',
      estimation_settings: 'id, updatedAt',
      unresolved_ingredient_stats: 'id, estimatorGenreId, count, lastSeenAt, [estimatorGenreId+lastSeenAt]',
    })
    this.version(9).stores({
      foods: 'id, name, maker, barcode, source, foodGroupId, estimatorGenreId, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      general_menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
      food_groups: 'id, displayName, category, updatedAt',
      food_aliases: 'id, foodGroupId, foodVariantId, normalizedAlias, isActive',
      food_related_terms: 'id, foodGroupId, normalizedTerm, isActive',
      food_usage_stats: 'foodId, selectionCount, lastSelectedAt, updatedAt',
      search_logs: 'id, createdAt, normalizedQuery, selectedFoodGroupId, selectedFoodVariantId, unselected',
      estimation_requests: 'requestId, foodId, status, createdAt, updatedAt, [foodId+createdAt], [foodId+status]',
      estimation_results: 'requestId, foodId, status, estimatedAt, [foodId+estimatedAt]',
      estimation_decisions: 'decisionId, requestId, foodId, nutrientKey, decision, decidedAt, [foodId+decidedAt], [requestId+decidedAt]',
      estimation_settings: 'id, updatedAt',
      unresolved_ingredient_stats: 'id, estimatorGenreId, count, lastSeenAt, [estimatorGenreId+lastSeenAt]',
      weight_records: 'id, date, recordedAt, [date+recordedAt]',
    }).upgrade(async (transaction) => {
      const settings = await transaction.table('settings').get('app') as AppSettings | undefined
      const weightKg = settings?.bodyProfile?.weightKg
      if (isValidWeightKg(weightKg)) {
        await transaction.table('weight_records').add(createWeightRecord(weightKg))
      }
      await transaction.table('metadata').put({ key: 'schema-version', value: 9 })
    })
    this.version(10).stores({
      meal_entries: 'id, eatenAt, registeredAt, mealType, foodId',
    }).upgrade(async (transaction) => {
      await transaction.table('meal_entries').toCollection().modify((entry: MealEntry) => {
        entry.registeredAt = withLegacyRegistrationTime(entry).registeredAt
      })
      await transaction.table('metadata').put({ key: 'schema-version', value: 10 })
    })
    this.version(11).stores({
      meal_entries: 'id, eatenAt, registeredAt, mealType, foodId, usageEvidence.savedAt',
      food_usage_stats: 'foodId, selectionCount, lastSelectedAt, updatedAt',
    }).upgrade(async (transaction) => {
      // 旧値は検索結果を開いただけの操作も含むため、食事保存実績へ読み替えない。
      await transaction.table('food_usage_stats').clear()
      await transaction.table('metadata').put({ key: 'schema-version', value: 11 })
    })
    this.mealEntries = this.table('meal_entries')
    this.menus = this.table('menus')
    this.generalMenus = this.table('general_menus')
    this.menuSets = this.table('menu_sets')
    this.foodGroups = this.table('food_groups')
    this.foodAliases = this.table('food_aliases')
    this.foodRelatedTerms = this.table('food_related_terms')
    this.foodUsageStats = this.table('food_usage_stats')
    this.searchLogs = this.table('search_logs')
    this.estimationRequests = this.table('estimation_requests')
    this.estimationResults = this.table('estimation_results')
    this.estimationDecisions = this.table('estimation_decisions')
    this.estimationSettings = this.table('estimation_settings')
    this.unresolvedIngredientStats = this.table('unresolved_ingredient_stats')
    this.weightRecords = this.table('weight_records')
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
  const bundledFoodIds = initialFoods.map((food) => food.id)
  const bundledFoodIdRecord = await db.metadata.get(INITIAL_FOOD_IDS_METADATA_KEY)
  let previousBundledFoodIds: Set<string> | null = null
  if (typeof bundledFoodIdRecord?.value === 'string') {
    try {
      const parsed = JSON.parse(bundledFoodIdRecord.value) as unknown
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) previousBundledFoodIds = new Set(parsed)
    } catch {
      previousBundledFoodIds = null
    }
  }
  const settings = await db.settings.get('app')
  if (!settings) await db.settings.put({ ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals } })
  if (!await db.estimationSettings.get('default')) {
    await db.estimationSettings.put({ ...DEFAULT_ESTIMATION_SETTINGS })
  }

  const seeded = await db.metadata.get('initial-foods-seeded')
  const seedVersion = await db.metadata.get('initial-foods-version')
  if (!seeded) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
      const existing = await db.foods.count()
      if (existing === 0) await db.foods.bulkAdd(initialFoods.map(enrichFoodForSearch))
      await db.metadata.put({ key: 'initial-foods-seeded', value: true })
      await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
      await db.metadata.put({ key: 'schema-version', value: 11 })
    })
  } else if (seedVersion?.value !== INITIAL_FOODS_VERSION) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
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
          // 以前の同梱版に存在したIDが欠けている場合は、ユーザーによる削除として維持する。
          if (!previousBundledFoodIds?.has(bundledFood.id)) foodsToPut.push(enrichedFood)
        } else if (
          existing.createdAt === existing.updatedAt
          && (
            (
              existing.source === 'mext'
              && (
                existing.sourceVersion.includes('増補2023年')
                || existing.sourceVersion.includes('初期サンプル')
              )
            )
            || (existing.source === 'imported' && bundledFood.source === 'imported')
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
      await db.metadata.put({ key: 'schema-version', value: 11 })
    })
  }
  await ensureSearchMetadata()
  await db.metadata.put({ key: INITIAL_FOOD_IDS_METADATA_KEY, value: JSON.stringify(bundledFoodIds) })
  await db.metadata.put({ key: 'schema-version', value: 11 })
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.settings.get('app')
  const normalized = stored
    ? {
      ...DEFAULT_SETTINGS, ...stored, goals: { ...DEFAULT_SETTINGS.goals, ...stored.goals },
      dataFormatVersion: Math.max(DEFAULT_SETTINGS.dataFormatVersion, stored.dataFormatVersion ?? 1),
      mealTimeMode: stored.mealTimeMode ?? 'auto', bodyProfile: { ...DEFAULT_BODY_PROFILE, ...stored.bodyProfile },
      foodAttributePreferences: normalizeFoodAttributePreferences(stored.foodAttributePreferences),
    }
    : { ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals }, bodyProfile: { ...DEFAULT_BODY_PROFILE }, foodAttributePreferences: {} }
  const next = normalized
  if (stored && (stored.dataFormatVersion !== next.dataFormatVersion || NUTRIENT_KEYS.some((key) => stored.goals[key] !== next.goals[key]))) await db.settings.put(next)
  return next
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(settings)
}

/** 身体情報・再計算済み目標・体重履歴を同一トランザクションで更新する。 */
export async function saveBodyProfileSettings(settings: AppSettings, recordedAt = new Date().toISOString()): Promise<void> {
  const nextBodyProfile = { ...DEFAULT_BODY_PROFILE, ...settings.bodyProfile }
  if (nextBodyProfile.weightKg !== null && !isValidWeightKg(nextBodyProfile.weightKg)) {
    throw new Error('体重は正の有限値で入力してください。')
  }
  await db.transaction('rw', [db.settings, db.weightRecords], async () => {
    const stored = await db.settings.get('app')
    const currentBodyProfile = { ...DEFAULT_BODY_PROFILE, ...stored?.bodyProfile }
    await db.settings.put({ ...settings, bodyProfile: nextBodyProfile })
    if (isValidWeightKg(nextBodyProfile.weightKg) && nextBodyProfile.weightKg !== currentBodyProfile.weightKg) {
      await db.weightRecords.add(createWeightRecord(nextBodyProfile.weightKg, recordedAt))
    }
  })
}

export async function getWeightRecords(): Promise<WeightRecord[]> {
  return sortWeightRecords(await db.weightRecords.orderBy('recordedAt').toArray())
}

export async function getWeightRecordsBetween(from: string, to: string): Promise<WeightRecord[]> {
  if (!isValidTokyoDateKey(from) || !isValidTokyoDateKey(to) || from > to) {
    throw new Error('体重履歴の日付範囲が不正です。')
  }
  const records = await db.weightRecords.where('date').between(from, to, true, true).toArray()
  return sortWeightRecords(records)
}

export interface FoodUsageProfileOptions {
  /** テストや同一検索内の順位固定で基準時刻を固定できる。 */
  asOf?: string
  windowDays?: number
}

const FOOD_USAGE_WINDOW_DAYS = 180

function emptyMealTypeCounts(): Record<MealType, number> {
  return { 朝食: 0, 昼食: 0, 夕食: 0, 間食: 0 }
}

/** クリック統計を参照せず、証跡付き食事だけから利用プロフィールを再構築する。 */
export async function getFoodUsageProfiles(options: FoodUsageProfileOptions = {}): Promise<FoodUsageProfile[]> {
  const asOf = options.asOf ?? new Date().toISOString()
  const asOfMs = new Date(asOf).getTime()
  const windowDays = options.windowDays ?? FOOD_USAGE_WINDOW_DAYS
  if (!Number.isFinite(asOfMs) || !Number.isSafeInteger(windowDays) || windowDays <= 0) {
    throw new Error('食品利用実績の集計期間が不正です。')
  }
  const cutoffMs = asOfMs - windowDays * 24 * 60 * 60 * 1000
  const entries = await db.mealEntries.where('usageEvidence.savedAt').aboveOrEqual(new Date(cutoffMs).toISOString()).toArray()
  const aggregates = new Map<string, {
    usageCount: number
    usageDays: Set<string>
    lastUsedAt: string
    mealTypeCounts: Record<MealType, number>
  }>()
  for (const entry of entries) {
    const evidence = entry.usageEvidence
    if (evidence?.version !== 1 || evidence.kind !== 'direct-food') continue
    const savedAtMs = new Date(evidence.savedAt).getTime()
    if (!Number.isFinite(savedAtMs) || savedAtMs < cutoffMs || savedAtMs > asOfMs) continue
    const current = aggregates.get(entry.foodId) ?? {
      usageCount: 0,
      usageDays: new Set<string>(),
      lastUsedAt: evidence.savedAt,
      mealTypeCounts: emptyMealTypeCounts(),
    }
    current.usageCount += 1
    current.usageDays.add(formatDateKey(evidence.savedAt))
    current.mealTypeCounts[entry.mealType] += 1
    if (evidence.savedAt > current.lastUsedAt) current.lastUsedAt = evidence.savedAt
    aggregates.set(entry.foodId, current)
  }
  return [...aggregates.entries()]
    .map(([foodId, value]): FoodUsageProfile => ({
      foodId,
      usageCount: value.usageCount,
      distinctUsageDays: value.usageDays.size,
      lastUsedAt: value.lastUsedAt,
      mealTypeCounts: value.mealTypeCounts,
    }))
    .sort((left, right) => left.foodId.localeCompare(right.foodId))
}

function usageProfilesToLegacySearchStats(profiles: FoodUsageProfile[], updatedAt: string): FoodUsageStat[] {
  return profiles.map((profile) => ({
    foodId: profile.foodId,
    selectionCount: profile.usageCount,
    lastSelectedAt: profile.lastUsedAt,
    distinctUsageDays: profile.distinctUsageDays,
    mealTypeCounts: profile.mealTypeCounts,
    updatedAt,
  }))
}

export async function searchFoods(query: string): Promise<Food[]> {
  const page = await searchFoodResults(query, { limit: 100, log: false })
  return page.page.results.map((result) => result.variants).flat()
}

export interface SearchFoodResultsOptions {
  limit?: number
  cursor?: string | null
  category?: FoodSearchCategory
  mealType?: MealType
  log?: boolean
}

export interface UnifiedFoodSearchPage {
  results: UnifiedFoodSearchResult[]
  normalizedQuery: string
  nextCursor: string | null
}

function foodSearchCursor(sessionId: string, offset: number): string {
  return `${sessionId}:${offset}`
}

function readFoodSearchCursor(cursor: string): { sessionId: string; offset: number } | null {
  const separator = cursor.lastIndexOf(':')
  if (separator <= 0) return null
  const offset = Number(cursor.slice(separator + 1))
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  return { sessionId: cursor.slice(0, separator), offset }
}

function retainFoodSearchSession(session: FoodSearchSession): void {
  foodSearchSessions.set(session.id, session)
  while (foodSearchSessions.size > FOOD_SEARCH_SESSION_LIMIT) {
    const oldest = [...foodSearchSessions.values()].sort((left, right) => left.createdAtMs - right.createdAtMs)[0]
    if (!oldest) break
    foodSearchSessions.delete(oldest.id)
  }
}

function searchLogItems(results: UnifiedFoodSearchResult[], offset: number): SearchLog['items'] {
  return results.map((result, index) => ({
    candidateKey: result.candidateKey,
    foodGroupId: result.group.id,
    foodVariantId: result.food.id,
    rank: offset + index + 1,
    score: result.score,
    matchedBy: result.matchedBy,
    scoreBreakdown: result.scoreBreakdown,
  }))
}

export async function searchFoodResults(query: string, options: SearchFoodResultsOptions = {}): Promise<{ page: UnifiedFoodSearchPage; logId: string }> {
  const startedAt = performance.now()
  const limit = Math.max(1, Math.floor(options.limit ?? 20))
  const category = options.category ?? 'all'
  if (options.cursor) {
    const parsed = readFoodSearchCursor(options.cursor)
    const session = parsed ? foodSearchSessions.get(parsed.sessionId) : undefined
    if (!parsed || !session
      || session.query !== query
      || session.category !== category
      || session.mealType !== options.mealType) {
      throw new Error('検索条件が変更されたため、もう一度検索してください。')
    }
    const results = session.results.slice(parsed.offset, parsed.offset + limit)
    const nextOffset = parsed.offset + results.length
    const page: UnifiedFoodSearchPage = {
      results,
      normalizedQuery: session.normalizedQuery,
      nextCursor: nextOffset < session.results.length ? foodSearchCursor(session.id, nextOffset) : null,
    }
    if (options.log !== false) {
      try {
        const log = await db.searchLogs.get(session.logId)
        if (log) {
          const additions = searchLogItems(results, parsed.offset)
          const ranks = new Set(log.items.map((item) => item.rank))
          await db.searchLogs.put({
            ...log,
            resultCount: Math.max(log.resultCount, nextOffset),
            items: [...log.items, ...additions.filter((item) => !ranks.has(item.rank))].sort((left, right) => left.rank - right.rank),
          })
        }
      } catch { /* ログ保存失敗で追加表示を止めない。 */ }
    }
    return { page, logId: session.logId }
  }

  const usageAsOf = new Date().toISOString()
  const [foods, groups, aliases, relatedTerms, usageProfiles, favoriteIds] = await Promise.all([
    db.foods.toArray(), db.foodGroups.toArray(), db.foodAliases.toArray(), db.foodRelatedTerms.toArray(), getFoodUsageProfiles({ asOf: usageAsOf }), getFavoriteIds(),
  ])
  const usageStats = usageProfilesToLegacySearchStats(usageProfiles, usageAsOf)
  const rankedResults = searchUnifiedFoodResults(query, { foods, groups, aliases, relatedTerms, usageStats, favoriteIds }, {
    category,
    mealType: options.mealType,
    now: new Date(usageAsOf),
  })
  const sessionId = createId('food-search-session')
  const logId = createId('search')
  const pageResults = rankedResults.slice(0, limit)
  const normalizedQuery = normalizeSearchText(query)
  retainFoodSearchSession({
    id: sessionId,
    query,
    category,
    mealType: options.mealType,
    normalizedQuery,
    results: rankedResults,
    logId,
    createdAtMs: Date.now(),
  })
  const page: UnifiedFoodSearchPage = {
    results: pageResults,
    normalizedQuery,
    nextCursor: pageResults.length < rankedResults.length ? foodSearchCursor(sessionId, pageResults.length) : null,
  }
  const log: SearchLog = {
    id: logId, createdAt: new Date().toISOString(), query, normalizedQuery,
    resultCount: pageResults.length, processingMs: Math.max(0, performance.now() - startedAt),
    items: searchLogItems(pageResults, 0),
    selectedFoodGroupId: null, selectedFoodVariantId: null, selectedRank: null, selectionElapsedMs: null, unselected: false,
  }
  if (options.log !== false) {
    try { await db.searchLogs.put(log) } catch { /* ログ保存失敗で検索本体を止めない */ }
  }
  return { page, logId }
}

export async function recordFoodSelection(logId: string, groupId: string, foodId: string, rank: number): Promise<void> {
  try {
    await db.transaction('rw', db.searchLogs, async () => {
      const log = await db.searchLogs.get(logId)
      if (log) await db.searchLogs.put({ ...log, selectedFoodGroupId: groupId, selectedFoodVariantId: foodId, selectedRank: rank, selectionElapsedMs: Math.max(0, Date.now() - new Date(log.createdAt).getTime()), unselected: false })
    })
  } catch { /* ログは補助情報。選択自体の成功を妨げない。 */ }
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
export async function getAllFoodUsageStats(): Promise<FoodUsageStat[]> {
  const updatedAt = new Date().toISOString()
  return usageProfilesToLegacySearchStats(await getFoodUsageProfiles({ asOf: updatedAt }), updatedAt)
}
export async function getSearchLogs(): Promise<SearchLog[]> { return db.searchLogs.orderBy('createdAt').toArray() }

export async function getFoodById(id: string): Promise<Food | undefined> {
  return db.foods.get(id)
}

export async function getFoodByBarcode(barcode: string): Promise<Food | undefined> {
  const normalized = barcode.trim()
  if (!normalized) return undefined
  const matches = await db.foods.where('barcode').equals(normalized).toArray()
  // 旧形式ではJANの一意制約がないため、同じJANが複数ある場合は最新の端末内記録を使う。
  return matches.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0]
}

function mergeFoodForSave(food: Food, previous: Food | undefined): Food {
  return enrichFoodForSearch({
    ...previous,
    ...food,
    foodGroupId: food.foodGroupId ?? previous?.foodGroupId,
    displayName: food.displayName ?? previous?.displayName,
    officialName: food.officialName ?? previous?.officialName,
  })
}

/** 原本の明細は換算を持たないため、使用中の単位を失う食品変更を保存前に拒否する。 */
async function assertFoodReferenceUnits(food: Food): Promise<void> {
  const supportedUnits = new Set(getFoodQuantityUnits(food))
  const hasUnsupportedIngredient = (menu: Menu): boolean => (menu.ingredients ?? []).some((ingredient) => (
    ingredient.kind === 'food' && ingredient.itemId === food.id && !supportedUnits.has(ingredient.unit)
  ))
  const menu = await db.menus.filter(hasUnsupportedIngredient).first()
  if (menu) throw new Error(`入力用単位を変更する前に、Myメニュー「${menu.name}」の該当食材を基準単位などへ変更してください。`)
  const generalMenu = await db.generalMenus.filter(hasUnsupportedIngredient).first()
  if (generalMenu) throw new Error(`入力用単位を変更する前に、一般メニュー「${generalMenu.name}」の該当食材を基準単位などへ変更してください。`)
  const menuSet = await db.menuSets.filter((set) => (set.foodItems ?? []).some((item) => (
    item.foodId === food.id && !supportedUnits.has(item.unit)
  ))).first()
  if (menuSet) throw new Error(`入力用単位を変更する前に、Myセット「${menuSet.name}」の該当食品を基準単位などへ変更してください。`)
}

export async function saveFood(food: Food): Promise<void> {
  await db.transaction('rw', [db.foods, db.foodGroups, db.menus, db.generalMenus, db.menuSets], async () => {
    const previous = await db.foods.get(food.id)
    const enriched = mergeFoodForSave(food, previous)
    await assertFoodReferenceUnits(enriched)
    const existingGroup = await db.foodGroups.get(enriched.foodGroupId ?? '')
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
export async function saveFoodWithMetadata(food: Food, metadata: FoodMetadataUpdate, expectedInputHash?: string | null): Promise<void> {
  await db.transaction('rw', [db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.menus, db.generalMenus, db.menuSets], async () => {
    const previous = await db.foods.get(food.id)
    if (expectedInputHash !== undefined && (previous ? createEstimationInputHash(previous) : null) !== expectedInputHash) {
      throw new Error('食品情報が別の操作で変更されています。食品を読み直して再推計してください。')
    }
    const enriched = mergeFoodForSave(food, previous)
    const group = { ...metadata.group, defaultVariantId: metadata.group.defaultVariantId ?? enriched.id }
    await assertFoodReferenceUnits(enriched)
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

function createMenuSearchMatchers(normalizedQuery: string, ingredientFoods: (Food | undefined)[], aliases: FoodAlias[]) {
  const foodsById = new Map(ingredientFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food]))
  const aliasesByGroup = new Map<string, string[]>()
  for (const alias of aliases) {
    aliasesByGroup.set(alias.foodGroupId, [...(aliasesByGroup.get(alias.foodGroupId) ?? []), alias.alias])
  }
  const textMatches = (field: string) => normalizeSearchText(field).includes(normalizedQuery)
  const foodMatches = (foodId: string): boolean => {
    const food = foodsById.get(foodId)
    if (!food) return false
    return [
      food.displayName ?? food.name,
      food.officialName ?? food.name,
      food.maker,
      food.reading ?? '',
      ...(food.foodGroupId ? aliasesByGroup.get(food.foodGroupId) ?? [] : []),
    ].some(textMatches)
  }
  return { foodMatches, textMatches }
}

export async function searchMenus(query: string): Promise<Menu[]> {
  const normalized = normalizeSearchText(query)
  const menus = await db.menus.orderBy('name').toArray()
  if (!normalized) return menus
  const ingredientFoods = await db.foods.bulkGet([...new Set(menus.flatMap(getMenuFoodIds))])
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const aliases = await db.foodAliases.toArray()
  const { foodMatches, textMatches } = createMenuSearchMatchers(normalized, ingredientFoods, aliases)
  const menuMatches = (menu: Menu, visited: Set<string>): boolean => {
    if (visited.has(menu.id)) return false
    const nextVisited = new Set(visited).add(menu.id)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some(foodMatches)
      || getNestedMenuIds(menu).some((menuId) => {
        const nested = menusById.get(menuId)
        return nested ? menuMatches(nested, nextVisited) : false
      })
  }
  return menus.filter((menu) => menuMatches(menu, new Set()))
}

export async function searchMenuSets(query: string): Promise<MenuSet[]> {
  const normalized = normalizeSearchText(query)
  const sets = sortMenuSets(await db.menuSets.orderBy('name').toArray())
  if (!normalized) return sets
  const menus = await db.menus.toArray()
  const menuById = new Map(menus.map((menu) => [menu.id, menu]))
  const generalMenus = await db.generalMenus.toArray()
  const generalMenuById = new Map(generalMenus.map((menu) => [menu.id, menu]))
  const foodIds = [...new Set([
    ...sets.flatMap((set) => set.foodIds ?? []),
    ...sets.flatMap((set) => (set.foodItems ?? []).map((item) => item.foodId)),
    ...menus.flatMap(getMenuFoodIds),
    ...generalMenus.flatMap(getMenuFoodIds),
  ])]
  const ingredientFoods = await db.foods.bulkGet(foodIds)
  const aliases = await db.foodAliases.toArray()
  const { foodMatches, textMatches } = createMenuSearchMatchers(normalized, ingredientFoods, aliases)
  const menuMatches = (menuId: string, visited = new Set<string>()): boolean => {
    const menu = menuById.get(menuId)
    if (!menu || visited.has(menuId)) return false
    const nextVisited = new Set(visited).add(menuId)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some(foodMatches)
      || getNestedMenuIds(menu).some((nestedMenuId) => menuMatches(nestedMenuId, nextVisited))
  }
  const generalMenuMatches = (menuId: string, visited = new Set<string>()): boolean => {
    const menu = generalMenuById.get(menuId)
    if (!menu || visited.has(menuId)) return false
    const nextVisited = new Set(visited).add(menuId)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some(foodMatches)
      || getNestedMenuIds(menu).some((nestedMenuId) => menuMatches(nestedMenuId, nextVisited))
  }
  return sortMenuSets(sets.filter((set) => textMatches(set.name) || (set.foodIds ?? []).some(foodMatches)
    || (set.foodItems ?? []).some((item) => foodMatches(item.foodId))
    || set.menuIds.some((menuId) => menuMatches(menuId))
    || (set.generalMenuIds ?? []).some((menuId) => generalMenuMatches(menuId))))
}

export async function getAllMenus(): Promise<Menu[]> {
  return db.menus.orderBy('name').toArray()
}

export async function getGeneralMenu(id: string): Promise<GeneralMenu | undefined> {
  return db.generalMenus.get(id)
}

export async function searchGeneralMenus(query: string): Promise<GeneralMenu[]> {
  const normalized = normalizeSearchText(query)
  const menus = await db.generalMenus.orderBy('name').toArray()
  if (!normalized) return menus
  const myMenus = await db.menus.toArray()
  const menusById = new Map(myMenus.map((menu) => [menu.id, menu]))
  const ingredientFoods = await db.foods.bulkGet([...new Set([...menus.flatMap(getMenuFoodIds), ...myMenus.flatMap(getMenuFoodIds)])])
  const aliases = await db.foodAliases.toArray()
  const { foodMatches, textMatches } = createMenuSearchMatchers(normalized, ingredientFoods, aliases)
  const myMenuMatches = (menuId: string, visited = new Set<string>()): boolean => {
    const menu = menusById.get(menuId)
    if (!menu || visited.has(menuId)) return false
    const nextVisited = new Set(visited).add(menuId)
    return [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
      || getMenuFoodIds(menu).some(foodMatches)
      || getNestedMenuIds(menu).some((nestedMenuId) => myMenuMatches(nestedMenuId, nextVisited))
  }
  const menuMatches = (menu: GeneralMenu) => [menu.name, menu.category, ...(menu.aliases ?? [])].some(textMatches)
    || getMenuFoodIds(menu).some(foodMatches)
    || getNestedMenuIds(menu).some((menuId) => myMenuMatches(menuId))
  return menus.filter(menuMatches)
}

export async function getAllGeneralMenus(): Promise<GeneralMenu[]> {
  return db.generalMenus.orderBy('name').toArray()
}

export async function getAllMenuSets(): Promise<MenuSet[]> {
  return sortMenuSets(await db.menuSets.orderBy('name').toArray())
}

function isValidMenuSetSortOrder(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

/** 明示順を優先し、旧データや同順位は既存の名前順を維持する。 */
function sortMenuSets(menuSets: MenuSet[]): MenuSet[] {
  return menuSets
    .map((menuSet, index) => ({ menuSet, index }))
    .sort((left, right) => {
      const leftHasOrder = isValidMenuSetSortOrder(left.menuSet.sortOrder)
      const rightHasOrder = isValidMenuSetSortOrder(right.menuSet.sortOrder)
      if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1
      if (leftHasOrder && rightHasOrder && left.menuSet.sortOrder !== right.menuSet.sortOrder) {
        return (left.menuSet.sortOrder ?? 0) - (right.menuSet.sortOrder ?? 0)
      }
      return left.index - right.index
    })
    .map(({ menuSet }) => menuSet)
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

export async function saveGeneralMenu(menu: GeneralMenu): Promise<void> {
  await db.generalMenus.put(menu)
}

export async function deleteGeneralMenu(id: string): Promise<void> {
  await db.transaction('rw', [db.generalMenus, db.menuSets], async () => {
    await db.generalMenus.delete(id)
    const sets = await db.menuSets.toArray()
    const updatedAt = new Date().toISOString()
    await Promise.all(sets.filter((set) => (set.generalMenuIds ?? []).includes(id)).map((set) => db.menuSets.put({
      ...set,
      generalMenuIds: (set.generalMenuIds ?? []).filter((menuId) => menuId !== id),
      updatedAt,
    })))
  })
}

export async function deleteMenu(id: string): Promise<void> {
  await db.transaction('rw', [db.menus, db.generalMenus, db.menuSets], async () => {
    const referencedBy = (await db.menus.toArray()).filter((menu) => menu.id !== id && getNestedMenuIds(menu).includes(id))
    if (referencedBy.length > 0) throw new Error(`「${referencedBy[0].name}」の食材として使用されているため削除できません。`)
    const referencedByGeneralMenu = (await db.generalMenus.toArray()).find((menu) => getNestedMenuIds(menu).includes(id))
    if (referencedByGeneralMenu) throw new Error(`一般メニュー「${referencedByGeneralMenu.name}」の食材として使用されているため削除できません。`)
    await db.menus.delete(id)
    const sets = await db.menuSets.toArray()
    await Promise.all(sets.filter((set) => set.menuIds.includes(id)).map((set) => db.menuSets.put({ ...set, menuIds: set.menuIds.filter((menuId) => menuId !== id), updatedAt: new Date().toISOString() })))
  })
}

export async function saveMenuSet(menuSet: MenuSet): Promise<void> {
  await db.menuSets.put(menuSet)
}

/** 全Myセットを指定順へ一括更新する。対象が一致しない場合は書き込まない。 */
export async function reorderMenuSets(orderedMenuSetIds: string[]): Promise<void> {
  if (new Set(orderedMenuSetIds).size !== orderedMenuSetIds.length) throw new Error('並び順に重複したMyセットがあります。')
  await db.transaction('rw', db.menuSets, async () => {
    const menuSets = await db.menuSets.toArray()
    const currentIds = new Set(menuSets.map((menuSet) => menuSet.id))
    if (menuSets.length !== orderedMenuSetIds.length || orderedMenuSetIds.some((id) => !currentIds.has(id))) {
      throw new Error('Myセットが変更されたため、並び替えを再試行してください。')
    }
    const menuSetsById = new Map(menuSets.map((menuSet) => [menuSet.id, menuSet]))
    const reordered = orderedMenuSetIds.map((id, sortOrder) => {
      const menuSet = menuSetsById.get(id)
      if (!menuSet) throw new Error('並び替えるMyセットが見つかりません。')
      return { ...menuSet, sortOrder }
    })
    if (reordered.length > 0) await db.menuSets.bulkPut(reordered)
  })
}

export async function deleteMenuSet(id: string): Promise<void> {
  await db.menuSets.delete(id)
}

export async function getEntriesForDate(dateKey: string): Promise<MealEntry[]> {
  const start = new Date(`${dateKey}T00:00:00+09:00`).toISOString()
  const nextDate = new Date(`${dateKey}T00:00:00+09:00`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const end = nextDate.toISOString()
  return sortMealEntries(await db.mealEntries.where('eatenAt').between(start, end, true, false).toArray())
}

export async function getEntriesBetween(from: string, to: string): Promise<MealEntry[]> {
  const start = new Date(`${from}T00:00:00+09:00`).toISOString()
  const endDate = new Date(`${to}T00:00:00+09:00`)
  endDate.setUTCDate(endDate.getUTCDate() + 1)
  return sortMealEntries(await db.mealEntries.where('eatenAt').between(start, endDate.toISOString(), true, false).toArray())
}

export async function saveMealEntry(entry: MealEntry): Promise<void> {
  await saveMealEntries([entry])
}

export interface SaveNewDirectFoodMealOptions {
  entryPoint: MealUsageEntryPoint
  savedAt?: string
  search?: MealUsageSearchContext
}

async function saveMealEntriesInternal(
  entries: MealEntry[],
  directUsageByEntryId: ReadonlyMap<string, SaveNewDirectFoodMealOptions> = new Map(),
): Promise<MealEntry[]> {
  if (entries.length === 0) return []
  return db.transaction('rw', [db.mealEntries, db.searchLogs], async () => {
    const previousEntries = (await db.mealEntries.bulkGet(entries.map((entry) => entry.id)))
      .filter((entry): entry is MealEntry => Boolean(entry))
    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]))
    for (const entryId of directUsageByEntryId.keys()) {
      if (previousById.has(entryId)) throw new Error('利用実績は新規の食事記録にだけ追加できます。')
    }
    const latestEntry = await db.mealEntries.orderBy('registeredAt').last()
    let latestRegistrationMs = latestEntry?.registeredAt ? new Date(latestEntry.registeredAt).getTime() : -Infinity
    const now = Date.now()
    const registeredEntries = entries.map((entry): MealEntry => {
      const previous = previousById.get(entry.id)
      let registeredAt = previous ? withLegacyRegistrationTime(previous).registeredAt : entry.registeredAt
      if (registeredAt !== undefined && !isRegistrationTimestamp(registeredAt)) {
        throw new Error('食事記録の登録日時が不正です。食事履歴の入力内容を確認してください。')
      }
      if (registeredAt === undefined) {
        // 同時刻の登録や端末時計の巻き戻りでも、後から追加した項目を先頭にする。
        latestRegistrationMs = Math.max(now, latestRegistrationMs + 1)
        registeredAt = new Date(latestRegistrationMs).toISOString()
      } else {
        latestRegistrationMs = Math.max(latestRegistrationMs, new Date(registeredAt).getTime())
      }
      const directUsage = directUsageByEntryId.get(entry.id)
      const requestedSavedAt = directUsage?.savedAt ?? registeredAt
      const search = directUsage?.search
      if (directUsage && (
        !isRegistrationTimestamp(requestedSavedAt)
        || entry.menuSnapshot !== undefined
        || !['search', 'favorite', 'history', 'food-picker', 'other'].includes(directUsage.entryPoint)
        || (search !== undefined && (
          !search.logId || !search.foodGroupId || search.foodVariantId !== entry.foodId
          || !Number.isSafeInteger(search.rank) || search.rank < 1
        ))
      )) {
        throw new Error('直接食品の利用実績が不正です。')
      }
      const usageEvidence: MealUsageEvidence | undefined = previous?.usageEvidence ?? (directUsage ? {
        version: 1,
        kind: 'direct-food',
        savedAt: requestedSavedAt,
        entryPoint: directUsage.entryPoint,
        search: directUsage.search,
      } : undefined)
      // 通常の一括保存へコピーされた証跡は捨て、編集時だけ既存証跡を維持する。
      const entryWithoutUsageEvidence = { ...entry }
      delete entryWithoutUsageEvidence.usageEvidence
      const saved: MealEntry = { ...entryWithoutUsageEvidence, registeredAt, ...(usageEvidence ? { usageEvidence } : {}) }
      previousById.set(saved.id, saved)
      return saved
    })
    await db.mealEntries.bulkPut(registeredEntries)

    for (const saved of registeredEntries) {
      if (!directUsageByEntryId.has(saved.id)) continue
      const evidence = saved.usageEvidence
      const search = evidence?.search
      if (!search) continue
      const log = await db.searchLogs.get(search.logId)
      if (!log) continue
      await db.searchLogs.put({
        ...log,
        selectedFoodGroupId: search.foodGroupId,
        selectedFoodVariantId: search.foodVariantId,
        selectedRank: search.rank,
        selectionElapsedMs: Math.max(0, new Date(evidence.savedAt).getTime() - new Date(log.createdAt).getTime()),
        unselected: false,
        savedAt: evidence.savedAt,
      })
    }

    const affectedGroups = new Map<string, { dateKey: string; mealType: MealType }>()
    for (const entry of [...previousEntries, ...entries]) {
      const dateKey = formatDateKey(entry.eatenAt)
      affectedGroups.set(`${dateKey}\u0000${entry.mealType}`, { dateKey, mealType: entry.mealType })
    }
    for (const { dateKey, mealType } of affectedGroups.values()) {
      const dateEntries = await getEntriesForDate(dateKey)
      const group = sortMealEntryGroup(dateEntries.filter((entry) => entry.mealType === mealType))
      if (group.length > 0) await db.mealEntries.bulkPut(normalizeMealEntryOrder(group))
    }
    return registeredEntries
  })
}

export async function saveMealEntries(entries: MealEntry[]): Promise<void> {
  await saveMealEntriesInternal(entries)
}

/** 新規の直接食品と利用証跡を同一トランザクションで保存する。 */
export async function saveNewDirectFoodMealEntry(entry: MealEntry, options: SaveNewDirectFoodMealOptions): Promise<MealEntry> {
  const saved = await saveMealEntriesInternal([entry], new Map([[entry.id, options]]))
  const result = saved[0]
  if (!result) throw new Error('食事記録を保存できませんでした。')
  return result
}

export async function deleteMealEntry(id: string): Promise<void> {
  await db.transaction('rw', db.mealEntries, async () => {
    const entry = await db.mealEntries.get(id)
    if (!entry) return
    await db.mealEntries.delete(id)
    const remaining = (await getEntriesForDate(formatDateKey(entry.eatenAt))).filter((candidate) => candidate.mealType === entry.mealType)
    if (remaining.length > 0) await db.mealEntries.bulkPut(normalizeMealEntryOrder(sortMealEntryGroup(remaining)))
  })
}

export async function reorderMealEntries(dateKey: string, mealType: MealType, orderedEntryIds: string[]): Promise<void> {
  if (new Set(orderedEntryIds).size !== orderedEntryIds.length) throw new Error('並び順に重複した食事記録があります。')
  await db.transaction('rw', db.mealEntries, async () => {
    const group = (await getEntriesForDate(dateKey)).filter((entry) => entry.mealType === mealType)
    const currentIds = new Set(group.map((entry) => entry.id))
    if (group.length !== orderedEntryIds.length || orderedEntryIds.some((id) => !currentIds.has(id))) {
      throw new Error('食事記録が変更されたため、並び替えを再試行してください。')
    }
    const entriesById = new Map(group.map((entry) => [entry.id, entry]))
    const reordered = orderedEntryIds.map((id, sortOrder) => {
      const entry = entriesById.get(id)
      if (!entry) throw new Error('並び替える食事記録が見つかりません。')
      return { ...entry, sortOrder }
    })
    if (reordered.length > 0) await db.mealEntries.bulkPut(reordered)
  })
}

export async function getFavoriteIds(): Promise<Set<string>> {
  const records = await db.favorites.toArray()
  return new Set(records.map((record) => record.foodId))
}

export async function setFavorite(foodId: string, favorite: boolean): Promise<void> {
  await db.transaction('rw', [db.favorites, db.foods], async () => {
    if (!favorite) {
      await db.favorites.delete(foodId)
      return
    }
    const records = await db.favorites.toArray()
    if (records.some((record) => record.foodId === foodId)) return
    const existingFoods = await db.foods.bulkGet(records.map((record) => record.foodId))
    const foodNames = new Map(existingFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food.name]))
    const ordered = records
      .map((record) => ({ record, index: records.indexOf(record) }))
      .sort((left, right) => {
        const leftOrder = left.record.sortOrder
        const rightOrder = right.record.sortOrder
        if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) return leftOrder - rightOrder
        if (leftOrder !== undefined && rightOrder === undefined) return -1
        if (leftOrder === undefined && rightOrder !== undefined) return 1
        return (foodNames.get(left.record.foodId) ?? left.record.foodId).localeCompare(foodNames.get(right.record.foodId) ?? right.record.foodId, 'ja') || left.index - right.index
      })
      .map(({ record }) => record)
    const normalized = ordered.map((record, sortOrder) => ({ ...record, sortOrder }))
    normalized.push({ foodId, createdAt: new Date().toISOString(), sortOrder: normalized.length })
    if (normalized.length > 1) await db.favorites.bulkPut(normalized)
    else await db.favorites.put(normalized[0])
  })
}

export async function getFavoriteFoods(): Promise<Food[]> {
  const [records, foods] = await Promise.all([db.favorites.toArray(), getAllFoods()])
  const recordsByFoodId = new Map(records.map((record) => [record.foodId, record]))
  return foods
    .filter((food) => recordsByFoodId.has(food.id))
    .sort((left, right) => {
      const leftRecord = recordsByFoodId.get(left.id)
      const rightRecord = recordsByFoodId.get(right.id)
      const leftOrder = leftRecord?.sortOrder
      const rightOrder = rightRecord?.sortOrder
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) return leftOrder - rightOrder
      if (leftOrder !== undefined && rightOrder === undefined) return -1
      if (leftOrder === undefined && rightOrder !== undefined) return 1
      return left.name.localeCompare(right.name, 'ja') || left.id.localeCompare(right.id)
    })
}

/** 全お気に入りを検証してから、1トランザクションで0始まりの順序を保存する。 */
export async function reorderFavorites(orderedFoodIds: string[]): Promise<void> {
  if (new Set(orderedFoodIds).size !== orderedFoodIds.length) throw new Error('並び順に重複したお気に入りがあります。')
  await db.transaction('rw', db.favorites, async () => {
    const records = await db.favorites.toArray()
    const currentIds = new Set(records.map((record) => record.foodId))
    if (records.length !== orderedFoodIds.length || orderedFoodIds.some((id) => !currentIds.has(id))) {
      throw new Error('お気に入りが変更されたため、並び替えを再試行してください。')
    }
    const recordsByFoodId = new Map(records.map((record) => [record.foodId, record]))
    const reordered = orderedFoodIds.map((foodId, sortOrder) => {
      const record = recordsByFoodId.get(foodId)
      if (!record) throw new Error('並び替えるお気に入りが見つかりません。')
      return { ...record, sortOrder }
    })
    if (reordered.length > 0) await db.favorites.bulkPut(reordered)
  })
}

export async function getRecentFoods(limit = 20, mealType?: MealType): Promise<Food[]> {
  if (limit <= 0) return []
  const recent: Food[] = []
  const seen = new Set<string>()
  const batchSize = Math.max(20, limit * 2)
  let offset = 0
  while (recent.length < limit) {
    const entries = await db.mealEntries.orderBy('registeredAt').reverse().offset(offset).limit(batchSize).toArray()
    if (entries.length === 0) break
    offset += entries.length
    const ids = entries.filter((entry) => mealType === undefined || entry.mealType === mealType).map((entry) => entry.foodId).filter((id) => {
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
  return db.transaction('r', [db.foods, db.mealEntries, db.favorites, db.settings, db.menus, db.generalMenus, db.menuSets, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.searchLogs, db.estimationSettings, db.estimationRequests, db.estimationResults, db.estimationDecisions, db.weightRecords], async () => {
    const settings = await db.settings.get('app')
    if (!settings) throw new Error('設定を読み込めませんでした。')
    const [foods, mealEntries, favorites, foodGroups, foodAliases, foodRelatedTerms, foodUsageStats, searchLogs, menus, generalMenus, menuSets, estimationSettings, estimationRequests, estimationResults, estimationDecisions, weightRecords] = await Promise.all([
      db.foods.toArray(), db.mealEntries.toArray(), db.favorites.toArray(), db.foodGroups.toArray(), db.foodAliases.toArray(),
      db.foodRelatedTerms.toArray(), getAllFoodUsageStats(), db.searchLogs.toArray(), db.menus.toArray(), db.generalMenus.toArray(), db.menuSets.toArray(),
      db.estimationSettings.get('default'), db.estimationRequests.toArray(), db.estimationResults.toArray(), db.estimationDecisions.toArray(), db.weightRecords.toArray(),
    ])
    const exportSettings = { ...settings, dataFormatVersion: 4 as const }
    return {
      format: 'nutrition-pwa-backup',
      dataFormatVersion: 4,
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
      generalMenus,
      menuSets,
      weightRecords,
      settings: exportSettings,
      estimationDataFormatVersion: 1,
      estimationSettings,
      estimationRequests,
      estimationResults,
      estimationDecisions,
    }
  })
}

export interface ReplaceAllDataResult {
  committed: true
  searchMetadataReady: boolean
}

export async function replaceAllData(backup: BackupData): Promise<ReplaceAllDataResult> {
  // UI以外の呼び出しでも、不正なバックアップで既存データを消さない。
  const validatedBackup = validateBackup(backup)
  await db.transaction('rw', [db.foods, db.mealEntries, db.favorites, db.settings, db.metadata, db.menus, db.generalMenus, db.menuSets, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.searchLogs, db.estimationSettings, db.estimationRequests, db.estimationResults, db.estimationDecisions, db.weightRecords], async () => {
    await db.foods.clear()
    await db.mealEntries.clear()
    await db.favorites.clear()
    await db.settings.clear()
    await db.metadata.clear()
    await db.menus.clear()
    await db.generalMenus.clear()
    await db.menuSets.clear()
    await db.foodGroups.clear()
    await db.foodAliases.clear()
    await db.foodRelatedTerms.clear()
    await db.foodUsageStats.clear()
    await db.searchLogs.clear()
    await db.estimationSettings.clear()
    await db.estimationRequests.clear()
    await db.estimationResults.clear()
    await db.estimationDecisions.clear()
    await db.weightRecords.clear()
    if (validatedBackup.foods.length) await db.foods.bulkAdd(validatedBackup.foods)
    if (validatedBackup.mealEntries.length) await db.mealEntries.bulkAdd(normalizeMealEntryGroups(validatedBackup.mealEntries.map(withLegacyRegistrationTime)))
    if (validatedBackup.favorites.length) await db.favorites.bulkAdd(validatedBackup.favorites)
    if (validatedBackup.menus?.length) await db.menus.bulkAdd(validatedBackup.menus)
    if (validatedBackup.generalMenus?.length) await db.generalMenus.bulkAdd(validatedBackup.generalMenus)
    if (validatedBackup.menuSets?.length) await db.menuSets.bulkAdd(validatedBackup.menuSets)
    if (validatedBackup.foodGroups?.length) await db.foodGroups.bulkAdd(validatedBackup.foodGroups)
    if (validatedBackup.foodAliases?.length) await db.foodAliases.bulkAdd(validatedBackup.foodAliases)
    if (validatedBackup.foodRelatedTerms?.length) await db.foodRelatedTerms.bulkAdd(validatedBackup.foodRelatedTerms)
    // 復元回数や旧クリック統計は加算せず、食事のusageEvidenceから都度再構築する。
    if (validatedBackup.searchLogs?.length) await db.searchLogs.bulkAdd(validatedBackup.searchLogs)
    if (validatedBackup.estimationSettings) await db.estimationSettings.add(validatedBackup.estimationSettings)
    if (validatedBackup.estimationRequests?.length) await db.estimationRequests.bulkAdd(validatedBackup.estimationRequests)
    if (validatedBackup.estimationResults?.length) await db.estimationResults.bulkAdd(validatedBackup.estimationResults)
    if (validatedBackup.estimationDecisions?.length) await db.estimationDecisions.bulkAdd(validatedBackup.estimationDecisions)
    if (validatedBackup.weightRecords?.length) await db.weightRecords.bulkAdd(validatedBackup.weightRecords)
    await db.settings.put(validatedBackup.settings)
    await db.metadata.put({ key: 'schema-version', value: 11 })
    await db.metadata.put({ key: 'initial-foods-seeded', value: true })
    await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
    if (validatedBackup.foodAliases !== undefined && validatedBackup.foodRelatedTerms !== undefined) {
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

export function createNewGeneralMenuId(): string {
  return createId('general-menu')
}

export function createNewMenuSetId(): string {
  return createId('menu-set')
}
