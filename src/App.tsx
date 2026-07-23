import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  createNewFoodId,
  createNewFoodGroupId,
  createNewMealId,
  createNewMenuId,
  createNewMenuSetId,
  db,
  deleteFood,
  deleteMealEntry,
  deleteMenu,
  deleteMenuSet,
  exportBackup,
  getEntriesBetween,
  getEntriesForDate,
  getAllFoods,
  getAllMenus,
  getAllMenuSets,
  getAllFoodAliases,
  getAllFoodGroups,
  getAllFoodRelatedTerms,
  getFavoriteFoods,
  getFavoriteIds,
  getFoodByBarcode,
  getRecentFoods,
  getSettings,
  initializeDatabase,
  markSearchLogUnselected,
  replaceAllData,
  recordFoodSelection,
  reorderMealEntries,
  saveFoodWithMetadata,
  saveMealEntries,
  saveMenu,
  saveMenuSet,
  saveSettings,
  searchFoodResults,
  searchMenus,
  searchMenuSets,
  setFavorite,
} from './db/db'
import { EXTERNAL_UNNAMED_PRODUCT_LABEL, externalFoodErrorMessage, searchExternalFood, type ExternalFoodPreview } from './services/externalFoodApi'
import { backupToJson, downloadBlob, parseBackupText } from './services/backup'
import { mealsToCsv, parseMealsCsv } from './services/csv'
import { calculateBmi, calculateNutrients, estimateDailyGoals, formatGraphNutrient, formatNutrient, getFoodDefaultServing, getFoodQuantityUnits, goalRate, incrementByQuantityUnit, nutrientRangeForGoals, scaleNutritionGoals, sumAvailableNutrients, sumByMealType, sumEntries, sumNutrients } from './services/nutrition'
import { getMenuIngredients, menuToFood, menusWithUnsupportedIngredientUnits, wouldCreateMenuCycle } from './services/menuIngredients'
import {
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotNutrients,
  cloneMealMenuSnapshot,
  createMealFoodIngredientSnapshot,
  createMealMenuIngredientSnapshot,
  createMealMenuSnapshot,
} from './services/mealMenuSnapshots'
import { createMenuSetMealBatch } from './services/menuSetMeals'
import { normalizeMealEntryOrder, sortMealEntries, sortMealEntryGroup } from './services/mealEntryOrder'
import { buildDailyNutrientTrend } from './services/trend'
import { groupFoodsByKana, type FoodIndexGroupKey } from './services/foodIndex'
import {
  EMPTY_NUTRIENTS,
  FOOD_UNITS,
  MEAL_TYPES,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  MENU_CATEGORIES,
  DEFAULT_BODY_PROFILE,
  type FoodAttributePreference,
  type FoodAttributePreferences,
  type Food,
  type FoodAlias,
  type FoodAliasType,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodVariantAttributes,
  type FoodUnit,
  type BiologicalSex,
  type ActivityLevel,
  type BodyProfile,
  type MealEntry,
  type MealIngredientSnapshot,
  type MealMenuSnapshot,
  type MealTimeMode,
  type MealType,
  type Menu,
  type MenuCategory,
  type MenuIngredient,
  type MenuSet,
  type NutrientKey,
  type Nutrients,
  type NutritionGoals,
  type QuantityUnit,
} from './types'
import { applyConstrainedMextFoodAttributePreferences, applyConstrainedUserFoodSelectionPreferences, getFoodAttributePreferencesForGroup, setFoodAttributePreference } from './services/foodAttributePreferences'
import { normalizeSearchText, type FoodSearchResult } from './services/foodSearch'
import { resolveBarcodeCommercialFlag, resolveFoodGroupDisplayName, shouldFollowFoodName } from './services/foodDraft'
import {
  FOOD_MASTER_SEARCH_CATEGORIES,
  MEAL_SEARCH_CATEGORIES,
  foodSearchCategoryIncludesFoods,
  foodSearchCategoryIncludesMenus,
  type FoodSearchCategory,
} from './services/foodClassification'
import { filterVariantsBySelection, getAvailableVariantOptionValues, getVariantOptionGroups, getVariantSelection, reconcileVariantSelection, resolveVariantForSelection, variantOptionText, type VariantOptionGroup } from './services/foodVariants'
import {
  AmbiguousFoodVariant,
  getAvailableFoodAttributeValueIds,
  getDefaultSelectedAttributes,
  getFoodGroup as getMextFoodGroup,
  getFoodAttributeDisplayName,
  getFoodVariantBySourceId,
  getSelectableAttributes,
  hasFoodGroup as hasMextFoodGroup,
  MissingRequiredAttribute,
  FoodVariantNotFound,
  reconcileFoodAttributeSelection,
  resolveFoodVariantForUi,
} from './services/mextFoodData'
import {
  getAvailableUserSelectionValueIds,
  MissingRequiredUserSelection,
  reconcileUserFoodSelection,
  resolveFoodGroupId,
  searchUserFoodGroups,
  type UserFoodSearchResult,
} from './services/mextUserFoodData'
import { addDays, currentDateKey, currentMonthRange, formatDateKey, formatDateTime, formatFileTimestamp, isoFromTokyoTimeInput, toTokyoTimeInput, formatTime } from './utils/date'
import { isPositiveFinite, isValidBarcode, isValidQuantityUnit, isValidUnit } from './utils/validation'
import './styles.css'

const BarcodeScanner = lazy(() => import('./components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })))

type View = 'today' | 'meal-confirmation' | 'graphs' | 'food-screen' | 'food-form' | 'settings' | 'menus' | 'search-input' | 'search-results'
type FoodFormReturnView = 'food-screen' | 'settings'
type FoodFormOrigin = 'settings' | 'meal' | 'barcode'
type FoodScreenReturnView = 'today' | 'meal-confirmation' | 'settings'
type SearchPurpose = 'meal' | 'food-master'
type TrendRangeId = 'week' | 'month' | 'threeMonths' | 'year'

const TREND_RANGE_OPTIONS: Array<{ id: TrendRangeId; label: string; days: number }> = [
  { id: 'week', label: '1週間', days: 7 },
  { id: 'month', label: '1ヶ月', days: 30 },
  { id: 'threeMonths', label: '3ヶ月', days: 90 },
  { id: 'year', label: '1年', days: 365 },
]

const TREND_RANGE_DAYS: Record<TrendRangeId, number> = Object.fromEntries(
  TREND_RANGE_OPTIONS.map((option) => [option.id, option.days]),
) as Record<TrendRangeId, number>

interface SearchResultItem {
  id: string
  kind: 'user-food' | 'food' | 'menu' | 'set'
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

interface SearchResultGroup {
  query: string
  items: SearchResultItem[]
  searchLogId: string | null
  nextCursor: string | null
}

type MenuIngredientDraft = Omit<MenuIngredient, 'amount'> & { amount: string }

interface MenuDraft {
  id: string | null
  name: string
  category: MenuCategory
  ingredients: MenuIngredientDraft[]
  aliases: string[]
}

interface MenuSetDraft {
  id: string | null
  name: string
  menuIds: string[]
  foodIds: string[]
}

interface BodyProfileDraft {
  heightCm: string
  weightKg: string
  ageYears: string
  sex: BiologicalSex
  activityLevel: ActivityLevel
}

interface FoodDraft {
  id: string | null
  name: string
  maker: string
  barcode: string
  isCommercial: boolean
  source: Food['source']
  sourceVersion: string
  baseAmount: string
  baseUnit: FoodUnit
  inputUnit: string
  inputUnitBaseAmount: string
  servingAmount: string
  servingUnit: QuantityUnit
  menuIds: string[]
  foodGroupId: string
  groupDisplayName: string
  groupReading: string
  groupCategory: string
  aliases: Array<{ value: string; type: FoodAliasType }>
  relatedTerms: string[]
  variantAttributes: Record<keyof FoodVariantAttributes, string>
  nutrients: Record<NutrientKey, string>
}

interface VariantPickerState {
  query: string
  item: SearchResultItem
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
}

interface FoodVariantPickerState {
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
}

const ASSET_BASE_URL = import.meta.env.BASE_URL
const MEAL_ICON_ASSETS: Record<MealType, string> = {
  朝食: `${ASSET_BASE_URL}assets/meal-icon-breakfast.png`,
  昼食: `${ASSET_BASE_URL}assets/meal-icon-lunch.png`,
  夕食: `${ASSET_BASE_URL}assets/meal-icon-dinner.png`,
  間食: `${ASSET_BASE_URL}assets/meal-icon-snack.png`,
}
const SETTINGS_ICON_ASSET = `${ASSET_BASE_URL}assets/settings-icon.png`

const nutrientKeys = [...NUTRIENT_KEYS]
const emptyNutrientInputs = (): Record<NutrientKey, string> => Object.fromEntries(nutrientKeys.map((key) => [key, ''])) as Record<NutrientKey, string>
const variantAttributeKeys: Array<keyof FoodVariantAttributes> = ['species', 'part', 'variety', 'nameSpecification', 'cultivation', 'sourceBean', 'skin', 'preparation', 'processing']
const variantAttributeLabels: Record<keyof FoodVariantAttributes, string> = {
  species: '種類', part: '部位', variety: '品種・区分', nameSpecification: '名称仕様', cultivation: '栽培方法', sourceBean: '原料豆', skin: '皮の状態', preparation: '調理方法', processing: '加工状態',
}
const emptyVariantInputs = (): Record<keyof FoodVariantAttributes, string> => Object.fromEntries(variantAttributeKeys.map((key) => [key, ''])) as Record<keyof FoodVariantAttributes, string>

function emptyFoodDraft(barcode = '', initialName = ''): FoodDraft {
  return {
    id: null, name: initialName, maker: '', barcode, isCommercial: Boolean(barcode.trim()), source: 'user', sourceVersion: 'ユーザー入力',
    baseAmount: '100', baseUnit: 'g', inputUnit: '', inputUnitBaseAmount: '', servingAmount: '', servingUnit: 'g', menuIds: [], foodGroupId: '', groupDisplayName: initialName,
    groupReading: '', groupCategory: '', aliases: [], relatedTerms: [], variantAttributes: emptyVariantInputs(), nutrients: emptyNutrientInputs(),
  }
}

function bodyProfileToDraft(profile: BodyProfile | undefined): BodyProfileDraft {
  const current = profile ?? DEFAULT_BODY_PROFILE
  return {
    heightCm: current.heightCm === null ? '' : String(current.heightCm), weightKg: current.weightKg === null ? '' : String(current.weightKg),
    ageYears: current.ageYears === null ? '' : String(current.ageYears), sex: current.sex, activityLevel: current.activityLevel,
  }
}

function foodToDraft(food: Food, group: FoodGroup | undefined, aliases: FoodAlias[], relatedTerms: FoodRelatedTerm[]): FoodDraft {
  const conversion = food.inputUnitConversions?.[0]
  return {
    id: food.id, name: food.name, maker: food.maker, barcode: food.barcode, isCommercial: food.isCommercial === true, source: food.source,
    sourceVersion: food.sourceVersion, baseAmount: String(food.baseAmount), baseUnit: food.baseUnit,
    inputUnit: conversion?.unit ?? '', inputUnitBaseAmount: conversion ? String(conversion.baseAmount) : '',
    servingAmount: food.servingAmount === null ? '' : String(food.servingAmount), servingUnit: food.servingUnit ?? food.baseUnit,
    menuIds: food.menuIds ?? [], foodGroupId: group?.id ?? food.foodGroupId ?? '', groupDisplayName: group?.displayName ?? food.displayName ?? food.name,
    groupReading: group?.reading ?? food.reading ?? '', groupCategory: group?.category ?? '',
    aliases: aliases.filter((alias) => alias.isActive).map((alias) => ({ value: alias.alias, type: alias.aliasType })),
    relatedTerms: relatedTerms.filter((term) => term.isActive).map((term) => term.term),
    variantAttributes: Object.fromEntries(variantAttributeKeys.map((key) => [key, food.variantAttributes?.[key] ?? ''])) as Record<keyof FoodVariantAttributes, string>,
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, food.nutrients[key] === null ? '' : String(food.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function previewToDraft(preview: ExternalFoodPreview): FoodDraft {
  const initialName = preview.name === EXTERNAL_UNNAMED_PRODUCT_LABEL ? '' : preview.name
  return {
    ...emptyFoodDraft(preview.barcode, initialName), groupDisplayName: initialName, maker: preview.maker, source: 'open_food_facts',
    sourceVersion: 'Open Food Facts（取得値は確認後に保存）', baseAmount: String(preview.baseAmount), baseUnit: preview.baseUnit,
    servingAmount: '', servingUnit: preview.baseUnit, menuIds: [],
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, preview.nutrients[key] === null ? '' : String(preview.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function snapshotToFood(entry: MealEntry): Food {
  return {
    id: entry.foodId, name: entry.foodSnapshot.name, displayName: entry.foodSnapshot.displayName ?? entry.foodSnapshot.name, officialName: entry.foodSnapshot.officialName, maker: entry.foodSnapshot.maker, barcode: entry.foodSnapshot.barcode,
    source: 'user', sourceVersion: '食事記録スナップショット', baseAmount: entry.foodSnapshot.baseAmount,
    baseUnit: entry.foodSnapshot.baseUnit, servingAmount: null, servingUnit: null,
    inputUnitConversions: entry.foodSnapshot.inputUnitConversions?.map((conversion) => ({ ...conversion })), nutrients: entry.foodSnapshot.nutrients,
    createdAt: entry.eatenAt, updatedAt: entry.eatenAt,
  }
}

function menuSetPreviewFood(menuSet: MenuSet, menus: Menu[], foods: Food[]): Food {
  const menuNutrients = menuSet.menuIds.map((menuId) => menus.find((menu) => menu.id === menuId)).filter((menu): menu is Menu => Boolean(menu)).map((menu) => menuToFood(menu, menus, foods)).map((food) => food.nutrients)
  const foodNutrients = (menuSet.foodIds ?? []).map((foodId) => foods.find((food) => food.id === foodId)).filter((food): food is Food => Boolean(food)).map((food) => {
    const serving = getFoodDefaultServing(food)
    return calculateNutrients(food, serving.amount, serving.unit)
  })
  const nutrients = sumNutrients([...menuNutrients, ...foodNutrients])
  return {
    id: `menu-set:${menuSet.id}`, name: menuSet.name, maker: '', barcode: '', source: 'user', sourceVersion: 'メニューセット',
    baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients, createdAt: menuSet.createdAt, updatedAt: menuSet.updatedAt,
  }
}

function isoForDate(dateKey: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '12'
  return new Date(`${dateKey}T${get('hour')}:${get('minute')}:00+09:00`).toISOString()
}

function displayFoodName(food: Food): string {
  const name = food.displayName ?? food.name
  return food.maker ? `${name}（${food.maker}）` : name
}

function displaySearchFoodName(group: FoodGroup, food: Food): string {
  return food.maker ? `${group.displayName}（${food.maker}）` : group.displayName
}

function buildMextFoodSearchResult(
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

function selectedUserFoodLabel(result: UserFoodSearchResult): string | null {
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

function selectedUserFoodDimensionLabel(result: UserFoodSearchResult): string | null {
  for (const dimension of result.group.selectionDimensions) {
    if (dimension.values.some((value) => value.id === result.presetSelection[dimension.id])) return dimension.displayName
  }
  return null
}

function menuIngredientNames(menu: Menu, menus: Menu[], foods: Food[]): string {
  return getMenuIngredients(menu, foods)
    .map((ingredient) => ingredient.kind === 'food'
      ? foods.find((food) => food.id === ingredient.itemId)?.name
      : menus.find((candidate) => candidate.id === ingredient.itemId)?.name)
    .filter((name): name is string => Boolean(name))
    .join('、')
}

function App() {
  const [ready, setReady] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [view, setView] = useState<View>('today')
  const [selectedDate, setSelectedDate] = useState(currentDateKey())
  const [loadedDate, setLoadedDate] = useState<string | null>(null)
  const [graphRange, setGraphRange] = useState<TrendRangeId>('week')
  const [entries, setEntries] = useState<MealEntry[]>([])
  const [trendEntries, setTrendEntries] = useState<MealEntry[]>([])
  const [foods, setFoods] = useState<Food[]>([])
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [foodAliases, setFoodAliases] = useState<FoodAlias[]>([])
  const [foodRelatedTerms, setFoodRelatedTerms] = useState<FoodRelatedTerm[]>([])
  const [menus, setMenus] = useState<Menu[]>([])
  const [menuSets, setMenuSets] = useState<MenuSet[]>([])
  const [recentFoods, setRecentFoods] = useState<Food[]>([])
  const [favoriteFoods, setFavoriteFoods] = useState<Food[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [existingFoodIds, setExistingFoodIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null)
  const [searchBars, setSearchBars] = useState([''])
  const [searchResults, setSearchResults] = useState<SearchResultGroup[]>([])
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null)
  const [searchPurpose, setSearchPurpose] = useState<SearchPurpose>('meal')
  const [searchCategory, setSearchCategory] = useState<FoodSearchCategory>('all')
  const [searchingResults, setSearchingResults] = useState(false)
  const [variantPicker, setVariantPicker] = useState<VariantPickerState | null>(null)
  const [foodFormReturnView, setFoodFormReturnView] = useState<FoodFormReturnView>('settings')
  const [foodFormOrigin, setFoodFormOrigin] = useState<FoodFormOrigin>('settings')
  const [foodScreenReturnView, setFoodScreenReturnView] = useState<FoodScreenReturnView>('today')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [foodDraft, setFoodDraft] = useState<FoodDraft | null>(null)
  const [foodFormMealType, setFoodFormMealType] = useState<MealType | null>(null)
  const [foodFormSearchQuery, setFoodFormSearchQuery] = useState<string | null>(null)
  const [menuDraft, setMenuDraft] = useState<MenuDraft | null>(null)
  const [menuSetDraft, setMenuSetDraft] = useState<MenuSetDraft | null>(null)
  const [externalNote, setExternalNote] = useState<string | null>(null)
  const [mealFood, setMealFood] = useState<Food | null>(null)
  const [mealAmount, setMealAmount] = useState('')
  const [mealAmountUnit, setMealAmountUnit] = useState<QuantityUnit>('g')
  const [mealMenuSnapshot, setMealMenuSnapshot] = useState<MealMenuSnapshot | null>(null)
  const [mealType, setMealType] = useState<MealType>('朝食')
  const [recordingMealType, setRecordingMealType] = useState<MealType | null>(null)
  const [mealTypePicker, setMealTypePicker] = useState<{ food: Food | null } | null>(null)
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null)
  const [mealDetails, setMealDetails] = useState<{ type: MealType; entries: MealEntry[]; subtotal: Nutrients } | null>(null)
  const [confirmingMealType, setConfirmingMealType] = useState<MealType | null>(null)
  const [showTodayDetails, setShowTodayDetails] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [copyMealType, setCopyMealType] = useState<'すべて' | MealType>('すべて')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [goalInputs, setGoalInputs] = useState<Record<NutrientKey, string>>(emptyNutrientInputs())
  const [bodyProfileInputs, setBodyProfileInputs] = useState<BodyProfileDraft>(bodyProfileToDraft(DEFAULT_BODY_PROFILE))
  const [csvFrom, setCsvFrom] = useState(currentMonthRange().from)
  const [csvTo, setCsvTo] = useState(currentMonthRange().to)
  const [counts, setCounts] = useState({ foods: 0, meals: 0, menus: 0, menuSets: 0 })
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
  const selectedDateRef = useRef(selectedDate)
  const loadRequestIdRef = useRef(0)
  const searchRequestIdRef = useRef(0)
  const mealSaveInFlightRef = useRef(false)
  const menuSetRegistrationRef = useRef(false)

  const graphTo = currentDateKey()
  const graphFrom = addDays(graphTo, -(TREND_RANGE_DAYS[graphRange] - 1))

  const notify = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3500)
  }, [])

  const load = useCallback(async (): Promise<boolean> => {
    const requestId = ++loadRequestIdRef.current
    const requestedDate = selectedDateRef.current
    setLoadedDate(null)
    try {
      const trendEntriesPromise = graphFrom && graphTo && graphFrom <= graphTo ? getEntriesBetween(graphFrom, graphTo) : Promise.resolve([] as MealEntry[])
      const [dateEntries, rangeEntries, resultFoods, resultGroups, resultAliases, resultRelatedTerms, recent, favorites, ids, currentSettings, foodCount, mealCount, menuCount, menuSetCount, foodKeys, resultMenus, resultMenuSets] = await Promise.all([
        getEntriesForDate(requestedDate), trendEntriesPromise, getAllFoods(), getAllFoodGroups(), getAllFoodAliases(), getAllFoodRelatedTerms(), getRecentFoods(), getFavoriteFoods(), getFavoriteIds(),
        getSettings(), db.foods.count(), db.mealEntries.count(), db.menus.count(), db.menuSets.count(), db.foods.toCollection().primaryKeys(), getAllMenus(), getAllMenuSets(),
      ])
      if (requestId !== loadRequestIdRef.current || requestedDate !== selectedDateRef.current) return false
      setEntries(dateEntries)
      setTrendEntries(rangeEntries)
      setFoods(resultFoods)
      setFoodGroups(resultGroups)
      setFoodAliases(resultAliases)
      setFoodRelatedTerms(resultRelatedTerms)
      setMenus(resultMenus)
      setMenuSets(resultMenuSets)
      setRecentFoods(recent)
      setFavoriteFoods(favorites)
      setFavoriteIds(ids)
      setExistingFoodIds(new Set([...foodKeys, ...resultMenus.map((menu) => `menu:${menu.id}`), ...resultMenuSets.map((menuSet) => `menu-set:${menuSet.id}`)]))
      setSettings(currentSettings)
      setCounts({ foods: foodCount, meals: mealCount, menus: menuCount, menuSets: menuSetCount })
      setGoalInputs(Object.fromEntries(nutrientKeys.map((key) => [key, currentSettings.goals[key] === null ? '' : String(currentSettings.goals[key])])) as Record<NutrientKey, string>)
      setBodyProfileInputs(bodyProfileToDraft(currentSettings.bodyProfile))
      setLoadedDate(requestedDate)
      setError(null)
      return true
    } catch {
      if (requestId !== loadRequestIdRef.current || requestedDate !== selectedDateRef.current) return false
      setLoadedDate(null)
      setError('データを読み込めませんでした。ページを再読み込みして再試行してください。')
      return false
    }
  }, [graphFrom, graphTo])

  useEffect(() => {
    void initializeDatabase()
      .then(() => setReady(true))
      .catch(() => setInitializationError('端末内データベースを初期化できませんでした。端末の空き容量を確認して再読み込みしてください。'))
    const updateSW = registerSW({
      onNeedRefresh: () => setUpdateAvailable(true),
      onOfflineReady: () => notify('オフライン利用の準備ができました。'),
    })
    updateSWRef.current = updateSW
    return () => { updateSWRef.current = null }
  }, [notify])

  useEffect(() => { if (ready) void load() }, [load, ready, selectedDate])

  useEffect(() => {
    if (view === 'food-screen') window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [view])

  const modalOpen = Boolean(mealTypePicker || mealFood || mealDetails || showTodayDetails || menuDraft || menuSetDraft || showScanner || variantPicker)

  useEffect(() => {
    if (!modalOpen) return
    const body = document.body
    const documentElement = document.documentElement
    const previousBodyOverflow = body.style.overflow
    const previousDocumentOverflow = documentElement.style.overflow
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior
    const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior
    body.style.overflow = 'hidden'
    documentElement.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    documentElement.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousBodyOverflow
      documentElement.style.overflow = previousDocumentOverflow
      body.style.overscrollBehavior = previousBodyOverscrollBehavior
      documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior
    }
  }, [modalOpen])

  useEffect(() => {
    if (!mealTypePicker) return
    const closeOnBackdropTap = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.matches('.modal-backdrop[aria-label="食事を追加"]')) setMealTypePicker(null)
    }
    document.addEventListener('pointerdown', closeOnBackdropTap)
    return () => document.removeEventListener('pointerdown', closeOnBackdropTap)
  }, [mealTypePicker])

  const total = useMemo(() => sumEntries(entries), [entries])
  const subtotals = useMemo(() => sumByMealType(entries), [entries])
  const recordedMealTypes = useMemo(() => MEAL_TYPES.filter((type) => entries.some((entry) => entry.mealType === type)), [entries])

  const showError = (message: string) => { setError(message); setNotice(null) }

  const reloadAfterMutation = async (successMessage: string): Promise<boolean> => {
    const refreshed = await load()
    if (refreshed) notify(successMessage)
    else showError(`${successMessage}。画面を更新できなかったため、再読み込みしてください。`)
    return refreshed
  }

  const requireLoadedDate = (): boolean => {
    if (loadedDate === selectedDate) return true
    showError('選択日の食事データを読み込み中です。完了後に再試行してください。')
    return false
  }

  const selectDate = (date: string) => {
    if (!date || date === selectedDate) return
    selectedDateRef.current = date
    loadRequestIdRef.current += 1
    setLoadedDate(null)
    setEntries([])
    setSelectedDate(date)
  }

  const openMealForm = useCallback((food: Food, entry?: MealEntry, forcedMealType?: MealType) => {
    setMealFood(food)
    setEditingEntry(entry ?? null)
    const serving = entry ? { amount: entry.amount, unit: entry.amountUnit } : getFoodDefaultServing(food)
    setMealAmount(String(serving.amount))
    setMealAmountUnit(serving.unit)
    const sourceMenuId = !entry && food.id.startsWith('menu:') ? food.id.slice('menu:'.length) : null
    const sourceMenu = sourceMenuId ? menus.find((menu) => menu.id === sourceMenuId) : undefined
    setMealMenuSnapshot(entry?.menuSnapshot
      ? cloneMealMenuSnapshot(entry.menuSnapshot)
      : sourceMenu ? createMealMenuSnapshot(sourceMenu, menus, foods) : null)
    setMealType(forcedMealType ?? entry?.mealType ?? '朝食')
    setError(null)
  }, [foods, menus])

  const openMealTypePicker = () => {
    if (!requireLoadedDate()) return
    setMealTypePicker({ food: null })
  }

  const startCategoryRecord = (type: MealType, returnView: FoodScreenReturnView = 'today') => {
    if (!requireLoadedDate()) return
    if (returnView !== 'meal-confirmation') setConfirmingMealType(null)
    setRecordingMealType(type)
    setMealType(type)
    setFoodScreenReturnView(returnView)
    setCopyMealType(type)
    setMealTypePicker(null)
    setView('food-screen')
  }

  const chooseMealType = (type: MealType) => {
    const food = mealTypePicker?.food
    setMealTypePicker(null)
    if (food) {
      openMealForm(food, undefined, type)
      return
    }
    startCategoryRecord(type)
  }

  const handleFoodSelection = (food: Food) => {
    if (recordingMealType) {
      openMealForm(food, undefined, recordingMealType)
      return
    }
    if (searchPurpose === 'meal') openMealForm(food, undefined, mealType)
  }

  const openFoodForm = useCallback((food?: Food, barcode = '', returnView: FoodFormReturnView = 'settings', returnMealType: MealType | null = null, returnSearchQuery: string | null = null, initialName = '', origin: FoodFormOrigin = 'meal') => {
    setExternalNote(null)
    const group = food ? foodGroups.find((item) => item.id === food.foodGroupId) : undefined
    const aliases = group ? foodAliases.filter((alias) => alias.foodGroupId === group.id) : []
    const relatedTerms = group ? foodRelatedTerms.filter((term) => term.foodGroupId === group.id) : []
    setFoodDraft(food ? foodToDraft(food, group, aliases, relatedTerms) : emptyFoodDraft(barcode, initialName))
    setFoodFormMealType(returnMealType)
    setFoodFormSearchQuery(returnSearchQuery)
    setFoodFormReturnView(returnView)
    setFoodFormOrigin(origin)
    setView('food-form')
    setError(null)
  }, [foodAliases, foodGroups, foodRelatedTerms])

  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    const normalized = barcode.trim()
    setShowScanner(false)
    try {
      const local = await getFoodByBarcode(normalized)
      if (local) {
        if (recordingMealType) {
          openMealForm(local, undefined, recordingMealType)
        } else openFoodForm(local, '', 'food-screen', null, null, '', 'barcode')
        notify('端末内の食品を見つけました。分量を入力してください。')
        return
      }
      if (settings?.externalApiEnabled) {
        try {
          const preview = await searchExternalFood(normalized, settings.externalApiEndpoint)
          if (preview) {
            setExternalNote('Open Food Factsの取得値です。栄養成分表示と照合してから保存してください。')
            setFoodDraft(previewToDraft(preview))
            setFoodFormMealType(recordingMealType)
            setFoodFormSearchQuery(null)
            setFoodFormReturnView('food-screen')
            setFoodFormOrigin('barcode')
            setView('food-form')
            notify('外部商品情報を取得しました。内容を確認して保存してください。')
            return
          }
          notify('商品が見つかりませんでした。バーコードを保持して手入力登録へ進みます。')
        } catch (error) {
          notify(`${externalFoodErrorMessage(error)} バーコードを保持して手入力登録へ進みます。`)
        }
      }
      openFoodForm(undefined, normalized, 'food-screen', recordingMealType, null, '', 'barcode')
    } catch {
      showError('バーコード検索に失敗しました。番号を確認して再試行してください。')
    }
  }, [notify, openFoodForm, openMealForm, recordingMealType, settings])

  const saveFoodDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!foodDraft || !foodDraft.name.trim()) { showError('食品名を入力してください。'); return }
    const baseAmount = Number(foodDraft.baseAmount)
    if (!isPositiveFinite(baseAmount) || !isValidUnit(foodDraft.baseUnit)) { showError('基準量は正の数値で入力してください。'); return }
    if (foodDraft.barcode && !isValidBarcode(foodDraft.barcode)) { showError('バーコードは8〜14桁の数字で入力してください。'); return }
    const servingAmount = foodDraft.servingAmount.trim() ? Number(foodDraft.servingAmount) : null
    if (servingAmount !== null && !isPositiveFinite(servingAmount)) { showError('既定量は正の数値で入力してください。'); return }
    const inputUnit = foodDraft.inputUnit.trim()
    if (inputUnit && !isValidQuantityUnit(inputUnit)) { showError('入力用単位は空白のみ・制御文字・31文字以上を使用できません。'); return }
    const normalizedInputUnit = inputUnit === foodDraft.baseUnit ? '' : inputUnit
    const inputUnitBaseAmount = normalizedInputUnit ? Number(foodDraft.inputUnitBaseAmount) : null
    if (normalizedInputUnit && (!isPositiveFinite(inputUnitBaseAmount ?? Number.NaN) || inputUnitBaseAmount! > 100000)) { showError('1入力単位あたりの基準量は正の数値で入力してください。'); return }
    const inputUnitConversions = normalizedInputUnit ? [{ unit: normalizedInputUnit, baseAmount: inputUnitBaseAmount! }] : undefined
    const servingUnit = foodDraft.servingUnit.trim()
    if (servingAmount !== null && (!isValidQuantityUnit(servingUnit) || (servingUnit !== foodDraft.baseUnit && !inputUnitConversions?.some((conversion) => conversion.unit === servingUnit)))) {
      showError('既定の入力単位は基準単位、または登録済みの入力用単位を選択してください。'); return
    }
    const nutrients = Object.fromEntries(nutrientKeys.map((key) => {
      const raw = foodDraft.nutrients[key].trim()
      if (!raw) return [key, null]
      const value = Number(raw)
      return [key, Number.isFinite(value) && value >= 0 ? value : Number.NaN]
    })) as Nutrients
    if (Object.values(nutrients).some((value) => typeof value === 'number' && Number.isNaN(value))) {
      showError('栄養値は0以上の数値、または空欄で入力してください。'); return
    }
    try {
      if (foodDraft.barcode) {
        const duplicate = await getFoodByBarcode(foodDraft.barcode)
        if (duplicate && duplicate.id !== foodDraft.id) { showError('同じバーコードの食品が既にあります。食品管理から確認・編集してください。'); return }
      }
      const now = new Date().toISOString()
      const foodId = foodDraft.id ?? createNewFoodId()
      const groupId = foodDraft.foodGroupId.trim() || createNewFoodGroupId()
      const previousFoodName = foodDraft.id ? foods.find((item) => item.id === foodDraft.id)?.name ?? '' : ''
      const groupDisplayName = resolveFoodGroupDisplayName(foodDraft.groupDisplayName, foodDraft.name, previousFoodName)
      const existingGroup = foodGroups.find((group) => group.id === groupId)
      const isBundledMextGroup = hasMextFoodGroup(groupId)
      const variantAttributes = Object.fromEntries(variantAttributeKeys.map((key) => [key, foodDraft.variantAttributes[key].trim() || null])) as FoodVariantAttributes
      const food: Food = {
        id: foodId, name: foodDraft.name.trim(), officialName: foodDraft.name.trim(), displayName: groupDisplayName, maker: foodDraft.maker.trim(), barcode: foodDraft.barcode.trim(),
        isCommercial: resolveBarcodeCommercialFlag(foodDraft.isCommercial, foodDraft.barcode, foodFormOrigin === 'barcode'),
        source: foodDraft.source, sourceVersion: foodDraft.sourceVersion || 'ユーザー入力', baseAmount, baseUnit: foodDraft.baseUnit,
        servingAmount, servingUnit: servingAmount === null ? null : servingUnit, inputUnitConversions, menuIds: foodDraft.menuIds, foodGroupId: groupId, variantAttributes, nutrients,
        createdAt: foodDraft.id ? (foods.find((item) => item.id === foodDraft.id)?.createdAt ?? now) : now, updatedAt: now,
      }
      const foodsAfterSave = [...foods.filter((item) => item.id !== food.id), food]
      const incompatibleMenus = menusWithUnsupportedIngredientUnits(menus, foodsAfterSave)
        .filter((menu) => menu.ingredients?.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === food.id))
      if (incompatibleMenus.length > 0) {
        showError(`入力用単位を変更する前に、料理メニュー「${incompatibleMenus[0].name}」の該当食材を基準単位などへ変更してください。`)
        return
      }
      const group: FoodGroup = {
        id: groupId,
        displayName: isBundledMextGroup ? (existingGroup?.displayName ?? groupDisplayName) : groupDisplayName,
        reading: isBundledMextGroup ? (existingGroup?.reading ?? null) : (foodDraft.groupReading.trim() || null),
        category: isBundledMextGroup ? (existingGroup?.category ?? null) : (foodDraft.groupCategory.trim() || null),
        representativeScore: existingGroup?.representativeScore ?? 0, defaultVariantId: existingGroup?.defaultVariantId ?? foodId, isActive: true,
        metadataSource: isBundledMextGroup ? (existingGroup?.metadataSource ?? 'imported') : 'manual',
        generationVersion: isBundledMextGroup ? (existingGroup?.generationVersion ?? 'mext-app-v2') : 'manual-v1',
        needsReview: isBundledMextGroup ? (existingGroup?.needsReview ?? false) : false,
        createdAt: existingGroup?.createdAt ?? now, updatedAt: now,
      }
      const aliasValues = new Map<string, { value: string; type: FoodAliasType }>()
      for (const alias of foodDraft.aliases) {
        const value = alias.value.trim()
        const normalized = normalizeSearchText(value)
        if (value && normalized && !aliasValues.has(normalized)) aliasValues.set(normalized, { value, type: alias.type })
      }
      const existingBundledAliases = new Set(foodAliases
        .filter((alias) => alias.foodGroupId === groupId && alias.metadataSource !== 'manual')
        .map((alias) => alias.normalizedAlias))
      const aliases: FoodAlias[] = [...aliasValues.values()]
        .filter((alias) => !isBundledMextGroup || !existingBundledAliases.has(normalizeSearchText(alias.value)))
        .map((alias, index) => ({
        id: `manual:alias:${groupId}:${index}`, foodGroupId: groupId, foodVariantId: null, alias: alias.value, normalizedAlias: normalizeSearchText(alias.value),
        aliasType: alias.type, priority: 80, isActive: true, metadataSource: 'manual',
        }))
      const relatedValues = new Map<string, string>()
      for (const term of foodDraft.relatedTerms) {
        const value = term.trim()
        const normalized = normalizeSearchText(value)
        if (value && normalized && !relatedValues.has(normalized)) relatedValues.set(normalized, value)
      }
      const existingBundledRelatedTerms = new Set(foodRelatedTerms
        .filter((term) => term.foodGroupId === groupId && term.metadataSource !== 'manual')
        .map((term) => term.normalizedTerm))
      const related: FoodRelatedTerm[] = [...relatedValues.values()]
        .filter((term) => !isBundledMextGroup || !existingBundledRelatedTerms.has(normalizeSearchText(term)))
        .map((term) => ({
        id: `manual:related:${groupId}:${normalizeSearchText(term)}`, foodGroupId: groupId, term, normalizedTerm: normalizeSearchText(term), weight: 0.5, isActive: true, metadataSource: 'manual',
        }))
      const returnMealType = foodFormMealType
      const returnSearchQuery = foodFormSearchQuery
      await saveFoodWithMetadata(food, { group, aliases, relatedTerms: related })
      setFoodDraft(null)
      setFoodFormMealType(null)
      setFoodFormSearchQuery(null)
      if (returnMealType) {
        if (returnSearchQuery) {
          setPendingSearchQuery(returnSearchQuery)
          await searchFoodsAndMenus()
        }
        openMealForm(food, undefined, returnMealType)
        setView(returnSearchQuery ? 'search-results' : 'food-screen')
      } else setView(foodFormReturnView)
      await reloadAfterMutation(foodDraft.id ? '食品を更新しました。' : '食品を登録しました。')
    } catch {
      showError('食品を保存できませんでした。入力を確認して再試行してください。')
    }
  }

  const saveMealRecord = async (food: Food, amountText: string, amountUnit: QuantityUnit, entryToEdit: MealEntry | null = editingEntry, menuSnapshot: MealMenuSnapshot | null = null) => {
    if (!requireLoadedDate()) return false
    if (mealSaveInFlightRef.current) return false
    const targetDate = selectedDate
    const currentEntries = entries
    const amount = Number(amountText)
    if (!isPositiveFinite(amount) || amount > 100000) { showError('分量は0より大きく、現実的な範囲の数値で入力してください。'); return false }
    const snapshotIngredients = menuSnapshot?.ingredients ?? []
    const invalidIngredientAmount = (ingredients: MealIngredientSnapshot[]): boolean => ingredients.some((ingredient) => !isPositiveFinite(ingredient.amount) || ingredient.amount > 100000 || (ingredient.kind === 'menu' && invalidIngredientAmount(ingredient.ingredients)))
    const invalidIngredientUnit = (ingredients: MealIngredientSnapshot[]): boolean => ingredients.some((ingredient) => {
      if (ingredient.kind === 'menu') return ingredient.unit !== '食' || invalidIngredientUnit(ingredient.ingredients)
      if (ingredient.foodSnapshot.missing) return false
      return ![ingredient.foodSnapshot.baseUnit, ...(ingredient.foodSnapshot.inputUnitConversions ?? []).map((conversion) => conversion.unit)].includes(ingredient.unit)
    })
    if (menuSnapshot && invalidIngredientAmount(snapshotIngredients)) { showError('構成食材の分量は0より大きく100000以下で入力してください。'); return false }
    if (menuSnapshot && invalidIngredientUnit(snapshotIngredients)) { showError('構成食材の入力単位が換算設定と一致しません。単位を選び直してください。'); return false }
    if (!isValidQuantityUnit(amountUnit) || !getFoodQuantityUnits(food).includes(amountUnit)) { showError('入力単位が食品の換算設定と一致しません。食品を選び直してください。'); return false }
    const snapshotNutrients = menuSnapshot ? calculateMealMenuSnapshotNutrients(menuSnapshot) : food.nutrients
    const calculated = menuSnapshot
      ? calculateMealMenuEntryNutrients(menuSnapshot, amount, amountUnit)
      : calculateNutrients(food, amount, amountUnit)
    const currentMealTime = currentEntries.find((current) => current.mealType === mealType)?.eatenAt
    const eatenAt = entryToEdit
      ? (mealType === '間食' ? entryToEdit.eatenAt : (currentMealTime ?? entryToEdit.eatenAt))
      : isoForDate(targetDate)
    const entry: MealEntry = {
      id: entryToEdit?.id ?? createNewMealId(), eatenAt, mealType,
      foodId: food.id, foodSnapshot: {
        name: food.displayName ?? food.name, officialName: food.officialName, displayName: food.displayName, maker: food.maker, barcode: food.barcode, baseAmount: food.baseAmount,
        baseUnit: food.baseUnit, inputUnitConversions: food.inputUnitConversions?.map((conversion) => ({ ...conversion })), nutrients: { ...snapshotNutrients },
      }, amount, amountUnit, calculatedNutrients: calculated,
      ...(menuSnapshot ? { menuSnapshot: cloneMealMenuSnapshot(menuSnapshot) } : {}),
    }
    mealSaveInFlightRef.current = true
    try {
      const currentGroup = sortMealEntryGroup(currentEntries.filter((current) => current.mealType === mealType))
      const previousIndex = entryToEdit?.mealType === mealType
        ? currentGroup.findIndex((current) => current.id === entry.id)
        : -1
      const orderedGroup = currentGroup.filter((current) => current.id !== entry.id)
      orderedGroup.splice(previousIndex >= 0 ? Math.min(previousIndex, orderedGroup.length) : orderedGroup.length, 0, entry)
      const entriesToSave = normalizeMealEntryOrder(orderedGroup).map((current) => (
        mealType === '間食' ? current : { ...current, eatenAt }
      ))
      await saveMealEntries(entriesToSave)
      if (pendingSearchQuery) {
        setSearchResults((current) => current.filter((group) => group.query !== pendingSearchQuery))
        setPendingSearchQuery(null)
      }
      setMealFood(null)
      setEditingEntry(null)
      setMealMenuSnapshot(null)
      setRecordingMealType(null)
      const refreshed = await load()
      if (selectedDateRef.current !== targetDate) {
        notify(`${targetDate}の食事を保存しました。`)
        return true
      }
      if (!refreshed) {
        setConfirmingMealType(null)
        setView('today')
        showError('食事は保存しましたが、画面を更新できませんでした。再読み込みしてください。')
        return true
      }
      if (entryToEdit) {
        setConfirmingMealType(mealType)
        setView('meal-confirmation')
      } else {
        setConfirmingMealType(mealType)
        setView('meal-confirmation')
      }
      notify(entryToEdit ? '食事記録を更新しました。' : '食事を記録しました。')
      return true
    } catch {
      showError('食事を保存できませんでした。保存先の空き容量を確認して再試行してください。')
      return false
    } finally {
      mealSaveInFlightRef.current = false
    }
  }

  const saveMeal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mealFood) await saveMealRecord(mealFood, mealAmount, mealAmountUnit, editingEntry, mealMenuSnapshot)
  }

  const registerMenuSet = async (menuSet: MenuSet, returnSearchQuery: string | null = null) => {
    if (!requireLoadedDate()) return false
    if (menuSetRegistrationRef.current) return false
    menuSetRegistrationRef.current = true
    const targetDate = selectedDate
    const currentEntries = entries
    const targetMealType = recordingMealType ?? mealType
    try {
      const currentMealTime = currentEntries.find((entry) => entry.mealType === targetMealType)?.eatenAt
      const eatenAt = targetMealType === '間食' ? isoForDate(targetDate) : (currentMealTime ?? isoForDate(targetDate))
      const batch = createMenuSetMealBatch({
        menuSet, menus, foods, mealType: targetMealType, eatenAt, createId: createNewMealId,
      })
      const missingCount = batch.missingMenuIds.length + batch.missingFoodIds.length
      if (batch.entries.length === 0) {
        showError(`「${menuSet.name}」には登録できる料理メニュー・食品がありません。セット内容を確認してください。`)
        return false
      }
      const existingGroup = sortMealEntryGroup(currentEntries.filter((entry) => entry.mealType === targetMealType))
      const orderedGroup = normalizeMealEntryOrder([...existingGroup, ...batch.entries]).map((entry) => (
        targetMealType === '間食' ? entry : { ...entry, eatenAt }
      ))
      await saveMealEntries(orderedGroup)
      if (returnSearchQuery !== null) {
        setSearchResults((current) => current.filter((group) => group.query !== returnSearchQuery))
      }
      setPendingSearchQuery(null)
      setRecordingMealType(null)
      const refreshed = await load()
      if (selectedDateRef.current !== targetDate) {
        notify(`${targetDate}の${targetMealType}へ「${menuSet.name}」の内容${batch.entries.length}件を登録しました。`)
        return true
      }
      if (!refreshed) {
        setConfirmingMealType(null)
        setView('today')
        showError(`「${menuSet.name}」の内容は登録しましたが、画面を更新できませんでした。再読み込みしてください。`)
        return true
      }
      setConfirmingMealType(targetMealType)
      setView('meal-confirmation')
      notify(`「${menuSet.name}」の内容${batch.entries.length}件を${targetMealType}へ一括登録しました。${missingCount > 0 ? `削除済みの${missingCount}件は除外しました。` : ''}`)
      return true
    } catch {
      showError('メニューセットを一括登録できませんでした。保存先の空き容量を確認して再試行してください。')
      return false
    } finally {
      menuSetRegistrationRef.current = false
    }
  }

  const removeMeal = async (entry: MealEntry) => {
    if (!requireLoadedDate()) return
    if (!window.confirm(`「${entry.foodSnapshot.name}」の食事記録を削除しますか？`)) return
    try { await deleteMealEntry(entry.id); await reloadAfterMutation('食事記録を削除しました。') } catch { showError('食事記録を削除できませんでした。') }
  }

  const copyPreviousMeals = async () => {
    if (!requireLoadedDate()) return
    const targetDate = selectedDate
    try {
      const previous = await getEntriesForDate(addDays(targetDate, -1))
      const selected = copyMealType === 'すべて' ? previous : previous.filter((entry) => entry.mealType === copyMealType)
      if (!selected.length) { notify('コピーできる前日の食事がありません。'); return }
      if (selectedDateRef.current !== targetDate) { showError('日付が変更されたため、前日コピーを中止しました。'); return }
      if (!window.confirm(`${selected.length}件の前日の食事を${targetDate}へコピーしますか？`)) return
      const copiedAt = isoForDate(targetDate)
      const copiedEntries = MEAL_TYPES.flatMap((type) => {
        const copies = selected.filter((entry) => entry.mealType === type)
        if (copies.length === 0) return []
        const existingGroup = sortMealEntryGroup(entries.filter((entry) => entry.mealType === type))
        return normalizeMealEntryOrder([
          ...existingGroup,
          ...copies.map((entry) => ({ ...entry, id: createNewMealId(), eatenAt: copiedAt })),
        ])
      })
      await saveMealEntries(copiedEntries)
      await reloadAfterMutation(`${selected.length}件をコピーしました。`)
    } catch { showError('前日の食事をコピーできませんでした。') }
  }

  const toggleFavorite = async (food: Food) => {
    try { await setFavorite(food.id, !favoriteIds.has(food.id)); await reloadAfterMutation('お気に入りを更新しました。') } catch { showError('お気に入りを更新できませんでした。') }
  }

  const openMealDetails = (type: MealType, mealEntries: MealEntry[], subtotal: Nutrients) => {
    setMealDetails({ type, entries: mealEntries, subtotal })
  }

  const updateMealTimes = async (entryIds: string[], time: string) => {
    if (!requireLoadedDate()) return
    const targetDate = selectedDate
    const currentEntries = entries
    const eatenAt = isoFromTokyoTimeInput(targetDate, time)
    if (!eatenAt) { showError('食事時刻を正しく入力してください。'); return }
    const ids = new Set(entryIds)
    const updates = currentEntries.filter((entry) => ids.has(entry.id)).map((entry) => ({ ...entry, eatenAt }))
    if (updates.length === 0) return
    try {
      await saveMealEntries(updates)
      setMealDetails(null)
      await reloadAfterMutation('食事時刻を更新しました。')
    } catch {
      showError('食事時刻を保存できませんでした。')
    }
  }

  const reorderMealRecords = async (type: MealType, orderedEntryIds: string[]) => {
    if (!requireLoadedDate()) throw new Error('選択日の食事データを読み込み中です。')
    const targetDate = selectedDate
    const previousEntries = entries
    const currentGroup = entries.filter((entry) => entry.mealType === type)
    const currentById = new Map(currentGroup.map((entry) => [entry.id, entry]))
    if (currentGroup.length !== orderedEntryIds.length || orderedEntryIds.some((id) => !currentById.has(id))) {
      throw new Error('食事記録が変更されたため、並び替えを再試行してください。')
    }
    const reorderedGroup = orderedEntryIds.map((id, sortOrder) => ({ ...currentById.get(id)!, sortOrder }))
    setEntries(sortMealEntries([
      ...entries.filter((entry) => entry.mealType !== type),
      ...reorderedGroup,
    ]))
    try {
      await reorderMealEntries(targetDate, type, orderedEntryIds)
      notify('食事の並び順を更新しました。')
    } catch (caught) {
      setEntries(previousEntries)
      await load()
      showError(caught instanceof Error ? caught.message : '食事の並び順を更新できませんでした。')
      throw caught
    }
  }

  const saveGoals = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings) return
    const goals = Object.fromEntries(nutrientKeys.map((key) => {
      const raw = goalInputs[key].trim()
      return [key, raw ? Number(raw) : null]
    })) as Nutrients
    if (Object.values(goals).some((value) => value !== null && (!Number.isFinite(value) || value <= 0))) {
      showError('目標値は正の数値、または空欄で入力してください。'); return
    }
    try { const next = { ...settings, goals }; await saveSettings(next); setSettings(next); notify('目標値を保存しました。') } catch { showError('目標値を保存できませんでした。') }
  }

  const openSearchInput = (purpose: SearchPurpose = 'meal') => {
    searchRequestIdRef.current += 1
    setSearchBars([''])
    setSearchResults([])
    setPendingSearchQuery(null)
    setSearchPurpose(purpose)
    setSearchCategory('all')
    setSearchingResults(false)
    setView('search-input')
  }

  const searchFoodsAndMenus = async (category: FoodSearchCategory = searchCategory) => {
    const requestId = ++searchRequestIdRef.current
    const enteredQueries = searchBars.map((query) => query.trim()).filter(Boolean)
    const queries = enteredQueries.length > 0 ? enteredQueries : ['']
    setSearchingResults(true)
    try {
      const groups = await Promise.all(queries.map(async (query) => {
        const includeFoods = foodSearchCategoryIncludesFoods(category)
        const includeMenus = foodSearchCategoryIncludesMenus(category) && Boolean(query) && searchPurpose === 'meal'
        const [{ page, logId }, resultMenus, resultMenuSets] = await Promise.all([
          includeFoods
            ? searchFoodResults(query, { limit: 20, category })
            : Promise.resolve({ page: { results: [], normalizedQuery: normalizeSearchText(query), nextCursor: null }, logId: null }),
          includeMenus ? searchMenus(query) : Promise.resolve([]),
          includeMenus ? searchMenuSets(query) : Promise.resolve([]),
        ])
        const allUserResults = (category === 'all' || category === 'general') && query ? searchUserFoodGroups(query, { expandPartShortcuts: true }) : []
        const coveredFoodGroupIds = new Set(allUserResults.flatMap((result) => result.group.memberFoodGroupIds))
        const userItems: SearchResultItem[] = allUserResults.slice(0, 20).flatMap((result, index) => {
          const previewGroupId = result.foodGroupId ?? result.group.defaultFoodGroupId ?? result.group.memberFoodGroupIds[0]
          const preview = previewGroupId ? buildMextFoodSearchResult(previewGroupId, foods, foodGroups, result.score) : null
          if (!preview) return []
          const selectedLabel = selectedUserFoodLabel(result)
          return [{
            id: result.foodGroupId ? `${result.group.id}:${result.foodGroupId}` : result.group.id,
            kind: 'user-food' as const,
            title: selectedLabel ?? result.group.displayName,
            subtitle: selectedLabel
              ? `${result.group.displayName} > ${selectedUserFoodDimensionLabel(result) ?? '種類'} · ${result.group.category}`
              : `${result.group.category} · ${result.group.memberCount > 1 ? `${result.group.memberCount}種類` : `${preview.food.baseAmount}${preview.food.baseUnit}`}`,
            food: preview.food,
            group: preview.group,
            variants: preview.variants,
            score: result.score,
            matchedBy: 'user-food-group',
            recentlyUsed: false,
            searchLogId: logId,
            searchRank: index + 1,
            userFoodResult: result,
          }]
        })
        const items: SearchResultItem[] = [
          ...userItems,
          ...page.results.filter((result) => !coveredFoodGroupIds.has(result.group.id)).map((result, index) => ({ id: result.group.id, kind: 'food' as const, title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · ${formatNutrient(result.food.nutrients.energyKcal)}kcal`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: userItems.length + index + 1 })),
          ...resultMenus.map((menu) => ({ id: menu.id, kind: 'menu' as const, title: menu.name, subtitle: `メニュー · ${menu.category} · 食材: ${menuIngredientNames(menu, menus, foods) || '未登録'}`, food: menuToFood(menu, menus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })),
          ...resultMenuSets.map((menuSet) => ({ id: menuSet.id, kind: 'set' as const, title: menuSet.name, subtitle: `メニューセット · 内容${menuSet.menuIds.length + (menuSet.foodIds?.length ?? 0)}件を一括登録`, food: menuSetPreviewFood(menuSet, menus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })),
        ]
        return { query: query || '最近・お気に入り', items, searchLogId: logId, nextCursor: page.nextCursor }
      }))
      if (requestId !== searchRequestIdRef.current) return
      setSearchResults(groups)
      setView('search-results')
      setError(null)
    } catch {
      if (requestId === searchRequestIdRef.current) showError('検索に失敗しました。検索語句を確認して再試行してください。')
    } finally {
      if (requestId === searchRequestIdRef.current) setSearchingResults(false)
    }
  }

  const changeSearchCategory = (category: FoodSearchCategory) => {
    if (category === searchCategory) return
    for (const group of searchResults) if (group.searchLogId) void markSearchLogUnselected(group.searchLogId)
    setSearchCategory(category)
    setSearchResults([])
    void searchFoodsAndMenus(category)
  }

  const leaveSearchResults = () => {
    searchRequestIdRef.current += 1
    setSearchingResults(false)
    for (const group of searchResults) if (group.searchLogId) void markSearchLogUnselected(group.searchLogId)
    setView('search-input')
  }

  const loadMoreSearchResults = async (groupIndex: number) => {
    const group = searchResults[groupIndex]
    if (!group?.nextCursor || !foodSearchCategoryIncludesFoods(searchCategory)) return
    const requestId = searchRequestIdRef.current
    const requestedCategory = searchCategory
    try {
      const actualQuery = group.query === '最近・お気に入り' ? '' : group.query
      const { page, logId } = await searchFoodResults(actualQuery, { limit: 20, cursor: group.nextCursor, category: requestedCategory })
      if (requestId !== searchRequestIdRef.current) return
      const coveredFoodGroupIds = new Set(((requestedCategory === 'all' || requestedCategory === 'general') && actualQuery ? searchUserFoodGroups(actualQuery, { expandPartShortcuts: true }) : []).flatMap((result) => result.group.memberFoodGroupIds))
      const additionalItems: SearchResultItem[] = page.results.filter((result) => !coveredFoodGroupIds.has(result.group.id)).map((result, resultIndex) => ({
        id: result.group.id, kind: 'food', title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · ${formatNutrient(result.food.nutrients.energyKcal)}kcal`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: group.items.length + resultIndex + 1,
      }))
      setSearchResults((current) => current.map((item, index) => index === groupIndex ? { ...item, items: [...item.items, ...additionalItems], nextCursor: page.nextCursor } : item))
    } catch { showError('検索結果を追加で読み込めませんでした。') }
  }

  const selectSearchFood = (groupQuery: string, item: SearchResultItem, food: Food, amount?: string) => {
    if (item.searchLogId && item.group) void recordFoodSelection(item.searchLogId, food.foodGroupId ?? item.group.id, food.id, item.searchRank ?? 0)
    if (searchPurpose === 'food-master') {
      setPendingSearchQuery(null)
      openFoodForm(food, '', 'food-screen', null, null, '', 'settings')
      return
    }
    setPendingSearchQuery(groupQuery)
    openMealForm(food, undefined, recordingMealType ?? mealType)
    if (amount !== undefined) setMealAmount(amount)
  }

  const openUserFoodPicker = (groupQuery: string, item: SearchResultItem, userFoodResult: UserFoodSearchResult) => {
    setVariantPicker({ query: groupQuery, item, result: null, userFoodResult })
  }

  const openResolvedUserFoodGroup = (groupQuery: string, item: SearchResultItem, foodGroupId: string) => {
    const result = buildMextFoodSearchResult(foodGroupId, foods, foodGroups, item.score ?? 0)
    if (!result) {
      showError(`食品データを読み込めませんでした（${foodGroupId}）。`)
      return
    }
    if (result.variants.length > 1) {
      setVariantPicker({ query: groupQuery, item, result })
      return
    }
    selectSearchFood(groupQuery, item, result.food)
  }

  const handleSearchResultSelect = (groupQuery: string, item: SearchResultItem) => {
    if (item.kind === 'set') {
      const menuSet = menuSets.find((candidate) => candidate.id === item.id)
      if (!menuSet) {
        showError('メニューセットが見つかりません。メニュー画面で登録内容を確認してください。')
        return
      }
      void registerMenuSet(menuSet, groupQuery)
      return
    }
    if (item.kind === 'user-food' && item.userFoodResult) {
      if (item.userFoodResult.group.selectionDimensions.length > 0
        && Object.keys(item.userFoodResult.presetSelection).length === 0) {
        openUserFoodPicker(groupQuery, item, item.userFoodResult)
        return
      }
      try {
        const foodGroupId = item.userFoodResult.foodGroupId
          ?? resolveFoodGroupId(item.userFoodResult.group.id, item.userFoodResult.presetSelection)
        openResolvedUserFoodGroup(groupQuery, item, foodGroupId)
      } catch (error) {
        if (error instanceof MissingRequiredUserSelection) {
          openUserFoodPicker(groupQuery, item, item.userFoodResult)
          return
        }
        showError(error instanceof Error ? error.message : '食品の種類を決定できません。')
      }
      return
    }
    if (item.kind === 'food' && item.group && item.variants.length > 1) {
      setVariantPicker({ query: groupQuery, item, result: { group: item.group, food: item.food, variants: item.variants, score: item.score ?? 0, matchedBy: item.matchedBy ?? 'none', recentlyUsed: item.recentlyUsed, scoreBreakdown: { text: 0, representative: 0, personalFrequency: 0, recent: 0, total: item.score ?? 0 } } })
      return
    }
    selectSearchFood(groupQuery, item, item.food)
  }

  const saveBodyProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings) return
    const heightCm = bodyProfileInputs.heightCm.trim() ? Number(bodyProfileInputs.heightCm) : null
    const weightKg = bodyProfileInputs.weightKg.trim() ? Number(bodyProfileInputs.weightKg) : null
    const ageYears = bodyProfileInputs.ageYears.trim() ? Number(bodyProfileInputs.ageYears) : null
    if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 300)) { showError('身長は0より大きく300cm以下で入力してください。'); return }
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500)) { showError('体重は0より大きく500kg以下で入力してください。'); return }
    if (ageYears !== null && (!Number.isInteger(ageYears) || ageYears <= 0 || ageYears > 120)) { showError('年齢は1〜120歳の整数で入力してください。'); return }
    const bodyProfile: BodyProfile = { heightCm, weightKg, ageYears, sex: bodyProfileInputs.sex, activityLevel: bodyProfileInputs.activityLevel }
    const estimatedGoals = estimateDailyGoals(bodyProfile)
    const next = { ...settings, bodyProfile, goals: estimatedGoals ?? settings.goals }
    try {
      await saveSettings(next)
      setSettings(next)
      setGoalInputs(Object.fromEntries(nutrientKeys.map((key) => [key, next.goals[key] === null ? '' : String(next.goals[key])])) as Record<NutrientKey, string>)
      notify(estimatedGoals === null ? '身体情報を保存しました。算出に必要な項目を入力してください。' : 'エネルギー・たんぱく質などの参考目標を保存しました。')
    } catch {
      showError('身体情報を保存できませんでした。入力を確認して再試行してください。')
    }
  }

  const saveMenuDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!menuDraft || !menuDraft.name.trim()) { showError('メニュー名を入力してください。'); return }
    const ingredients = menuDraft.ingredients.map((ingredient) => ({ ...ingredient, amount: Number(ingredient.amount) }))
    if (ingredients.some((ingredient) => !isPositiveFinite(ingredient.amount) || ingredient.amount > 100000)) { showError('食材の分量は0より大きく100000以下で入力してください。'); return }
    if (ingredients.some((ingredient) => ingredient.kind === 'food' && foods.some((food) => food.id === ingredient.itemId) && !getFoodQuantityUnits(foods.find((food) => food.id === ingredient.itemId)!).includes(ingredient.unit))) { showError('食品の入力単位が現在の換算設定と一致しません。単位を選び直してください。'); return }
    if (ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.unit !== '食')) { showError('料理メニューの単位は「食」を選択してください。'); return }
    if (menuDraft.id && ingredients.some((ingredient) => ingredient.kind === 'menu' && wouldCreateMenuCycle(menuDraft.id, ingredient.itemId, menus))) { showError('料理メニューを循環して参照することはできません。'); return }
    const now = new Date().toISOString()
    const menu: Menu = {
      id: menuDraft.id ?? createNewMenuId(), name: menuDraft.name.trim(), category: menuDraft.category,
      foodIds: ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId), ingredients,
      aliases: [...new Set(menuDraft.aliases.map((alias) => alias.trim()).filter(Boolean))],
      createdAt: menuDraft.id ? (menus.find((item) => item.id === menuDraft.id)?.createdAt ?? now) : now, updatedAt: now,
    }
    try { await saveMenu(menu); setMenuDraft(null); await reloadAfterMutation(menuDraft.id ? 'メニューを更新しました。' : 'メニューを登録しました。') } catch { showError('メニューを保存できませんでした。') }
  }

  const saveMenuSetDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!menuSetDraft || !menuSetDraft.name.trim()) { showError('セット名を入力してください。'); return }
    const now = new Date().toISOString()
    const menuSet: MenuSet = {
      id: menuSetDraft.id ?? createNewMenuSetId(), name: menuSetDraft.name.trim(), menuIds: menuSetDraft.menuIds, foodIds: menuSetDraft.foodIds,
      createdAt: menuSetDraft.id ? (menuSets.find((item) => item.id === menuSetDraft.id)?.createdAt ?? now) : now, updatedAt: now,
    }
    try { await saveMenuSet(menuSet); setMenuSetDraft(null); await reloadAfterMutation(menuSetDraft.id ? 'メニューセットを更新しました。' : 'メニューセットを登録しました。') } catch { showError('メニューセットを保存できませんでした。') }
  }

  const removeMenu = async (menu: Menu) => {
    if (!window.confirm(`「${menu.name}」を削除しますか？`)) return
    try { await deleteMenu(menu.id); await reloadAfterMutation('メニューを削除しました。') } catch (error) { showError(error instanceof Error ? error.message : 'メニューを削除できませんでした。') }
  }

  const removeMenuSet = async (menuSet: MenuSet) => {
    if (!window.confirm(`「${menuSet.name}」を削除しますか？`)) return
    try { await deleteMenuSet(menuSet.id); await reloadAfterMutation('メニューセットを削除しました。') } catch { showError('メニューセットを削除できませんでした。') }
  }

  const toggleExternalApi = async (enabled: boolean) => {
    if (!settings) return
    const next = { ...settings, externalApiEnabled: enabled }
    try { await saveSettings(next); setSettings(next); notify(enabled ? '外部商品APIを有効にしました。' : '外部商品APIを無効にしました。') } catch { showError('外部商品APIの設定を保存できませんでした。') }
  }

  const changeDefaultMealTimeMode = async (mode: MealTimeMode) => {
    if (!settings) return
    const next = { ...settings, mealTimeMode: mode }
    try { await saveSettings(next); setSettings(next); notify(mode === 'auto' ? '食事時刻を自動挿入にしました。' : '食事時刻を自己申告にしました。記録後に区分詳細から入力できます。') } catch { showError('食事時刻の設定を保存できませんでした。') }
  }

  const saveFoodAttributePreference = async (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null): Promise<boolean> => {
    if (!settings) return false
    const next = { ...settings, foodAttributePreferences: setFoodAttributePreference(settings.foodAttributePreferences ?? {}, foodGroupId, attributeId, preference) }
    try {
      await saveSettings(next)
      setSettings(next)
      notify(preference ? '食品属性の設定を保存しました。' : '食品属性の設定を解除しました。')
      return true
    } catch {
      showError('食品属性の設定を保存できませんでした。')
      return false
    }
  }

  const exportJson = async () => {
    let backup: Awaited<ReturnType<typeof exportBackup>>
    try {
      backup = await exportBackup()
      downloadBlob(backupToJson(backup), `nutrition-backup-${formatFileTimestamp(new Date(backup.exportedAt))}.json`, 'application/json')
    } catch { showError('JSONバックアップを作成できませんでした。'); return }
    const next = settings ? { ...settings, lastBackupAt: backup.exportedAt } : null
    try {
      if (next) { await saveSettings(next); setSettings(next) }
      notify('JSONバックアップを出力しました。')
    } catch {
      showError('JSONバックアップは出力しましたが、最終バックアップ日時を保存できませんでした。')
    }
  }

  const restoreJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const backup = parseBackupText(await file.text())
      if (!window.confirm('現在のデータを自動退避してから、バックアップで全置換します。続けますか？')) return
      const current = await exportBackup()
      downloadBlob(backupToJson(current), `nutrition-auto-backup-${formatFileTimestamp(new Date(current.exportedAt))}.json`, 'application/json')
      const result = await replaceAllData(backup)
      const refreshed = await load()
      const summary = `食品${backup.foods.length}件、食事${backup.mealEntries.length}件、メニュー${backup.menus?.length ?? 0}件、セット${backup.menuSets?.length ?? 0}件`
      if (!refreshed) {
        showError(`復元は完了しました（${summary}）。画面を再読み込みしてください。`)
      } else if (!result.searchMetadataReady) {
        showError(`復元は完了しました（${summary}）。検索データの更新に失敗したため、アプリを再起動してください。`)
      } else {
        notify(`復元しました。${summary}です。自動退避も出力しました。`)
      }
    } catch (caught) { showError(caught instanceof Error ? caught.message : 'JSONを復元できませんでした。現在のデータは変更していません。') }
  }

  const exportCsv = async () => {
    if (!csvFrom || !csvTo || csvFrom > csvTo) { showError('CSVの期間を正しく指定してください。'); return }
    try {
      const selected = await getEntriesBetween(csvFrom, csvTo)
      downloadBlob(mealsToCsv(selected), `nutrition-meals-${csvFrom}-${csvTo}.csv`, 'text/csv;charset=utf-8')
      notify(`${selected.length}件の食事記録をCSV出力しました。`)
    } catch { showError('CSVを出力できませんでした。') }
  }

  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = parseMealsCsv(await file.text())
      if (imported.length === 0) { showError('CSVに食事記録がありません。'); return }
      const existing = await db.mealEntries.bulkGet(imported.map((entry) => entry.id))
      const overwriteCount = existing.filter((entry): entry is MealEntry => Boolean(entry)).length
      const overwriteNotice = overwriteCount > 0 ? `同じIDの${overwriteCount}件は上書きされます。` : ''
      if (!window.confirm(`${imported.length}件の食事履歴を取り込みます。${overwriteNotice}\n続けますか？`)) return
      await saveMealEntries(imported)
      await reloadAfterMutation(`${imported.length}件の食事履歴を取り込みました。`)
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'CSVを取り込めませんでした。既存データは変更していません。')
    }
  }

  const removeFood = async (food: Food) => {
    if (!window.confirm(`「${displayFoodName(food)}」を食品マスターから削除しますか？食事履歴は残ります。`)) return
    try { await deleteFood(food.id); await reloadAfterMutation('食品を削除しました。食事履歴はスナップショットで残っています。') } catch { showError('食品を削除できませんでした。') }
  }

  if (initializationError) return <div className="loading-screen loading-error"><div className="brand-mark">N</div><p>{initializationError}</p><button className="button primary" type="button" onClick={() => window.location.reload()}>再読み込み</button></div>
  if (!ready || !settings) return <div className="loading-screen"><div className="brand-mark">N</div><p>Nutritionを準備しています…</p></div>

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-status"><span className="offline-dot" />端末内保存</div>
      </header>

      {updateAvailable && <div className="update-banner"><span>新しいバージョンがあります。</span><button type="button" onClick={() => void updateSWRef.current?.(true)}>更新する</button><button type="button" className="close-text" onClick={() => setUpdateAvailable(false)}>後で</button></div>}
      {notice && <div className="toast success" role="status">{notice}</div>}
      {error && <div className="toast error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="閉じる">×</button></div>}

      <main className="content">
        {view === 'today' && <TodayView
          selectedDate={selectedDate} setSelectedDate={selectDate} total={total} goals={settings.goals} entries={entries} subtotals={subtotals}
          existingFoodIds={existingFoodIds}
          onOpenMealConfirmation={(type) => { if (!requireLoadedDate()) return; setConfirmingMealType(type); setRecordingMealType(null); setView('meal-confirmation') }}
          onShowMealDetails={openMealDetails} onShowTodayDetails={() => setShowTodayDetails(true)}
        />}
        {view === 'meal-confirmation' && confirmingMealType && <MealConfirmationView
          type={confirmingMealType}
          entries={entries.filter((entry) => entry.mealType === confirmingMealType)}
          subtotal={subtotals[confirmingMealType] ?? EMPTY_NUTRIENTS}
          onAdd={() => startCategoryRecord(confirmingMealType, 'meal-confirmation')}
          onEdit={(entry) => openMealForm(snapshotToFood(entry), entry)}
          onDelete={removeMeal}
          onReorder={(orderedEntryIds) => reorderMealRecords(confirmingMealType, orderedEntryIds)}
          onDone={() => { setConfirmingMealType(null); setView('today') }}
        />}
        {view === 'graphs' && <GraphsView entries={trendEntries} range={graphRange} onRangeChange={setGraphRange} goals={settings.goals} />}
        {view === 'food-screen' && <FoodsView recordingMealType={recordingMealType} foods={foods} foodGroups={foodGroups} menus={menus} menuSets={menuSets} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onSelectFood={handleFoodSelection} onSelectMenuSet={(menuSet) => void registerMenuSet(menuSet)} onToggleFavorite={toggleFavorite} onEditFood={(food) => openFoodForm(food, '', 'food-screen', null, null, '', foodScreenReturnView === 'settings' ? 'settings' : 'meal')} onDeleteFood={removeFood} onOpenSearch={() => openSearchInput(recordingMealType ? 'meal' : 'food-master')} onOpenScanner={() => setShowScanner(true)} onBack={() => { setRecordingMealType(null); setView(foodScreenReturnView) }} backLabel={foodScreenReturnView === 'settings' ? '← 設定' : '← 記録'} copyMealType={copyMealType} setCopyMealType={setCopyMealType} onCopyPrevious={copyPreviousMeals} />}
        {view === 'food-form' && foodDraft && <FoodFormView draft={foodDraft} returnView={foodFormReturnView} allowCommercialClassification={foodFormOrigin === 'settings'} setDraft={setFoodDraft} foodGroups={foodGroups} foodAliases={foodAliases} foodRelatedTerms={foodRelatedTerms} externalNote={externalNote} onSubmit={saveFoodDraft} onClose={() => { setFoodDraft(null); setFoodFormMealType(null); setFoodFormSearchQuery(null); setView(foodFormReturnView) }} />}
        {view === 'settings' && <><SettingsView settings={settings} goalInputs={goalInputs} setGoalInputs={setGoalInputs} onSaveGoals={saveGoals} onToggleExternalApi={toggleExternalApi} onChangeDefaultMealTimeMode={changeDefaultMealTimeMode} onExportJson={exportJson} onRestoreJson={restoreJson} onExportCsv={exportCsv} onImportCsv={importCsv} csvFrom={csvFrom} csvTo={csvTo} setCsvFrom={setCsvFrom} setCsvTo={setCsvTo} counts={counts} /><SettingsExtras bodyProfileInputs={bodyProfileInputs} setBodyProfileInputs={setBodyProfileInputs} onSaveBodyProfile={saveBodyProfile} onOpenNewFood={() => openFoodForm(undefined, '', 'settings', null, null, '', 'settings')} onOpenFoodMaster={() => { setRecordingMealType(null); setFoodScreenReturnView('settings'); setView('food-screen') }} estimatedGoals={estimateDailyGoals(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} bmi={calculateBmi(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} /></>}
        {view === 'menus' && <MenuView menus={menus} menuSets={menuSets} foods={foods} onNewMenu={() => setMenuDraft({ id: null, name: '', category: '主菜', ingredients: [], aliases: [] })} onEditMenu={(menu) => setMenuDraft({ id: menu.id, name: menu.name, category: menu.category, ingredients: getMenuIngredients(menu, foods).map((ingredient) => ({ ...ingredient, amount: String(ingredient.amount) })), aliases: menu.aliases ?? [] })} onDeleteMenu={removeMenu} onNewMenuSet={() => setMenuSetDraft({ id: null, name: '', menuIds: [], foodIds: [] })} onEditMenuSet={(menuSet) => setMenuSetDraft({ id: menuSet.id, name: menuSet.name, menuIds: menuSet.menuIds, foodIds: menuSet.foodIds ?? [] })} onDeleteMenuSet={removeMenuSet} onBack={() => setView('today')} />}
        {view === 'search-input' && <SearchInputView bars={searchBars} setBars={setSearchBars} onSearch={() => void searchFoodsAndMenus()} onBack={() => setView('food-screen')} />}
        {view === 'search-results' && <SearchResultsView groups={searchResults} purpose={searchPurpose} category={searchCategory} searching={searchingResults} onCategoryChange={changeSearchCategory} onSelect={handleSearchResultSelect} onAddFood={(query) => openFoodForm(undefined, '', 'food-screen', searchPurpose === 'meal' ? (recordingMealType ?? mealType) : null, searchPurpose === 'meal' ? (query || null) : null, query, searchPurpose === 'food-master' ? 'settings' : 'meal')} onLoadMore={(index) => void loadMoreSearchResults(index)} onBack={leaveSearchResults} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavButton active={view === 'today' || view === 'meal-confirmation'} onClick={() => { selectDate(currentDateKey()); setRecordingMealType(null); setConfirmingMealType(null); setView('today') }} icon="◷" iconClass="today-icon" label="記録" />
        <NavButton active={view === 'graphs'} onClick={() => { setRecordingMealType(null); setView('graphs') }} icon="↗" iconClass="graphs-icon" label="グラフ" />
        <NavButton active={view === 'menus'} onClick={() => { setRecordingMealType(null); setView('menus') }} icon="menu-grid" iconClass="menu-grid-icon" label="メニュー" />
        <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="settings" iconClass="settings-icon" label="設定" />
      </nav>

      {view === 'today' && <button className="floating-add" type="button" onClick={openMealTypePicker} aria-label="食事を追加">＋</button>}

      {mealTypePicker && <MealTypePickerModal food={mealTypePicker.food} recordedMealTypes={recordedMealTypes} onSelect={chooseMealType} />}
      {variantPicker && <FoodVariantPickerModal result={variantPicker.result} userFoodResult={variantPicker.userFoodResult} foods={foods} foodGroups={foodGroups} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} mealMode={searchPurpose === 'meal'} onSubmitMeal={async (food, amount, amountUnit) => { if (await saveMealRecord(food, amount, amountUnit)) setVariantPicker(null) }} onSelect={(food) => { setVariantPicker(null); selectSearchFood(variantPicker.query, variantPicker.item, food) }} onClose={() => setVariantPicker(null)} />}
      {mealFood && <MealModal food={mealFood} amount={mealAmount} setAmount={setMealAmount} amountUnit={mealAmountUnit} setAmountUnit={setMealAmountUnit} menuSnapshot={mealMenuSnapshot} setMenuSnapshot={setMealMenuSnapshot} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} editing={Boolean(editingEntry)} onSubmit={saveMeal} onClose={() => { setMealFood(null); setEditingEntry(null); setMealMenuSnapshot(null) }} />}
      {mealDetails && <MealDetailsModal details={mealDetails} goals={scaleNutritionGoals(settings.goals, 1 / 3)} onUpdateTimes={updateMealTimes} onClose={() => setMealDetails(null)} />}
      {showTodayDetails && <TodayDetailsModal total={total} goals={settings.goals} entries={entries} onClose={() => setShowTodayDetails(false)} />}
      {menuDraft && <MenuEditorModal draft={menuDraft} setDraft={setMenuDraft} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveMenuDraft} onClose={() => setMenuDraft(null)} />}
      {menuSetDraft && <MenuSetEditorModal draft={menuSetDraft} setDraft={setMenuSetDraft} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveMenuSetDraft} onClose={() => setMenuSetDraft(null)} />}
      {showScanner && <Suspense fallback={<div className="modal-backdrop"><section className="modal-card"><p>バーコード画面を準備しています…</p></section></div>}><BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setShowScanner(false)} /></Suspense>}
    </div>
  )
}

interface NavButtonProps { active: boolean; onClick: () => void; icon: string; iconClass?: string; label: string }
function NavButton({ active, onClick, icon, iconClass, label }: NavButtonProps) {
  return <button type="button" className={`nav-item${active ? ' active' : ''}`} onClick={onClick}><span className={iconClass}>{icon === 'menu-grid' ? <span className="menu-grid-table" aria-hidden="true"><i /><i /><i /><i /></span> : icon === 'settings' ? <span className="settings-nav-icon" style={{ '--settings-icon-image': `url(${SETTINGS_ICON_ASSET})` } as React.CSSProperties} aria-hidden="true" /> : icon}</span>{label}</button>
}

function InfoPopover({ label, text, className = '' }: { label: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target
      if (target instanceof Node && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('focusin', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('focusin', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div ref={popoverRef} className={`info-popover${className ? ` ${className}` : ''}`}><button type="button" className="info-button" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)}>i</button>{open && <p role="tooltip">{text}</p>}</div>
}

interface GoalSegment { type: MealType; value: number }

function mealTone(type: MealType): string {
  return ({ 朝食: 'breakfast', 昼食: 'lunch', 夕食: 'dinner', 間食: 'snack' })[type]
}

function GoalProgressBar({ label, value, availableValue = value, goal, unit, range, colorClass = 'goal-progress-accent', segments, dark = false, targetPositionPercent = 50 }: { label: string; value: number | null; availableValue?: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; colorClass?: string; segments?: GoalSegment[]; dark?: boolean; targetPositionPercent?: number }) {
  const rate = goalRate(value, goal)
  const hasGoal = goal !== null && goal > 0
  const normalizedTargetPosition = Math.min(95, Math.max(5, targetPositionPercent))
  const graphMax = hasGoal ? Math.max(goal / (normalizedTargetPosition / 100), 1) : Math.max(availableValue ?? 0, 1)
  const progressWidth = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / graphMax) * 100))
  const rangeLeft = hasGoal ? Math.min(100, Math.max(0, ((range.min ?? 0) / graphMax) * 100)) : 0
  const rangeRight = hasGoal ? Math.min(100, Math.max(rangeLeft, ((range.max ?? graphMax) / graphMax) * 100)) : 0
  const targetPosition = hasGoal ? normalizedTargetPosition : null
  const segmentTotal = segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0
  const status = value === null || rate === null ? 'unknown' : range.max !== null && value > range.max ? 'outside' : range.min !== null && value < range.min ? 'outside' : 'ok'
  return <div className={`goal-progress-card${dark ? ' goal-progress-dark' : ''} goal-progress-status-${status}`}><div className="goal-progress-heading"><span>{label}</span><strong>{formatGraphNutrient(availableValue)}<small>{unit}</small><em>{goal === null ? '目標未設定' : ` / ${formatGraphNutrient(goal)}${unit}`}</em></strong></div><div className="goal-progress-visual"><span className="goal-range-band" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{availableValue !== null && <div className={`goal-intake-bar${segments && segmentTotal > 0 ? ' goal-intake-segmented' : ` ${colorClass}`}`} style={{ width: `${progressWidth}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <span key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</div>}{targetPosition !== null && <span className="goal-target-line" style={{ left: `${targetPosition}%` }} />}</div><div className="goal-progress-footer"><span>{rate === null ? '比較する目標がありません' : `目標の${rate.toFixed(0)}%`}</span><div className="goal-progress-legends">{targetPosition !== null && <span className="goal-line-legend"><i />目標</span>}{segments && segmentTotal > 0 && <MealColorLegend />}</div></div></div>
}

function MealColorLegend() {
  return <div className="meal-color-legend">{MEAL_TYPES.map((type) => <span key={type}><i className={`meal-dot meal-dot-${mealTone(type)}`} /><img className="meal-legend-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</span>)}</div>
}

function NutrientGraphRow({ label, value, availableValue = value, goal, unit, range, segments }: { label: string; value: number | null; availableValue?: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; segments?: GoalSegment[] }) {
  const hasGoal = goal !== null && goal > 0
  const graphMax = hasGoal ? Math.max(goal * 2, availableValue ?? 0, 1) : Math.max(availableValue ?? 0, 1)
  const valuePercent = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / graphMax) * 100))
  const rangeLeft = hasGoal ? Math.min(100, Math.max(0, ((range.min ?? 0) / graphMax) * 100)) : 0
  const rangeRight = hasGoal ? Math.min(100, Math.max(rangeLeft, ((range.max ?? graphMax) / graphMax) * 100)) : 0
  const segmentTotal = segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0
  const rate = goalRate(value, goal)
  const status = value === null || rate === null ? '未設定' : range.max !== null && value > range.max ? '超過' : range.min !== null && value < range.min ? '不足' : '適正'
  return <div className="nutrient-graph-row"><span className="nutrient-graph-label">{label}</span><div className="nutrient-graph-track"><span className="nutrient-graph-range" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{availableValue !== null && <span className={`nutrient-graph-intake${segments && segmentTotal > 0 ? ' nutrient-graph-intake-segmented' : ''}`} style={{ width: `${valuePercent}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}{hasGoal && <span className="nutrient-graph-target" style={{ left: '50%' }} />}</div><span className={`nutrient-graph-value nutrient-graph-status-${status === '超過' ? 'over' : status === '不足' ? 'under' : status === '適正' ? 'ok' : 'unknown'}`}>{formatGraphNutrient(availableValue)}<small>{unit}</small></span></div>
}

function NutrientGoalGraphs({ nutrients, availableNutrients, goals, subtotals, availableSubtotals, colorByMeal = false, excludeEnergy = false }: { nutrients: Nutrients; availableNutrients?: Nutrients; goals: NutritionGoals; subtotals?: Record<string, Nutrients>; availableSubtotals?: Record<string, Nutrients>; colorByMeal?: boolean; excludeEnergy?: boolean }) {
  const keys = excludeEnergy ? NUTRIENT_KEYS.filter((key) => key !== 'energyKcal') : NUTRIENT_KEYS
  const segmentSubtotals = availableSubtotals ?? subtotals
  return <section className="nutrient-graph"><div className="nutrient-graph-heading"><span>栄養素</span><span>基準ライン</span><span>摂取量</span></div><div className="nutrient-graph-rows">{keys.map((key) => <NutrientGraphRow key={key} label={NUTRIENT_LABELS[key]} value={nutrients[key]} availableValue={availableNutrients ? availableNutrients[key] : nutrients[key]} goal={goals[key]} unit={NUTRIENT_UNITS[key]} range={nutrientRangeForGoals(goals, key)} segments={colorByMeal && segmentSubtotals ? MEAL_TYPES.map((type) => ({ type, value: segmentSubtotals[type]?.[key] ?? 0 })).filter((segment) => segment.value > 0) : undefined} />)}</div>{colorByMeal && segmentSubtotals && <div className="nutrient-graph-footer"><MealColorLegend /></div>}</section>
}

const TREND_NUTRIENT_KEYS: NutrientKey[] = ['energyKcal', 'proteinG', 'fatG', 'carbohydrateG']

function formatTrendDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

interface GraphsViewProps {
  entries: MealEntry[]
  range: TrendRangeId
  goals: NutritionGoals
  onRangeChange: (value: TrendRangeId) => void
}

function GraphsView({ entries, range, goals, onRangeChange }: GraphsViewProps) {
  const [metric, setMetric] = useState<NutrientKey>('energyKcal')
  const rangeDays = TREND_RANGE_DAYS[range]
  const to = currentDateKey()
  const from = addDays(to, -(rangeDays - 1))
  const points = useMemo(() => buildDailyNutrientTrend(entries, from, to, rangeDays), [entries, from, to, rangeDays])
  const goal = goals[metric]
  const values = points.map((point) => point.availableNutrients[metric] ?? 0)
  const chartMax = Math.max(goal ?? 0, ...values, 1) * 1.15
  const goalPosition = goal !== null && goal > 0 ? Math.min(100, (goal / chartMax) * 100) : null
  const recordedDays = new Set(entries.map((entry) => formatDateKey(entry.eatenAt))).size

  return <>
    <section className="page-heading"><div><span className="eyebrow">GRAPHS</span><h1>グラフ</h1></div></section>
    <section className="settings-card trend-toolbar-card"><div className="section-title"><div><span className="eyebrow">TREND</span><h2>表示する期間と栄養素</h2></div></div><div className="trend-range-tabs" role="tablist" aria-label="グラフの表示期間">{TREND_RANGE_OPTIONS.map((option) => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? 'active' : ''} onClick={() => onRangeChange(option.id)}>{option.label}</button>)}</div><label>表示する栄養素<select value={metric} onChange={(event) => setMetric(event.target.value as NutrientKey)}>{TREND_NUTRIENT_KEYS.map((key) => <option key={key} value={key}>{NUTRIENT_LABELS[key]}</option>)}</select></label><InfoPopover label="グラフの表示について" text="今日を含む固定期間で表示します。線は設定された1日の目標値です。" /></section>
    <section className="trend-chart-card"><div className="trend-chart-heading"><div><span className="eyebrow">DAILY TREND</span><h2>{NUTRIENT_LABELS[metric]}の推移</h2></div><span>{recordedDays}日記録 / {points.length}日</span></div><div className="trend-chart-legend"><span className="trend-legend-bar" />摂取量{goalPosition !== null && <><span className="trend-legend-line" />目標 {formatGraphNutrient(goal)}{NUTRIENT_UNITS[metric]}</>}</div><div className="trend-chart-scroll"><div className="trend-chart"><div className="trend-chart-plot">{goalPosition !== null && <span className="trend-chart-goal-line" style={{ bottom: `${goalPosition}%` }} />}<div className="trend-chart-bars" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(2.7rem, 1fr))`, minWidth: `${Math.max(points.length * 3.2, 31)}rem` }}>{points.map((point) => { const availableValue = point.availableNutrients[metric]; const height = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / chartMax) * 100)); return <div className="trend-bar-column" key={point.date} title={`${point.date} ${NUTRIENT_LABELS[metric]} ${formatGraphNutrient(availableValue)}${NUTRIENT_UNITS[metric]}`}><span className={`trend-bar-value${availableValue === null ? ' is-missing' : ''}`}>{formatGraphNutrient(availableValue)}<small>{NUTRIENT_UNITS[metric]}</small></span><div className="trend-bar-track">{availableValue !== null && <span className="trend-bar-fill" style={{ height: `${height}%` }} />}</div><span className="trend-bar-date">{formatTrendDate(point.date)}</span></div> })}</div></div></div></div></section>
  </>
}

interface TodayViewProps {
  selectedDate: string; setSelectedDate: (value: string) => void; total: Nutrients; goals: NutritionGoals; entries: MealEntry[]; subtotals: Record<string, Nutrients>
  existingFoodIds: Set<string>; onOpenMealConfirmation: (type: MealType) => void
  onShowMealDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onShowTodayDetails: () => void
}

function TodayView(props: TodayViewProps) {
  const { selectedDate, setSelectedDate, total, goals, entries, subtotals, existingFoodIds, onOpenMealConfirmation, onShowMealDetails, onShowTodayDetails } = props
  const availableNutrients = sumAvailableNutrients(entries)
  const availableSubtotals = Object.fromEntries(MEAL_TYPES.map((type) => [type, sumAvailableNutrients(entries.filter((entry) => entry.mealType === type))])) as Record<string, Nutrients>
  return <>
    <section className="page-heading"><div><span className="eyebrow">DAILY LOG</span><h1>今日の記録</h1><p className="muted">食べたものを、あとから振り返れる形で。</p></div><div className="date-picker"><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value) }} /><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button></div></section>
    <section className="hero-summary"><div className="hero-summary-heading"><div className="today-hero-copy"><span className="section-kicker">{selectedDate === currentDateKey() ? 'TODAY' : selectedDate}</span><strong>今日の進捗</strong></div><button className="hero-detail-button" type="button" onClick={onShowTodayDetails}>詳細を見る</button></div><GoalProgressBar label="カロリー" value={total.energyKcal} availableValue={availableNutrients.energyKcal} goal={goals.energyKcal} unit="kcal" range={nutrientRangeForGoals(goals, 'energyKcal')} segments={MEAL_TYPES.map((type) => ({ type, value: availableSubtotals[type]?.energyKcal ?? 0 })).filter((segment) => segment.value > 0)} dark targetPositionPercent={75} /></section>
    <section className="section-block meals-section"><div className="section-title"><div><span className="eyebrow">MEALS</span><h2>食事の内訳</h2></div><span className="count-label">{entries.length}件</span></div>{MEAL_TYPES.map((type) => <MealGroup key={type} type={type} entries={entries.filter((entry) => entry.mealType === type)} subtotal={subtotals[type]} existingFoodIds={existingFoodIds} onOpenConfirmation={onOpenMealConfirmation} onShowDetails={onShowMealDetails} />)}</section>
  </>
}

function MealConfirmationView({ type, entries, subtotal, onAdd, onEdit, onDelete, onReorder, onDone }: {
  type: MealType
  entries: MealEntry[]
  subtotal: Nutrients
  onAdd: () => void
  onEdit: (entry: MealEntry) => void
  onDelete: (entry: MealEntry) => void
  onReorder: (orderedEntryIds: string[]) => Promise<void>
  onDone: () => void
}) {
  const [orderedEntries, setOrderedEntries] = useState(entries)
  const orderedEntriesRef = useRef(entries)
  const entriesRef = useRef(entries)
  const listRef = useRef<HTMLDivElement>(null)
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null)
  const draggedEntryIdRef = useRef<string | null>(null)
  const dragStartOrderRef = useRef<MealEntry[]>(entries)
  const dragOffsetYRef = useRef(0)
  const dragPointerIdRef = useRef<number | null>(null)
  const [dragPreview, setDragPreview] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const savingOrderRef = useRef(false)

  const updateLocalOrder = (next: MealEntry[]) => {
    orderedEntriesRef.current = next
    setOrderedEntries(next)
  }

  useEffect(() => {
    entriesRef.current = entries
    if (!draggedEntryIdRef.current && !savingOrderRef.current) {
      orderedEntriesRef.current = entries
      setOrderedEntries(entries)
    }
  }, [entries])

  const commitOrder = async (next: MealEntry[]) => {
    const nextIds = next.map((entry) => entry.id)
    const persistedEntries = entriesRef.current
    if (nextIds.every((id, index) => id === persistedEntries[index]?.id)) return
    if (savingOrderRef.current) return
    savingOrderRef.current = true
    setSavingOrder(true)
    try {
      await onReorder(nextIds)
    } catch {
      updateLocalOrder(persistedEntries)
    } finally {
      savingOrderRef.current = false
      setSavingOrder(false)
    }
  }

  const moveByButton = async (entryId: string, offset: -1 | 1) => {
    if (savingOrderRef.current) return
    const next = [...orderedEntriesRef.current]
    const index = next.findIndex((entry) => entry.id === entryId)
    const destination = index + offset
    if (index < 0 || destination < 0 || destination >= next.length) return
    ;[next[index], next[destination]] = [next[destination], next[index]]
    updateLocalOrder(next)
    await commitOrder(next)
  }

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, entryId: string) => {
    if (savingOrderRef.current || orderedEntriesRef.current.length < 2) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-meal-entry-id]')
    if (!row) return
    const rect = row.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartOrderRef.current = orderedEntriesRef.current
    dragOffsetYRef.current = event.clientY - rect.top
    dragPointerIdRef.current = event.pointerId
    draggedEntryIdRef.current = entryId
    setDraggedEntryId(entryId)
    setDragPreview({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const sourceId = draggedEntryIdRef.current
    if (!sourceId || dragPointerIdRef.current !== event.pointerId) return
    event.preventDefault()
    setDragPreview((current) => current ? { ...current, top: event.clientY - dragOffsetYRef.current } : current)
    const source = orderedEntriesRef.current.find((entry) => entry.id === sourceId)
    if (!source || !listRef.current) return
    const remaining = orderedEntriesRef.current.filter((entry) => entry.id !== sourceId)
    const rowById = new Map(
      Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-meal-entry-id]'))
        .map((row) => [row.dataset.mealEntryId, row] as const),
    )
    let destination = remaining.length
    for (let index = 0; index < remaining.length; index += 1) {
      const rect = rowById.get(remaining[index].id)?.getBoundingClientRect()
      if (rect && event.clientY < rect.top + rect.height / 2) {
        destination = index
        break
      }
    }
    const next = [...remaining]
    next.splice(destination, 0, source)
    if (!next.every((entry, index) => entry.id === orderedEntriesRef.current[index]?.id)) updateLocalOrder(next)
  }

  const finishDrag = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggedEntryIdRef.current || dragPointerIdRef.current !== event.pointerId) return
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggedEntryIdRef.current = null
    dragPointerIdRef.current = null
    setDraggedEntryId(null)
    setDragPreview(null)
    await commitOrder(orderedEntriesRef.current)
  }

  const cancelDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggedEntryIdRef.current || dragPointerIdRef.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggedEntryIdRef.current = null
    dragPointerIdRef.current = null
    setDraggedEntryId(null)
    setDragPreview(null)
    updateLocalOrder(dragStartOrderRef.current)
  }

  const draggedEntry = draggedEntryId ? orderedEntries.find((entry) => entry.id === draggedEntryId) : null

  return <>
    <section className="page-heading meal-confirmation-heading"><div><span className="eyebrow">MEAL CONFIRMATION</span><h1>{type}の確認</h1><p className="muted">登録内容を確認できます。≡をドラッグして表示順を変更できます。</p></div><button className="button ghost" type="button" onClick={onDone}>今日の記録へ</button></section>
    <section className="settings-card meal-confirmation-card">
      <div className="meal-confirmation-summary"><div><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" /><span>{type}</span></div><strong>{entries.length}件 · {formatNutrient(subtotal.energyKcal)} kcal</strong></div>
      {orderedEntries.length > 0 ? <div ref={listRef} className={`meal-confirmation-list${draggedEntryId ? ' is-reordering' : ''}`}>{orderedEntries.map((entry, index) => <div className={`meal-confirmation-entry${draggedEntryId === entry.id ? ' is-drag-placeholder' : ''}`} key={entry.id} data-meal-entry-id={entry.id}><button className="meal-order-handle" type="button" aria-label={`${entry.foodSnapshot.name}をドラッグして並び替え`} disabled={savingOrder || orderedEntries.length < 2} onPointerDown={(event) => startDrag(event, entry.id)} onPointerMove={moveDrag} onPointerUp={(event) => void finishDrag(event)} onPointerCancel={cancelDrag}>≡</button><div className="meal-confirmation-entry-copy"><strong>{entry.foodSnapshot.name}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}</span></div><div className="meal-confirmation-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b><div className="meal-order-buttons"><button type="button" aria-label={`${entry.foodSnapshot.name}を上へ移動`} disabled={savingOrder || index === 0} onClick={() => void moveByButton(entry.id, -1)}>↑</button><button type="button" aria-label={`${entry.foodSnapshot.name}を下へ移動`} disabled={savingOrder || index === orderedEntries.length - 1} onClick={() => void moveByButton(entry.id, 1)}>↓</button></div><button className="small-action" type="button" disabled={savingOrder} onClick={() => onEdit(entry)}>編集</button><button className="small-action danger-text" type="button" disabled={savingOrder} onClick={() => onDelete(entry)}>削除</button></div></div>)}</div> : <div className="empty-state">この区分の食事記録はありません。</div>}
      <div className="meal-confirmation-actions"><button className="button primary" type="button" onClick={onAdd}>＋ {type}を追加</button><button className="button secondary" type="button" onClick={onDone}>登録を完了</button></div>
    </section>
    {draggedEntry && dragPreview && <div className="meal-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle">≡</span><div className="meal-confirmation-entry-copy"><strong>{draggedEntry.foodSnapshot.name}{draggedEntry.foodSnapshot.maker ? `（${draggedEntry.foodSnapshot.maker}）` : ''}</strong><span>{draggedEntry.amount}{draggedEntry.amountUnit}{type === '間食' ? ` · ${formatTime(draggedEntry.eatenAt)}` : ''}</span></div><b>{formatNutrient(draggedEntry.calculatedNutrients.energyKcal)} kcal</b></div>}
  </>
}

function TodayDetailsModal({ total, goals, entries, onClose }: { total: Nutrients; goals: NutritionGoals; entries: MealEntry[]; onClose: () => void }) {
  const subtotals = sumByMealType(entries)
  const availableNutrients = sumAvailableNutrients(entries)
  const availableSubtotals = Object.fromEntries(MEAL_TYPES.map((type) => [type, sumAvailableNutrients(entries.filter((entry) => entry.mealType === type))])) as Record<string, Nutrients>
  return <div className="modal-backdrop nutrient-detail-backdrop" role="dialog" aria-modal="true" aria-label="今日の栄養詳細"><section className="modal-card nutrient-detail-modal today-details-modal"><div className="modal-heading"><div><span className="eyebrow">TODAY DETAILS</span><h2>今日の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><NutrientGoalGraphs nutrients={total} availableNutrients={availableNutrients} goals={goals} subtotals={subtotals} availableSubtotals={availableSubtotals} colorByMeal /></section></div>
}

function QuickFoodGroup({ title, foods, favoriteIds, onSelect, onToggleFavorite }: { title: string; foods: Food[]; favoriteIds: Set<string>; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="quick-group"><h3>{title}</h3>{foods.length > 0 ? <div className="quick-list">{foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />)}</div> : <p className="quick-empty-inline">まだお気に入りがありません。食品の☆から追加できます。</p>}</div>
}

function FoodRow({ food, favorite, onSelect, onAdd, onToggleFavorite, onEdit, onDelete, onRemove }: { food: Food; favorite: boolean; onSelect?: (food: Food) => void; onAdd?: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEdit?: (food: Food) => void; onDelete?: (food: Food) => void; onRemove?: (food: Food) => void }) {
  const name = displayFoodName(food)
  return <div className="food-row">{onSelect ? <button type="button" className="food-main" onClick={() => onSelect(food)}><strong>{name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></button> : <div className="food-main static"><strong>{name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></div>}{onAdd && <button type="button" className="small-action food-add-button" onClick={() => onAdd(food)}>追加</button>}<button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button>{onEdit && <button type="button" className="small-action" onClick={() => onEdit(food)}>編集</button>}{onDelete && <button type="button" className="small-action danger-text" onClick={() => onDelete(food)}>削除</button>}{onRemove && <button type="button" className="small-action danger-text" onClick={() => onRemove(food)}>外す</button>}</div>
}

function MenuFoodPicker({ menus, menuSets, foods, onSelect, onSelectMenuSet }: { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onSelect: (food: Food) => void; onSelectMenuSet: (menuSet: MenuSet) => void }) {
  const categoryGroups = MENU_CATEGORIES.map((category) => ({ category, menus: menus.filter((menu) => menu.category === category) }))
  return <section className="section-block menu-picker-section food-section-card"><div className="section-title"><div><span className="eyebrow">MENUS</span><h2>メニューから探す</h2></div></div><div className="menu-picker-groups"><details className="menu-picker-group"><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />セット</span><small>{menuSets.length > 0 ? `${menuSets.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{menuSets.length > 0 ? menuSets.map((menuSet) => { const food = menuSetPreviewFood(menuSet, menus, foods); const itemCount = menuSet.menuIds.length + (menuSet.foodIds?.length ?? 0); return <button className="menu-picker-row" type="button" key={menuSet.id} onClick={() => onSelectMenuSet(menuSet)}><span className="source-badge">セット</span><span className="menu-picker-copy"><strong>{menuSet.name}</strong><small>内容{itemCount}件を一括登録 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b className="batch-action">一括登録</b></button> }) : <p className="menu-picker-empty">セットはまだ登録されていません。</p>}</div></details>{categoryGroups.map(({ category, menus: categoryMenus }) => <details className="menu-picker-group" key={category}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{categoryMenus.length > 0 ? categoryMenus.map((menu) => { const food = menuToFood(menu, menus, foods); return <button className="menu-picker-row" type="button" key={menu.id} onClick={() => onSelect(food)}><span className="source-badge">料理</span><span className="menu-picker-copy"><strong>{menu.name}</strong><small>{getMenuIngredients(menu, foods).length}食材 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button> }) : <p className="menu-picker-empty">この区分に登録されたメニューはありません。</p>}</div></details>)}</div></section>
}

function MealGroup({ type, entries, subtotal, existingFoodIds, onShowDetails, onOpenConfirmation }: { type: MealType; entries: MealEntry[]; subtotal?: Nutrients; existingFoodIds: Set<string>; onShowDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onOpenConfirmation: (type: MealType) => void }) {
  const sharedTime = entries[0]?.eatenAt
  return <div className="meal-group"><div className="meal-heading"><h3><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</h3><div className="meal-heading-actions"><span>{entries.length ? `${formatNutrient(subtotal?.energyKcal ?? null)} kcal` : '記録なし'}</span>{entries.length > 0 && <button type="button" className="small-action" onClick={() => onShowDetails(type, entries, subtotal ?? EMPTY_NUTRIENTS)}>詳細</button>}<button type="button" className="meal-record-button" onClick={() => onOpenConfirmation(type)}>編集</button></div></div>{entries.length > 0 && type !== '間食' && <div className="meal-shared-time">食事時刻：{sharedTime ? formatTime(sharedTime) : '未設定'}</div>}{entries.map((entry) => <div className="meal-entry" key={entry.id}><div className="meal-entry-copy"><strong>{entry.foodSnapshot.name}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}{existingFoodIds.has(entry.foodId) ? '' : ' · 削除済み食品'}</span></div><div className="meal-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b></div></div>)}</div>
}

interface FoodsViewProps { recordingMealType: MealType | null; foods: Food[]; foodGroups: FoodGroup[]; menus: Menu[]; menuSets: MenuSet[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onSelectFood: (food: Food) => void; onSelectMenuSet: (menuSet: MenuSet) => void; onToggleFavorite: (food: Food) => void; onEditFood: (food: Food) => void; onDeleteFood: (food: Food) => void; onOpenSearch?: () => void; onOpenScanner: () => void; onBack: () => void; backLabel: string; copyMealType: 'すべて' | MealType; setCopyMealType: (value: 'すべて' | MealType) => void; onCopyPrevious: () => void }
function FoodsView({ recordingMealType, foods, foodGroups, menus, menuSets, recentFoods, favoriteFoods, favoriteIds, onSelectFood, onSelectMenuSet, onToggleFavorite, onEditFood, onDeleteFood, onOpenSearch, onOpenScanner, onBack, backLabel, copyMealType, setCopyMealType, onCopyPrevious }: FoodsViewProps) {
  const selectable = Boolean(recordingMealType)
  const [activeTab, setActiveTab] = useState<'quick' | 'foods' | 'menus'>(selectable ? 'quick' : 'foods')
  const [openFoodGroups, setOpenFoodGroups] = useState<Set<FoodIndexGroupKey>>(new Set())
  const indexedFoodGroups = useMemo(() => groupFoodsByKana(foods, foodGroups), [foods, foodGroups])
  useEffect(() => {
    setActiveTab(selectable ? 'quick' : 'foods')
  }, [selectable])
  const tabs: Array<{ id: 'quick' | 'foods' | 'menus'; label: string }> = selectable
    ? [{ id: 'quick', label: 'すぐに記録' }, { id: 'foods', label: '食品' }, { id: 'menus', label: 'メニュー' }]
    : []
  return <><section className="page-heading food-screen-heading"><div><span className="eyebrow">{recordingMealType ? 'SELECT FOOD' : 'FOOD MASTER'}</span><h1>{recordingMealType ? `${recordingMealType}の食品を選ぶ` : '食品を登録・管理'}</h1>{!recordingMealType && <p className="muted">食品の編集・検索はこの画面で行います。新規登録は設定から行えます。</p>}</div><button className="button ghost" type="button" onClick={onBack}>{backLabel}</button></section><div className="action-row">{onOpenSearch && <button className="button primary" type="button" onClick={onOpenSearch}>⌕ 食品を検索</button>}<button className="button secondary" type="button" onClick={onOpenScanner}>▦ バーコード</button></div><div className="search-category-tabs food-screen-tabs" role="tablist" aria-label="食品登録方法">{tabs.map((tab) => <button key={tab.id} id={`food-screen-tab-${tab.id}`} className={activeTab === tab.id ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="food-screen-tab-panel" onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div><div id="food-screen-tab-panel" role="tabpanel" aria-labelledby={`food-screen-tab-${activeTab}`} className="food-screen-sections">{activeTab === 'menus' && selectable && <MenuFoodPicker menus={menus} menuSets={menuSets} foods={foods} onSelect={onSelectFood} onSelectMenuSet={onSelectMenuSet} />}{activeTab === 'quick' && selectable && <section className="section-block food-section-card food-quick-section"><div className="section-title"><div><span className="eyebrow">QUICK ADD</span><h2>すぐに記録</h2></div><span className="count-label quick-count">最近 {recentFoods.length} / お気に入り {favoriteFoods.length}</span></div><div className="quick-groups">{recentFoods.length > 0 && <QuickFoodGroup title="最近使った食品" foods={recentFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} />}{<QuickFoodGroup title="お気に入り" foods={favoriteFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} />}</div>{recordingMealType && <section className="copy-panel quick-copy-panel"><div><strong>前日の食事をコピー</strong><span>当日の現在時刻で登録します</span></div><select value={copyMealType} onChange={(event) => setCopyMealType(event.target.value as 'すべて' | MealType)}><option>すべて</option>{MEAL_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button className="button ghost" type="button" onClick={onCopyPrevious}>コピー</button></section>}</section>}{activeTab === 'foods' && <section className="section-block food-section-card"><div className="section-title"><div><span className="eyebrow">FOODS</span><h2>食品</h2></div><span className="count-label">{foods.length}件</span></div>{selectable ? <div className="food-results">{foods.slice(0, 50).map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={undefined} onAdd={onSelectFood} onToggleFavorite={onToggleFavorite} />)}</div> : <div className="menu-picker-groups">{indexedFoodGroups.map((group) => { const open = openFoodGroups.has(group.key); return <details className="menu-picker-group" key={group.key} open={open} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenFoodGroups((current) => { const next = new Set(current); if (isOpen) next.add(group.key); else next.delete(group.key); return next }) }}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{group.label}</span><small>{group.foods.length > 0 ? `${group.foods.length}件` : '登録なし'}</small></summary>{open && <div className="food-results">{group.foods.length > 0 ? group.foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onEdit={onEditFood} onDelete={onDeleteFood} />) : <p className="menu-picker-empty">この行に登録された食品はありません。</p>}</div>}</details> })}</div>}</section>}</div></>
}

function SearchInputView({ bars, setBars, onSearch, onBack }: { bars: string[]; setBars: React.Dispatch<React.SetStateAction<string[]>>; onSearch: () => void; onBack: () => void }) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [focusIndex, setFocusIndex] = useState<number | null>(0)

  useEffect(() => {
    if (focusIndex === null) return
    const input = inputRefs.current[focusIndex]
    if (!input) return
    input.focus()
    setFocusIndex(null)
  }, [bars.length, focusIndex])

  const addSearchBar = () => {
    setFocusIndex(bars.length)
    setBars((current) => [...current, ''])
  }

  return <><section className="page-heading"><div><span className="eyebrow">SEARCH</span><h1>食品・メニューを検索</h1></div><button className="button ghost" type="button" onClick={onBack}>← 食品画面へ</button></section><section className="settings-card search-input-card"><div className="search-bar-list">{bars.map((bar, index) => <div className="search-bar-row" key={index}><label><input ref={(element) => { inputRefs.current[index] = element }} aria-label="検索バー" maxLength={100} value={bar} onChange={(event) => setBars((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} placeholder="食品名・メーカー・メニュー名" /></label>{bars.length > 1 && <button className="small-action danger-text" type="button" onClick={() => setBars((current) => current.filter((_, currentIndex) => currentIndex !== index))}>削除</button>}</div>)}</div><div className="search-input-actions"><button className="button secondary" type="button" onClick={addSearchBar}>＋ 検索バーを追加</button><button className="button primary" type="button" onClick={onSearch}>検索する</button></div></section></>
}

const searchCategoryLabels: Record<FoodSearchCategory, string> = { all: '全て', general: '一般食材', menu: '料理メニュー', commercial: '外食・市販' }

function SearchResultsView({ groups, purpose, category, searching, onCategoryChange, onSelect, onAddFood, onLoadMore, onBack }: { groups: SearchResultGroup[]; purpose: SearchPurpose; category: FoodSearchCategory; searching: boolean; onCategoryChange: (category: FoodSearchCategory) => void; onSelect: (query: string, item: SearchResultItem) => void; onAddFood: (query: string) => void; onLoadMore: (index: number) => void; onBack: () => void }) {
  const helperText = purpose === 'food-master' ? '食品を選ぶと、登録内容を確認・編集できます。' : '食品・料理メニューは内容を確認して記録し、メニューセットは構成項目を一括登録します。'
  const categories = purpose === 'meal' ? MEAL_SEARCH_CATEGORIES : FOOD_MASTER_SEARCH_CATEGORIES
  const emptyLabel = category === 'all' ? '一致する食品・メニューがありません。' : category === 'menu' ? '一致する料理メニューがありません。' : `${searchCategoryLabels[category]}に一致する食品がありません。`
  return <><section className="page-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h1>検索結果</h1><p className="muted">{helperText}</p></div><button className="button ghost" type="button" onClick={onBack}>← 検索画面へ</button></section><div className="search-category-tabs" role="tablist" aria-label="検索結果の分類">{categories.map((value) => <button key={value} id={`search-category-${value}`} role="tab" type="button" aria-selected={category === value} aria-controls="search-category-panel" className={category === value ? 'active' : ''} disabled={searching} onClick={() => onCategoryChange(value)}>{searchCategoryLabels[value]}</button>)}</div><div id="search-category-panel" role="tabpanel" aria-labelledby={`search-category-${category}`} aria-busy={searching} className="search-result-groups">{searching ? <div className="empty-state">検索中…</div> : <>{groups.map((group, groupIndex) => <section className="search-result-group" key={`${group.query}:${groupIndex}`}><div className="search-result-heading"><strong>検索結果：</strong><span>{group.query}</span></div><div className="food-results">{group.items.map((item) => <button className="search-result-row" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(group.query, item)}><span className="source-badge">{item.kind === 'food' || item.kind === 'user-food' ? '食品' : item.kind === 'menu' ? 'メニュー' : 'セット'}</span><span className="search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small>{(item.kind === 'food' || item.kind === 'user-food') && <span className="search-result-meta">{item.recentlyUsed && <em>最近使った</em>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_group' && item.userFoodResult.group.memberCount !== 1 && <span>{item.userFoodResult.group.memberCount}種類から選択</span>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_variant' && item.variants.length > 1 && <span>{item.variants.length}バリエーションから選択</span>}{item.kind === 'food' && item.variants.length > 1 && <span>{item.variants.length}種類から選択</span>}</span>}</span><b className={item.kind === 'set' ? 'batch-action' : undefined}>{item.kind === 'set' ? '一括登録' : '›'}</b></button>)}{group.items.length === 0 && <div className="search-empty-state"><p>{emptyLabel}</p>{category !== 'menu' && <button className="button secondary" type="button" onClick={() => onAddFood(group.query === '最近・お気に入り' ? '' : group.query)}>食品を追加</button>}</div>}{group.nextCursor && <button className="button secondary search-load-more" type="button" onClick={() => onLoadMore(groupIndex)}>さらに表示</button>}</div></section>)}{groups.length === 0 && <div className="empty-state">検索結果はありません。検索画面へ戻って再検索してください。</div>}</>}</div></>
}

interface FoodVariantPickerModalProps {
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
  foods?: Food[]
  foodGroups?: FoodGroup[]
  onSelect: (food: Food) => void
  onClose: () => void
  mealMode?: boolean
  onSubmitMeal?: (food: Food, amount: string, amountUnit: QuantityUnit) => void | Promise<void>
  foodAttributePreferences?: FoodAttributePreferences
  onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>
}

function FoodVariantPickerModal(props: FoodVariantPickerModalProps) {
  if (!props.result && !props.userFoodResult) return null
  if (props.userFoodResult || (props.result && hasMextFoodGroup(props.result.group.id))) {
    return <MextFoodVariantPickerModal {...props} />
  }
  if (!props.result) return null
  return <LegacyFoodVariantPickerModal {...props} result={props.result} />
}

interface FoodAttributeVisibilityItem {
  key: string
  displayName: string
  checked: boolean
  disabled: boolean
  selectedValueName: string | null
  onToggle: (visible: boolean) => void
}

function FoodAttributeVisibilityPanel({ items, onClose }: {
  items: FoodAttributeVisibilityItem[]
  onClose: () => void
}) {
  return <div className="food-attribute-visibility-panel"><div className="food-attribute-visibility-heading"><strong>表示する項目</strong><button className="small-action" type="button" onClick={onClose}>閉じる</button></div><p className="helper-text">チェックした項目だけを食品選択画面に表示します。チェックを外すと、現在の選択を次回以降の既定値として使用します。</p><div className="food-attribute-visibility-list">{items.map((item) => <label className="food-attribute-visibility-row" key={item.key}><input type="checkbox" checked={item.checked} disabled={item.disabled} onChange={(event) => item.onToggle(event.target.checked)} /><span>{item.displayName}</span><small>{item.selectedValueName ? `既定: ${item.selectedValueName}` : '先に値を選択'}</small></label>)}</div></div>
}

function MextFoodVariantPickerModal({ result, userFoodResult, foods = [], foodGroups = [], onSelect, onClose, mealMode = false, onSubmitMeal, foodAttributePreferences = {}, onSaveFoodAttributePreference }: FoodVariantPickerModalProps) {
  const userGroupPreferences = useMemo(() => userFoodResult ? (foodAttributePreferences[userFoodResult.group.id] ?? {}) : {}, [foodAttributePreferences, userFoodResult])
  const appliedUserPreferences = useMemo(() => userFoodResult
    ? applyConstrainedUserFoodSelectionPreferences(userFoodResult.group.id, userFoodResult.group.selectionDimensions, userFoodResult.presetSelection, userGroupPreferences)
    : { selection: {}, autoHiddenDimensionIds: new Set<string>(), invalidDimensionIds: new Set<string>(), incompatibleDimensionIds: new Set<string>() }, [userFoodResult, userGroupPreferences])
  const userSelectionOrder = useMemo(() => userFoodResult ? [
    ...userFoodResult.group.selectionDimensions.filter((dimension) => !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
    ...userFoodResult.group.selectionDimensions.filter((dimension) => appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
  ].map((dimension) => dimension.id) : [], [appliedUserPreferences.autoHiddenDimensionIds, userFoodResult])
  const [userSelection, setUserSelection] = useState<Record<string, string>>(() => appliedUserPreferences.selection)
  const [temporarilyVisibleUserDimensionIds, setTemporarilyVisibleUserDimensionIds] = useState<Set<string>>(new Set())
  const [constraintMessage, setConstraintMessage] = useState<string | null>(null)
  useEffect(() => {
    setUserSelection(appliedUserPreferences.selection)
    setTemporarilyVisibleUserDimensionIds(new Set(appliedUserPreferences.incompatibleDimensionIds))
    if (appliedUserPreferences.incompatibleDimensionIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [appliedUserPreferences])
  const visibleUserDimensions = useMemo(() => (userFoodResult?.group.selectionDimensions ?? []).filter((dimension) => {
    return !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id) || temporarilyVisibleUserDimensionIds.has(dimension.id)
  }), [appliedUserPreferences.autoHiddenDimensionIds, temporarilyVisibleUserDimensionIds, userFoodResult])
  const availableUserDimensionValues = useMemo(() => new Map((userFoodResult?.group.selectionDimensions ?? []).map((dimension) => [
    dimension.id,
    getAvailableUserSelectionValueIds(userFoodResult!.group.id, userSelection, dimension.id, userSelectionOrder),
  ])), [userFoodResult, userSelection, userSelectionOrder])
  const resolvedUserFoodGroupId = useMemo(() => {
    if (!userFoodResult) return result?.group.id ?? null
    try {
      return resolveFoodGroupId(userFoodResult.group.id, userSelection)
    } catch {
      return null
    }
  }, [result?.group.id, userFoodResult, userSelection])
  const activeResult = useMemo(() => {
    if (!userFoodResult) return result
    if (!resolvedUserFoodGroupId) return null
    return buildMextFoodSearchResult(resolvedUserFoodGroupId, foods, foodGroups, result?.score ?? 0)
  }, [foodGroups, foods, resolvedUserFoodGroupId, result, userFoodResult])
  const activeFoodGroupId = activeResult?.group.id ?? null
  const attributes = useMemo(() => activeFoodGroupId ? getSelectableAttributes(activeFoodGroupId) : [], [activeFoodGroupId])
  const [temporarilyVisibleAttributeIds, setTemporarilyVisibleAttributeIds] = useState<Set<string>>(new Set())
  const [showAttributeSettings, setShowAttributeSettings] = useState(false)
  const groupPreferences = useMemo(() => activeFoodGroupId ? getFoodAttributePreferencesForGroup(foodAttributePreferences, activeFoodGroupId) : {}, [activeFoodGroupId, foodAttributePreferences])
  const appliedPreferences = useMemo(() => activeFoodGroupId
    ? applyConstrainedMextFoodAttributePreferences(activeFoodGroupId, attributes, getDefaultSelectedAttributes(activeFoodGroupId), groupPreferences)
    : { selection: {}, autoHiddenAttributeIds: new Set<string>(), invalidAttributeIds: new Set<string>(), incompatibleAttributeIds: new Set<string>() }, [activeFoodGroupId, attributes, groupPreferences])
  const attributeSelectionOrder = useMemo(() => [
    ...attributes.filter((attribute) => attribute.visibility !== 'hidden' && !appliedPreferences.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => appliedPreferences.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => attribute.visibility === 'hidden'),
  ].map((attribute) => attribute.id), [appliedPreferences.autoHiddenAttributeIds, attributes])
  const hasAutoHiddenPreference = appliedPreferences.autoHiddenAttributeIds.size > 0
  const visibleAttributeIds = useMemo(() => new Set(attributes.filter((attribute) => {
    return attribute.visibility !== 'hidden' && (!appliedPreferences.autoHiddenAttributeIds.has(attribute.id) || temporarilyVisibleAttributeIds.has(attribute.id))
  }).map((attribute) => attribute.id)), [attributes, appliedPreferences.autoHiddenAttributeIds, temporarilyVisibleAttributeIds])
  const visibleAttributes = useMemo(() => attributes.filter((attribute) => visibleAttributeIds.has(attribute.id)), [attributes, visibleAttributeIds])
  const hiddenAttributes = useMemo(() => attributes.filter((attribute) => attribute.visibility === 'hidden'), [attributes])
  const supplementalFoods = useMemo(() => (activeResult?.variants ?? []).filter((food) => !getFoodVariantBySourceId(food.id)), [activeResult?.variants])
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    return appliedPreferences.selection
  })
  const [selectionFoodGroupId, setSelectionFoodGroupId] = useState<string | null>(activeFoodGroupId)
  const [supplementalFoodId, setSupplementalFoodId] = useState<string | null>(null)
  const selectionForActiveGroup = selectionFoodGroupId === activeFoodGroupId ? selection : appliedPreferences.selection
  useEffect(() => {
    setSelection(appliedPreferences.selection)
    setSelectionFoodGroupId(activeFoodGroupId)
    setSupplementalFoodId(null)
    setTemporarilyVisibleAttributeIds(new Set(appliedPreferences.incompatibleAttributeIds))
    if (appliedPreferences.incompatibleAttributeIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [activeFoodGroupId, appliedPreferences])
  const resolution = useMemo(() => {
    if (!resolvedUserFoodGroupId) {
      return { variant: null, error: '種類を選択すると、属性を指定できます。', requiresHiddenSelection: false }
    }
    if (!activeResult || !activeFoodGroupId) {
      return { variant: null, error: '対象食品データを読み込めませんでした。食品データを再読み込みしてください。', requiresHiddenSelection: false }
    }
    try {
      return { variant: resolveFoodVariantForUi(activeFoodGroupId, selectionForActiveGroup), error: null, requiresHiddenSelection: false }
    } catch (error) {
      if (error instanceof MissingRequiredAttribute) return { variant: null, error: '必要な属性を選択してください。', requiresHiddenSelection: false }
      if (error instanceof AmbiguousFoodVariant) return { variant: null, error: '食品を一意に決めるため、追加の属性を選択してください。', requiresHiddenSelection: true }
      if (error instanceof FoodVariantNotFound && hasAutoHiddenPreference) return { variant: null, error: '自動適用した属性の組み合わせに該当する食品がありません。属性を確認してください。', requiresHiddenSelection: true }
      return { variant: null, error: error instanceof Error ? error.message : '食品を決定できません。', requiresHiddenSelection: false }
    }
  }, [activeFoodGroupId, activeResult, hasAutoHiddenPreference, resolvedUserFoodGroupId, selectionForActiveGroup])
  const supplementalFood = supplementalFoods.find((food) => food.id === supplementalFoodId) ?? null
  const resolvedMextFood = resolution.variant && activeResult
    ? activeResult.variants.find((food) => food.id === resolution.variant?.sourceId) ?? null
    : null
  const selectedFood = supplementalFood ?? resolvedMextFood
  const attributesToShow = resolution.requiresHiddenSelection ? attributes : visibleAttributes
  const availableAttributeValues = useMemo(() => new Map(attributesToShow.map((attribute) => [
    attribute.id,
    activeFoodGroupId
      ? getAvailableFoodAttributeValueIds(activeFoodGroupId, selectionForActiveGroup, attributeSelectionOrder, attribute.id)
      : new Set<string>(),
  ])), [activeFoodGroupId, attributeSelectionOrder, attributesToShow, selectionForActiveGroup])
  const autoAppliedAttributes = attributes.filter((attribute) => {
    const preference = groupPreferences[attribute.id]
    return appliedPreferences.autoHiddenAttributeIds.has(attribute.id)
      && preference !== undefined
      && selectionForActiveGroup[attribute.id] === preference.defaultValueId
      && !appliedPreferences.invalidAttributeIds.has(attribute.id)
  })
  const autoAppliedUserDimensions = (userFoodResult?.group.selectionDimensions ?? []).filter((dimension) => {
    const preference = userGroupPreferences[dimension.id]
    return appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)
      && preference !== undefined
      && userSelection[dimension.id] === preference.defaultValueId
      && !appliedUserPreferences.invalidDimensionIds.has(dimension.id)
  })
  const autoHiddenAttributes = autoAppliedAttributes.filter((attribute) => !temporarilyVisibleAttributeIds.has(attribute.id))
  const autoHiddenUserDimensions = autoAppliedUserDimensions.filter((dimension) => !temporarilyVisibleUserDimensionIds.has(dimension.id))
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  const selectedFoodDefaultUnit = selectedFood ? (selectedFood.servingUnit ?? selectedFood.baseUnit) : ''
  const selectedFoodName = supplementalFood ? (supplementalFood.officialName ?? supplementalFood.name) : resolution.variant?.sourceName
  const [amount, setAmount] = useState(selectedFoodDefaultAmount)
  const [amountUnit, setAmountUnit] = useState<QuantityUnit>(selectedFoodDefaultUnit)
  useEffect(() => {
    setAmount(selectedFoodDefaultAmount)
    setAmountUnit(selectedFoodDefaultUnit)
  }, [selectedFoodDefaultAmount, selectedFoodDefaultUnit, selectedFoodId])

  const chooseAttribute = (attributeId: string, valueId: string, hidden: boolean) => {
    if (!activeFoodGroupId) return
    setSupplementalFoodId(null)
    const next = { ...selectionForActiveGroup, [attributeId]: valueId }
    if (!hidden) hiddenAttributes.forEach((attribute) => { delete next[attribute.id] })
    const reconciled = reconcileFoodAttributeSelection(activeFoodGroupId, next, attributeSelectionOrder)
    setSelection(reconciled.selection)
    setSelectionFoodGroupId(activeFoodGroupId)
    if (reconciled.clearedAttributeIds.size > 0) {
      setTemporarilyVisibleAttributeIds((current) => new Set([...current, ...reconciled.clearedAttributeIds]))
      setConstraintMessage('選択条件が変わったため、利用できない下位の属性を解除しました。')
    } else {
      setConstraintMessage(null)
    }
  }

  const chooseUserDimension = (dimensionId: string, valueId: string) => {
    if (!userFoodResult) return
    const reconciled = reconcileUserFoodSelection(userFoodResult.group.id, { ...userSelection, [dimensionId]: valueId }, userSelectionOrder)
    setUserSelection(reconciled.selection)
    if (reconciled.clearedDimensionIds.size > 0) {
      setTemporarilyVisibleUserDimensionIds((current) => new Set([...current, ...reconciled.clearedDimensionIds]))
      setConstraintMessage('種類が変わったため、利用できない下位の選択を解除しました。')
    } else {
      setConstraintMessage(null)
    }
  }

  const showAutoAttribute = (attributeId: string) => setTemporarilyVisibleAttributeIds((current) => new Set(current).add(attributeId))
  const showAutoUserDimension = (dimensionId: string) => setTemporarilyVisibleUserDimensionIds((current) => new Set(current).add(dimensionId))
  const toggleUserDimensionVisibility = async (dimensionId: string, visible: boolean) => {
    const valueId = userSelection[dimensionId] ?? userGroupPreferences[dimensionId]?.defaultValueId
    if (!userFoodResult || !valueId || !onSaveFoodAttributePreference) return
    await onSaveFoodAttributePreference(userFoodResult.group.id, dimensionId, { defaultValueId: valueId, mode: visible ? 'prefill' : 'auto', visible })
  }
  const toggleAttributeVisibility = async (attributeId: string, visible: boolean) => {
    const valueId = selectionForActiveGroup[attributeId] ?? groupPreferences[attributeId]?.defaultValueId
    if (!activeFoodGroupId || !valueId || !onSaveFoodAttributePreference) return
    await onSaveFoodAttributePreference(activeFoodGroupId, attributeId, { defaultValueId: valueId, mode: visible ? 'prefill' : 'auto', visible })
  }
  const attributeDisplayName = (attribute: ReturnType<typeof getSelectableAttributes>[number]) => activeFoodGroupId
    ? getFoodAttributeDisplayName(activeFoodGroupId, attribute)
    : attribute.displayName
  const visibilityItems: FoodAttributeVisibilityItem[] = [
    ...(userFoodResult?.group.selectionDimensions ?? []).map((dimension) => {
      const selectedValueId = userSelection[dimension.id] ?? userGroupPreferences[dimension.id]?.defaultValueId
      const selectedValue = dimension.values.find((value) => value.id === selectedValueId)
      return {
        key: `user:${dimension.id}`,
        displayName: dimension.displayName,
        checked: !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id),
        disabled: selectedValue === undefined,
        selectedValueName: selectedValue?.displayName ?? null,
        onToggle: (visible: boolean) => { void toggleUserDimensionVisibility(dimension.id, visible) },
      }
    }),
    ...attributes.filter((attribute) => attribute.visibility !== 'hidden').map((attribute) => {
      const selectedValueId = selectionForActiveGroup[attribute.id] ?? groupPreferences[attribute.id]?.defaultValueId
      const selectedValue = attribute.values.find((value) => value.id === selectedValueId)
      return {
        key: `mext:${attribute.id}`,
        displayName: attributeDisplayName(attribute),
        checked: !appliedPreferences.autoHiddenAttributeIds.has(attribute.id),
        disabled: selectedValue === undefined,
        selectedValueName: selectedValue?.displayName ?? null,
        onToggle: (visible: boolean) => { void toggleAttributeVisibility(attribute.id, visible) },
      }
    }),
  ]
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品の種類と属性を選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">FOOD SELECTION</span><h2 className="variant-picker-title">{activeResult?.group.displayName ?? userFoodResult?.group.displayName ?? result?.group.displayName ?? '食品'}<button className="info-button variant-attribute-info" type="button" disabled={visibilityItems.length === 0} onClick={() => setShowAttributeSettings((current) => !current)} aria-expanded={showAttributeSettings} aria-label="表示する食品属性を設定">ⓘ</button></h2><p className="muted">種類と属性をこの画面で指定できます。</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>{visibleUserDimensions.length > 0 && <div className="variant-choice-groups food-type-selection">{visibleUserDimensions.map((dimension) => <section className="variant-choice-group" key={dimension.id}><h3>{dimension.displayName}</h3><div className="variant-choice-buttons">{dimension.values.map((value) => { const available = availableUserDimensionValues.get(dimension.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${userSelection[dimension.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={userSelection[dimension.id] === value.id} key={`${dimension.id}:${value.id}`} disabled={!available} onClick={() => chooseUserDimension(dimension.id, value.id)}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{showAttributeSettings && <FoodAttributeVisibilityPanel items={visibilityItems} onClose={() => setShowAttributeSettings(false)} />}{supplementalFoods.length > 0 && <div className="variant-choice-groups"><section className="variant-choice-group"><h3>手動登録食品</h3><div className="variant-choice-buttons">{supplementalFoods.map((food) => <button className={`variant-choice-button${supplementalFoodId === food.id ? ' is-selected' : ''}`} type="button" aria-pressed={supplementalFoodId === food.id} key={food.id} onClick={() => setSupplementalFoodId(food.id)}>{food.officialName ?? food.name}</button>)}</div></section></div>}{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{autoAppliedUserDimensions.length + autoAppliedAttributes.length > 0 && <div className="variant-picker-auto-summary"><span>自動適用: {[...autoAppliedUserDimensions.map((dimension) => `${dimension.displayName}＝${dimension.values.find((value) => value.id === userSelection[dimension.id])?.displayName ?? ''}`), ...autoAppliedAttributes.map((attribute) => `${attributeDisplayName(attribute)}＝${attribute.values.find((value) => value.id === selectionForActiveGroup[attribute.id])?.displayName ?? ''}`)].join('、')}</span>{autoHiddenUserDimensions.length + autoHiddenAttributes.length > 0 && <button className="small-action" type="button" onClick={() => { autoHiddenUserDimensions.forEach((dimension) => showAutoUserDimension(dimension.id)); autoHiddenAttributes.forEach((attribute) => showAutoAttribute(attribute.id)) }}>今回だけ変更</button>}</div>}{attributesToShow.length > 0 && <div className="variant-choice-groups">{attributesToShow.map((attribute) => <section className="variant-choice-group" key={attribute.id}><h3>{attributeDisplayName(attribute)}</h3><div className="variant-choice-buttons">{attribute.values.map((value) => { const available = availableAttributeValues.get(attribute.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${selectionForActiveGroup[attribute.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={selectionForActiveGroup[attribute.id] === value.id} key={`${attribute.id}:${value.id}`} disabled={!available} onClick={() => chooseAttribute(attribute.id, value.id, attribute.visibility === 'hidden')}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{userFoodResult && !activeResult && <p className="variant-picker-no-match">{resolution.error}</p>}{activeResult && selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{selectedFoodName}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}</small></div> : activeResult ? <p className="variant-picker-no-match">{resolution.error}</p> : null}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label={`分量を${amountUnit}単位で1つ増やす`}>＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>食事として登録</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

function LegacyFoodVariantPickerModal({ result, onSelect, onClose, mealMode = false, onSubmitMeal }: Omit<FoodVariantPickerModalProps, 'result'> & { result: FoodSearchResult }) {
  const optionGroups = useMemo(() => getVariantOptionGroups(result.variants), [result.variants])
  const defaultVariant = result.variants.find((food) => food.id === result.group.defaultVariantId) ?? result.food
  const [selection, setSelection] = useState(() => getVariantSelection(defaultVariant, optionGroups))
  const [fallbackVariantId, setFallbackVariantId] = useState(defaultVariant.id)
  const [amount, setAmount] = useState(String(defaultVariant.servingAmount ?? defaultVariant.baseAmount))
  const [constraintMessage, setConstraintMessage] = useState<string | null>(null)
  const fallbackGroup: VariantOptionGroup = useMemo(() => ({ key: 'variant', label: 'バリエーション', options: result.variants.map((food) => ({ value: food.id, label: variantOptionText(food) })) }), [result.variants])
  const groups = optionGroups.length > 0 ? optionGroups : [fallbackGroup]
  const matchingVariants = optionGroups.length > 0 ? filterVariantsBySelection(result.variants, selection) : result.variants.filter((food) => food.id === fallbackVariantId)
  const selectedFood = optionGroups.length > 0 ? resolveVariantForSelection(result.variants, selection, result.group.defaultVariantId) : matchingVariants[0] ?? null
  const availableOptionValues = useMemo(() => new Map(optionGroups.flatMap((group) => group.key === 'variant' ? [] : [[
    group.key,
    getAvailableVariantOptionValues(result.variants, optionGroups, selection, group.key),
  ]])), [optionGroups, result.variants, selection])
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  const selectedFoodDefaultUnit = selectedFood ? (selectedFood.servingUnit ?? selectedFood.baseUnit) : ''
  useEffect(() => {
    if (selectedFoodId) setAmount(selectedFoodDefaultAmount)
  }, [selectedFoodDefaultAmount, selectedFoodId])
  const [amountUnit, setAmountUnit] = useState<QuantityUnit>(selectedFoodDefaultUnit)
  useEffect(() => {
    setAmountUnit(selectedFoodDefaultUnit)
  }, [selectedFoodDefaultUnit, selectedFoodId])
  const isSelected = (group: VariantOptionGroup, value: string | null) => group.key === 'variant' ? fallbackVariantId === value : selection[group.key] === value
  const chooseOption = (group: VariantOptionGroup, value: string | null) => {
    if (group.key === 'variant') setFallbackVariantId(value ?? '')
    else {
      const reconciled = reconcileVariantSelection(result.variants, optionGroups, { ...selection, [group.key]: value })
      setSelection(reconciled.selection)
      setConstraintMessage(reconciled.clearedKeys.size > 0 ? '選択条件が変わったため、利用できない下位の属性を解除しました。' : null)
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品のバリエーションを選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">VARIATIONS</span><h2>{result.group.displayName}</h2><p className="muted">条件ごとに選択してください</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="variant-choice-groups">{groups.map((group) => <section className="variant-choice-group" key={group.key}><h3>{group.label}</h3><div className="variant-choice-buttons">{group.options.map((option) => { const available = group.key === 'variant' || (availableOptionValues.get(group.key)?.has(option.value) ?? false); return <button className={`variant-choice-button${isSelected(group, option.value) ? ' is-selected' : ''}`} type="button" aria-pressed={isSelected(group, option.value)} key={`${group.key}:${option.value ?? 'none'}`} disabled={!available} onClick={() => chooseOption(group, option.value)}><span>{option.label}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{variantOptionText(selectedFood)}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}kcal{matchingVariants.length > 1 ? ` · ${matchingVariants.length}件が該当` : ''}</small></div> : <p className="variant-picker-no-match">必要な属性を選択してください。</p>}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label={`分量を${amountUnit}単位で1つ増やす`}>＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>食事として登録</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

interface MenuViewProps { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onNewMenu: () => void; onEditMenu: (menu: Menu) => void; onDeleteMenu: (menu: Menu) => void; onNewMenuSet: () => void; onEditMenuSet: (menuSet: MenuSet) => void; onDeleteMenuSet: (menuSet: MenuSet) => void; onBack: () => void }
function MenuView({ menus, menuSets, foods, onNewMenu, onEditMenu, onDeleteMenu, onNewMenuSet, onEditMenuSet, onDeleteMenuSet }: MenuViewProps) {
  const [activeTab, setActiveTab] = useState<'menus' | 'sets'>('menus')
  const foodName = (id: string) => {
    const food = foods.find((item) => item.id === id)
    return food ? displayFoodName(food) : '削除済み食品'
  }
  const menuName = (id: string) => menus.find((menu) => menu.id === id)?.name ?? '削除済みメニュー'
  const menuSetItems = (menuSet: MenuSet) => [
    ...menuSet.menuIds.map((id) => ({ id: `menu:${id}`, kind: '料理メニュー', name: menuName(id) })),
    ...(menuSet.foodIds ?? []).map((id) => ({ id: `food:${id}`, kind: '食品', name: foodName(id) })),
  ]
  return <>
    <section className="page-heading"><div><span className="eyebrow">MENUS</span><h1>メニュー</h1></div></section>
    <div className="search-category-tabs menu-management-tabs" role="tablist" aria-label="メニュー種別">
      <button className={activeTab === 'menus' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'menus'} onClick={() => setActiveTab('menus')}>料理メニュー</button>
      <button className={activeTab === 'sets' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'sets'} onClick={() => setActiveTab('sets')}>メニューセット</button>
    </div>
    {activeTab === 'menus' ? <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">DISHES</span><h2>料理メニュー</h2></div><button className="button primary" type="button" onClick={onNewMenu}>＋ 料理メニュー</button></div>
      <div className="menu-category-groups">{MENU_CATEGORIES.map((category) => { const categoryMenus = menus.filter((menu) => menu.category === category); return <details className="menu-category-group" key={category}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary>{categoryMenus.length > 0 ? <div className="menu-list">{categoryMenus.map((menu) => { const ingredients = getMenuIngredients(menu, foods); return <div className="menu-card" key={menu.id}><div><strong>{menu.name}</strong><small>{ingredients.length ? ingredients.map((ingredient) => ingredient.kind === 'food' ? foodName(ingredient.itemId) : menuName(ingredient.itemId)).join('・') : '食材未選択'}</small></div><div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenu(menu)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenu(menu)}>削除</button></div></div> })}</div> : <p className="menu-picker-empty">この区分に登録された料理メニューはありません。</p>}</details> })}</div>
    </section> : <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">SETS</span><h2>メニューセット</h2></div><button className="button primary" type="button" onClick={onNewMenuSet}>＋ メニューセット</button></div>
      {menuSets.length === 0 ? <div className="empty-state">メニューセットはまだありません。</div> : <div className="menu-set-list">{menuSets.map((menuSet) => { const items = menuSetItems(menuSet); return <details className="menu-set-card" key={menuSet.id}><summary><span><span className="source-badge">セット</span><strong>{menuSet.name}</strong></span><small>{items.length > 0 ? `構成 ${items.length}件` : '構成なし'}</small></summary><div className="menu-set-card-body">{items.length > 0 ? <ul>{items.map((item) => <li key={item.id}><span>{item.kind}</span><strong>{item.name}</strong></li>)}</ul> : <p className="menu-picker-empty">メニュー・食品が選択されていません。</p>}<div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenuSet(menuSet)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenuSet(menuSet)}>削除</button></div></div></details> })}</div>}
    </section>}
  </>
}

interface MenuFoodSelectionProps {
  selectedIds: string[]
  selectedIngredients?: MenuIngredientDraft[]
  selectedMenuIds?: string[]
  menus?: Menu[]
  editingMenuId?: string | null
  foods: Food[]
  foodGroups: FoodGroup[]
  recentFoods: Food[]
  favoriteFoods: Food[]
  favoriteIds: Set<string>
  onToggleFavorite: (food: Food) => void
  onAdd: (food: Food) => void
  onRemove: (food: Food) => void
  onAddMenu?: (menu: Menu) => void
  onRemoveMenu?: (menu: Menu) => void
  onRemoveIngredient?: (ingredient: MenuIngredientDraft) => void
  onChangeIngredientAmount?: (ingredient: MenuIngredientDraft, amount: string) => void
  onChangeIngredientUnit?: (ingredient: MenuIngredientDraft, unit: QuantityUnit) => void
  showSelectedList?: boolean
  pickerTitle?: string
  foodAttributePreferences?: FoodAttributePreferences
  onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>
}

function MenuFoodChoiceRow({ food, selected, favorite, onAdd, onToggleFavorite }: { food: Food; selected: boolean; favorite: boolean; onAdd: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(food)} disabled={selected}>{selected ? '追加済み' : '追加'}</button><button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button></div>
}

function MenuIngredientChoiceRow({ menu, selected, onAdd }: { menu: Menu; selected: boolean; onAdd: (menu: Menu) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{menu.name}</strong><span>料理メニュー · {menu.category}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(menu)} disabled={selected}>{selected ? '追加済み' : '追加'}</button></div>
}

function MenuIngredientRow({ ingredient, foods, menus, onChangeAmount, onChangeUnit, onRemove }: { ingredient: MenuIngredientDraft; foods: Food[]; menus: Menu[]; onChangeAmount: (amount: string) => void; onChangeUnit?: (unit: QuantityUnit) => void; onRemove: () => void }) {
  const food = ingredient.kind === 'food' ? foods.find((item) => item.id === ingredient.itemId) : undefined
  const menu = ingredient.kind === 'menu' ? menus.find((item) => item.id === ingredient.itemId) : undefined
  const name = food ? displayFoodName(food) : menu?.name ?? (ingredient.kind === 'food' ? '削除済み食品' : '削除済みメニュー')
  const availableUnits = food ? getFoodQuantityUnits(food) : ['食']
  const unitOptions = availableUnits.includes(ingredient.unit) ? availableUnits : [...availableUnits, ingredient.unit]
  return <div className="menu-ingredient-row"><div className="menu-ingredient-copy"><span className="source-badge">{ingredient.kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><label className="menu-ingredient-amount"><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={ingredient.amount} onChange={(event) => onChangeAmount(event.target.value)} required />{onChangeUnit ? <select value={ingredient.unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select> : <span>{ingredient.unit}</span>}</label><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

function MenuSetSelectedItemRow({ kind, name, onRemove }: { kind: 'food' | 'menu'; name: string; onRemove: () => void }) {
  return <div className="menu-set-selected-row"><div><span className="source-badge">{kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

function MenuFoodSelection({ selectedIds, selectedIngredients, selectedMenuIds = [], menus = [], editingMenuId = null, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onAdd, onRemove, onAddMenu, onRemoveMenu, onRemoveIngredient, onChangeIngredientAmount, onChangeIngredientUnit, showSelectedList = true, pickerTitle = '食材を追加', foodAttributePreferences, onSaveFoodAttributePreference }: MenuFoodSelectionProps) {
  const [foodQuery, setFoodQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [userSearchResults, setUserSearchResults] = useState<UserFoodSearchResult[]>([])
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [variantResult, setVariantResult] = useState<FoodVariantPickerState | null>(null)
  const normalizedQuery = normalizeSearchText(foodQuery)
  const selectedFoods = selectedIds.map((id) => foods.find((food) => food.id === id)).filter((food): food is Food => Boolean(food))
  const selectedMenus = selectedMenuIds.map((id) => menus.find((menu) => menu.id === id)).filter((menu): menu is Menu => Boolean(menu))
  const selectedCount = selectedIngredients?.length ?? selectedFoods.length + selectedMenuIds.length
  const selectedIngredientKeys = new Set([
    ...(selectedIngredients?.map((ingredient) => `${ingredient.kind}:${ingredient.itemId}`) ?? []),
    ...selectedIds.map((id) => `food:${id}`),
    ...selectedMenuIds.map((id) => `menu:${id}`),
  ])
  const selectableMenus = menus.filter((menu) => menu.id !== editingMenuId && !wouldCreateMenuCycle(editingMenuId, menu.id, menus))
  const matchingMenus = selectableMenus.filter((menu) => [menu.name, menu.category, ...(menu.aliases ?? [])].some((value) => normalizeSearchText(value).includes(normalizedQuery)))
  const quickFoods = [...recentFoods, ...favoriteFoods].filter((food, index, all) => all.findIndex((item) => item.id === food.id) === index).slice(0, 8)

  const runSearch = async () => {
    const query = foodQuery.trim()
    if (!query) { setSearchedQuery(''); setUserSearchResults([]); setSearchResults([]); return }
    setSearching(true)
    try {
      const allUserResults = searchUserFoodGroups(query, { expandPartShortcuts: true })
      const coveredFoodGroupIds = new Set(allUserResults.flatMap((result) => result.group.memberFoodGroupIds))
      const { page } = await searchFoodResults(query, { limit: 20 })
      setUserSearchResults(allUserResults.slice(0, 20))
      setSearchResults(page.results.filter((result) => !coveredFoodGroupIds.has(result.group.id)))
      setSearchedQuery(normalizeSearchText(query))
    } catch {
      setUserSearchResults([])
      setSearchResults([])
      setSearchedQuery(normalizeSearchText(query))
    } finally {
      setSearching(false)
    }
  }

  const showSearchResults = normalizedQuery.length > 0 && searchedQuery === normalizedQuery
  const chooseSearchResult = (result: FoodSearchResult) => {
    if (result.variants.length > 1) setVariantResult({ result })
    else onAdd(result.food)
  }

  const chooseResolvedFoodGroup = (foodGroupId: string) => {
    const result = buildMextFoodSearchResult(foodGroupId, foods, foodGroups)
    if (!result) return
    chooseSearchResult(result)
  }

  const chooseUserSearchResult = (result: UserFoodSearchResult) => {
    if (result.group.selectionDimensions.length > 0 && Object.keys(result.presetSelection).length === 0) {
      setVariantResult({ result: null, userFoodResult: result })
      return
    }
    try {
      const foodGroupId = result.foodGroupId ?? resolveFoodGroupId(result.group.id, result.presetSelection)
      chooseResolvedFoodGroup(foodGroupId)
    } catch (error) {
      if (error instanceof MissingRequiredUserSelection) {
        setVariantResult({ result: null, userFoodResult: result })
      }
    }
  }

  return (
    <div className="menu-food-selection">
      {showSelectedList && <><div className="menu-selected-heading"><span>選択中の食材</span><span>{selectedCount}件</span></div>
        {selectedCount > 0
            ? <div className="menu-selected-foods">{selectedIngredients
            ? selectedIngredients.map((ingredient) => <MenuIngredientRow key={`${ingredient.kind}:${ingredient.itemId}`} ingredient={ingredient} foods={foods} menus={menus} onChangeAmount={(amount) => onChangeIngredientAmount?.(ingredient, amount)} onChangeUnit={onChangeIngredientUnit ? (unit) => onChangeIngredientUnit(ingredient, unit) : undefined} onRemove={() => onRemoveIngredient?.(ingredient)} />)
            : <>{selectedMenus.map((menu) => <MenuSetSelectedItemRow key={`menu:${menu.id}`} kind="menu" name={menu.name} onRemove={() => onRemoveMenu?.(menu)} />)}{selectedFoods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onRemove={onRemove} />)}</>}</div>
          : <p className="menu-food-empty">まだ食材がありません。下の「食材を追加」から選択してください。</p>}</>}
      <details className="food-collapsible menu-food-picker">
        <summary className="section-title collapsible-summary"><div><span className="eyebrow">ADD ITEMS</span><h3>{pickerTitle}</h3></div></summary>
        <div className="menu-food-picker-body">
          <div className="menu-food-search-row">
            <label className="menu-food-search">食材を検索
              <input value={foodQuery} onChange={(event) => { setFoodQuery(event.target.value); setSearchedQuery('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder={onAddMenu ? '食品名・メーカー・料理メニュー名' : '食品名・メーカー'} />
            </label>
            <button className="button secondary menu-food-search-button" type="button" onClick={() => void runSearch()} disabled={searching}>{searching ? '検索中…' : '検索する'}</button>
          </div>
          {showSearchResults ? (
            <>
              <div className="menu-food-section-heading"><span className="eyebrow">SEARCH RESULTS</span><h4>検索結果：{foodQuery.trim()}</h4></div>
              <div className="menu-food-search-results">
                {userSearchResults.length > 0 || searchResults.length > 0 || (onAddMenu && matchingMenus.length > 0)
                  ? <>{onAddMenu && matchingMenus.map((menu) => <button className="menu-food-search-result" type="button" key={`menu:${menu.id}`} disabled={selectedIngredientKeys.has(`menu:${menu.id}`)} onClick={() => onAddMenu(menu)}><span className="source-badge">料理</span><span><strong>{menu.name}</strong><small>{menu.category} · 1食単位</small></span><b>{selectedIngredientKeys.has(`menu:${menu.id}`) ? '追加済み' : '›'}</b></button>)}{userSearchResults.map((result) => { const label = selectedUserFoodLabel(result); return <button className="menu-food-search-result" type="button" key={`user:${result.group.id}:${result.foodGroupId ?? 'group'}`} onClick={() => chooseUserSearchResult(result)}><span className="source-badge">食品</span><span><strong>{label ?? result.group.displayName}</strong><small>{label ? `${result.group.displayName} > ${selectedUserFoodDimensionLabel(result) ?? '種類'}` : `${result.group.category} · ${result.group.memberCount > 1 ? `${result.group.memberCount}種類` : '直接選択'}`}</small></span><b>›</b></button> })}{searchResults.map((result) => { const selected = result.variants.length === 1 && selectedIngredientKeys.has(`food:${result.food.id}`); return <button className="menu-food-search-result" type="button" key={result.group.id} disabled={selected} onClick={() => chooseSearchResult(result)}><span className="source-badge">食品</span><span><strong>{displaySearchFoodName(result.group, result.food)}</strong><small>{result.group.category ?? '食品'} · {result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · {formatNutrient(result.food.nutrients.energyKcal)}kcal</small></span><b>{selected ? '追加済み' : '›'}</b></button> })}</>
                  : <p className="menu-food-empty">検索に一致する食品・料理メニューがありません。</p>}
              </div>
            </>
          ) : (
            <>
              <div className="menu-food-quick">
                <div className="menu-food-section-heading"><span className="eyebrow">QUICK ADD</span><h4>最近・お気に入り</h4></div>
                {quickFoods.length > 0
                  ? <div className="menu-food-list">{quickFoods.map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIngredientKeys.has(`food:${food.id}`)} favorite={favoriteIds.has(food.id)} onAdd={onAdd} onToggleFavorite={onToggleFavorite} />)}</div>
                  : <p className="menu-food-empty">最近使った食品やお気に入りはありません。</p>}
              </div>
              {onAddMenu && <><div className="menu-food-section-heading"><span className="eyebrow">MENUS</span><h4>料理メニュー</h4></div>{selectableMenus.length > 0 ? <div className="menu-food-list">{selectableMenus.map((menu) => <MenuIngredientChoiceRow key={menu.id} menu={menu} selected={selectedIngredientKeys.has(`menu:${menu.id}`)} onAdd={onAddMenu} />)}</div> : <p className="menu-food-empty">追加できる料理メニューがありません。</p>}</>}
              <div className="menu-food-section-heading"><span className="eyebrow">FOODS</span><h4>食品</h4></div>
              <div className="menu-food-list">{foods.slice(0, 60).map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIngredientKeys.has(`food:${food.id}`)} favorite={favoriteIds.has(food.id)} onAdd={onAdd} onToggleFavorite={onToggleFavorite} />)}</div>
              {foods.length > 60 && <p className="menu-food-more">食品名を検索すると、続きの食品を表示できます。</p>}
            </>
          )}
        </div>
      </details>
      {variantResult && <FoodVariantPickerModal result={variantResult.result} userFoodResult={variantResult.userFoodResult} foods={foods} foodGroups={foodGroups} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onSelect={(food) => { onAdd(food); setVariantResult(null) }} onClose={() => setVariantResult(null)} />}
    </div>
  )
}

function MenuEditorModal({ draft, setDraft, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose }: { draft: MenuDraft; setDraft: React.Dispatch<React.SetStateAction<MenuDraft | null>>; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => {
    if (!current || current.ingredients.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === food.id)) return current
    const serving = getFoodDefaultServing(food)
    return { ...current, ingredients: [...current.ingredients, { kind: 'food', itemId: food.id, amount: String(serving.amount), unit: serving.unit }] }
  })
  const addMenu = (menu: Menu) => setDraft((current) => current && !current.ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.itemId === menu.id) ? { ...current, ingredients: [...current.ingredients, { kind: 'menu', itemId: menu.id, amount: '1', unit: '食' }] } : current)
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.kind !== 'food' || ingredient.itemId !== food.id) } : current)
  const removeIngredient = (target: MenuIngredientDraft) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.kind !== target.kind || ingredient.itemId !== target.itemId) } : current)
  const changeIngredientAmount = (target: MenuIngredientDraft, amount: string) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((ingredient) => ingredient.kind === target.kind && ingredient.itemId === target.itemId ? { ...ingredient, amount } : ingredient) } : current)
  const changeIngredientUnit = (target: MenuIngredientDraft, unit: QuantityUnit) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((ingredient) => ingredient.kind === target.kind && ingredient.itemId === target.itemId ? { ...ingredient, unit } : ingredient) } : current)
  const selectedFoodIds = draft.ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId)
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="料理メニューを設定">
      <section className="modal-card menu-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">MENU</span><h2>{draft.id ? '料理メニューを編集' : '料理メニューを設定'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="menu-editor-form" onSubmit={onSubmit}>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">BASIC</span><h3>基本情報</h3></div>
            </div>
            <div className="menu-editor-basic-fields">
              <label className="menu-editor-name-field">メニュー名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label>
              <label>区分<select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as MenuCategory } : current)}>{MENU_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="menu-editor-alias-field">検索用エイリアス（任意）<input value={draft.aliases.join('、')} onChange={(event) => setDraft((current) => current ? { ...current, aliases: event.target.value.split(/[、,，]/).map((alias) => alias.trim()).filter(Boolean) } : current)} placeholder="例：おにぎり、朝ごはん" /></label>
            </div>
          </section>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">SELECTED</span><h3>追加済み食材</h3></div>
              <span className="menu-editor-count">{draft.ingredients.length}件</span>
            </div>
            {draft.ingredients.length > 0
              ? <div className="menu-editor-selected-list">{draft.ingredients.map((ingredient) => <MenuIngredientRow key={`${ingredient.kind}:${ingredient.itemId}`} ingredient={ingredient} foods={foods} menus={menus} onChangeAmount={(amount) => changeIngredientAmount(ingredient, amount)} onChangeUnit={(unit) => changeIngredientUnit(ingredient, unit)} onRemove={() => removeIngredient(ingredient)} />)}</div>
              : <p className="menu-editor-empty">まだ食材がありません。下の「食材を追加」から選択してください。</p>}
          </section>
          <section className="menu-editor-section menu-editor-add-section">
            <MenuFoodSelection selectedIds={selectedFoodIds} selectedIngredients={draft.ingredients} menus={menus} editingMenuId={draft.id} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={removeFood} onAddMenu={addMenu} showSelectedList={false} pickerTitle="食材を追加" />
          </section>
          <div className="menu-editor-actions">
            <button className="button primary full-width" type="submit">保存する</button>
            <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function MenuSetEditorModal({ draft, setDraft, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose }: { draft: MenuSetDraft; setDraft: React.Dispatch<React.SetStateAction<MenuSetDraft | null>>; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => current && !current.foodIds.includes(food.id) ? { ...current, foodIds: [...current.foodIds, food.id] } : current)
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== food.id) } : current)
  const addMenu = (menu: Menu) => setDraft((current) => current && !current.menuIds.includes(menu.id) ? { ...current, menuIds: [...current.menuIds, menu.id] } : current)
  const removeMenu = (menuId: string) => setDraft((current) => current ? { ...current, menuIds: current.menuIds.filter((id) => id !== menuId) } : current)
  const selectedCount = draft.foodIds.length + draft.menuIds.length
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="メニューセットを設定">
      <section className="modal-card menu-editor-modal menu-set-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">MENU SET</span><h2>{draft.id ? 'メニューセットを編集' : 'メニューセットを設定'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="menu-editor-form" onSubmit={onSubmit}>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">NAME</span><h3>セット名</h3></div>
            </div>
            <label className="menu-editor-name-field"><span className="sr-only">セット名</span><input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} placeholder="例：いつもの朝食" required /></label>
          </section>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">SELECTED</span><h3>追加済み食品</h3><p>食品と料理メニューを、セット登録時にまとめて食事へ追加します。</p></div>
              <span className="menu-editor-count">{selectedCount}件</span>
            </div>
            {selectedCount > 0
              ? <div className="menu-set-selected-list">
                {draft.menuIds.map((menuId) => {
                  const menu = menus.find((item) => item.id === menuId)
                  return <MenuSetSelectedItemRow key={`menu:${menuId}`} kind="menu" name={menu?.name ?? '削除済み料理メニュー'} onRemove={() => removeMenu(menuId)} />
                })}
                {draft.foodIds.map((foodId) => {
                  const food = foods.find((item) => item.id === foodId)
                  return <MenuSetSelectedItemRow key={`food:${foodId}`} kind="food" name={food ? displayFoodName(food) : '削除済み食品'} onRemove={() => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== foodId) } : current)} />
                })}
              </div>
              : <p className="menu-editor-empty">まだ食品や料理メニューがありません。下の追加欄から選択してください。</p>}
          </section>
          <section className="menu-editor-section menu-editor-add-section">
            <MenuFoodSelection selectedIds={draft.foodIds} selectedMenuIds={draft.menuIds} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={removeFood} onAddMenu={addMenu} showSelectedList={false} pickerTitle="食品・料理メニューを追加" />
          </section>
          <div className="menu-editor-actions">
            <button className="button primary full-width" type="submit">保存する</button>
            <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  )
}

interface SettingsViewProps {
  settings: Awaited<ReturnType<typeof getSettings>>
  goalInputs: Record<NutrientKey, string>
  setGoalInputs: React.Dispatch<React.SetStateAction<Record<NutrientKey, string>>>
  onSaveGoals: (event: React.FormEvent<HTMLFormElement>) => void
  onToggleExternalApi: (enabled: boolean) => void
  onChangeDefaultMealTimeMode: (mode: MealTimeMode) => void
  onExportJson: () => void
  onRestoreJson: (event: React.ChangeEvent<HTMLInputElement>) => void
  onExportCsv: () => void
  onImportCsv: (event: React.ChangeEvent<HTMLInputElement>) => void
  csvFrom: string
  csvTo: string
  setCsvFrom: (value: string) => void
  setCsvTo: (value: string) => void
  counts: { foods: number; meals: number; menus: number; menuSets: number }
}

function SettingsView({ settings, goalInputs, setGoalInputs, onSaveGoals, onToggleExternalApi, onChangeDefaultMealTimeMode, onExportJson, onRestoreJson, onExportCsv, onImportCsv, csvFrom, csvTo, setCsvFrom, setCsvTo, counts }: SettingsViewProps) {
  const configuredGoalCount = NUTRIENT_KEYS.filter((key) => settings.goals[key] !== null).length
  return <>
    <section className="page-heading"><div><span className="eyebrow">SETTINGS</span><h1>設定・データ管理</h1></div></section>
    <details className="settings-card food-collapsible settings-goals-collapsible">
      <summary className="section-title collapsible-summary"><div><span className="eyebrow">GOALS</span><h2>栄養目標</h2></div><span className="count-label">{configuredGoalCount > 0 ? `${configuredGoalCount}項目を設定` : '未設定'}</span></summary>
      <form onSubmit={onSaveGoals} className="goal-form">
        {NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={goalInputs[key]} onChange={(event) => setGoalInputs((current) => ({ ...current, [key]: event.target.value }))} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}
        <button className="button primary" type="submit">目標を保存</button>
      </form>
    </details>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h2>食事時刻</h2></div></div>
      <label>既定の時刻入力<select value={settings.mealTimeMode ?? 'auto'} onChange={(event) => onChangeDefaultMealTimeMode(event.target.value as MealTimeMode)}><option value="auto">現在時刻を自動挿入</option><option value="manual">自分で入力</option></select></label>
    </section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">BACKUP</span><h2>バックアップ</h2></div></div>
      <div className="data-stats">
        <div><strong>{counts.foods}</strong><span>食品</span></div>
        <div><strong>{counts.meals}</strong><span>食事記録</span></div>
        <div><strong>{settings.dataFormatVersion}</strong><span>データ形式</span></div>
        <div><strong>{counts.menus}</strong><span>料理メニュー</span></div>
        <div><strong>{counts.menuSets}</strong><span>メニューセット</span></div>
      </div>
      <p className="helper-text">最終バックアップ: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '未作成'}</p>
      <div className="settings-info-row settings-inline-row">
        <label className="toggle-row"><input type="checkbox" checked={settings.externalApiEnabled} onChange={(event) => onToggleExternalApi(event.target.checked)} />食品が見つからないときにOpen Food Factsを検索する</label>
        <InfoPopover className="settings-info" label="外部APIについて" text="外部APIにはバーコード番号のみを送り、取得値は確認後に保存します。通信失敗時は手入力へ進みます。" />
      </div>
      <div className="settings-info-row backup-actions">
        <div className="settings-action-buttons">
          <button className="button primary" type="button" onClick={onExportJson}>JSONを出力</button>
          <label className="button secondary file-button">JSONを復元<input type="file" accept="application/json,.json" onChange={onRestoreJson} /></label>
        </div>
        <InfoPopover className="settings-info" label="JSONバックアップについて" text="JSONには食品、食事記録、お気に入り、料理メニュー、メニューセット、設定を含めます。復元前には現在データを自動退避します。" />
      </div>
    </section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">CSV EXPORT / IMPORT</span><h2>食事履歴CSV</h2></div></div>
      <div className="date-range"><label>開始日<input type="date" value={csvFrom} onChange={(event) => setCsvFrom(event.target.value)} /></label><span>〜</span><label>終了日<input type="date" value={csvTo} onChange={(event) => setCsvTo(event.target.value)} /></label></div>
      <div className="settings-info-row csv-action-row">
        <div className="settings-action-buttons">
          <button className="button secondary" type="button" onClick={onExportCsv}>CSVを出力</button>
          <label className="button secondary file-button csv-import-button">CSVを取り込む<input type="file" accept="text/csv,.csv" onChange={onImportCsv} /></label>
        </div>
        <InfoPopover className="settings-info" label="CSVについて" text="UTF-8 BOM付きです。このPWAで出力したCSVは食事履歴の復元に使えます。取り込み時は同じIDの記録を上書きします。" />
      </div>
    </section>
  </>
}

function SettingsExtras({ bodyProfileInputs, setBodyProfileInputs, onSaveBodyProfile, onOpenNewFood, onOpenFoodMaster, estimatedGoals, bmi }: { bodyProfileInputs: BodyProfileDraft; setBodyProfileInputs: React.Dispatch<React.SetStateAction<BodyProfileDraft>>; onSaveBodyProfile: (event: React.FormEvent<HTMLFormElement>) => void; onOpenNewFood: () => void; onOpenFoodMaster: () => void; estimatedGoals: NutritionGoals | null; bmi: number | null }) {
  return <><section className="settings-card body-profile-card"><div className="section-title"><div><span className="eyebrow">BODY PROFILE</span><h2>身体情報と推定目標</h2></div></div><form onSubmit={onSaveBodyProfile} className="body-profile-form"><div className="two-fields"><label>身長（cm）<input type="number" min="1" max="300" step="0.1" value={bodyProfileInputs.heightCm} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, heightCm: event.target.value }))} placeholder="未設定" /></label><label>体重（kg）<input type="number" min="1" max="500" step="0.1" value={bodyProfileInputs.weightKg} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, weightKg: event.target.value }))} placeholder="未設定" /></label></div><div className="two-fields"><label>年齢（歳）<input type="number" min="1" max="120" step="1" value={bodyProfileInputs.ageYears} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, ageYears: event.target.value }))} placeholder="算出に使用" /></label><label>性別<select value={bodyProfileInputs.sex} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, sex: event.target.value as BiologicalSex }))}><option value="unspecified">未選択</option><option value="male">男性</option><option value="female">女性</option></select></label></div><label>活動量<select value={bodyProfileInputs.activityLevel} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, activityLevel: event.target.value as ActivityLevel }))}><option value="low">低い</option><option value="moderate">普通</option><option value="high">高い</option></select></label><button className="button primary" type="submit">身体情報を保存して目標を算出</button></form><div className="estimated-target"><div><span>BMI</span><strong>{bmi === null ? '未計算' : bmi.toFixed(1)}</strong></div><div><span>推定エネルギー目標</span><strong>{estimatedGoals === null ? '未計算' : `${estimatedGoals.energyKcal ?? '未設定'} kcal`}</strong></div></div>{estimatedGoals && <div className="estimated-goals"><div className="estimated-goals-heading"><strong>栄養素の参考目標</strong><span>P15% / F25% / C60%</span></div><div className="estimated-goal-grid">{NUTRIENT_KEYS.filter((key) => key !== 'energyKcal').map((key) => <div key={key}><span>{NUTRIENT_LABELS[key]}</span><strong>{formatNutrient(estimatedGoals[key])}<small>{NUTRIENT_UNITS[key]}</small></strong></div>)}</div></div>}<div className="estimate-info-row"><span>参考目標の算出について</span><InfoPopover label="参考目標の算出について" text="算出値は一般的な推定式・栄養配分による参考値です。食塩は性別ごとの一般的な上限目安を表示しています。診断・治療・個別の栄養指導を目的とせず、体調や医療上の指示がある場合は専門家に相談してください。" /></div></section><section className="settings-card"><div className="section-title"><div><span className="eyebrow">FOOD MASTER</span><h2>食品登録</h2></div></div><div className="food-master-actions"><button className="button primary" type="button" onClick={onOpenNewFood}>＋ 新しい食品を登録</button><button className="button secondary" type="button" onClick={onOpenFoodMaster}>登録済み食品を確認・検索</button></div></section><section className="privacy-note"><strong>医療目的ではありません</strong><p>このアプリは日々の記録を支援するもので、診断・治療・個別の栄養指導を行いません。</p><span>Nutrition PWA v0.1.0 · 端末内のみで動作</span></section></>
}

function MealTypePickerModal({ food, recordedMealTypes, onSelect }: { food: Food | null; recordedMealTypes: MealType[]; onSelect: (type: MealType) => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を追加"><section className="modal-card meal-type-picker">{food && <p className="helper-text">「{food.name}」を記録する区分を選択してください。</p>}<div className="meal-type-options">{MEAL_TYPES.map((type) => { const recorded = recordedMealTypes.includes(type); return <button key={type} className={`meal-type-option${recorded ? ' is-recorded' : ''}`} type="button" onClick={() => onSelect(type)} aria-label={`${type}${recorded ? '（記録済み）' : ''}`}><img src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{recorded && <span className="meal-type-check" aria-hidden="true">✓</span>}</button> })}</div></section></div>
}

function MealSnapshotIngredientRow({ ingredient, onChange, onRemove }: { ingredient: MealIngredientSnapshot; onChange: (ingredient: MealIngredientSnapshot) => void; onRemove: () => void }) {
  const name = ingredient.kind === 'food' ? ingredient.foodSnapshot.name : ingredient.name
  const availableUnits = ingredient.kind === 'food'
    ? [ingredient.foodSnapshot.baseUnit, ...(ingredient.foodSnapshot.inputUnitConversions ?? []).map((conversion) => conversion.unit)]
    : ['食']
  const unitOptions = availableUnits.includes(ingredient.unit) ? availableUnits : [...availableUnits, ingredient.unit]
  const changeChild = (index: number, child: MealIngredientSnapshot) => {
    if (ingredient.kind !== 'menu') return
    onChange({ ...ingredient, ingredients: ingredient.ingredients.map((current, currentIndex) => currentIndex === index ? child : current) })
  }
  const removeChild = (index: number) => {
    if (ingredient.kind !== 'menu') return
    onChange({ ...ingredient, ingredients: ingredient.ingredients.filter((_, currentIndex) => currentIndex !== index) })
  }
  return <div className={`meal-snapshot-ingredient${ingredient.kind === 'menu' ? ' is-menu' : ''}`}><div className="menu-ingredient-row"><div className="menu-ingredient-copy"><span className="source-badge">{ingredient.kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><label className="menu-ingredient-amount"><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={ingredient.amount > 0 ? ingredient.amount : ''} onChange={(event) => onChange({ ...ingredient, amount: Number(event.target.value) })} required />{ingredient.kind === 'food' ? <select value={ingredient.unit} onChange={(event) => onChange({ ...ingredient, unit: event.target.value })} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select> : <span>{ingredient.unit}</span>}</label><button type="button" className="small-action danger-text" onClick={onRemove}>削除</button></div>{ingredient.kind === 'menu' && <details className="meal-snapshot-nested"><summary>{ingredient.name}の構成食材（{ingredient.ingredients.length}件）</summary><div>{ingredient.missing && <p className="menu-food-empty">原本は削除されています。保存済みの構成だけを使用します。</p>}{ingredient.ingredients.map((child, index) => <MealSnapshotIngredientRow key={`${child.kind}:${child.itemId}:${index}`} ingredient={child} onChange={(next) => changeChild(index, next)} onRemove={() => removeChild(index)} />)}</div></details>}</div>
}

function MealModal({ food, amount, setAmount, amountUnit, setAmountUnit, menuSnapshot, setMenuSnapshot, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, editing, onSubmit, onClose }: { food: Food; amount: string; setAmount: (value: string) => void; amountUnit: QuantityUnit; setAmountUnit: (value: QuantityUnit) => void; menuSnapshot: MealMenuSnapshot | null; setMenuSnapshot: (snapshot: MealMenuSnapshot | null) => void; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; editing: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const preview = menuSnapshot
    ? calculateMealMenuEntryNutrients(menuSnapshot, Number(amount), amountUnit)
    : calculateNutrients(food, Number(amount), amountUnit)
  const numericAmount = Number(amount)
  const canIncrement = !Number.isFinite(numericAmount) || numericAmount < 100000
  const incrementAmount = () => setAmount(String(incrementByQuantityUnit(numericAmount, food, amountUnit)))
  const changeIngredient = (index: number, ingredient: MealIngredientSnapshot) => setMenuSnapshot(menuSnapshot ? { ...menuSnapshot, ingredients: menuSnapshot.ingredients.map((current, currentIndex) => currentIndex === index ? ingredient : current) } : null)
  const removeIngredient = (index: number) => setMenuSnapshot(menuSnapshot ? { ...menuSnapshot, ingredients: menuSnapshot.ingredients.filter((_, currentIndex) => currentIndex !== index) } : null)
  const addFood = (ingredientFood: Food) => {
    if (!menuSnapshot || menuSnapshot.ingredients.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === ingredientFood.id)) return
    setMenuSnapshot({ ...menuSnapshot, ingredients: [...menuSnapshot.ingredients, createMealFoodIngredientSnapshot(ingredientFood)] })
  }
  const addMenu = (menu: Menu) => {
    if (!menuSnapshot || menuSnapshot.ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.itemId === menu.id)) return
    setMenuSnapshot({ ...menuSnapshot, ingredients: [...menuSnapshot.ingredients, createMealMenuIngredientSnapshot(menu, menus, foods)] })
  }
  const selectedIngredients: MenuIngredientDraft[] = menuSnapshot?.ingredients.map((ingredient) => ({ kind: ingredient.kind, itemId: ingredient.itemId, amount: String(ingredient.amount), unit: ingredient.unit })) ?? []
  const selectedFoodIds = selectedIngredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を記録"><section className={`modal-card${menuSnapshot ? ' meal-menu-modal' : ''}`}><div className="modal-heading"><div><span className="eyebrow">ADD MEAL</span><h2>{editing ? '食事を編集' : '食事を記録'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="selected-food"><strong>{food.displayName ?? food.name}</strong><span>{menuSnapshot ? '料理メニュー' : (food.maker || '一般食品')} · 基準量 {food.baseAmount}{food.baseUnit}{food.inputUnitConversions?.length ? ` · 入力用単位 ${food.inputUnitConversions.map((conversion) => `1${conversion.unit}=${conversion.baseAmount}${food.baseUnit}`).join('、')}` : ''}</span></div><form onSubmit={onSubmit}><label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力用単位">{getFoodQuantityUnits(food).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={incrementAmount} disabled={!canIncrement} aria-label={`分量を${amountUnit}単位で1つ増やす`}>＋1</button></div></label>{menuSnapshot && <fieldset className="meal-menu-snapshot-editor"><legend>この食事の構成食材</legend><p className="helper-text">表示中の分量は1食分です。ここでの変更はこの食事だけに保存され、料理メニュー原本には反映されません。食材を置き換える場合は、元の食材を削除してから追加してください。</p><div className="meal-snapshot-ingredients">{menuSnapshot.ingredients.length > 0 ? menuSnapshot.ingredients.map((ingredient, index) => <MealSnapshotIngredientRow key={`${ingredient.kind}:${ingredient.itemId}:${index}`} ingredient={ingredient} onChange={(next) => changeIngredient(index, next)} onRemove={() => removeIngredient(index)} />) : <p className="menu-food-empty">構成食材がありません。下から追加できます。</p>}</div><MenuFoodSelection selectedIds={selectedFoodIds} selectedIngredients={selectedIngredients} menus={menus} editingMenuId={menuSnapshot.sourceMenuId} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={() => undefined} onAddMenu={addMenu} showSelectedList={false} /></fieldset>}<div className="preview-box calorie-preview"><div className="section-kicker">今回のカロリー</div><strong>{formatNutrient(preview.energyKcal)}<small> kcal</small></strong></div><button className="button primary full-width" type="submit">{editing ? '変更を保存' : '食事として登録'}</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

function MealDetailsModal({ details, goals, onUpdateTimes, onClose }: { details: { type: MealType; entries: MealEntry[]; subtotal: Nutrients }; goals: NutritionGoals; onUpdateTimes: (entryIds: string[], time: string) => void; onClose: () => void }) {
  const [sharedTime, setSharedTime] = useState(details.entries[0] ? toTokyoTimeInput(details.entries[0].eatenAt) : '')
  const [snackTimes, setSnackTimes] = useState<Record<string, string>>(() => Object.fromEntries(details.entries.map((entry) => [entry.id, toTokyoTimeInput(entry.eatenAt)])))
  const sharedEntryIds = details.entries.map((entry) => entry.id)
  const availableNutrients = sumAvailableNutrients(details.entries)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${details.type}の栄養詳細`}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">NUTRIENTS</span><h2>{details.type}の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(details.subtotal.energyKcal)}<small> kcal</small></strong></div><NutrientGoalGraphs nutrients={details.subtotal} availableNutrients={availableNutrients} goals={goals} /><section className="meal-time-editor"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h3>食事時刻</h3></div></div>{details.type !== '間食' ? <form className="inline-time-form" onSubmit={(event) => { event.preventDefault(); onUpdateTimes(sharedEntryIds, sharedTime) }}><label><input aria-label="食事時刻" type="time" value={sharedTime} onChange={(event) => setSharedTime(event.target.value)} required /></label><button className="button secondary" type="submit">時刻を保存</button></form> : <div className="snack-time-list">{details.entries.map((entry) => <div className="snack-time-row" key={entry.id}><span>{entry.foodSnapshot.name}</span><input type="time" value={snackTimes[entry.id] ?? ''} onChange={(event) => setSnackTimes((current) => ({ ...current, [entry.id]: event.target.value }))} /><button className="small-action" type="button" onClick={() => onUpdateTimes([entry.id], snackTimes[entry.id] ?? '')}>保存</button></div>)}</div>}</section><div className="detail-entry-list">{details.entries.map((entry) => <div className="detail-entry" key={entry.id}><span>{entry.foodSnapshot.name} · {entry.amount}{entry.amountUnit}</span><strong>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</strong></div>)}</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}

function FoodFormView({ draft, returnView, allowCommercialClassification, setDraft, foodGroups, foodAliases, foodRelatedTerms, externalNote, onSubmit, onClose }: { draft: FoodDraft; returnView: FoodFormReturnView; allowCommercialClassification: boolean; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; foodGroups: FoodGroup[]; foodAliases: FoodAlias[]; foodRelatedTerms: FoodRelatedTerm[]; externalNote: string | null; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'basic' | 'nutrition' | 'search'>('basic')
  const update = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current)
  const updateBaseUnit = (baseUnit: FoodUnit) => setDraft((current) => {
    if (!current) return current
    const normalizedInputUnit = current.inputUnit.trim()
    const inputUnit = normalizedInputUnit === current.baseUnit || normalizedInputUnit === baseUnit ? '' : current.inputUnit
    const allowed = [baseUnit, ...(inputUnit.trim() && inputUnit.trim() !== baseUnit ? [inputUnit.trim()] : [])]
    return { ...current, baseUnit, inputUnit, inputUnitBaseAmount: inputUnit ? current.inputUnitBaseAmount : '', servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : baseUnit }
  })
  const updateInputUnit = (inputUnit: string) => setDraft((current) => {
    if (!current) return current
    const normalized = inputUnit.trim()
    const allowed = [current.baseUnit, ...(normalized && normalized !== current.baseUnit ? [normalized] : [])]
    return { ...current, inputUnit, inputUnitBaseAmount: normalized && normalized !== current.baseUnit ? current.inputUnitBaseAmount : '', servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : current.baseUnit }
  })
  const inputUnit = draft.inputUnit.trim()
  const servingUnitOptions = [...new Set([draft.baseUnit, ...(inputUnit && inputUnit !== draft.baseUnit ? [inputUnit] : [])])]
  const updateProductName = (value: string) => setDraft((current) => {
    if (!current) return current
    return { ...current, name: value, groupDisplayName: shouldFollowFoodName(current.groupDisplayName, current.name) ? value : current.groupDisplayName }
  })
  const selectFamily = (value: string) => setDraft((current) => {
    if (!current) return current
    const group = foodGroups.find((item) => item.id === value)
    if (!group) return { ...current, foodGroupId: value }
    return {
      ...current, foodGroupId: value, groupDisplayName: group.displayName, groupReading: group.reading ?? '', groupCategory: group.category ?? '',
      aliases: foodAliases.filter((alias) => alias.foodGroupId === value && alias.isActive).map((alias) => ({ value: alias.alias, type: alias.aliasType })),
      relatedTerms: foodRelatedTerms.filter((term) => term.foodGroupId === value && term.isActive).map((term) => term.term),
    }
  })
  const addAlias = () => update('aliases', [...draft.aliases, { value: '', type: 'synonym' }])
  const addRelatedTerm = () => update('relatedTerms', [...draft.relatedTerms, ''])
  return <>
    <section className="page-heading food-form-heading"><div><span className="eyebrow">FOOD MASTER</span><h1>{draft.id ? '食品を編集' : '新しい食品を登録'}</h1></div><button className="button ghost" type="button" onClick={onClose}>{returnView === 'settings' ? '← 設定へ' : '← 食品画面へ'}</button></section>
    <section className="settings-card food-form-card">
      {externalNote && <div className="external-warning">{externalNote}</div>}
      <form onSubmit={(event) => { if (!draft.name.trim() || !isPositiveFinite(Number(draft.baseAmount))) setActiveTab('basic'); onSubmit(event) }}>
        <div className="search-category-tabs food-form-tabs" role="tablist" aria-label="食品登録項目">
          <button className={activeTab === 'basic' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'basic'} onClick={() => setActiveTab('basic')}>基本情報</button>
          <button className={activeTab === 'nutrition' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'nutrition'} onClick={() => setActiveTab('nutrition')}>栄養値</button>
          <button className={activeTab === 'search' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'search'} onClick={() => setActiveTab('search')}>検索設定</button>
        </div>

        {activeTab === 'basic' && <div className="food-form-tab-panel" role="tabpanel">
          <label>食品名*<input value={draft.name} onChange={(event) => updateProductName(event.target.value)} required /></label>
          <label>メーカー<input value={draft.maker} onChange={(event) => update('maker', event.target.value)} /></label>
          <label>バーコード（JAN/GTIN）<input inputMode="numeric" value={draft.barcode} onChange={(event) => update('barcode', event.target.value)} placeholder="任意・8〜14桁" /></label>
          {allowCommercialClassification && <div className="food-commercial-setting"><label className="toggle-row"><input type="checkbox" checked={draft.isCommercial} onChange={(event) => update('isCommercial', event.target.checked)} />外食・市販として分類する</label><p className="helper-text">JAN/GTINがある食品は、チェックなしでも自動的に「外食・市販」へ表示されます。</p></div>}
          <div className="two-fields"><label>基準量*<input type="number" min="0.01" step="any" value={draft.baseAmount} onChange={(event) => update('baseAmount', event.target.value)} required /></label><label>基準単位*<select value={draft.baseUnit} onChange={(event) => updateBaseUnit(event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
          <div className="two-fields"><label>入力用単位（任意）<input list="food-input-unit-options" value={draft.inputUnit} onChange={(event) => updateInputUnit(event.target.value)} placeholder="例：個、杯、パック、切れ" /><datalist id="food-input-unit-options">{FOOD_UNITS.map((unit) => <option key={unit} value={unit} />)}</datalist></label>{inputUnit && inputUnit !== draft.baseUnit ? <label>1入力単位あたりの基準量<input type="number" min="0.01" max="100000" step="any" value={draft.inputUnitBaseAmount} onChange={(event) => update('inputUnitBaseAmount', event.target.value)} placeholder={`例：60（${draft.baseUnit}）`} /><span className="field-hint">{draft.baseUnit}で入力</span></label> : <p className="helper-text">「切れ」「パック」など任意の単位名を追加できます。空欄なら基準単位だけを使います。</p>}</div>
          <div className="two-fields"><label>既定の入力分量<input type="number" min="0.01" step="any" value={draft.servingAmount} onChange={(event) => update('servingAmount', event.target.value)} placeholder="任意" /></label><label>既定の入力単位<select value={draft.servingUnit} onChange={(event) => update('servingUnit', event.target.value)}>{servingUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label></div>
          <p className="helper-text">栄養値の基準量は {draft.baseAmount || '—'}{draft.baseUnit} のまま保存します。既定量と食事入力だけ、明示した入力用単位を使えます。</p>
          <p className="source-line">出典: {draft.sourceVersion}（保存前に内容を確認してください）</p>
        </div>}

        {activeTab === 'nutrition' && <div className="food-form-tab-panel" role="tabpanel"><div className="section-title"><div><span className="eyebrow">NUTRIENTS</span><h2>基準量あたりの栄養値</h2></div></div><div className="nutrient-input-grid">{NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={draft.nutrients[key]} onChange={(event) => update('nutrients', { ...draft.nutrients, [key]: event.target.value })} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}</div></div>}

        {activeTab === 'search' && <div className="food-form-tab-panel" role="tabpanel">
          <div className="section-title"><div><span className="eyebrow">SEARCH</span><h2>検索表示とバリエーション</h2></div></div>
          <label>所属するfamily<select value={draft.foodGroupId} onChange={(event) => selectFamily(event.target.value)}><option value="">新しいfamilyを作成</option>{foodGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName}{group.needsReview ? '（要確認）' : ''}</option>)}</select></label>
          <label>表示名<input value={draft.groupDisplayName} onChange={(event) => update('groupDisplayName', event.target.value)} placeholder="未入力時は食品名を使用" /></label>
          <div className="two-fields"><label>読み仮名<input value={draft.groupReading} onChange={(event) => update('groupReading', event.target.value)} placeholder="ひらがな" /></label><label>食品区分<input value={draft.groupCategory} onChange={(event) => update('groupCategory', event.target.value)} placeholder="例：主菜" /></label></div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>別名</strong><button className="small-action" type="button" onClick={addAlias}>＋追加</button></div>{draft.aliases.map((alias, index) => <div className="metadata-input-row" key={`${index}:${alias.value}`}><input value={alias.value} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="例：とりむね" /><select value={alias.type} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FoodAliasType } : item))}><option value="synonym">通称</option><option value="reading">読み</option><option value="abbreviation">略称</option></select><button className="small-action danger-text" type="button" onClick={() => update('aliases', draft.aliases.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>関連語</strong><button className="small-action" type="button" onClick={addRelatedTerm}>＋追加</button></div>{draft.relatedTerms.map((term, index) => <div className="metadata-input-row" key={`${index}:${term}`}><input value={term} onChange={(event) => update('relatedTerms', draft.relatedTerms.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="同じ食品ではないが関連する語" /><button className="small-action danger-text" type="button" onClick={() => update('relatedTerms', draft.relatedTerms.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="food-form-subsection"><h3>バリエーション属性</h3><p className="helper-text">食品の状態・分量の選択肢として表示する属性です。空欄は指定なしで保存します。</p><div className="two-fields variant-attribute-inputs">{variantAttributeKeys.map((key) => <label key={key}>{variantAttributeLabels[key]}<input value={draft.variantAttributes[key]} onChange={(event) => update('variantAttributes', { ...draft.variantAttributes, [key]: event.target.value })} placeholder="任意" /></label>)}</div></div>
        </div>}

        <div className="food-form-actions"><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></div>
      </form>
    </section>
  </>
}

export default App
