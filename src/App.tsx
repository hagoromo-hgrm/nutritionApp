import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  createNewFoodId,
  createNewFoodGroupId,
  createNewGeneralMenuId,
  createNewMealId,
  createNewMenuId,
  createNewMenuSetId,
  db,
  deleteFood,
  deleteGeneralMenu,
  deleteMealEntry,
  deleteMenu,
  deleteMenuSet,
  exportBackup,
  getEntriesBetween,
  getEntriesForDate,
  getAllFoods,
  getAllGeneralMenus,
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
  reorderMenuSets,
  saveFoodWithMetadata,
  saveGeneralMenu,
  saveMealEntries,
  saveMenu,
  saveMenuSet,
  saveSettings,
  searchFoodResults,
  searchGeneralMenus,
  searchMenus,
  searchMenuSets,
  setFavorite,
} from './db/db'
import { EXTERNAL_UNNAMED_PRODUCT_LABEL, externalFoodErrorMessage, searchExternalFood, type ExternalFoodPreview } from './services/externalFoodApi'
import { backupToJson, downloadBlob, parseBackupText } from './services/backup'
import { mealsToCsv, parseMealsCsv } from './services/csv'
import {
  adoptEstimatedNutrients,
  createEstimationRequest,
  getEstimationDecisionsForFood,
  getEstimationSettings,
  rejectEstimatedNutrients,
  revertEstimatedNutrient,
  saveEstimationRequest,
  saveEstimationResult,
  saveEstimationSettings,
} from './services/nutrientEstimationStore'
import {
  NutrientEstimatePanel,
  type NutrientEstimateAdoption,
  type NutrientEstimateEvaluation,
} from './components/NutrientEstimatePanel'
import { ESTIMATABLE_NUTRIENT_KEYS, ESTIMATE_FIT_NUTRIENT_KEYS, GENRE_PRIOR_PARTIAL_METHOD, PARTIAL_METHOD, toStoredNutrientEstimateResult } from './services/nutrientEstimator'
import { calculateBmi, calculateNutrients, estimateDailyGoals, formatGraphNutrient, formatNutrient, getFoodDefaultServing, getFoodDefaultServingNutrition, getFoodQuantityUnits, goalRate, incrementByQuantityUnit, mealDetailNutritionGoals, nutrientGraphMax, nutrientRangeForGoals, scaleNutrientReference, scaleNutritionGoals, sumAvailableNutrients, sumByMealType, sumEntries, sumNutrients } from './services/nutrition'
import { getMenuIngredients, menuToFood, menusWithUnsupportedIngredientUnits, wouldCreateMenuCycle } from './services/menuIngredients'
import {
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotNutrients,
  cloneMealMenuSnapshot,
  createGeneralMealMenuSnapshot,
  createMealFoodIngredientSnapshot,
  createMealMenuIngredientSnapshot,
  createMealMenuSnapshot,
  createTemporaryMealMenuSnapshot,
} from './services/mealMenuSnapshots'
import { createMenuSetMealBatch, getMenuSetCalorieSummary, getMenuSetFoodItems } from './services/menuSetMeals'
import { normalizeMealEntryOrder, sortMealEntries, sortMealEntryGroup } from './services/mealEntryOrder'
import { buildDailyNutrientTrend } from './services/trend'
import { shouldShowTrendDate } from './services/trendDateLabels'
import { consumeSearchSelectionGroup } from './services/searchSelection'
import {
  buildTodayDetailSummary,
  resolveTodayDetailPeriod,
  TODAY_DETAIL_RANGE_OPTIONS,
  type TodayDetailRangeId,
} from './services/todayDetails'
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
  type GeneralMenu,
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
  type MenuSetFoodItem,
  type NutrientKey,
  type Nutrients,
  type NutritionGoals,
  type EstimationSettings,
  type EstimatorGenreId,
  type EstimatorGenreSource,
  type NutrientMetadataMap,
  type QuantityUnit,
} from './types'
import { applyConstrainedMextFoodAttributePreferences, applyConstrainedUserFoodSelectionPreferences, getFoodAttributePreferencesForGroup, setFoodAttributePreference } from './services/foodAttributePreferences'
import { normalizeSearchText, type FoodSearchResult } from './services/foodSearch'
import { resolveBarcodeCommercialFlag, resolveFoodGroupDisplayName, shouldFollowFoodName } from './services/foodDraft'
import {
  ESTIMATOR_GENRE_LABELS,
  ESTIMATOR_GENRE_OPTIONS,
  inferEstimatorGenre,
  refreshEstimatorGenre,
} from './services/estimatorGenre'
import {
  recordUnresolvedIngredients,
  unresolvedIngredientsToCsv,
  unresolvedIngredientsToJson,
} from './services/unresolvedIngredients'
import {
  FOOD_MASTER_SEARCH_CATEGORIES,
  MEAL_SEARCH_CATEGORIES,
  foodMatchesSearchCategory,
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
  getUserFoodGroup,
  getUserFoodGroupForFoodGroup,
  MissingRequiredUserSelection,
  reconcileUserFoodSelection,
  resolveFoodGroupId,
  searchUserFoodGroups,
  type UserFoodSearchResult,
} from './services/mextUserFoodData'
import { getFoodSnapshotDisplayName, getMealEntryDisplayName, getMextUserFacingFoodName } from './services/mealEntryDisplay'
import { addDays, currentDateKey, currentMonthRange, formatDateTime, formatFileTimestamp, isoFromTokyoTimeInput, toTokyoTimeInput, formatTime } from './utils/date'
import { isPositiveFinite, isValidBarcode, isValidQuantityUnit, isValidUnit } from './utils/validation'
import './styles.css'

const BarcodeScanner = lazy(() => import('./components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })))

type View = 'today' | 'meal-confirmation' | 'graphs' | 'food-screen' | 'food-form' | 'settings' | 'menus' | 'search-input' | 'search-results'
type FoodFormReturnView = 'food-screen' | 'settings' | 'search-results'
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
  memo?: string
}

interface MenuSetDraft {
  id: string | null
  name: string
  menuIds: string[]
  generalMenuIds: string[]
  foodIds: string[]
  foodItems: MenuSetFoodItemDraft[]
}

interface MenuSetFoodItemDraft {
  foodId: string
  amount: string
  unit: QuantityUnit
}

interface BodyProfileDraft {
  heightCm: string
  weightKg: string
  ageYears: string
  sex: BiologicalSex
  activityLevel: ActivityLevel
}

interface PendingEstimationDecision {
  evaluation: NutrientEstimateEvaluation
  adoption: NutrientEstimateAdoption | null
  rejectedKeys: NutrientKey[]
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
  ingredientsText: string
  ingredientsSourceProvider: string
  estimatorGenreId: EstimatorGenreId
  estimatorGenreSource: EstimatorGenreSource
  estimationReferenceMassG: string
  estimationReferenceMassSource: string
  nutrientMetadata: NutrientMetadataMap
  pendingEstimation: PendingEstimationDecision | null
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
  initialFoodId?: string
  initialAmount?: string
  initialAmountUnit?: QuantityUnit
}

interface MealVariantEditState {
  entry: MealEntry
  result: FoodSearchResult
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
const formatEstimateInput = (value: number): string => value.toFixed(1)
const variantAttributeKeys: Array<keyof FoodVariantAttributes> = ['species', 'part', 'variety', 'nameSpecification', 'cultivation', 'sourceBean', 'skin', 'preparation', 'processing']
const variantAttributeLabels: Record<keyof FoodVariantAttributes, string> = {
  species: '種類', part: '部位', variety: '品種・区分', nameSpecification: '名称仕様', cultivation: '栽培方法', sourceBean: '原料豆', skin: '皮の状態', preparation: '調理方法', processing: '加工状態',
}
const emptyVariantInputs = (): Record<keyof FoodVariantAttributes, string> => Object.fromEntries(variantAttributeKeys.map((key) => [key, ''])) as Record<keyof FoodVariantAttributes, string>

function emptyFoodDraft(barcode = '', initialName = ''): FoodDraft {
  const genre = inferEstimatorGenre({ productName: initialName })
  return {
    id: null, name: initialName, maker: '', barcode, isCommercial: Boolean(barcode.trim()), source: 'user', sourceVersion: 'ユーザー入力',
    baseAmount: '100', baseUnit: 'g', inputUnit: '', inputUnitBaseAmount: '', servingAmount: '', servingUnit: 'g', menuIds: [], foodGroupId: '', groupDisplayName: initialName,
    groupReading: '', groupCategory: '', aliases: [], relatedTerms: [], variantAttributes: emptyVariantInputs(), nutrients: emptyNutrientInputs(),
    ingredientsText: '', ingredientsSourceProvider: '', estimationReferenceMassG: '', estimationReferenceMassSource: '',
    estimatorGenreId: genre.id, estimatorGenreSource: genre.source,
    nutrientMetadata: {}, pendingEstimation: null,
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
  const inferredGenre = inferEstimatorGenre({ productName: food.name, ingredientsText: food.ingredientsText })
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
    ingredientsText: food.ingredientsText ?? '',
    ingredientsSourceProvider: food.ingredientsSource?.provider ?? '',
    estimatorGenreId: food.estimatorGenreId ?? inferredGenre.id,
    estimatorGenreSource: food.estimatorGenreSource ?? inferredGenre.source,
    estimationReferenceMassG: food.estimationReferenceMassG === null || food.estimationReferenceMassG === undefined ? '' : String(food.estimationReferenceMassG),
    estimationReferenceMassSource: food.estimationReferenceMassSource ?? '',
    nutrientMetadata: Object.fromEntries(Object.entries(food.nutrientMetadata ?? {}).map(([key, metadata]) => [key, {
      ...metadata,
      sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
      calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
    }])) as NutrientMetadataMap,
    pendingEstimation: null,
  }
}

function previewToDraft(preview: ExternalFoodPreview): FoodDraft {
  const initialName = preview.name === EXTERNAL_UNNAMED_PRODUCT_LABEL ? '' : preview.name
  const genre = inferEstimatorGenre({ productName: initialName, ingredientsText: preview.ingredientsText, offCategories: preview.categories })
  return {
    ...emptyFoodDraft(preview.barcode, initialName), groupDisplayName: initialName, maker: preview.maker, source: 'open_food_facts',
    sourceVersion: 'Open Food Facts（取得値は確認後に保存）', baseAmount: String(preview.baseAmount), baseUnit: preview.baseUnit,
    servingAmount: '', servingUnit: preview.baseUnit, menuIds: [],
    ingredientsText: preview.ingredientsText ?? '',
    ingredientsSourceProvider: preview.ingredientsText ? 'Open Food Facts' : '',
    estimatorGenreId: genre.id,
    estimatorGenreSource: genre.source,
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, preview.nutrients[key] === null ? '' : String(preview.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function snapshotToFood(entry: MealEntry): Food {
  return {
    id: entry.foodId, name: entry.foodSnapshot.name, displayName: entry.foodSnapshot.displayName ?? entry.foodSnapshot.name, officialName: entry.foodSnapshot.officialName, maker: entry.foodSnapshot.maker, barcode: entry.foodSnapshot.barcode,
    source: 'user', sourceVersion: '食事記録スナップショット', baseAmount: entry.foodSnapshot.baseAmount,
    baseUnit: entry.foodSnapshot.baseUnit, servingAmount: null, servingUnit: null,
    inputUnitConversions: entry.foodSnapshot.inputUnitConversions?.map((conversion) => ({ ...conversion })), nutrients: entry.foodSnapshot.nutrients,
    nutrientMetadata: entry.foodSnapshot.nutrientMetadata
      ? Object.fromEntries(Object.entries(entry.foodSnapshot.nutrientMetadata).map(([key, metadata]) => [key, {
        ...metadata,
        sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
        calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
      }])) as NutrientMetadataMap
      : undefined,
    createdAt: entry.eatenAt, updatedAt: entry.eatenAt,
  }
}

function menuSetPreviewFood(menuSet: MenuSet, menus: Menu[], generalMenus: GeneralMenu[], foods: Food[]): Food {
  const menuNutrients = menuSet.menuIds.map((menuId) => menus.find((menu) => menu.id === menuId)).filter((menu): menu is Menu => Boolean(menu)).map((menu) => menuToFood(menu, menus, foods)).map((food) => food.nutrients)
  const generalMenuNutrients = (menuSet.generalMenuIds ?? []).map((menuId) => generalMenus.find((menu) => menu.id === menuId)).filter((menu): menu is GeneralMenu => Boolean(menu)).map((menu) => generalMenuToFood(menu, menus, foods)).map((food) => food.nutrients)
  const foodNutrients = getMenuSetFoodItems(menuSet, foods).map((item) => {
    const food = foods.find((candidate) => candidate.id === item.foodId)
    return food ? calculateNutrients(food, item.amount, item.unit) : null
  }).filter((nutrients): nutrients is Nutrients => nutrients !== null)
  const nutrients = sumNutrients([...menuNutrients, ...generalMenuNutrients, ...foodNutrients])
  return {
    id: `menu-set:${menuSet.id}`, name: menuSet.name, maker: '', barcode: '', source: 'user', sourceVersion: 'Myセット',
    baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients, createdAt: menuSet.createdAt, updatedAt: menuSet.updatedAt,
  }
}

function generalMenuToFood(menu: GeneralMenu, menus: Menu[], foods: Food[]): Food {
  const converted = menuToFood(menu, [menu, ...menus], foods)
  return {
    ...converted,
    id: `general-menu:${menu.id}`,
    sourceVersion: `一般メニュー「${menu.category}」`,
  }
}

function temporaryMenuToFood(snapshot: MealMenuSnapshot): Food {
  const now = new Date().toISOString()
  return {
    id: snapshot.sourceMenuId,
    name: snapshot.sourceMenuName,
    displayName: snapshot.sourceMenuName,
    maker: '',
    barcode: '',
    source: 'user',
    sourceVersion: '一時メニュー',
    baseAmount: 1,
    baseUnit: '食',
    servingAmount: 1,
    servingUnit: '食',
    nutrients: calculateMealMenuSnapshotNutrients(snapshot),
    createdAt: now,
    updatedAt: now,
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

function foodListNutritionLabel(food: Food, includeQuantity = true): string {
  const serving = getFoodDefaultServingNutrition(food)
  return `${includeQuantity ? `${serving.amount}${serving.unit} · ` : ''}${formatNutrient(serving.nutrients.energyKcal)}kcal`
}

function displaySearchFoodName(group: FoodGroup, food: Food): string {
  return food.maker ? `${group.displayName}（${food.maker}）` : group.displayName
}

function getSearchResultUserFacingName(item: SearchResultItem): string {
  if (item.kind === 'food' && item.group) return item.group.displayName
  return item.title
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
    .map((ingredient) => {
      if (ingredient.kind !== 'food') return menus.find((candidate) => candidate.id === ingredient.itemId)?.name
      const food = foods.find((candidate) => candidate.id === ingredient.itemId)
      return food ? displayFoodName(food) : undefined
    })
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
  const [foods, setFoods] = useState<Food[]>([])
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [foodAliases, setFoodAliases] = useState<FoodAlias[]>([])
  const [foodRelatedTerms, setFoodRelatedTerms] = useState<FoodRelatedTerm[]>([])
  const [menus, setMenus] = useState<Menu[]>([])
  const [generalMenus, setGeneralMenus] = useState<GeneralMenu[]>([])
  const [menuSets, setMenuSets] = useState<MenuSet[]>([])
  const [recentFoods, setRecentFoods] = useState<Food[]>([])
  const [favoriteFoods, setFavoriteFoods] = useState<Food[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [existingFoodIds, setExistingFoodIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null)
  const [estimationSettings, setEstimationSettings] = useState<EstimationSettings | null>(null)
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
  const [generalMenuDraft, setGeneralMenuDraft] = useState<MenuDraft | null>(null)
  const [temporaryMenuDraft, setTemporaryMenuDraft] = useState<MenuDraft | null>(null)
  const [menuSetDraft, setMenuSetDraft] = useState<MenuSetDraft | null>(null)
  const [externalNote, setExternalNote] = useState<string | null>(null)
  const [mealFood, setMealFood] = useState<Food | null>(null)
  const [mealUserFacingName, setMealUserFacingName] = useState<string | null>(null)
  const [mealAmount, setMealAmount] = useState('')
  const [mealAmountUnit, setMealAmountUnit] = useState<QuantityUnit>('g')
  const [mealMenuSnapshot, setMealMenuSnapshot] = useState<MealMenuSnapshot | null>(null)
  const [mealType, setMealType] = useState<MealType>('朝食')
  const [recordingMealType, setRecordingMealType] = useState<MealType | null>(null)
  const [mealTypePicker, setMealTypePicker] = useState<{ food: Food | null } | null>(null)
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null)
  const [mealVariantEdit, setMealVariantEdit] = useState<MealVariantEditState | null>(null)
  const [mealDetails, setMealDetails] = useState<{ type: MealType; entries: MealEntry[]; subtotal: Nutrients } | null>(null)
  const [menuNutritionDetails, setMenuNutritionDetails] = useState<Menu | null>(null)
  const [confirmingMealType, setConfirmingMealType] = useState<MealType | null>(null)
  const [showTodayDetails, setShowTodayDetails] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [copyMealType, setCopyMealType] = useState<'すべて' | MealType>('すべて')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [goalInputs, setGoalInputs] = useState<Record<NutrientKey, string>>(emptyNutrientInputs())
  const [bodyProfileInputs, setBodyProfileInputs] = useState<BodyProfileDraft>(bodyProfileToDraft(DEFAULT_BODY_PROFILE))
  const [csvFrom, setCsvFrom] = useState(currentMonthRange().from)
  const [csvTo, setCsvTo] = useState(currentMonthRange().to)
  const [counts, setCounts] = useState({ foods: 0, meals: 0, menus: 0, generalMenus: 0, menuSets: 0 })
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
  const selectedDateRef = useRef(selectedDate)
  const loadRequestIdRef = useRef(0)
  const searchRequestIdRef = useRef(0)
  const mealSaveInFlightRef = useRef(false)
  const menuSetRegistrationRef = useRef(false)

  const notify = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3500)
  }, [])

  const load = useCallback(async (): Promise<boolean> => {
    const requestId = ++loadRequestIdRef.current
    const requestedDate = selectedDateRef.current
    setLoadedDate(null)
    try {
      const [dateEntries, resultFoods, resultGroups, resultAliases, resultRelatedTerms, recent, favorites, ids, currentSettings, currentEstimationSettings, foodCount, mealCount, menuCount, generalMenuCount, menuSetCount, foodKeys, resultMenus, resultGeneralMenus, resultMenuSets] = await Promise.all([
        getEntriesForDate(requestedDate), getAllFoods(), getAllFoodGroups(), getAllFoodAliases(), getAllFoodRelatedTerms(), getRecentFoods(), getFavoriteFoods(), getFavoriteIds(),
        getSettings(), getEstimationSettings(), db.foods.count(), db.mealEntries.count(), db.menus.count(), db.generalMenus.count(), db.menuSets.count(), db.foods.toCollection().primaryKeys(), getAllMenus(), getAllGeneralMenus(), getAllMenuSets(),
      ])
      if (requestId !== loadRequestIdRef.current || requestedDate !== selectedDateRef.current) return false
      setEntries(dateEntries)
      setFoods(resultFoods)
      setFoodGroups(resultGroups)
      setFoodAliases(resultAliases)
      setFoodRelatedTerms(resultRelatedTerms)
      setMenus(resultMenus)
      setGeneralMenus(resultGeneralMenus)
      setMenuSets(resultMenuSets)
      setRecentFoods(recent)
      setFavoriteFoods(favorites)
      setFavoriteIds(ids)
      setExistingFoodIds(new Set([...foodKeys, ...resultMenus.map((menu) => `menu:${menu.id}`), ...resultGeneralMenus.map((menu) => `general-menu:${menu.id}`), ...resultMenuSets.map((menuSet) => `menu-set:${menuSet.id}`)]))
      setSettings(currentSettings)
      setEstimationSettings(currentEstimationSettings)
      setCounts({ foods: foodCount, meals: mealCount, menus: menuCount, generalMenus: generalMenuCount, menuSets: menuSetCount })
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
  }, [])

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

  const modalOpen = Boolean(mealTypePicker || mealFood || mealDetails || menuNutritionDetails || showTodayDetails || menuDraft || generalMenuDraft || temporaryMenuDraft || menuSetDraft || showScanner || variantPicker || mealVariantEdit)

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

  const openMealForm = useCallback((food: Food, entry?: MealEntry, forcedMealType?: MealType, userFacingName?: string) => {
    setMealFood(food)
    setEditingEntry(entry ?? null)
    setMealUserFacingName(userFacingName?.trim() || (entry ? getMealEntryDisplayName(entry) : null))
    const serving = entry ? { amount: entry.amount, unit: entry.amountUnit } : getFoodDefaultServing(food)
    setMealAmount(String(serving.amount))
    setMealAmountUnit(serving.unit)
    const sourceMenuId = !entry && food.id.startsWith('menu:') ? food.id.slice('menu:'.length) : null
    const sourceMenu = sourceMenuId ? menus.find((menu) => menu.id === sourceMenuId) : undefined
    const sourceGeneralMenuId = !entry && food.id.startsWith('general-menu:') ? food.id.slice('general-menu:'.length) : null
    const sourceGeneralMenu = sourceGeneralMenuId ? generalMenus.find((menu) => menu.id === sourceGeneralMenuId) : undefined
    setMealMenuSnapshot(entry?.menuSnapshot
      ? cloneMealMenuSnapshot(entry.menuSnapshot)
      : sourceMenu ? createMealMenuSnapshot(sourceMenu, menus, foods)
        : sourceGeneralMenu ? createGeneralMealMenuSnapshot(sourceGeneralMenu, menus, foods)
          : null)
    setMealType(forcedMealType ?? entry?.mealType ?? '朝食')
    setError(null)
  }, [foods, generalMenus, menus])

  const openMealEntryEditor = useCallback((entry: MealEntry) => {
    const currentVariant = entry.menuSnapshot ? undefined : getFoodVariantBySourceId(entry.foodId)
    const result = currentVariant ? buildMextFoodSearchResult(currentVariant.foodGroupId, foods, foodGroups) : null
    if (currentVariant && result) {
      let userFoodResult: UserFoodSearchResult | undefined
      const mapping = getUserFoodGroupForFoodGroup(currentVariant.foodGroupId)
      if (mapping) {
        try {
          const userGroup = getUserFoodGroup(mapping.userFoodGroupId)
          userFoodResult = {
            group: userGroup,
            presetSelection: { ...mapping.presetSelection },
            foodGroupId: currentVariant.foodGroupId,
            targetType: 'user_food_variant',
            matchedTerm: userGroup.displayName,
            score: 0,
          }
        } catch {
          // データが欠けた場合は、MEXTの下位属性だけを表示して編集を継続する。
        }
      }
      setMealType(entry.mealType)
      setMealVariantEdit({ entry, result, userFoodResult })
      setError(null)
      return
    }
    openMealForm(snapshotToFood(entry), entry)
  }, [foodGroups, foods, openMealForm])

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
            setExternalNote(preview.ingredientsText
              ? 'Open Food Factsの商品情報と原材料を自動入力しました。パッケージ表示と照合してから保存してください。'
              : 'Open Food Factsの商品情報を自動入力しました。原材料は登録されていないため、必要に応じて手入力してください。栄養成分表示と照合してから保存してください。')
            setFoodDraft(previewToDraft(preview))
            setFoodFormMealType(recordingMealType)
            setFoodFormSearchQuery(null)
            setFoodFormReturnView('food-screen')
            setFoodFormOrigin('barcode')
            setView('food-form')
            notify(preview.ingredientsText
              ? '外部商品情報と原材料を入力しました。内容を確認して保存してください。'
              : '外部商品情報を入力しました。原材料は見つかりませんでした。')
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
    const ingredientsText = foodDraft.ingredientsText.trim() || null
    const ingredientsSourceProvider = foodDraft.ingredientsSourceProvider.trim()
    if (ingredientsText !== null && !ingredientsSourceProvider) { showError('原材料表示の取得元を選択してください。推計しない場合も、入力した原材料の根拠を保存します。'); return }
    if (ingredientsText === null && ingredientsSourceProvider) { showError('原材料表示を入力するか、取得元を未選択に戻してください。'); return }
    const estimationReferenceMassG = foodDraft.baseUnit === 'g'
      ? null
      : (foodDraft.estimationReferenceMassG.trim() ? Number(foodDraft.estimationReferenceMassG) : null)
    const estimationReferenceMassSource = foodDraft.baseUnit === 'g'
      ? null
      : (foodDraft.estimationReferenceMassSource.trim() || null)
    if (estimationReferenceMassG !== null && !isPositiveFinite(estimationReferenceMassG)) { showError('確認済み重量は0より大きいg単位の数値で入力してください。'); return }
    if ((estimationReferenceMassG === null) !== (estimationReferenceMassSource === null)) { showError('確認済み重量と、その根拠を両方入力してください。'); return }
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
      const pendingAdoptionValues = foodDraft.pendingEstimation?.adoption?.values ?? {}
      const pendingAdoptionKeys = Object.keys(pendingAdoptionValues) as Array<keyof typeof pendingAdoptionValues>
      const persistedNutrients = { ...nutrients }
      const persistedMetadata = Object.fromEntries(Object.entries(foodDraft.nutrientMetadata).map(([key, metadata]) => [
        key,
        {
          ...metadata,
          sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
          calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
        },
      ])) as NutrientMetadataMap
      for (const key of pendingAdoptionKeys) {
        const pendingValue = pendingAdoptionValues[key]
        if (pendingValue === undefined || foodDraft.nutrients[key] !== formatEstimateInput(pendingValue)) {
          showError('推計候補を反映した後に対象値が変更されています。もう一度推計してから保存してください。')
          return
        }
        persistedNutrients[key] = null
        delete persistedMetadata[key]
      }
      const food: Food = {
        id: foodId, name: foodDraft.name.trim(), officialName: foodDraft.name.trim(), displayName: groupDisplayName, maker: foodDraft.maker.trim(), barcode: foodDraft.barcode.trim(),
        isCommercial: resolveBarcodeCommercialFlag(foodDraft.isCommercial, foodDraft.barcode, foodFormOrigin === 'barcode'),
        source: foodDraft.source, sourceVersion: foodDraft.sourceVersion || 'ユーザー入力', baseAmount, baseUnit: foodDraft.baseUnit,
        servingAmount, servingUnit: servingAmount === null ? null : servingUnit, inputUnitConversions, menuIds: foodDraft.menuIds, foodGroupId: groupId, variantAttributes,
        nutrients: persistedNutrients,
        ingredientsText,
        ingredientsSource: ingredientsText ? { provider: ingredientsSourceProvider, verified: true } : null,
        estimationReferenceMassG,
        estimationReferenceMassSource,
        estimatorGenreId: foodDraft.estimatorGenreId,
        estimatorGenreSource: foodDraft.estimatorGenreSource,
        nutrientMetadata: persistedMetadata,
        createdAt: foodDraft.id ? (foods.find((item) => item.id === foodDraft.id)?.createdAt ?? now) : now, updatedAt: now,
      }
      const foodsAfterSave = [...foods.filter((item) => item.id !== food.id), food]
      const incompatibleMenus = menusWithUnsupportedIngredientUnits(menus, foodsAfterSave)
        .filter((menu) => menu.ingredients?.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === food.id))
      if (incompatibleMenus.length > 0) {
        showError(`入力用単位を変更する前に、Myメニュー「${incompatibleMenus[0].name}」の該当食材を基準単位などへ変更してください。`)
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
      const pendingEstimation = foodDraft.pendingEstimation
      const evaluated = pendingEstimation?.evaluation.request
      const referenceMassG = food.baseUnit === 'g' ? food.baseAmount : (food.estimationReferenceMassG ?? null)
      const referenceMassSource = food.baseUnit === 'g' ? '基準単位がg' : (food.estimationReferenceMassSource ?? null)
      const evaluationStillCurrent = Boolean(evaluated
        && (evaluated.productName?.trim() ?? '') === food.name.trim()
        && evaluated.baseAmount === food.baseAmount
        && evaluated.baseUnit === food.baseUnit
        && evaluated.referenceMassG === referenceMassG
        && evaluated.referenceMassSource === referenceMassSource
        && evaluated.ingredientsText?.trim() === food.ingredientsText?.trim()
        && evaluated.ingredientsSource?.provider === food.ingredientsSource?.provider
        && evaluated.ingredientsSource?.verified === food.ingredientsSource?.verified
        && (evaluated.estimatorGenreId ?? 'other_unknown') === (food.estimatorGenreId ?? 'other_unknown')
        && ESTIMATE_FIT_NUTRIENT_KEYS.every((key) => (
          (evaluated.knownNutrients?.[key] ?? null) === food.nutrients[key]
        )))
      if (pendingEstimation && !evaluationStillCurrent && (pendingAdoptionKeys.length > 0 || pendingEstimation.rejectedKeys.length > 0)) {
        showError('推計後に原材料、基準量または確認済み重量が変更されています。もう一度推計してから保存してください。')
        return
      }
      await saveFoodWithMetadata(food, { group, aliases, relatedTerms: related })
      let savedFood = food
      if (pendingEstimation) {
        if (evaluationStillCurrent) {
          const request = createEstimationRequest(food, {
            requestId: evaluated!.requestId,
            now: evaluated!.requestedAt,
          })
          await saveEstimationRequest(request)
          await saveEstimationResult(toStoredNutrientEstimateResult(pendingEstimation.evaluation.result, {
            foodId: food.id,
            inputHash: request.inputHash,
            baseAmount: food.baseAmount,
            baseUnit: food.baseUnit,
          }))
          if (pendingEstimation.rejectedKeys.length > 0) {
            await rejectEstimatedNutrients(request.requestId, pendingEstimation.rejectedKeys)
          }
          if (pendingAdoptionKeys.length > 0) {
            await adoptEstimatedNutrients(request.requestId, pendingAdoptionKeys)
            savedFood = await db.foods.get(food.id) ?? food
          }
        }
      }
      setFoodDraft(null)
      setFoodFormMealType(null)
      setFoodFormSearchQuery(null)
      if (returnMealType) {
        if (returnSearchQuery) {
          setPendingSearchQuery(returnSearchQuery)
          await searchFoodsAndMenus()
        }
        openMealForm(savedFood, undefined, returnMealType)
        setView(returnSearchQuery ? 'search-results' : 'food-screen')
      } else setView(foodFormReturnView)
      const savedMessage = pendingAdoptionKeys.length > 0
        ? '推計値を採用して食品を保存しました。保存済みの食事記録は変更していません。'
        : (foodDraft.pendingEstimation?.rejectedKeys.length ?? 0) > 0
          ? '推計値を不採用として記録し、食品を保存しました。'
          : (foodDraft.id ? '食品を更新しました。' : '食品を登録しました。')
      await reloadAfterMutation(savedMessage)
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : '食品を保存できませんでした。入力を確認して再試行してください。')
    }
  }

  const saveMealRecord = async (
    food: Food,
    amountText: string,
    amountUnit: QuantityUnit,
    entryToEdit: MealEntry | null = editingEntry,
    menuSnapshot: MealMenuSnapshot | null = null,
    userFacingName?: string,
    returnSearchQuery: string | null = pendingSearchQuery,
  ) => {
    if (!requireLoadedDate()) return false
    if (mealSaveInFlightRef.current) return false
    const targetDate = selectedDate
    const currentEntries = entries
    const amount = Number(amountText)
    if (!isPositiveFinite(amount) || amount > 100000) { showError('分量は0より大きく、現実的な範囲の数値で入力してください。'); return false }
    const snapshotIngredients = menuSnapshot?.ingredients ?? []
    if (menuSnapshot && !menuSnapshot.sourceMenuName.trim()) { showError('メニュー名を入力してください。'); return false }
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
    const menuDisplayName = menuSnapshot?.sourceMenuName.trim()
    const resolvedUserFacingName = menuDisplayName
      || userFacingName?.trim()
      || entryToEdit?.foodSnapshot.userFacingName?.trim()
      || getMextUserFacingFoodName(food.id)
      || food.displayName?.trim()
      || food.name
    const entry: MealEntry = {
      id: entryToEdit?.id ?? createNewMealId(), eatenAt, mealType,
      foodId: food.id, foodSnapshot: {
        name: menuDisplayName || food.displayName || food.name, officialName: food.officialName, displayName: menuDisplayName || food.displayName, userFacingName: resolvedUserFacingName,
        maker: food.maker, barcode: food.barcode, baseAmount: food.baseAmount,
        baseUnit: food.baseUnit, inputUnitConversions: food.inputUnitConversions?.map((conversion) => ({ ...conversion })), nutrients: { ...snapshotNutrients },
        nutrientMetadata: food.nutrientMetadata
          ? Object.fromEntries(Object.entries(food.nutrientMetadata).map(([key, metadata]) => [key, {
            ...metadata,
            sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
            calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
          }])) as NutrientMetadataMap
          : undefined,
      }, amount, amountUnit, calculatedNutrients: calculated,
      ...(menuSnapshot ? { menuSnapshot: cloneMealMenuSnapshot(menuSnapshot) } : {}),
    }
    mealSaveInFlightRef.current = true
    try {
      const searchProgress = entryToEdit
        ? { matched: false, remainingGroups: searchResults }
        : consumeSearchSelectionGroup(searchResults, returnSearchQuery)
      const continueSearchSelection = searchPurpose === 'meal'
        && searchProgress.matched
        && searchProgress.remainingGroups.length > 0
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
      if (searchProgress.matched) setSearchResults(searchProgress.remainingGroups)
      setPendingSearchQuery(null)
      setMealFood(null)
      setMealUserFacingName(null)
      setEditingEntry(null)
      setMealMenuSnapshot(null)
      setRecordingMealType(continueSearchSelection ? mealType : null)
      const refreshed = await load()
      if (selectedDateRef.current !== targetDate) {
        setRecordingMealType(null)
        notify(`${targetDate}の食事を保存しました。`)
        return true
      }
      if (!refreshed) {
        setRecordingMealType(null)
        setConfirmingMealType(null)
        setView('today')
        showError('食事は保存しましたが、画面を更新できませんでした。再読み込みしてください。')
        return true
      }
      if (continueSearchSelection) {
        setConfirmingMealType(null)
        setView('search-results')
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
    if (mealFood) await saveMealRecord(mealFood, mealAmount, mealAmountUnit, editingEntry, mealMenuSnapshot, mealUserFacingName ?? undefined)
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
        menuSet, menus, generalMenus, foods, mealType: targetMealType, eatenAt, createId: createNewMealId,
      })
      const missingCount = batch.missingMenuIds.length + batch.missingGeneralMenuIds.length + batch.missingFoodIds.length
      if (batch.entries.length === 0) {
        showError(`「${menuSet.name}」には登録できるメニュー・食品がありません。Myセットの内容を確認してください。`)
        return false
      }
      const existingGroup = sortMealEntryGroup(currentEntries.filter((entry) => entry.mealType === targetMealType))
      const orderedGroup = normalizeMealEntryOrder([...existingGroup, ...batch.entries]).map((entry) => (
        targetMealType === '間食' ? entry : { ...entry, eatenAt }
      ))
      await saveMealEntries(orderedGroup)
      const searchProgress = consumeSearchSelectionGroup(searchResults, returnSearchQuery)
      const continueSearchSelection = searchPurpose === 'meal'
        && searchProgress.matched
        && searchProgress.remainingGroups.length > 0
      if (searchProgress.matched) setSearchResults(searchProgress.remainingGroups)
      setPendingSearchQuery(null)
      setRecordingMealType(continueSearchSelection ? targetMealType : null)
      const refreshed = await load()
      if (selectedDateRef.current !== targetDate) {
        setRecordingMealType(null)
        notify(`${targetDate}の${targetMealType}へ「${menuSet.name}」の内容${batch.entries.length}件を登録しました。`)
        return true
      }
      if (!refreshed) {
        setRecordingMealType(null)
        setConfirmingMealType(null)
        setView('today')
        showError(`「${menuSet.name}」の内容は登録しましたが、画面を更新できませんでした。再読み込みしてください。`)
        return true
      }
      if (continueSearchSelection) {
        setConfirmingMealType(null)
        setView('search-results')
      } else {
        setConfirmingMealType(targetMealType)
        setView('meal-confirmation')
      }
      notify(`「${menuSet.name}」の内容${batch.entries.length}件を${targetMealType}へ一括登録しました。${missingCount > 0 ? `削除済みの${missingCount}件は除外しました。` : ''}`)
      return true
    } catch {
      showError('Myセットを一括登録できませんでした。保存先の空き容量を確認して再試行してください。')
      return false
    } finally {
      menuSetRegistrationRef.current = false
    }
  }

  const removeMeal = async (entry: MealEntry) => {
    if (!requireLoadedDate()) return
    if (!window.confirm(`「${getMealEntryDisplayName(entry)}」の食事記録を削除しますか？`)) return
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
        const [{ page, logId }, resultMenus, resultGeneralMenus, resultMenuSets] = await Promise.all([
          includeFoods
            ? searchFoodResults(query, { limit: 20, category })
            : Promise.resolve({ page: { results: [], normalizedQuery: normalizeSearchText(query), nextCursor: null }, logId: null }),
          includeMenus ? searchMenus(query) : Promise.resolve([]),
          includeMenus ? searchGeneralMenus(query) : Promise.resolve([]),
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
              ? `${result.group.displayName} > ${selectedUserFoodDimensionLabel(result) ?? '種類'} · ${result.group.category} · ${foodListNutritionLabel(preview.food)}`
              : `${result.group.category} · ${result.group.memberCount > 1 ? `${result.group.memberCount}種類` : foodListNutritionLabel(preview.food)}`,
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
          ...page.results.filter((result) => !coveredFoodGroupIds.has(result.group.id)).map((result, index) => ({ id: result.group.id, kind: 'food' as const, title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション · ${foodListNutritionLabel(result.food, false)}` : foodListNutritionLabel(result.food)}`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: userItems.length + index + 1 })),
          ...resultMenus.map((menu) => ({ id: menu.id, kind: 'menu' as const, title: menu.name, subtitle: `Myメニュー · ${menu.category} · 食材: ${menuIngredientNames(menu, menus, foods) || '未登録'}`, food: menuToFood(menu, menus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })),
          ...resultGeneralMenus.map((menu) => ({ id: menu.id, kind: 'general-menu' as const, title: menu.name, subtitle: `一般メニュー · ${menu.category} · 食材: ${menuIngredientNames(menu, [menu, ...menus], foods) || '未登録'}`, food: generalMenuToFood(menu, menus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })),
          ...resultMenuSets.map((menuSet) => ({ id: menuSet.id, kind: 'set' as const, title: menuSet.name, subtitle: `Myセット · 内容${menuSet.menuIds.length + (menuSet.generalMenuIds?.length ?? 0) + getMenuSetFoodItems(menuSet, foods).length}件を一括登録`, food: menuSetPreviewFood(menuSet, menus, generalMenus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })),
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

  const openMealConfirmationFromSearch = () => {
    if (searchPurpose !== 'meal' || !requireLoadedDate()) return
    const targetMealType = recordingMealType ?? mealType
    for (const group of searchResults) if (group.searchLogId) void markSearchLogUnselected(group.searchLogId)
    setPendingSearchQuery(null)
    setSearchResults([])
    setRecordingMealType(null)
    setConfirmingMealType(targetMealType)
    setView('meal-confirmation')
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
        id: result.group.id, kind: 'food', title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション · ${foodListNutritionLabel(result.food, false)}` : foodListNutritionLabel(result.food)}`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: group.items.length + resultIndex + 1,
      }))
      setSearchResults((current) => current.map((item, index) => index === groupIndex ? { ...item, items: [...item.items, ...additionalItems], nextCursor: page.nextCursor } : item))
    } catch { showError('検索結果を追加で読み込めませんでした。') }
  }

  const selectSearchFood = (groupQuery: string, item: SearchResultItem, food: Food, amount?: string) => {
    if (item.searchLogId && item.group) void recordFoodSelection(item.searchLogId, food.foodGroupId ?? item.group.id, food.id, item.searchRank ?? 0)
    if (searchPurpose === 'food-master') {
      setPendingSearchQuery(null)
      openFoodForm(food, '', 'search-results', null, null, '', 'settings')
      return
    }
    setPendingSearchQuery(groupQuery)
    openMealForm(food, undefined, recordingMealType ?? mealType, getSearchResultUserFacingName(item))
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
        showError('Myセットが見つかりません。メニュー画面で登録内容を確認してください。')
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
    if (ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.unit !== '食')) { showError('Myメニューの単位は「食」を選択してください。'); return }
    if (menuDraft.id && ingredients.some((ingredient) => ingredient.kind === 'menu' && wouldCreateMenuCycle(menuDraft.id, ingredient.itemId, menus))) { showError('Myメニューを循環して参照することはできません。'); return }
    const now = new Date().toISOString()
    const menu: Menu = {
      id: menuDraft.id ?? createNewMenuId(), name: menuDraft.name.trim(), category: menuDraft.category,
      foodIds: ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId), ingredients,
      aliases: [...new Set(menuDraft.aliases.map((alias) => alias.trim()).filter(Boolean))],
      memo: menuDraft.memo?.trim() || undefined,
      createdAt: menuDraft.id ? (menus.find((item) => item.id === menuDraft.id)?.createdAt ?? now) : now, updatedAt: now,
    }
    try { await saveMenu(menu); setMenuDraft(null); await reloadAfterMutation(menuDraft.id ? 'メニューを更新しました。' : 'メニューを登録しました。') } catch { showError('メニューを保存できませんでした。') }
  }

  const validateMenuDraftIngredients = (draft: MenuDraft): MenuIngredient[] | null => {
    const ingredients = draft.ingredients.map((ingredient) => ({ ...ingredient, amount: Number(ingredient.amount) }))
    if (ingredients.some((ingredient) => !isPositiveFinite(ingredient.amount) || ingredient.amount > 100000)) {
      showError('食材の分量は0より大きく100000以下で入力してください。')
      return null
    }
    if (ingredients.some((ingredient) => {
      if (ingredient.kind === 'menu') return ingredient.unit !== '食'
      const food = foods.find((candidate) => candidate.id === ingredient.itemId)
      return food !== undefined && !getFoodQuantityUnits(food).includes(ingredient.unit)
    })) {
      showError('食材の入力単位が現在の換算設定と一致しません。単位を選び直してください。')
      return null
    }
    return ingredients
  }

  const saveGeneralMenuDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!generalMenuDraft || !generalMenuDraft.name.trim()) { showError('一般メニュー名を入力してください。'); return }
    const ingredients = validateMenuDraftIngredients(generalMenuDraft)
    if (!ingredients) return
    if (ingredients.length === 0) { showError('一般メニューに食材を1件以上追加してください。'); return }
    const now = new Date().toISOString()
    const menu: GeneralMenu = {
      id: generalMenuDraft.id ?? createNewGeneralMenuId(),
      name: generalMenuDraft.name.trim(),
      category: generalMenuDraft.category,
      foodIds: ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId),
      ingredients,
      aliases: [...new Set(generalMenuDraft.aliases.map((alias) => alias.trim()).filter(Boolean))],
      createdAt: generalMenuDraft.id ? (generalMenus.find((item) => item.id === generalMenuDraft.id)?.createdAt ?? now) : now,
      updatedAt: now,
    }
    try {
      await saveGeneralMenu(menu)
      setGeneralMenuDraft(null)
      await reloadAfterMutation(generalMenuDraft.id ? '一般メニューを更新しました。' : '一般メニューを登録しました。')
    } catch {
      showError('一般メニューを保存できませんでした。')
    }
  }

  const saveTemporaryMenuDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!temporaryMenuDraft || !temporaryMenuDraft.name.trim()) { showError('一時メニュー名を入力してください。'); return }
    const ingredients = validateMenuDraftIngredients(temporaryMenuDraft)
    if (!ingredients) return
    if (ingredients.length === 0) { showError('一時メニューに食材を1件以上追加してください。'); return }
    const snapshots: MealIngredientSnapshot[] = []
    for (const ingredient of ingredients) {
      if (ingredient.kind === 'food') {
        const food = foods.find((candidate) => candidate.id === ingredient.itemId)
        if (!food) { showError('削除済みの食品が含まれています。食材を選び直してください。'); return }
        snapshots.push(createMealFoodIngredientSnapshot(food, ingredient.amount, ingredient.unit))
      } else {
        const menu = menus.find((candidate) => candidate.id === ingredient.itemId)
        if (!menu) { showError('削除済みのMyメニューが含まれています。食材を選び直してください。'); return }
        snapshots.push(createMealMenuIngredientSnapshot(menu, menus, foods, ingredient.amount, ingredient.unit))
      }
    }
    const snapshot = createTemporaryMealMenuSnapshot(temporaryMenuDraft.name, snapshots)
    const saved = await saveMealRecord(temporaryMenuToFood(snapshot), '1', '食', null, snapshot, snapshot.sourceMenuName)
    if (saved) setTemporaryMenuDraft(null)
  }

  const cloneGeneralMenuToMyMenu = async (generalMenu: GeneralMenu) => {
    const now = new Date().toISOString()
    const cloned: Menu = {
      ...generalMenu,
      id: createNewMenuId(),
      foodIds: [...generalMenu.foodIds],
      ingredients: generalMenu.ingredients?.map((ingredient) => ({ ...ingredient })),
      aliases: generalMenu.aliases ? [...generalMenu.aliases] : undefined,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await saveMenu(cloned)
      await reloadAfterMutation(`「${generalMenu.name}」をMyメニューへ複製しました。`)
    } catch {
      showError('一般メニューをMyメニューへ複製できませんでした。')
    }
  }

  const saveMenuSetDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!menuSetDraft || !menuSetDraft.name.trim()) { showError('セット名を入力してください。'); return }
    const invalidAmount = menuSetDraft.foodItems.some((item) => !isPositiveFinite(Number(item.amount)) || Number(item.amount) > 100000)
    if (invalidAmount) { showError('セット内食品の分量は0より大きく100000以下で入力してください。'); return }
    const invalidUnit = menuSetDraft.foodItems.some((item) => {
      const food = foods.find((candidate) => candidate.id === item.foodId)
      return !isValidQuantityUnit(item.unit) || (food !== undefined && !getFoodQuantityUnits(food).includes(item.unit))
    })
    if (invalidUnit) { showError('セット内食品の入力単位が換算設定と一致しません。単位を選び直してください。'); return }
    const foodItems: MenuSetFoodItem[] = menuSetDraft.foodItems.map((item) => ({ ...item, amount: Number(item.amount) }))
    const now = new Date().toISOString()
    const existingMenuSet = menuSetDraft.id ? menuSets.find((item) => item.id === menuSetDraft.id) : undefined
    const menuSet: MenuSet = {
      id: menuSetDraft.id ?? createNewMenuSetId(), name: menuSetDraft.name.trim(), menuIds: menuSetDraft.menuIds,
      ...(existingMenuSet?.sortOrder === undefined ? {} : { sortOrder: existingMenuSet.sortOrder }),
      generalMenuIds: menuSetDraft.generalMenuIds,
      foodIds: foodItems.map((item) => item.foodId), foodItems,
      createdAt: existingMenuSet?.createdAt ?? now, updatedAt: now,
    }
    try { await saveMenuSet(menuSet); setMenuSetDraft(null); await reloadAfterMutation(menuSetDraft.id ? 'Myセットを更新しました。' : 'Myセットを登録しました。') } catch { showError('Myセットを保存できませんでした。') }
  }

  const removeMenu = async (menu: Menu) => {
    if (!window.confirm(`「${menu.name}」を削除しますか？`)) return
    try { await deleteMenu(menu.id); await reloadAfterMutation('メニューを削除しました。') } catch (error) { showError(error instanceof Error ? error.message : 'メニューを削除できませんでした。') }
  }

  const removeGeneralMenu = async (menu: GeneralMenu) => {
    if (!window.confirm(`一般メニュー「${menu.name}」を削除しますか？`)) return
    try { await deleteGeneralMenu(menu.id); await reloadAfterMutation('一般メニューを削除しました。') } catch { showError('一般メニューを削除できませんでした。') }
  }

  const removeMenuSet = async (menuSet: MenuSet) => {
    if (!window.confirm(`「${menuSet.name}」を削除しますか？`)) return
    try { await deleteMenuSet(menuSet.id); await reloadAfterMutation('Myセットを削除しました。') } catch { showError('Myセットを削除できませんでした。') }
  }

  const reorderMenuSetRecords = async (orderedMenuSetIds: string[]) => {
    try {
      await reorderMenuSets(orderedMenuSetIds)
      setMenuSets(await getAllMenuSets())
      notify('Myセットの並び順を保存しました。')
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Myセットの並び順を保存できませんでした。')
      throw cause
    }
  }

  const toggleExternalApi = async (enabled: boolean) => {
    if (!settings) return
    const next = { ...settings, externalApiEnabled: enabled }
    try { await saveSettings(next); setSettings(next); notify(enabled ? '外部商品APIを有効にしました。' : '外部商品APIを無効にしました。') } catch { showError('外部商品APIの設定を保存できませんでした。') }
  }

  const toggleNutrientEstimator = async (enabled: boolean) => {
    if (!estimationSettings) return
    try {
      await saveEstimationSettings({
        enabled,
        trigger: 'manual',
        applyMode: 'manual',
        minimumConfidenceForSuggestion: estimationSettings.minimumConfidenceForSuggestion,
      })
      const next = await getEstimationSettings()
      setEstimationSettings(next)
      notify(enabled ? '栄養素の参考推計を有効にしました。' : '栄養素の参考推計を無効にしました。')
    } catch {
      showError('参考推計の設定を保存できませんでした。もう一度お試しください。')
    }
  }

  const revertFoodEstimate = async (foodId: string, nutrientKey: NutrientKey) => {
    try {
      const history = await getEstimationDecisionsForFood(foodId, { limit: 100 })
      const reverted = new Set(history.items
        .filter((decision) => decision.decision === 'reverted')
        .map((decision) => `${decision.requestId}:${decision.nutrientKey}`))
      const adopted = history.items.find((decision) => (
        decision.decision === 'adopted'
        && decision.nutrientKey === nutrientKey
        && !reverted.has(`${decision.requestId}:${decision.nutrientKey}`)
      ))
      if (!adopted) throw new Error('取り消せる採用履歴が見つかりません。')
      await revertEstimatedNutrient(adopted.decisionId)
      const refreshedFood = await db.foods.get(foodId)
      if (!refreshedFood) throw new Error('食品を読み直せませんでした。食品管理へ戻って再度開いてください。')
      const group = foodGroups.find((item) => item.id === refreshedFood.foodGroupId)
      const aliases = group ? foodAliases.filter((alias) => alias.foodGroupId === group.id) : []
      const relatedTerms = group ? foodRelatedTerms.filter((term) => term.foodGroupId === group.id) : []
      setFoodDraft(foodToDraft(refreshedFood, group, aliases, relatedTerms))
      await load()
      notify(`${NUTRIENT_LABELS[nutrientKey]}の推計採用を取り消しました。保存済みの食事記録は変更していません。`)
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : '推計値の採用を取り消せませんでした。食品を確認して再試行してください。')
    }
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

  const exportUnresolvedIngredients = async (format: 'json' | 'csv') => {
    try {
      const content = format === 'json'
        ? await unresolvedIngredientsToJson()
        : await unresolvedIngredientsToCsv()
      const timestamp = formatFileTimestamp(new Date())
      downloadBlob(
        content,
        `nutrition-unresolved-ingredients-${timestamp}.${format}`,
        format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      )
      notify(`未対応原材料の${format.toUpperCase()}を出力しました。商品名・バーコード・食事記録は含みません。`)
    } catch {
      showError('未対応原材料を出力できませんでした。もう一度お試しください。')
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
      const summary = `食品${backup.foods.length}件、食事${backup.mealEntries.length}件、Myメニュー${backup.menus?.length ?? 0}件、一般メニュー${backup.generalMenus?.length ?? 0}件、Myセット${backup.menuSets?.length ?? 0}件`
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
          onEdit={openMealEntryEditor}
          onDelete={removeMeal}
          onReorder={(orderedEntryIds) => reorderMealRecords(confirmingMealType, orderedEntryIds)}
          onDone={() => { setConfirmingMealType(null); setView('today') }}
        />}
        {view === 'graphs' && <GraphsView range={graphRange} onRangeChange={setGraphRange} goals={settings.goals} />}
        {view === 'food-screen' && <FoodsView recordingMealType={recordingMealType} foods={foods} foodGroups={foodGroups} menus={menus} generalMenus={generalMenus} menuSets={menuSets} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onSelectFood={handleFoodSelection} onSelectMenuSet={(menuSet) => void registerMenuSet(menuSet)} onCreateTemporaryMenu={() => setTemporaryMenuDraft({ id: null, name: '', category: 'その他', ingredients: [], aliases: [] })} onToggleFavorite={toggleFavorite} onEditFood={(food) => openFoodForm(food, '', 'food-screen', null, null, '', foodScreenReturnView === 'settings' ? 'settings' : 'meal')} onDeleteFood={removeFood} onOpenSearch={() => openSearchInput(recordingMealType ? 'meal' : 'food-master')} onOpenScanner={() => setShowScanner(true)} onBack={() => { setRecordingMealType(null); setView(foodScreenReturnView) }} backLabel={foodScreenReturnView === 'settings' ? '← 設定' : '← 記録'} copyMealType={copyMealType} setCopyMealType={setCopyMealType} onCopyPrevious={copyPreviousMeals} />}
        {view === 'food-form' && foodDraft && <FoodFormView draft={foodDraft} returnView={foodFormReturnView} allowCommercialClassification={foodFormOrigin === 'settings'} estimationEnabled={estimationSettings?.enabled === true} setDraft={setFoodDraft} foodGroups={foodGroups} foodAliases={foodAliases} foodRelatedTerms={foodRelatedTerms} externalNote={externalNote} onRevertEstimate={(foodId, nutrientKey) => void revertFoodEstimate(foodId, nutrientKey)} onSubmit={saveFoodDraft} onClose={() => { setFoodDraft(null); setFoodFormMealType(null); setFoodFormSearchQuery(null); setView(foodFormReturnView) }} />}
        {view === 'settings' && estimationSettings && <SettingsView settings={settings} estimationSettings={estimationSettings} goalInputs={goalInputs} setGoalInputs={setGoalInputs} onSaveGoals={saveGoals} onToggleExternalApi={toggleExternalApi} onToggleNutrientEstimator={toggleNutrientEstimator} onChangeDefaultMealTimeMode={changeDefaultMealTimeMode} onExportJson={exportJson} onRestoreJson={restoreJson} onExportCsv={exportCsv} onImportCsv={importCsv} onExportUnresolvedIngredients={exportUnresolvedIngredients} csvFrom={csvFrom} csvTo={csvTo} setCsvFrom={setCsvFrom} setCsvTo={setCsvTo} counts={counts} bodyProfileInputs={bodyProfileInputs} setBodyProfileInputs={setBodyProfileInputs} onSaveBodyProfile={saveBodyProfile} onOpenNewFood={() => openFoodForm(undefined, '', 'settings', null, null, '', 'settings')} onOpenFoodMaster={() => { setRecordingMealType(null); setFoodScreenReturnView('settings'); setView('food-screen') }} estimatedGoals={estimateDailyGoals(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} bmi={calculateBmi(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} />}
        {view === 'menus' && <MenuView menus={menus} generalMenus={generalMenus} menuSets={menuSets} foods={foods} onNewMenu={() => setMenuDraft({ id: null, name: '', category: '主菜', ingredients: [], aliases: [], memo: '' })} onShowMenuNutrition={setMenuNutritionDetails} onEditMenu={(menu) => setMenuDraft({ id: menu.id, name: menu.name, category: menu.category, ingredients: getMenuIngredients(menu, foods).map((ingredient) => ({ ...ingredient, amount: String(ingredient.amount) })), aliases: menu.aliases ?? [], memo: menu.memo ?? '' })} onDeleteMenu={removeMenu} onNewGeneralMenu={() => setGeneralMenuDraft({ id: null, name: '', category: '主菜', ingredients: [], aliases: [] })} onEditGeneralMenu={(menu) => setGeneralMenuDraft({ id: menu.id, name: menu.name, category: menu.category, ingredients: getMenuIngredients(menu, foods).map((ingredient) => ({ ...ingredient, amount: String(ingredient.amount) })), aliases: menu.aliases ?? [] })} onDeleteGeneralMenu={removeGeneralMenu} onCloneGeneralMenu={(menu) => void cloneGeneralMenuToMyMenu(menu)} onNewMenuSet={() => setMenuSetDraft({ id: null, name: '', menuIds: [], generalMenuIds: [], foodIds: [], foodItems: [] })} onEditMenuSet={(menuSet) => { const foodItems = getMenuSetFoodItems(menuSet, foods); setMenuSetDraft({ id: menuSet.id, name: menuSet.name, menuIds: menuSet.menuIds, generalMenuIds: menuSet.generalMenuIds ?? [], foodIds: foodItems.map((item) => item.foodId), foodItems: foodItems.map((item) => ({ ...item, amount: String(item.amount) })) }) }} onDeleteMenuSet={removeMenuSet} onReorderMenuSets={reorderMenuSetRecords} onBack={() => setView('today')} />}
        {view === 'search-input' && <SearchInputView bars={searchBars} setBars={setSearchBars} onSearch={() => void searchFoodsAndMenus()} onBack={() => setView('food-screen')} />}
        {view === 'search-results' && <SearchResultsView groups={searchResults} purpose={searchPurpose} category={searchCategory} searching={searchingResults} onCategoryChange={changeSearchCategory} onSelect={handleSearchResultSelect} onAddFood={(query) => openFoodForm(undefined, '', searchPurpose === 'food-master' ? 'search-results' : 'food-screen', searchPurpose === 'meal' ? (recordingMealType ?? mealType) : null, searchPurpose === 'meal' ? (query || null) : null, query, searchPurpose === 'food-master' ? 'settings' : 'meal')} onLoadMore={(index) => void loadMoreSearchResults(index)} onOpenConfirmation={openMealConfirmationFromSearch} onBack={leaveSearchResults} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavButton active={view === 'today' || view === 'meal-confirmation'} onClick={() => { selectDate(currentDateKey()); setRecordingMealType(null); setConfirmingMealType(null); setView('today') }} icon="◷" iconClass="today-icon" label="記録" />
        <NavButton active={view === 'graphs'} onClick={() => { setRecordingMealType(null); setView('graphs') }} icon="↗" iconClass="graphs-icon" label="グラフ" />
        <NavButton active={view === 'menus'} onClick={() => { setRecordingMealType(null); setView('menus') }} icon="menu-grid" iconClass="menu-grid-icon" label="メニュー" />
        <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="settings" iconClass="settings-icon" label="設定" />
      </nav>

      {view === 'today' && <button className="floating-add" type="button" onClick={openMealTypePicker} aria-label="食事を追加">＋</button>}

      {mealTypePicker && <MealTypePickerModal food={mealTypePicker.food} recordedMealTypes={recordedMealTypes} onSelect={chooseMealType} />}
      {variantPicker && <FoodVariantPickerModal result={variantPicker.result} userFoodResult={variantPicker.userFoodResult} foods={foods} foodGroups={foodGroups} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} mealMode={searchPurpose === 'meal'} onSubmitMeal={async (food, amount, amountUnit) => { if (await saveMealRecord(food, amount, amountUnit, null, null, getSearchResultUserFacingName(variantPicker.item), variantPicker.query)) setVariantPicker(null) }} onSelect={(food) => { setVariantPicker(null); selectSearchFood(variantPicker.query, variantPicker.item, food) }} onClose={() => setVariantPicker(null)} />}
      {mealVariantEdit && <FoodVariantPickerModal
        result={mealVariantEdit.result}
        userFoodResult={mealVariantEdit.userFoodResult}
        foods={foods}
        foodGroups={foodGroups}
        foodAttributePreferences={settings.foodAttributePreferences}
        onSaveFoodAttributePreference={saveFoodAttributePreference}
        mealMode
        initialFoodId={mealVariantEdit.entry.foodId}
        initialAmount={String(mealVariantEdit.entry.amount)}
        initialAmountUnit={mealVariantEdit.entry.amountUnit}
        submitLabel="変更を保存"
        onSubmitMeal={async (food, amount, amountUnit) => { if (await saveMealRecord(food, amount, amountUnit, mealVariantEdit.entry, null, getMealEntryDisplayName(mealVariantEdit.entry))) setMealVariantEdit(null) }}
        onSelect={() => undefined}
        onClose={() => setMealVariantEdit(null)}
      />}
      {mealFood && <MealModal food={mealFood} amount={mealAmount} setAmount={setMealAmount} amountUnit={mealAmountUnit} setAmountUnit={setMealAmountUnit} menuSnapshot={mealMenuSnapshot} setMenuSnapshot={setMealMenuSnapshot} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} editing={Boolean(editingEntry)} onSubmit={saveMeal} onClose={() => { setMealFood(null); setMealUserFacingName(null); setEditingEntry(null); setMealMenuSnapshot(null) }} />}
      {mealDetails && <MealDetailsModal details={mealDetails} goals={mealDetailNutritionGoals(settings.goals, mealDetails.type)} onUpdateTimes={updateMealTimes} onClose={() => setMealDetails(null)} />}
      {showTodayDetails && <TodayDetailsModal selectedDate={selectedDate} goals={settings.goals} entries={entries} onClose={() => setShowTodayDetails(false)} />}
      {menuNutritionDetails && <MenuNutritionDetailsModal menu={menuNutritionDetails} menus={menus} foods={foods} goals={scaleNutritionGoals(settings.goals, 1 / 3)} onClose={() => setMenuNutritionDetails(null)} />}
      {menuDraft && <MenuEditorModal draft={menuDraft} setDraft={setMenuDraft} menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveMenuDraft} onClose={() => setMenuDraft(null)} />}
      {generalMenuDraft && <MenuEditorModal draft={generalMenuDraft} setDraft={setGeneralMenuDraft} mode="general" menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveGeneralMenuDraft} onClose={() => setGeneralMenuDraft(null)} />}
      {temporaryMenuDraft && <MenuEditorModal draft={temporaryMenuDraft} setDraft={setTemporaryMenuDraft} mode="temporary" menus={menus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveTemporaryMenuDraft} onClose={() => setTemporaryMenuDraft(null)} />}
      {menuSetDraft && <MenuSetEditorModal draft={menuSetDraft} setDraft={setMenuSetDraft} menus={menus} generalMenus={generalMenus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} foodAttributePreferences={settings.foodAttributePreferences} onSaveFoodAttributePreference={saveFoodAttributePreference} onSubmit={saveMenuSetDraft} onClose={() => setMenuSetDraft(null)} />}
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

function NutrientGraphRow({ label, value, availableValue = value, goal, unit, range, segments, showReference = true }: { label: string; value: number | null; availableValue?: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; segments?: GoalSegment[]; showReference?: boolean }) {
  const hasGoal = showReference && goal !== null && goal > 0
  const graphMax = nutrientGraphMax(hasGoal ? goal : null, availableValue)
  const valuePercent = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / graphMax) * 100))
  const rangeLeft = hasGoal ? Math.min(100, Math.max(0, ((range.min ?? 0) / graphMax) * 100)) : 0
  const rangeRight = hasGoal ? Math.min(100, Math.max(rangeLeft, ((range.max ?? graphMax) / graphMax) * 100)) : 0
  const segmentTotal = segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0
  const rate = goalRate(value, goal)
  const status = !showReference || value === null || rate === null ? '未設定' : range.max !== null && value > range.max ? '超過' : range.min !== null && value < range.min ? '不足' : '適正'
  return <div className="nutrient-graph-row"><span className="nutrient-graph-label">{label}</span><div className="nutrient-graph-track"><span className="nutrient-graph-range" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{availableValue !== null && <span className={`nutrient-graph-intake${segments && segmentTotal > 0 ? ' nutrient-graph-intake-segmented' : ''}`} style={{ width: `${valuePercent}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}{hasGoal && <span className="nutrient-graph-target" style={{ left: '50%' }} />}</div><span className={`nutrient-graph-value nutrient-graph-status-${status === '超過' ? 'over' : status === '不足' ? 'under' : status === '適正' ? 'ok' : 'unknown'}`}>{formatGraphNutrient(availableValue)}<small>{unit}</small></span></div>
}

function NutrientGoalGraphs({ nutrients, availableNutrients, goals, subtotals, availableSubtotals, colorByMeal = false, excludeEnergy = false, showReference = true, referenceMultiplier = 1 }: { nutrients: Nutrients; availableNutrients?: Nutrients; goals: NutritionGoals; subtotals?: Record<string, Nutrients>; availableSubtotals?: Record<string, Nutrients>; colorByMeal?: boolean; excludeEnergy?: boolean; showReference?: boolean; referenceMultiplier?: number }) {
  const keys = excludeEnergy ? NUTRIENT_KEYS.filter((key) => key !== 'energyKcal') : NUTRIENT_KEYS
  const segmentSubtotals = availableSubtotals ?? subtotals
  return <section className={`nutrient-graph${showReference ? '' : ' nutrient-graph-without-reference'}`}><div className="nutrient-graph-heading"><span>栄養素</span><span>{showReference ? '基準ライン' : ''}</span><span>摂取量</span></div><div className="nutrient-graph-rows">{keys.map((key) => {
    const { goal, range } = scaleNutrientReference(goals, key, referenceMultiplier)
    return <NutrientGraphRow key={key} label={NUTRIENT_LABELS[key]} value={nutrients[key]} availableValue={availableNutrients ? availableNutrients[key] : nutrients[key]} goal={goal} unit={NUTRIENT_UNITS[key]} range={range} segments={colorByMeal && segmentSubtotals ? MEAL_TYPES.map((type) => ({ type, value: segmentSubtotals[type]?.[key] ?? 0 })).filter((segment) => segment.value > 0) : undefined} showReference={showReference} />
  })}</div>{colorByMeal && segmentSubtotals && <div className="nutrient-graph-footer"><MealColorLegend /></div>}</section>
}

const TREND_NUTRIENT_KEYS: NutrientKey[] = ['energyKcal', 'proteinG', 'fatG', 'carbohydrateG']
const TREND_MIN_HISTORY_DAYS = 28
const TREND_HISTORY_CHUNK_DAYS = 365

function formatTrendDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

interface GraphsViewProps {
  range: TrendRangeId
  goals: NutritionGoals
  onRangeChange: (value: TrendRangeId) => void
}

function GraphsView({ range, goals, onRangeChange }: GraphsViewProps) {
  const [metric, setMetric] = useState<NutrientKey>('energyKcal')
  const rangeDays = TREND_RANGE_DAYS[range]
  const [historyDays, setHistoryDays] = useState(() => Math.max(TREND_MIN_HISTORY_DAYS, rangeDays * 2))
  const [historyEntries, setHistoryEntries] = useState<MealEntry[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [chartViewportWidth, setChartViewportWidth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyDaysRef = useRef(historyDays)
  const loadingOlderRef = useRef(false)
  const initialScrollPositionedRef = useRef(false)
  const pendingPrependWidthRef = useRef<number | null>(null)
  const pendingRightDayRef = useRef<number | null>(null)
  const todayRef = useRef(currentDateKey())
  const today = todayRef.current
  const historyFrom = addDays(today, -(historyDays - 1))
  const points = useMemo(
    () => buildDailyNutrientTrend(historyEntries, historyFrom, today, historyDays),
    [historyDays, historyEntries, historyFrom, today],
  )
  const goal = goals[metric]
  const values = points.map((point) => point.availableNutrients[metric] ?? 0)
  const chartMax = Math.max(goal ?? 0, ...values, 1) * 1.15
  const goalPosition = goal !== null && goal > 0 ? Math.min(100, (goal / chartMax) * 100) : null
  const dayStep = Math.max(1, (chartViewportWidth || 320) / rangeDays)
  const dayGap = dayStep / 5
  const chartWidth = Math.max(chartViewportWidth, points.length * dayStep)

  useEffect(() => {
    let active = true
    void getEntriesBetween(historyFrom, today)
      .then((loaded) => {
        if (!active) return
        setHistoryEntries(loaded)
        setHistoryReady(true)
        setHistoryError(null)
      })
      .catch(() => {
        if (!active) return
        setHistoryReady(true)
        setHistoryError('グラフ用の食事履歴を読み込めませんでした。')
      })
    return () => { active = false }
    // The initial range is intentionally fixed; older ranges are prepended on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const updateWidth = () => setChartViewportWidth(scroll.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !historyReady) return
    if (pendingPrependWidthRef.current !== null) {
      const previousWidth = pendingPrependWidthRef.current
      pendingPrependWidthRef.current = null
      scroll.scrollLeft += Math.max(0, scroll.scrollWidth - previousWidth)
      return
    }
    if (pendingRightDayRef.current !== null) {
      const rightDay = pendingRightDayRef.current
      pendingRightDayRef.current = null
      scroll.scrollLeft = Math.max(0, rightDay * dayStep - scroll.clientWidth)
      return
    }
    if (!initialScrollPositionedRef.current) {
      initialScrollPositionedRef.current = true
      scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
    }
  }, [chartWidth, dayStep, historyReady, points.length])

  const loadOlderHistory = useCallback(async (additionalDays = TREND_HISTORY_CHUNK_DAYS) => {
    const scroll = scrollRef.current
    if (!scroll || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const currentDays = historyDaysRef.current
    const nextDays = currentDays + additionalDays
    const olderFrom = addDays(today, -(nextDays - 1))
    const olderTo = addDays(today, -currentDays)
    const previousScrollWidth = scroll.scrollWidth
    try {
      const olderEntries = await getEntriesBetween(olderFrom, olderTo)
      pendingPrependWidthRef.current = previousScrollWidth
      historyDaysRef.current = nextDays
      setHistoryDays(nextDays)
      setHistoryEntries((current) => {
        const byId = new Map([...olderEntries, ...current].map((entry) => [entry.id, entry]))
        return sortMealEntries([...byId.values()])
      })
      setHistoryError(null)
    } catch {
      setHistoryError('過去の食事履歴を追加で読み込めませんでした。')
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [today])

  useEffect(() => {
    if (!historyReady) return
    const minimumHistoryDays = Math.max(TREND_MIN_HISTORY_DAYS, rangeDays * 2)
    const missingDays = minimumHistoryDays - historyDaysRef.current
    if (missingDays > 0) void loadOlderHistory(missingDays)
  }, [historyReady, loadOlderHistory, rangeDays])

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!initialScrollPositionedRef.current || event.currentTarget.scrollLeft > event.currentTarget.clientWidth * 0.35) return
    void loadOlderHistory()
  }

  const changeRange = (next: TrendRangeId) => {
    if (next === range) return
    const scroll = scrollRef.current
    if (scroll) pendingRightDayRef.current = (scroll.scrollLeft + scroll.clientWidth) / dayStep
    onRangeChange(next)
  }

  return <>
    <section className="page-heading"><div><span className="eyebrow">GRAPHS</span><h1>グラフ</h1></div></section>
    <section className="settings-card trend-toolbar-card"><div className="trend-range-tabs" role="tablist" aria-label="1画面に表示する期間">{TREND_RANGE_OPTIONS.map((option) => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? 'active' : ''} onClick={() => changeRange(option.id)}>{option.label}</button>)}</div><select className="trend-metric-select" aria-label="表示する栄養素" value={metric} onChange={(event) => setMetric(event.target.value as NutrientKey)}>{TREND_NUTRIENT_KEYS.map((key) => <option key={key} value={key}>{NUTRIENT_LABELS[key]}</option>)}</select></section>
    <section className="trend-chart-card" aria-busy={!historyReady || loadingOlder}><div className="trend-chart-legend"><MealColorLegend />{goalPosition !== null && <span className="trend-goal-legend"><i className="trend-legend-line" />目標 {formatGraphNutrient(goal)}{NUTRIENT_UNITS[metric]}</span>}</div>{historyError && <p className="trend-load-status error-text">{historyError}</p>}<div ref={scrollRef} className="trend-chart-scroll" onScroll={handleScroll}><div className="trend-chart" style={{ width: `${chartWidth}px` }}><div className="trend-chart-plot">{goalPosition !== null && <span className="trend-chart-goal-line" style={{ bottom: `${goalPosition}%` }} />}<div className="trend-chart-bars" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))`, gap: `${dayGap}px` }}>{points.map((point) => { const availableValue = point.availableNutrients[metric]; const height = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / chartMax) * 100)); const segments = MEAL_TYPES.map((type) => ({ type, value: point.availableNutrientsByMealType[type]?.[metric] ?? 0 })).filter((segment) => segment.value > 0); const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0); const showLabel = shouldShowTrendDate(point.date, range); return <div className="trend-bar-column" key={point.date} title={`${point.date} ${NUTRIENT_LABELS[metric]} ${formatGraphNutrient(availableValue)}${NUTRIENT_UNITS[metric]}`}><span className={`trend-bar-value${availableValue === null ? ' is-missing' : ''}${showLabel ? '' : ' is-hidden'}`}>{formatGraphNutrient(availableValue)}<small>{NUTRIENT_UNITS[metric]}</small></span><div className="trend-bar-track">{availableValue !== null && segmentTotal > 0 && <span className="trend-bar-fill" style={{ height: `${height}%` }}>{segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ height: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}</div><span className={`trend-bar-date${showLabel ? '' : ' is-hidden'}`}>{formatTrendDate(point.date)}</span></div> })}</div></div></div></div>{loadingOlder && <p className="trend-load-status">過去の記録を読み込んでいます…</p>}</section>
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
    <section className="page-heading"><div><span className="eyebrow">DAILY LOG</span><h1>今日の記録</h1></div><div className="date-picker"><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value) }} /><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button></div></section>
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
  const dragHandleRef = useRef<HTMLButtonElement | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const latestDragYRef = useRef(0)
  const updateDragPositionRef = useRef<(clientY: number) => void>(() => undefined)
  const finishDragRef = useRef<(pointerId: number | null, commit: boolean) => void>(() => undefined)
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

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, entryId: string) => {
    if (savingOrderRef.current || orderedEntriesRef.current.length < 2) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-meal-entry-id]')
    if (!row) return
    const rect = row.getBoundingClientRect()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Global listeners registered below keep the drag usable even when capture is unavailable.
    }
    dragStartOrderRef.current = orderedEntriesRef.current
    dragOffsetYRef.current = event.clientY - rect.top
    dragPointerIdRef.current = event.pointerId
    dragHandleRef.current = event.currentTarget
    latestDragYRef.current = event.clientY
    draggedEntryIdRef.current = entryId
    setDraggedEntryId(entryId)
    setDragPreview({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }

  const updateDragPosition = (clientY: number) => {
    const sourceId = draggedEntryIdRef.current
    if (!sourceId) return
    setDragPreview((current) => current ? { ...current, top: clientY - dragOffsetYRef.current } : current)
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
      if (rect && clientY < rect.top + rect.height / 2) {
        destination = index
        break
      }
    }
    const next = [...remaining]
    next.splice(destination, 0, source)
    if (!next.every((entry, index) => entry.id === orderedEntriesRef.current[index]?.id)) updateLocalOrder(next)
  }

  updateDragPositionRef.current = updateDragPosition

  const finalizeDrag = (pointerId: number | null, commit: boolean) => {
    if (!draggedEntryIdRef.current || dragPointerIdRef.current === null || (pointerId !== null && dragPointerIdRef.current !== pointerId)) return
    const activePointerId = dragPointerIdRef.current
    const handle = dragHandleRef.current
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
      if (commit) updateDragPositionRef.current(latestDragYRef.current)
    }
    const finalOrder = orderedEntriesRef.current
    dragPointerIdRef.current = null
    draggedEntryIdRef.current = null
    dragHandleRef.current = null
    setDraggedEntryId(null)
    setDragPreview(null)
    try {
      if (handle?.hasPointerCapture(activePointerId)) handle.releasePointerCapture(activePointerId)
    } catch {
      // The browser may already have released capture after moving the keyed row.
    }
    if (commit) void commitOrder(finalOrder)
    else updateLocalOrder(dragStartOrderRef.current)
  }

  finishDragRef.current = finalizeDrag

  useEffect(() => {
    if (!draggedEntryId) return

    const queueMove = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      latestDragYRef.current = event.clientY
      if (dragFrameRef.current !== null) return
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null
        updateDragPositionRef.current(latestDragYRef.current)
      })
    }
    const commit = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      finishDragRef.current(event.pointerId, true)
    }
    const cancel = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      finishDragRef.current(event.pointerId, false)
    }
    const cancelWithoutPointer = () => finishDragRef.current(null, false)
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelWithoutPointer()
    }

    document.addEventListener('pointermove', queueMove, { capture: true, passive: false })
    window.addEventListener('pointerup', commit, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', cancelWithoutPointer)
    window.addEventListener('pagehide', cancelWithoutPointer)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      document.removeEventListener('pointermove', queueMove, true)
      window.removeEventListener('pointerup', commit, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', cancelWithoutPointer)
      window.removeEventListener('pagehide', cancelWithoutPointer)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
    }
  }, [draggedEntryId])

  const draggedEntry = draggedEntryId ? orderedEntries.find((entry) => entry.id === draggedEntryId) : null

  return <>
    <section className="page-heading meal-confirmation-heading"><div><span className="eyebrow">MEAL CONFIRMATION</span><h1>{type}の確認</h1></div><button className="button ghost" type="button" onClick={onDone}>今日の記録へ</button></section>
    <section className="settings-card meal-confirmation-card">
      <div className="meal-confirmation-summary"><div><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" /><span>{type}</span></div><strong>{entries.length}件 · {formatNutrient(subtotal.energyKcal)} kcal</strong></div>
      {orderedEntries.length > 0 ? <div ref={listRef} className={`meal-confirmation-list${draggedEntryId ? ' is-reordering' : ''}`}>{orderedEntries.map((entry) => { const entryName = getMealEntryDisplayName(entry); return <div className={`meal-confirmation-entry${draggedEntryId === entry.id ? ' is-drag-placeholder' : ''}`} key={entry.id} data-meal-entry-id={entry.id}><button className="meal-order-handle" type="button" aria-label={`${entryName}をドラッグして並び替え`} disabled={savingOrder || orderedEntries.length < 2} onPointerDown={(event) => startDrag(event, entry.id)} onPointerUp={(event) => finishDragRef.current(event.pointerId, true)} onPointerCancel={(event) => finishDragRef.current(event.pointerId, false)}>≡</button><div className="meal-confirmation-entry-copy"><strong>{entryName}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}</span></div><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b><button className="small-action" type="button" disabled={savingOrder} onClick={() => onEdit(entry)}>編集</button><button className="small-action danger-text" type="button" disabled={savingOrder} onClick={() => onDelete(entry)}>削除</button></div> })}</div> : <div className="empty-state">この区分の食事記録はありません。</div>}
      <div className="meal-confirmation-actions"><button className="button primary" type="button" onClick={onAdd}>＋ {type}を追加</button><button className="button secondary" type="button" onClick={onDone}>登録を完了</button></div>
    </section>
    {draggedEntry && dragPreview && <div className="meal-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle">≡</span><div className="meal-confirmation-entry-copy"><strong>{getMealEntryDisplayName(draggedEntry)}{draggedEntry.foodSnapshot.maker ? `（${draggedEntry.foodSnapshot.maker}）` : ''}</strong><span>{draggedEntry.amount}{draggedEntry.amountUnit}{type === '間食' ? ` · ${formatTime(draggedEntry.eatenAt)}` : ''}</span></div><b>{formatNutrient(draggedEntry.calculatedNutrients.energyKcal)} kcal</b></div>}
  </>
}

function TodayDetailsModal({ selectedDate, goals, entries, onClose }: { selectedDate: string; goals: NutritionGoals; entries: MealEntry[]; onClose: () => void }) {
  const [rangeId, setRangeId] = useState<TodayDetailRangeId>('day')
  const [loadedPeriod, setLoadedPeriod] = useState<{ key: string; entries: MealEntry[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const period = useMemo(() => resolveTodayDetailPeriod(rangeId, selectedDate), [rangeId, selectedDate])
  const periodKey = `${period.from}:${period.to}`

  useEffect(() => {
    if (rangeId === 'day') {
      setLoading(false)
      setLoadError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setLoadedPeriod((current) => current?.key === periodKey ? current : null)
    void getEntriesBetween(period.from, period.to)
      .then((periodEntries) => {
        if (cancelled) return
        setLoadedPeriod({ key: periodKey, entries: periodEntries })
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadedPeriod(null)
        setLoadError({ key: periodKey, message: '期間の食事記録を読み込めませんでした。再試行してください。' })
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [period.from, period.to, periodKey, rangeId, reloadToken])

  const displayedEntries = rangeId === 'day'
    ? entries
    : loadedPeriod?.key === periodKey ? loadedPeriod.entries : null
  const summary = useMemo(
    () => displayedEntries ? buildTodayDetailSummary(displayedEntries) : null,
    [displayedEntries],
  )
  const currentLoadError = loadError?.key === periodKey ? loadError.message : null
  const waitingForPeriod = rangeId !== 'day' && loadedPeriod?.key !== periodKey && currentLoadError === null
  const periodLabel = period.from === period.to ? period.to : `${period.from}〜${period.to}`

  return <div className="modal-backdrop nutrient-detail-backdrop" role="dialog" aria-modal="true" aria-label="今日の栄養詳細"><section className="modal-card nutrient-detail-modal today-details-modal" aria-busy={loading || waitingForPeriod}><div className="modal-heading"><div><span className="eyebrow">TODAY DETAILS</span><h2>今日の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="today-detail-range-control"><div className="today-detail-range-tabs" role="tablist" aria-label="今日の詳細の集計期間">{TODAY_DETAIL_RANGE_OPTIONS.map((option) => <button key={option.id} id={`today-detail-range-${option.id}`} type="button" role="tab" aria-selected={rangeId === option.id} aria-controls="today-detail-period-panel" className={rangeId === option.id ? 'active' : ''} onClick={() => setRangeId(option.id)}>{option.label}</button>)}</div><div className="today-detail-range-summary"><span>{periodLabel}</span><strong>{period.days}日合計</strong></div></div><div id="today-detail-period-panel" role="tabpanel" aria-labelledby={`today-detail-range-${rangeId}`}>{(loading || waitingForPeriod) && !summary ? <p className="today-detail-load-status" role="status">期間の食事記録を読み込んでいます…</p> : currentLoadError ? <div className="today-detail-load-status error-text" role="alert"><p>{currentLoadError}</p><button className="button secondary" type="button" onClick={() => setReloadToken((current) => current + 1)}>再試行</button></div> : summary && <NutrientGoalGraphs nutrients={summary.nutrients} availableNutrients={summary.availableNutrients} goals={goals} subtotals={summary.subtotals} availableSubtotals={summary.availableSubtotals} colorByMeal referenceMultiplier={period.days} />}</div></section></div>
}

function MenuNutritionDetailsModal({ menu, menus, foods, goals, onClose }: { menu: Menu; menus: Menu[]; foods: Food[]; goals: NutritionGoals; onClose: () => void }) {
  const menuFood = menuToFood(menu, menus, foods)
  const memo = menu.memo?.trim()
  return <div className="modal-backdrop nutrient-detail-backdrop" role="dialog" aria-modal="true" aria-label={`${menu.name}の詳細`}><section className="modal-card nutrient-detail-modal menu-nutrition-details-modal"><div className="modal-heading"><div><span className="eyebrow">MY MENU DETAILS</span><h2>{menu.name}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(menuFood.nutrients.energyKcal)}<small> kcal</small></strong></div><section className="menu-detail-nutrients" aria-label="栄養価"><span className="eyebrow">NUTRIENTS</span><h3>栄養価</h3><NutrientGoalGraphs nutrients={menuFood.nutrients} goals={goals} /></section>{memo && <section className="menu-detail-memo" aria-label="メモ"><span className="eyebrow">MEMO</span><h3>メモ</h3><p>{memo}</p></section>}</section></div>
}

function QuickFoodGroup({ title, foods, favoriteIds, onSelect, onToggleFavorite, emptyText = 'まだお気に入りがありません。食品の☆から追加できます。' }: { title: string; foods: Food[]; favoriteIds: Set<string>; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void; emptyText?: string }) {
  return <div className="quick-group"><h3>{title}</h3>{foods.length > 0 ? <div className="quick-list">{foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />)}</div> : <p className="quick-empty-inline">{emptyText}</p>}</div>
}

function FoodRow({ food, favorite, onSelect, onAdd, onToggleFavorite, onEdit, onDelete, onRemove }: { food: Food; favorite: boolean; onSelect?: (food: Food) => void; onAdd?: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEdit?: (food: Food) => void; onDelete?: (food: Food) => void; onRemove?: (food: Food) => void }) {
  const name = displayFoodName(food)
  const nutritionLabel = foodListNutritionLabel(food)
  return <div className="food-row">{onSelect ? <button type="button" className="food-main" onClick={() => onSelect(food)}><strong>{name}</strong><span>{food.maker || '一般食品'} · {nutritionLabel}</span></button> : <div className="food-main static"><strong>{name}</strong><span>{food.maker || '一般食品'} · {nutritionLabel}</span></div>}{onAdd && <button type="button" className="small-action food-add-button" onClick={() => onAdd(food)}>追加</button>}<button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button>{onEdit && <button type="button" className="small-action" onClick={() => onEdit(food)}>編集</button>}{onDelete && <button type="button" className="small-action danger-text" onClick={() => onDelete(food)}>削除</button>}{onRemove && <button type="button" className="small-action danger-text" onClick={() => onRemove(food)}>外す</button>}</div>
}

function MenuFoodPicker({ menus, generalMenus, menuSets, foods, onSelect, onSelectMenuSet, onCreateTemporaryMenu }: { menus: Menu[]; generalMenus: GeneralMenu[]; menuSets: MenuSet[]; foods: Food[]; onSelect: (food: Food) => void; onSelectMenuSet: (menuSet: MenuSet) => void; onCreateTemporaryMenu: () => void }) {
  const categoryGroups = MENU_CATEGORIES.map((category) => ({ category, menus: menus.filter((menu) => menu.category === category) }))
  return <section className="section-block menu-picker-section food-section-card">
    <div className="section-title"><div><span className="eyebrow">MENUS</span><h2>メニューから探す</h2></div></div>
    <div className="menu-picker-groups">
      <details className="menu-picker-group">
        <summary><span className="menu-picker-summary-label"><i aria-hidden="true" />Myセット</span><small>{menuSets.length > 0 ? `${menuSets.length}件` : '登録なし'}</small></summary>
        <div className="menu-picker-list">{menuSets.length > 0 ? menuSets.map((menuSet) => {
          const food = menuSetPreviewFood(menuSet, menus, generalMenus, foods)
          const itemCount = menuSet.menuIds.length + (menuSet.generalMenuIds?.length ?? 0) + getMenuSetFoodItems(menuSet, foods).length
          return <button className="menu-picker-row" type="button" key={menuSet.id} onClick={() => onSelectMenuSet(menuSet)}><span className="source-badge">セット</span><span className="menu-picker-copy"><strong>{menuSet.name}</strong><small>内容{itemCount}件を一括登録 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b className="batch-action">一括登録</b></button>
        }) : <p className="menu-picker-empty">Myセットはまだ登録されていません。</p>}</div>
      </details>
      <button className="menu-picker-create-temporary" type="button" onClick={onCreateTemporaryMenu}><span><span className="eyebrow">ONE-TIME</span><strong>一時メニューを作成</strong></span><b>＋</b></button>
      <details className="menu-picker-group">
        <summary><span className="menu-picker-summary-label"><i aria-hidden="true" />一般メニュー</span><small>{generalMenus.length > 0 ? `${generalMenus.length}件` : '登録なし'}</small></summary>
        <div className="menu-picker-list">{generalMenus.length > 0 ? generalMenus.map((menu) => {
          const food = generalMenuToFood(menu, menus, foods)
          return <button className="menu-picker-row" type="button" key={menu.id} onClick={() => onSelect(food)}><span className="source-badge">一般</span><span className="menu-picker-copy"><strong>{menu.name}</strong><small>{getMenuIngredients(menu, foods).length}食材 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button>
        }) : <p className="menu-picker-empty">一般メニューはまだ登録されていません。</p>}</div>
      </details>
      {categoryGroups.map(({ category, menus: categoryMenus }) => <details className="menu-picker-group" key={category}>
        <summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary>
        <div className="menu-picker-list">{categoryMenus.length > 0 ? categoryMenus.map((menu) => {
          const food = menuToFood(menu, menus, foods)
          return <button className="menu-picker-row" type="button" key={menu.id} onClick={() => onSelect(food)}><span className="source-badge">My</span><span className="menu-picker-copy"><strong>{menu.name}</strong><small>{getMenuIngredients(menu, foods).length}食材 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button>
        }) : <p className="menu-picker-empty">この区分に登録されたMyメニューはありません。</p>}</div>
      </details>)}
    </div>
  </section>
}

function MealGroup({ type, entries, subtotal, existingFoodIds, onShowDetails, onOpenConfirmation }: { type: MealType; entries: MealEntry[]; subtotal?: Nutrients; existingFoodIds: Set<string>; onShowDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onOpenConfirmation: (type: MealType) => void }) {
  const sharedTime = entries[0]?.eatenAt
  return <div className="meal-group"><div className="meal-heading"><h3><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</h3><div className="meal-heading-actions"><span>{entries.length ? `${formatNutrient(subtotal?.energyKcal ?? null)} kcal` : '記録なし'}</span>{entries.length > 0 && <button type="button" className="small-action" onClick={() => onShowDetails(type, entries, subtotal ?? EMPTY_NUTRIENTS)}>詳細</button>}<button type="button" className="meal-record-button" onClick={() => onOpenConfirmation(type)}>編集</button></div></div>{entries.length > 0 && type !== '間食' && <div className="meal-shared-time">食事時刻：{sharedTime ? formatTime(sharedTime) : '未設定'}</div>}{entries.map((entry) => <div className="meal-entry" key={entry.id}><div className="meal-entry-copy"><strong>{getMealEntryDisplayName(entry)}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}{existingFoodIds.has(entry.foodId) ? '' : ' · 削除済み食品'}</span></div><div className="meal-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b></div></div>)}</div>
}

interface FoodsViewProps { recordingMealType: MealType | null; foods: Food[]; foodGroups: FoodGroup[]; menus: Menu[]; generalMenus: GeneralMenu[]; menuSets: MenuSet[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onSelectFood: (food: Food) => void; onSelectMenuSet: (menuSet: MenuSet) => void; onCreateTemporaryMenu: () => void; onToggleFavorite: (food: Food) => void; onEditFood: (food: Food) => void; onDeleteFood: (food: Food) => void; onOpenSearch?: () => void; onOpenScanner: () => void; onBack: () => void; backLabel: string; copyMealType: 'すべて' | MealType; setCopyMealType: (value: 'すべて' | MealType) => void; onCopyPrevious: () => void }
function FoodsView({ recordingMealType, foods, foodGroups, menus, generalMenus, menuSets, recentFoods, favoriteFoods, favoriteIds, onSelectFood, onSelectMenuSet, onCreateTemporaryMenu, onToggleFavorite, onEditFood, onDeleteFood, onOpenSearch, onOpenScanner, onBack, backLabel, copyMealType, setCopyMealType, onCopyPrevious }: FoodsViewProps) {
  const selectable = Boolean(recordingMealType)
  const [activeTab, setActiveTab] = useState<'favorites' | 'history' | 'foods' | 'menus'>(selectable ? 'favorites' : 'foods')
  const [foodMasterCategory, setFoodMasterCategory] = useState<'all' | 'commercial'>('all')
  const [openFoodGroups, setOpenFoodGroups] = useState<Set<FoodIndexGroupKey>>(new Set())
  const visibleFoods = useMemo(() => selectable
    ? foods
    : foods.filter((food) => foodMatchesSearchCategory(food, foodMasterCategory)), [foodMasterCategory, foods, selectable])
  const indexedFoodGroups = useMemo(() => groupFoodsByKana(visibleFoods, foodGroups), [foodGroups, visibleFoods])
  useEffect(() => {
    setActiveTab(selectable ? 'favorites' : 'foods')
  }, [selectable])
  const tabs: Array<{ id: 'favorites' | 'history' | 'foods' | 'menus'; label: string }> = selectable
    ? [{ id: 'favorites', label: 'お気に入り' }, { id: 'history', label: '履歴' }, { id: 'menus', label: 'メニュー' }]
    : []
  return <><section className="page-heading food-screen-heading"><div><span className="eyebrow">{recordingMealType ? 'SELECT FOOD' : 'FOOD MASTER'}</span><h1>{recordingMealType ? `${recordingMealType}の食品を選ぶ` : '食品を登録・管理'}</h1></div><button className="button ghost" type="button" onClick={onBack}>{backLabel}</button></section><div className="action-row">{onOpenSearch && <button className="button primary" type="button" onClick={onOpenSearch}>⌕ 食品を検索</button>}<button className="button secondary" type="button" onClick={onOpenScanner}>▦ バーコード</button></div><div className="search-category-tabs food-screen-tabs" role="tablist" aria-label="食品登録方法">{tabs.map((tab) => <button key={tab.id} id={`food-screen-tab-${tab.id}`} className={activeTab === tab.id ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="food-screen-tab-panel" onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div><div id="food-screen-tab-panel" role="tabpanel" aria-labelledby={`food-screen-tab-${activeTab}`} className="food-screen-sections">{activeTab === 'menus' && selectable && <MenuFoodPicker menus={menus} generalMenus={generalMenus} menuSets={menuSets} foods={foods} onSelect={onSelectFood} onSelectMenuSet={onSelectMenuSet} onCreateTemporaryMenu={onCreateTemporaryMenu} />}{activeTab === 'favorites' && selectable && <section className="section-block food-section-card food-quick-section"><div className="section-title"><div><span className="eyebrow">FAVORITES</span><h2>お気に入り</h2></div><span className="count-label quick-count">{favoriteFoods.length}件</span></div><QuickFoodGroup title="お気に入りの食品" foods={favoriteFoods.slice(0, 20)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} /></section>}{activeTab === 'history' && selectable && <section className="section-block food-section-card food-quick-section"><div className="section-title"><div><span className="eyebrow">HISTORY</span><h2>履歴</h2></div><span className="count-label quick-count">{recentFoods.length}件</span></div><QuickFoodGroup title="最近使った食品" foods={recentFoods.slice(0, 20)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} emptyText="食事を記録すると、最近使った食品がここに表示されます。" />{recordingMealType && <section className="copy-panel quick-copy-panel"><div><strong>前日の食事をコピー</strong><span>当日の現在時刻で登録します</span></div><select value={copyMealType} onChange={(event) => setCopyMealType(event.target.value as 'すべて' | MealType)}><option>すべて</option>{MEAL_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button className="button ghost" type="button" onClick={onCopyPrevious}>コピー</button></section>}</section>}{activeTab === 'foods' && <section className="section-block food-section-card"><div className="section-title"><div><span className="eyebrow">FOODS</span><h2>食品</h2></div><span className="count-label">{visibleFoods.length}件</span></div>{!selectable && <div className="search-category-tabs food-master-list-tabs" role="tablist" aria-label="食品一覧の分類"><button className={foodMasterCategory === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={foodMasterCategory === 'all'} onClick={() => setFoodMasterCategory('all')}>すべて</button><button className={foodMasterCategory === 'commercial' ? 'active' : ''} type="button" role="tab" aria-selected={foodMasterCategory === 'commercial'} onClick={() => setFoodMasterCategory('commercial')}>外食・市販</button></div>}<div className="menu-picker-groups">{indexedFoodGroups.map((group) => { const open = openFoodGroups.has(group.key); return <details className="menu-picker-group" key={group.key} open={open} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenFoodGroups((current) => { const next = new Set(current); if (isOpen) next.add(group.key); else next.delete(group.key); return next }) }}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{group.label}</span><small>{group.foods.length > 0 ? `${group.foods.length}件` : '登録なし'}</small></summary>{open && <div className="food-results">{group.foods.length > 0 ? group.foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onEdit={onEditFood} onDelete={onDeleteFood} />) : <p className="menu-picker-empty">この行に登録された食品はありません。</p>}</div>}</details> })}</div></section>}</div></>
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

const searchCategoryLabels: Record<FoodSearchCategory, string> = { all: '全て', general: '一般食材', menu: 'メニュー', commercial: '外食・市販' }

function SearchResultsView({ groups, purpose, category, searching, onCategoryChange, onSelect, onAddFood, onLoadMore, onOpenConfirmation, onBack }: { groups: SearchResultGroup[]; purpose: SearchPurpose; category: FoodSearchCategory; searching: boolean; onCategoryChange: (category: FoodSearchCategory) => void; onSelect: (query: string, item: SearchResultItem) => void; onAddFood: (query: string) => void; onLoadMore: (index: number) => void; onOpenConfirmation: () => void; onBack: () => void }) {
  const categories = purpose === 'meal' ? MEAL_SEARCH_CATEGORIES : FOOD_MASTER_SEARCH_CATEGORIES
  const emptyLabel = category === 'all' ? '一致する食品・メニューがありません。' : category === 'menu' ? '一致するメニューがありません。' : `${searchCategoryLabels[category]}に一致する食品がありません。`
  return <>
    <section className="page-heading search-results-page-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h1>検索結果</h1></div><div className="search-results-heading-actions">{purpose === 'meal' && <button className="button primary" type="button" onClick={onOpenConfirmation}>確認画面へ→</button>}<button className="button ghost" type="button" onClick={onBack}>← 検索画面へ</button></div></section>
    <div className="search-category-tabs" role="tablist" aria-label="検索結果の分類">{categories.map((value) => <button key={value} id={`search-category-${value}`} role="tab" type="button" aria-selected={category === value} aria-controls="search-category-panel" className={category === value ? 'active' : ''} disabled={searching} onClick={() => onCategoryChange(value)}>{searchCategoryLabels[value]}</button>)}</div>
    <div id="search-category-panel" role="tabpanel" aria-labelledby={`search-category-${category}`} aria-busy={searching} className="search-result-groups">
      {searching ? <div className="empty-state">検索中…</div> : <>
        {groups.map((group, groupIndex) => <section className="search-result-group" key={`${group.query}:${groupIndex}`}>
          <div className="search-result-heading"><strong>検索結果：</strong><span>{group.query}</span></div>
          <div className="food-results">
            {group.items.map((item) => <button className="search-result-row" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(group.query, item)}><span className="source-badge">{item.kind === 'food' || item.kind === 'user-food' ? '食品' : item.kind === 'menu' ? 'My' : item.kind === 'general-menu' ? '一般' : 'セット'}</span><span className="search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small>{(item.kind === 'food' || item.kind === 'user-food') && <span className="search-result-meta">{item.recentlyUsed && <em>最近使った</em>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_group' && item.userFoodResult.group.memberCount !== 1 && <span>{item.userFoodResult.group.memberCount}種類から選択</span>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_variant' && item.variants.length > 1 && <span>{item.variants.length}バリエーションから選択</span>}{item.kind === 'food' && item.variants.length > 1 && <span>{item.variants.length}種類から選択</span>}</span>}</span><b className={item.kind === 'set' ? 'batch-action' : undefined}>{item.kind === 'set' ? '一括登録' : '›'}</b></button>)}
            {group.items.length === 0 && <div className="search-empty-state"><p>{emptyLabel}</p>{category !== 'menu' && <button className="button secondary" type="button" onClick={() => onAddFood(group.query === '最近・お気に入り' ? '' : group.query)}>食品を追加</button>}</div>}
            {group.nextCursor && <button className="button secondary search-load-more" type="button" onClick={() => onLoadMore(groupIndex)}>さらに表示</button>}
          </div>
        </section>)}
        {groups.length === 0 && <div className="empty-state">検索結果はありません。検索画面へ戻って再検索してください。</div>}
      </>}
    </div>
  </>
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
  initialFoodId?: string
  initialAmount?: string
  initialAmountUnit?: QuantityUnit
  submitLabel?: string
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

function MextFoodVariantPickerModal({ result, userFoodResult, foods = [], foodGroups = [], onSelect, onClose, mealMode = false, onSubmitMeal, initialFoodId, initialAmount, initialAmountUnit, submitLabel = '食事として登録', foodAttributePreferences = {}, onSaveFoodAttributePreference }: FoodVariantPickerModalProps) {
  const initialFoodVariant = useMemo(() => initialFoodId ? getFoodVariantBySourceId(initialFoodId) : undefined, [initialFoodId])
  const initialUserSelection = useMemo(() => {
    if (!userFoodResult || !initialFoodVariant) return null
    return reconcileUserFoodSelection(userFoodResult.group.id, userFoodResult.presetSelection).selection
  }, [initialFoodVariant, userFoodResult])
  const userGroupPreferences = useMemo(() => userFoodResult ? (foodAttributePreferences[userFoodResult.group.id] ?? {}) : {}, [foodAttributePreferences, userFoodResult])
  const appliedUserPreferences = useMemo(() => userFoodResult
    ? applyConstrainedUserFoodSelectionPreferences(userFoodResult.group.id, userFoodResult.group.selectionDimensions, userFoodResult.presetSelection, userGroupPreferences)
    : { selection: {}, autoHiddenDimensionIds: new Set<string>(), invalidDimensionIds: new Set<string>(), incompatibleDimensionIds: new Set<string>() }, [userFoodResult, userGroupPreferences])
  const userSelectionOrder = useMemo(() => userFoodResult ? [
    ...userFoodResult.group.selectionDimensions.filter((dimension) => !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
    ...userFoodResult.group.selectionDimensions.filter((dimension) => appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
  ].map((dimension) => dimension.id) : [], [appliedUserPreferences.autoHiddenDimensionIds, userFoodResult])
  const [userSelection, setUserSelection] = useState<Record<string, string>>(() => initialUserSelection ?? appliedUserPreferences.selection)
  const [temporarilyVisibleUserDimensionIds, setTemporarilyVisibleUserDimensionIds] = useState<Set<string>>(new Set())
  const [constraintMessage, setConstraintMessage] = useState<string | null>(null)
  useEffect(() => {
    setUserSelection(initialUserSelection ?? appliedUserPreferences.selection)
    setTemporarilyVisibleUserDimensionIds(new Set(appliedUserPreferences.incompatibleDimensionIds))
    if (appliedUserPreferences.incompatibleDimensionIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [appliedUserPreferences, initialUserSelection])
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
  const initialAttributeSelection = useMemo(() => initialFoodVariant && initialFoodVariant.foodGroupId === activeFoodGroupId
    ? { ...initialFoodVariant.attributes }
    : null, [activeFoodGroupId, initialFoodVariant])
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
  const [selection, setSelection] = useState<Record<string, string>>(() => initialAttributeSelection ?? appliedPreferences.selection)
  const [selectionFoodGroupId, setSelectionFoodGroupId] = useState<string | null>(activeFoodGroupId)
  const [supplementalFoodId, setSupplementalFoodId] = useState<string | null>(null)
  const selectionForActiveGroup = selectionFoodGroupId === activeFoodGroupId ? selection : appliedPreferences.selection
  useEffect(() => {
    setSelection(initialAttributeSelection ?? appliedPreferences.selection)
    setSelectionFoodGroupId(activeFoodGroupId)
    setSupplementalFoodId(null)
    setTemporarilyVisibleAttributeIds(new Set(appliedPreferences.incompatibleAttributeIds))
    if (appliedPreferences.incompatibleAttributeIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [activeFoodGroupId, appliedPreferences, initialAttributeSelection])
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
  const editingAmount = initialAmount !== undefined
  const [amount, setAmount] = useState(initialAmount ?? selectedFoodDefaultAmount)
  const [amountUnit, setAmountUnit] = useState<QuantityUnit>(initialAmountUnit ?? selectedFoodDefaultUnit)
  useEffect(() => {
    if (!editingAmount) {
      setAmount(selectedFoodDefaultAmount)
      setAmountUnit(selectedFoodDefaultUnit)
      return
    }
    if (selectedFood && !getFoodQuantityUnits(selectedFood).includes(amountUnit)) setAmountUnit(selectedFoodDefaultUnit)
  }, [amountUnit, editingAmount, selectedFood, selectedFoodDefaultAmount, selectedFoodDefaultUnit, selectedFoodId])

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
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品の種類と属性を選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">FOOD SELECTION</span><h2 className="variant-picker-title">{activeResult?.group.displayName ?? userFoodResult?.group.displayName ?? result?.group.displayName ?? '食品'}<button className="info-button variant-attribute-info" type="button" disabled={visibilityItems.length === 0} onClick={() => setShowAttributeSettings((current) => !current)} aria-expanded={showAttributeSettings} aria-label="表示する食品属性を設定">ⓘ</button></h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>{visibleUserDimensions.length > 0 && <div className="variant-choice-groups food-type-selection">{visibleUserDimensions.map((dimension) => <section className="variant-choice-group" key={dimension.id}><h3>{dimension.displayName}</h3><div className="variant-choice-buttons">{dimension.values.map((value) => { const available = availableUserDimensionValues.get(dimension.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${userSelection[dimension.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={userSelection[dimension.id] === value.id} key={`${dimension.id}:${value.id}`} disabled={!available} onClick={() => chooseUserDimension(dimension.id, value.id)}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{showAttributeSettings && <FoodAttributeVisibilityPanel items={visibilityItems} onClose={() => setShowAttributeSettings(false)} />}{supplementalFoods.length > 0 && <div className="variant-choice-groups"><section className="variant-choice-group"><h3>手動登録食品</h3><div className="variant-choice-buttons">{supplementalFoods.map((food) => <button className={`variant-choice-button${supplementalFoodId === food.id ? ' is-selected' : ''}`} type="button" aria-pressed={supplementalFoodId === food.id} key={food.id} onClick={() => setSupplementalFoodId(food.id)}>{food.officialName ?? food.name}</button>)}</div></section></div>}{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{autoAppliedUserDimensions.length + autoAppliedAttributes.length > 0 && <div className="variant-picker-auto-summary"><span>自動適用: {[...autoAppliedUserDimensions.map((dimension) => `${dimension.displayName}＝${dimension.values.find((value) => value.id === userSelection[dimension.id])?.displayName ?? ''}`), ...autoAppliedAttributes.map((attribute) => `${attributeDisplayName(attribute)}＝${attribute.values.find((value) => value.id === selectionForActiveGroup[attribute.id])?.displayName ?? ''}`)].join('、')}</span>{autoHiddenUserDimensions.length + autoHiddenAttributes.length > 0 && <button className="small-action" type="button" onClick={() => { autoHiddenUserDimensions.forEach((dimension) => showAutoUserDimension(dimension.id)); autoHiddenAttributes.forEach((attribute) => showAutoAttribute(attribute.id)) }}>今回だけ変更</button>}</div>}{attributesToShow.length > 0 && <div className="variant-choice-groups">{attributesToShow.map((attribute) => <section className="variant-choice-group" key={attribute.id}><h3>{attributeDisplayName(attribute)}</h3><div className="variant-choice-buttons">{attribute.values.map((value) => { const available = availableAttributeValues.get(attribute.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${selectionForActiveGroup[attribute.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={selectionForActiveGroup[attribute.id] === value.id} key={`${attribute.id}:${value.id}`} disabled={!available} onClick={() => chooseAttribute(attribute.id, value.id, attribute.visibility === 'hidden')}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{userFoodResult && !activeResult && <p className="variant-picker-no-match">{resolution.error}</p>}{activeResult && selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{selectedFoodName}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}</small></div> : activeResult ? <p className="variant-picker-no-match">{resolution.error}</p> : null}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>{submitLabel}</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

function FoodAmountPickerModal({ food, amount, unit, onChangeAmount, onChangeUnit, onSubmit, onClose }: { food: Food; amount: string; unit: QuantityUnit; onChangeAmount: (value: string) => void; onChangeUnit: (value: QuantityUnit) => void; onSubmit?: (food: Food, amount: string, unit: QuantityUnit) => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品の分量を設定"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">FOOD AMOUNT</span><h2>{displayFoodName(food)}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="selected-food"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · 基準量 {food.baseAmount}{food.baseUnit}</span></div><label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => onChangeAmount(event.target.value)} required /><select className="field-suffix" value={unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(food).map((option) => <option key={option} value={option}>{option}</option>)}</select></div></div></label><button className="button primary variant-picker-confirm" type="button" onClick={() => onSubmit?.(food, amount, unit)}>追加する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></section></div>
}

function LegacyFoodVariantPickerModal({ result, onSelect, onClose, mealMode = false, onSubmitMeal, submitLabel = '食事として登録' }: Omit<FoodVariantPickerModalProps, 'result'> & { result: FoodSearchResult }) {
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
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品のバリエーションを選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">VARIATIONS</span><h2>{result.group.displayName}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="variant-choice-groups">{groups.map((group) => <section className="variant-choice-group" key={group.key}><h3>{group.label}</h3><div className="variant-choice-buttons">{group.options.map((option) => { const available = group.key === 'variant' || (availableOptionValues.get(group.key)?.has(option.value) ?? false); return <button className={`variant-choice-button${isSelected(group, option.value) ? ' is-selected' : ''}`} type="button" aria-pressed={isSelected(group, option.value)} key={`${group.key}:${option.value ?? 'none'}`} disabled={!available} onClick={() => chooseOption(group, option.value)}><span>{option.label}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{variantOptionText(selectedFood)}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}kcal{matchingVariants.length > 1 ? ` · ${matchingVariants.length}件が該当` : ''}</small></div> : <p className="variant-picker-no-match">必要な属性を選択してください。</p>}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>{submitLabel}</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

interface MenuViewProps { menus: Menu[]; generalMenus: GeneralMenu[]; menuSets: MenuSet[]; foods: Food[]; onNewMenu: () => void; onShowMenuNutrition: (menu: Menu) => void; onEditMenu: (menu: Menu) => void; onDeleteMenu: (menu: Menu) => void; onNewGeneralMenu: () => void; onEditGeneralMenu: (menu: GeneralMenu) => void; onDeleteGeneralMenu: (menu: GeneralMenu) => void; onCloneGeneralMenu: (menu: GeneralMenu) => void; onNewMenuSet: () => void; onEditMenuSet: (menuSet: MenuSet) => void; onDeleteMenuSet: (menuSet: MenuSet) => void; onReorderMenuSets: (orderedMenuSetIds: string[]) => Promise<void>; onBack: () => void }
function MenuView({ menus, generalMenus, menuSets, foods, onNewMenu, onShowMenuNutrition, onEditMenu, onDeleteMenu, onNewGeneralMenu, onEditGeneralMenu, onDeleteGeneralMenu, onCloneGeneralMenu, onNewMenuSet, onEditMenuSet, onDeleteMenuSet, onReorderMenuSets }: MenuViewProps) {
  const [activeTab, setActiveTab] = useState<'menus' | 'sets' | 'general'>('menus')
  const [orderedMenuSets, setOrderedMenuSets] = useState(menuSets)
  const orderedMenuSetsRef = useRef(menuSets)
  const menuSetsRef = useRef(menuSets)
  const [draggedMenuSetId, setDraggedMenuSetId] = useState<string | null>(null)
  const draggedMenuSetIdRef = useRef<string | null>(null)
  const dragStartOrderRef = useRef<MenuSet[]>(menuSets)
  const dragOffsetYRef = useRef(0)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragHandleRef = useRef<HTMLButtonElement | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const latestDragYRef = useRef(0)
  const updateDragPositionRef = useRef<(clientY: number) => void>(() => undefined)
  const finishDragRef = useRef<(pointerId: number | null, commit: boolean) => void>(() => undefined)
  const [dragPreview, setDragPreview] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [savingMenuSetOrder, setSavingMenuSetOrder] = useState(false)
  const savingMenuSetOrderRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const updateLocalMenuSetOrder = (next: MenuSet[]) => {
    orderedMenuSetsRef.current = next
    setOrderedMenuSets(next)
  }

  useEffect(() => {
    menuSetsRef.current = menuSets
    if (!draggedMenuSetIdRef.current && !savingMenuSetOrderRef.current) {
      orderedMenuSetsRef.current = menuSets
      setOrderedMenuSets(menuSets)
    }
  }, [menuSets])

  const commitMenuSetOrder = async (next: MenuSet[]) => {
    const nextIds = next.map((menuSet) => menuSet.id)
    const persistedMenuSets = menuSetsRef.current
    if (nextIds.every((id, index) => id === persistedMenuSets[index]?.id)) return
    if (savingMenuSetOrderRef.current) return
    savingMenuSetOrderRef.current = true
    setSavingMenuSetOrder(true)
    try {
      await onReorderMenuSets(nextIds)
    } catch {
      updateLocalMenuSetOrder(persistedMenuSets)
    } finally {
      savingMenuSetOrderRef.current = false
      setSavingMenuSetOrder(false)
    }
  }

  const startMenuSetDrag = (event: React.PointerEvent<HTMLButtonElement>, menuSetId: string) => {
    if (savingMenuSetOrderRef.current || orderedMenuSetsRef.current.length < 2) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-menu-set-id]')
    if (!row) return
    const rect = row.getBoundingClientRect()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Global listeners below keep the drag usable when pointer capture is unavailable.
    }
    dragStartOrderRef.current = orderedMenuSetsRef.current
    dragOffsetYRef.current = event.clientY - rect.top
    dragPointerIdRef.current = event.pointerId
    dragHandleRef.current = event.currentTarget
    latestDragYRef.current = event.clientY
    draggedMenuSetIdRef.current = menuSetId
    setDraggedMenuSetId(menuSetId)
    setDragPreview({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }

  const updateMenuSetDragPosition = (clientY: number) => {
    const sourceId = draggedMenuSetIdRef.current
    if (!sourceId) return
    setDragPreview((current) => current ? { ...current, top: clientY - dragOffsetYRef.current } : current)
    const source = orderedMenuSetsRef.current.find((menuSet) => menuSet.id === sourceId)
    if (!source || !listRef.current) return
    const remaining = orderedMenuSetsRef.current.filter((menuSet) => menuSet.id !== sourceId)
    const rowById = new Map(
      Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-menu-set-id]'))
        .map((row) => [row.dataset.menuSetId, row] as const),
    )
    let destination = remaining.length
    for (let index = 0; index < remaining.length; index += 1) {
      const rect = rowById.get(remaining[index].id)?.getBoundingClientRect()
      if (rect && clientY < rect.top + rect.height / 2) {
        destination = index
        break
      }
    }
    const next = [...remaining]
    next.splice(destination, 0, source)
    if (!next.every((menuSet, index) => menuSet.id === orderedMenuSetsRef.current[index]?.id)) updateLocalMenuSetOrder(next)
  }

  updateDragPositionRef.current = updateMenuSetDragPosition

  const finalizeMenuSetDrag = (pointerId: number | null, commit: boolean) => {
    if (!draggedMenuSetIdRef.current || dragPointerIdRef.current === null || (pointerId !== null && dragPointerIdRef.current !== pointerId)) return
    const activePointerId = dragPointerIdRef.current
    const handle = dragHandleRef.current
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
      if (commit) updateDragPositionRef.current(latestDragYRef.current)
    }
    const finalOrder = orderedMenuSetsRef.current
    dragPointerIdRef.current = null
    draggedMenuSetIdRef.current = null
    dragHandleRef.current = null
    setDraggedMenuSetId(null)
    setDragPreview(null)
    try {
      if (handle?.hasPointerCapture(activePointerId)) handle.releasePointerCapture(activePointerId)
    } catch {
      // The browser may already have released capture after the row moved.
    }
    if (commit) void commitMenuSetOrder(finalOrder)
    else updateLocalMenuSetOrder(dragStartOrderRef.current)
  }

  finishDragRef.current = finalizeMenuSetDrag

  useEffect(() => {
    if (!draggedMenuSetId) return

    const queueMove = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      latestDragYRef.current = event.clientY
      if (dragFrameRef.current !== null) return
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null
        updateDragPositionRef.current(latestDragYRef.current)
      })
    }
    const commit = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      finishDragRef.current(event.pointerId, true)
    }
    const cancel = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      finishDragRef.current(event.pointerId, false)
    }
    const cancelWithoutPointer = () => finishDragRef.current(null, false)
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelWithoutPointer()
    }

    document.addEventListener('pointermove', queueMove, { capture: true, passive: false })
    window.addEventListener('pointerup', commit, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', cancelWithoutPointer)
    window.addEventListener('pagehide', cancelWithoutPointer)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      document.removeEventListener('pointermove', queueMove, true)
      window.removeEventListener('pointerup', commit, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', cancelWithoutPointer)
      window.removeEventListener('pagehide', cancelWithoutPointer)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
    }
  }, [draggedMenuSetId])

  const draggedMenuSet = draggedMenuSetId ? orderedMenuSets.find((menuSet) => menuSet.id === draggedMenuSetId) : null
  const foodName = (id: string) => {
    const food = foods.find((item) => item.id === id)
    return food ? displayFoodName(food) : '削除済み食品'
  }
  const menuName = (id: string) => menus.find((menu) => menu.id === id)?.name ?? '削除済みメニュー'
  const generalMenuName = (id: string) => generalMenus.find((menu) => menu.id === id)?.name ?? '削除済み一般メニュー'
  const formatMenuSetCalories = (energyKcal: number | null) => `${energyKcal === null ? '--.-' : formatNutrient(energyKcal)}kcal`
  const menuSetItems = (menuSet: MenuSet) => {
    const items = [
    ...menuSet.menuIds.map((id) => ({ id: `menu:${id}`, kind: 'Myメニュー', name: menuName(id) })),
    ...(menuSet.generalMenuIds ?? []).map((id) => ({ id: `general-menu:${id}`, kind: '一般メニュー', name: generalMenuName(id) })),
    ...getMenuSetFoodItems(menuSet, foods).map((item) => ({ id: `food:${item.foodId}`, kind: '食品', name: foodName(item.foodId) })),
    ]
    const calories = getMenuSetCalorieSummary({ menuSet, menus, generalMenus, foods })
    return { items: items.map((item, index) => ({ ...item, energyKcal: calories.items[index]?.energyKcal ?? null })), energyKcal: calories.energyKcal }
  }
  const menuList = (items: Array<Menu | GeneralMenu>, kind: 'my' | 'general') => <div className="menu-category-groups">{MENU_CATEGORIES.map((category) => {
    const categoryMenus = items.filter((menu) => menu.category === category)
    return <details className="menu-category-group" key={category}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary>{categoryMenus.length > 0 ? <div className="menu-list">{categoryMenus.map((menu) => {
      const ingredients = getMenuIngredients(menu, foods)
      return <div className="menu-card" key={menu.id}><div><strong>{menu.name}</strong><small>{ingredients.length ? ingredients.map((ingredient) => ingredient.kind === 'food' ? foodName(ingredient.itemId) : menuName(ingredient.itemId)).join('・') : '食材未選択'}</small></div><div className="menu-card-actions">{kind === 'my' && <button type="button" className="small-action" onClick={() => onShowMenuNutrition(menu)}>詳細</button>}{kind === 'general' && <button type="button" className="small-action" onClick={() => onCloneGeneralMenu(menu)}>Myメニューに複製</button>}<button type="button" className="small-action" onClick={() => kind === 'general' ? onEditGeneralMenu(menu) : onEditMenu(menu)}>編集</button><button type="button" className="small-action danger-text" onClick={() => kind === 'general' ? onDeleteGeneralMenu(menu) : onDeleteMenu(menu)}>削除</button></div></div>
    })}</div> : <p className="menu-picker-empty">この区分に登録された{kind === 'general' ? '一般メニュー' : 'Myメニュー'}はありません。</p>}</details>
  })}</div>
  return <>
    <section className="page-heading"><div><span className="eyebrow">MENUS</span><h1>メニュー</h1></div></section>
    <div className="search-category-tabs menu-management-tabs" role="tablist" aria-label="メニュー種別">
      <button className={activeTab === 'menus' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'menus'} onClick={() => setActiveTab('menus')}>Myメニュー</button>
      <button className={activeTab === 'sets' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'sets'} onClick={() => setActiveTab('sets')}>Myセット</button>
      <button className={activeTab === 'general' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'general'} onClick={() => setActiveTab('general')}>一般メニュー</button>
    </div>
    {activeTab === 'menus' ? <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">MY MENUS</span><h2>Myメニュー</h2></div><button className="button primary" type="button" onClick={onNewMenu}>＋ Myメニュー</button></div>
      {menuList(menus, 'my')}
    </section> : activeTab === 'sets' ? <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">MY SETS</span><h2>Myセット</h2></div><button className="button primary" type="button" onClick={onNewMenuSet}>＋ Myセット</button></div>
      {orderedMenuSets.length === 0 ? <div className="empty-state">Myセットはまだありません。</div> : <><p className="helper-text menu-set-order-helper">≡をドラッグして、食事登録画面に表示する順番を変更できます。</p><div ref={listRef} className={`menu-set-list${draggedMenuSetId ? ' is-reordering' : ''}`}>{orderedMenuSets.map((menuSet) => { const setDisplay = menuSetItems(menuSet); const items = setDisplay.items; return <div className="menu-set-order-row" key={menuSet.id}><div className={`menu-set-card-shell${draggedMenuSetId === menuSet.id ? ' is-drag-placeholder' : ''}`} data-menu-set-id={menuSet.id}><button className="meal-order-handle menu-set-order-handle" type="button" aria-label={`${menuSet.name}をドラッグして並び替え`} disabled={savingMenuSetOrder || orderedMenuSets.length < 2} onPointerDown={(event) => startMenuSetDrag(event, menuSet.id)} onPointerUp={(event) => finishDragRef.current(event.pointerId, true)} onPointerCancel={(event) => finishDragRef.current(event.pointerId, false)}>≡</button><details className="menu-set-card"><summary><span><span className="source-badge">セット</span><strong>{menuSet.name}</strong></span><small>{formatMenuSetCalories(setDisplay.energyKcal)}</small></summary><div className="menu-set-card-body">{items.length > 0 ? <ul>{items.map((item) => <li key={item.id}><span>{item.kind}</span><strong>{item.name}</strong><small>{formatMenuSetCalories(item.energyKcal)}</small></li>)}</ul> : <p className="menu-picker-empty">メニュー・食品が選択されていません。</p>}<div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenuSet(menuSet)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenuSet(menuSet)}>削除</button></div></div></details></div></div> })}</div></>}
    </section> : <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">GENERAL MENUS</span><h2>一般メニュー</h2></div><button className="button primary" type="button" onClick={onNewGeneralMenu}>＋ 一般メニュー</button></div>
      {menuList(generalMenus, 'general')}
    </section>}
    {draggedMenuSet && dragPreview && <div className="menu-set-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle">≡</span><div className="menu-set-drag-copy"><span><span className="source-badge">セット</span><strong>{draggedMenuSet.name}</strong></span><small>{formatMenuSetCalories(menuSetItems(draggedMenuSet).energyKcal)}</small></div></div>}
  </>
}

interface MenuFoodSelectionProps {
  selectedIds: string[]
  selectedIngredients?: MenuIngredientDraft[]
  selectedMenuIds?: string[]
  selectedGeneralMenuIds?: string[]
  menus?: Menu[]
  generalMenus?: GeneralMenu[]
  editingMenuId?: string | null
  foods: Food[]
  foodGroups: FoodGroup[]
  recentFoods: Food[]
  favoriteFoods: Food[]
  favoriteIds: Set<string>
  onToggleFavorite: (food: Food) => void
  onAdd: (food: Food) => void
  onAddWithAmount?: (food: Food, amount: string, unit: QuantityUnit) => void
  onRemove: (food: Food) => void
  onAddMenu?: (menu: Menu) => void
  onRemoveMenu?: (menu: Menu) => void
  onAddGeneralMenu?: (menu: GeneralMenu) => void
  onRemoveGeneralMenu?: (menu: GeneralMenu) => void
  onRemoveIngredient?: (ingredient: MenuIngredientDraft) => void
  onChangeIngredientAmount?: (ingredient: MenuIngredientDraft, amount: string) => void
  onChangeIngredientUnit?: (ingredient: MenuIngredientDraft, unit: QuantityUnit) => void
  showSelectedList?: boolean
  pickerTitle?: string
  allowFoodCategoryFilter?: boolean
  foodAttributePreferences?: FoodAttributePreferences
  onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>
}

function MenuFoodChoiceRow({ food, selected, favorite, onAdd, onToggleFavorite }: { food: Food; selected: boolean; favorite: boolean; onAdd: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · {foodListNutritionLabel(food)}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(food)} disabled={selected}>{selected ? '追加済み' : '追加'}</button><button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button></div>
}

function MenuIngredientChoiceRow({ menu, selected, onAdd }: { menu: Menu; selected: boolean; onAdd: (menu: Menu) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{menu.name}</strong><span>Myメニュー · {menu.category}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(menu)} disabled={selected}>{selected ? '追加済み' : '追加'}</button></div>
}

function MenuGeneralChoiceRow({ menu, selected, onAdd }: { menu: GeneralMenu; selected: boolean; onAdd: (menu: GeneralMenu) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{menu.name}</strong><span>一般メニュー · {menu.category}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(menu)} disabled={selected}>{selected ? '追加済み' : '追加'}</button></div>
}

function MenuIngredientRow({ ingredient, foods, menus, onChangeAmount, onChangeUnit, onRemove }: { ingredient: MenuIngredientDraft; foods: Food[]; menus: Menu[]; onChangeAmount: (amount: string) => void; onChangeUnit?: (unit: QuantityUnit) => void; onRemove: () => void }) {
  const food = ingredient.kind === 'food' ? foods.find((item) => item.id === ingredient.itemId) : undefined
  const menu = ingredient.kind === 'menu' ? menus.find((item) => item.id === ingredient.itemId) : undefined
  const name = food ? displayFoodName(food) : menu?.name ?? (ingredient.kind === 'food' ? '削除済み食品' : '削除済みメニュー')
  const availableUnits = food ? getFoodQuantityUnits(food) : ['食']
  const unitOptions = availableUnits.includes(ingredient.unit) ? availableUnits : [...availableUnits, ingredient.unit]
  return <div className="menu-ingredient-row"><div className="menu-ingredient-copy"><span className="source-badge">{ingredient.kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><label className="menu-ingredient-amount"><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={ingredient.amount} onChange={(event) => onChangeAmount(event.target.value)} required />{onChangeUnit ? <select value={ingredient.unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select> : <span>{ingredient.unit}</span>}</label><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

function MenuSetSelectedItemRow({ kind, name, onRemove }: { kind: 'food' | 'menu' | 'general-menu'; name: string; onRemove: () => void }) {
  return <div className="menu-set-selected-row"><div><span className="source-badge">{kind === 'food' ? '食品' : kind === 'general-menu' ? '一般' : 'My'}</span><strong>{name}</strong></div><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

function MenuSetSelectedFoodRow({ food, item, onChangeAmount, onChangeUnit, onRemove }: { food: Food | undefined; item: MenuSetFoodItemDraft; onChangeAmount: (amount: string) => void; onChangeUnit: (unit: QuantityUnit) => void; onRemove: () => void }) {
  const name = food ? displayFoodName(food) : '削除済み食品'
  const availableUnits = food ? getFoodQuantityUnits(food) : [item.unit]
  const unitOptions = availableUnits.includes(item.unit) ? availableUnits : [...availableUnits, item.unit]
  return <div className="menu-set-selected-row menu-set-selected-food-row"><div className="menu-set-selected-food-copy"><div><span className="source-badge">食品</span><strong>{name}</strong></div><label><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={item.amount} onChange={(event) => onChangeAmount(event.target.value)} required /><select value={item.unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select></label></div><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

function MenuFoodSelection({ selectedIds, selectedIngredients, selectedMenuIds = [], selectedGeneralMenuIds = [], menus = [], generalMenus = [], editingMenuId = null, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onAdd, onAddWithAmount, onRemove, onAddMenu, onRemoveMenu, onAddGeneralMenu, onRemoveGeneralMenu, onRemoveIngredient, onChangeIngredientAmount, onChangeIngredientUnit, showSelectedList = true, pickerTitle = '食材を追加', allowFoodCategoryFilter = false, foodAttributePreferences, onSaveFoodAttributePreference }: MenuFoodSelectionProps) {
  const [foodQuery, setFoodQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [foodCategory, setFoodCategory] = useState<'all' | 'commercial'>('all')
  const [userSearchResults, setUserSearchResults] = useState<UserFoodSearchResult[]>([])
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [variantResult, setVariantResult] = useState<FoodVariantPickerState | null>(null)
  const normalizedQuery = normalizeSearchText(foodQuery)
  const selectedFoods = selectedIds.map((id) => foods.find((food) => food.id === id)).filter((food): food is Food => Boolean(food))
  const selectedMenus = selectedMenuIds.map((id) => menus.find((menu) => menu.id === id)).filter((menu): menu is Menu => Boolean(menu))
  const selectedGeneralMenus = selectedGeneralMenuIds.map((id) => generalMenus.find((menu) => menu.id === id)).filter((menu): menu is GeneralMenu => Boolean(menu))
  const selectedCount = selectedIngredients?.length ?? selectedFoods.length + selectedMenuIds.length + selectedGeneralMenuIds.length
  const selectedIngredientKeys = new Set([
    ...(selectedIngredients?.map((ingredient) => `${ingredient.kind}:${ingredient.itemId}`) ?? []),
    ...selectedIds.map((id) => `food:${id}`),
    ...selectedMenuIds.map((id) => `menu:${id}`),
    ...selectedGeneralMenuIds.map((id) => `general-menu:${id}`),
  ])
  const selectableMenus = menus.filter((menu) => menu.id !== editingMenuId && !wouldCreateMenuCycle(editingMenuId, menu.id, menus))
  const matchingMenus = selectableMenus.filter((menu) => [menu.name, menu.category, ...(menu.aliases ?? [])].some((value) => normalizeSearchText(value).includes(normalizedQuery)))
  const matchingGeneralMenus = generalMenus.filter((menu) => [menu.name, menu.category, ...(menu.aliases ?? [])].some((value) => normalizeSearchText(value).includes(normalizedQuery)))
  const candidateFoods = allowFoodCategoryFilter && foodCategory === 'commercial'
    ? foods.filter((food) => foodMatchesSearchCategory(food, 'commercial'))
    : foods
  const quickFoods = [...recentFoods, ...favoriteFoods]
    .filter((food) => !allowFoodCategoryFilter || foodMatchesSearchCategory(food, foodCategory))
    .filter((food, index, all) => all.findIndex((item) => item.id === food.id) === index)
    .slice(0, 8)

  useEffect(() => {
    setSearchedQuery('')
    setUserSearchResults([])
    setSearchResults([])
  }, [foodCategory])

  const startFoodAdd = (food: Food) => {
    if (!onAddWithAmount) {
      onAdd(food)
      return
    }
    const serving = getFoodDefaultServing(food)
    const result = food.foodGroupId ? buildMextFoodSearchResult(food.foodGroupId, foods, foodGroups) : null
    if (result) {
      setVariantResult({ result, initialFoodId: food.id, initialAmount: String(serving.amount), initialAmountUnit: serving.unit })
    } else {
      setAmountPickerFood({ food, amount: String(serving.amount), unit: serving.unit })
    }
  }

  const [amountPickerFood, setAmountPickerFood] = useState<{ food: Food; amount: string; unit: QuantityUnit } | null>(null)

  const runSearch = async () => {
    const query = foodQuery.trim()
    if (!query) { setSearchedQuery(''); setUserSearchResults([]); setSearchResults([]); return }
    setSearching(true)
    try {
      const requestedCategory = allowFoodCategoryFilter ? foodCategory : 'all'
      const allUserResults = requestedCategory === 'all' ? searchUserFoodGroups(query, { expandPartShortcuts: true }) : []
      const coveredFoodGroupIds = new Set(allUserResults.flatMap((result) => result.group.memberFoodGroupIds))
      const { page } = await searchFoodResults(query, { limit: 20, category: requestedCategory })
      setUserSearchResults(allUserResults.slice(0, 20))
      setSearchResults(requestedCategory === 'commercial' ? page.results : page.results.filter((result) => !coveredFoodGroupIds.has(result.group.id)))
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
    else startFoodAdd(result.food)
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
            : <>{selectedMenus.map((menu) => <MenuSetSelectedItemRow key={`menu:${menu.id}`} kind="menu" name={menu.name} onRemove={() => onRemoveMenu?.(menu)} />)}{selectedGeneralMenus.map((menu) => <MenuSetSelectedItemRow key={`general-menu:${menu.id}`} kind="general-menu" name={menu.name} onRemove={() => onRemoveGeneralMenu?.(menu)} />)}{selectedFoods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onRemove={onRemove} />)}</>}</div>
          : <p className="menu-food-empty">まだ食材がありません。下の「食材を追加」から選択してください。</p>}</>}
      <details className="food-collapsible menu-food-picker">
        <summary className="section-title collapsible-summary"><div><span className="eyebrow">ADD ITEMS</span><h3>{pickerTitle}</h3></div></summary>
        <div className="menu-food-picker-body">
          {allowFoodCategoryFilter && <div className="search-category-tabs menu-food-category-tabs" role="tablist" aria-label="追加する食品の分類"><button className={foodCategory === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={foodCategory === 'all'} onClick={() => setFoodCategory('all')}>すべて</button><button className={foodCategory === 'commercial' ? 'active' : ''} type="button" role="tab" aria-selected={foodCategory === 'commercial'} onClick={() => setFoodCategory('commercial')}>外食・市販</button></div>}
          <div className="menu-food-search-row">
            <label className="menu-food-search">食材を検索
              <input value={foodQuery} onChange={(event) => { setFoodQuery(event.target.value); setSearchedQuery('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder={onAddMenu ? '食品名・メーカー・メニュー名' : '食品名・メーカー'} />
            </label>
            <button className="button secondary menu-food-search-button" type="button" onClick={() => void runSearch()} disabled={searching}>{searching ? '検索中…' : '検索する'}</button>
          </div>
          {showSearchResults ? (
            <>
              <div className="menu-food-section-heading"><span className="eyebrow">SEARCH RESULTS</span><h4>検索結果：{foodQuery.trim()}</h4></div>
              <div className="menu-food-search-results">
                {userSearchResults.length > 0 || searchResults.length > 0 || (onAddMenu && matchingMenus.length > 0) || (onAddGeneralMenu && matchingGeneralMenus.length > 0)
                  ? <>{onAddMenu && matchingMenus.map((menu) => <button className="menu-food-search-result" type="button" key={`menu:${menu.id}`} disabled={selectedIngredientKeys.has(`menu:${menu.id}`)} onClick={() => onAddMenu(menu)}><span className="source-badge">My</span><span><strong>{menu.name}</strong><small>{menu.category} · 1食単位</small></span><b>{selectedIngredientKeys.has(`menu:${menu.id}`) ? '追加済み' : '›'}</b></button>)}{onAddGeneralMenu && matchingGeneralMenus.map((menu) => <button className="menu-food-search-result" type="button" key={`general-menu:${menu.id}`} disabled={selectedIngredientKeys.has(`general-menu:${menu.id}`)} onClick={() => onAddGeneralMenu(menu)}><span className="source-badge">一般</span><span><strong>{menu.name}</strong><small>{menu.category} · 1食単位</small></span><b>{selectedIngredientKeys.has(`general-menu:${menu.id}`) ? '追加済み' : '›'}</b></button>)}{userSearchResults.map((result) => { const label = selectedUserFoodLabel(result); return <button className="menu-food-search-result" type="button" key={`user:${result.group.id}:${result.foodGroupId ?? 'group'}`} onClick={() => chooseUserSearchResult(result)}><span className="source-badge">食品</span><span><strong>{label ?? result.group.displayName}</strong><small>{label ? `${result.group.displayName} > ${selectedUserFoodDimensionLabel(result) ?? '種類'}` : `${result.group.category} · ${result.group.memberCount > 1 ? `${result.group.memberCount}種類` : '直接選択'}`}</small></span><b>›</b></button> })}{searchResults.map((result) => { const selected = result.variants.length === 1 && selectedIngredientKeys.has(`food:${result.food.id}`); return <button className="menu-food-search-result" type="button" key={result.group.id} disabled={selected} onClick={() => chooseSearchResult(result)}><span className="source-badge">食品</span><span><strong>{displaySearchFoodName(result.group, result.food)}</strong><small>{result.group.category ?? '食品'} · {result.variants.length > 1 ? `${result.variants.length}バリエーション · ${foodListNutritionLabel(result.food, false)}` : foodListNutritionLabel(result.food)}</small></span><b>{selected ? '追加済み' : '›'}</b></button> })}</>
                  : <p className="menu-food-empty">検索に一致する食品・メニューがありません。</p>}
              </div>
            </>
          ) : (
            <>
              <div className="menu-food-quick">
                <div className="menu-food-section-heading"><span className="eyebrow">QUICK ADD</span><h4>最近・お気に入り</h4></div>
                {quickFoods.length > 0
                  ? <div className="menu-food-list">{quickFoods.map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIngredientKeys.has(`food:${food.id}`)} favorite={favoriteIds.has(food.id)} onAdd={startFoodAdd} onToggleFavorite={onToggleFavorite} />)}</div>
                  : <p className="menu-food-empty">最近使った食品やお気に入りはありません。</p>}
              </div>
              {onAddMenu && <><div className="menu-food-section-heading"><span className="eyebrow">MY MENUS</span><h4>Myメニュー</h4></div>{selectableMenus.length > 0 ? <div className="menu-food-list">{selectableMenus.map((menu) => <MenuIngredientChoiceRow key={menu.id} menu={menu} selected={selectedIngredientKeys.has(`menu:${menu.id}`)} onAdd={onAddMenu} />)}</div> : <p className="menu-food-empty">追加できるMyメニューがありません。</p>}</>}
              {onAddGeneralMenu && <><div className="menu-food-section-heading"><span className="eyebrow">GENERAL MENUS</span><h4>一般メニュー</h4></div>{generalMenus.length > 0 ? <div className="menu-food-list">{generalMenus.map((menu) => <MenuGeneralChoiceRow key={menu.id} menu={menu} selected={selectedIngredientKeys.has(`general-menu:${menu.id}`)} onAdd={onAddGeneralMenu} />)}</div> : <p className="menu-food-empty">追加できる一般メニューがありません。</p>}</>}
              <div className="menu-food-section-heading"><span className="eyebrow">FOODS</span><h4>食品</h4></div>
              <div className="menu-food-list">{candidateFoods.slice(0, 60).map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIngredientKeys.has(`food:${food.id}`)} favorite={favoriteIds.has(food.id)} onAdd={startFoodAdd} onToggleFavorite={onToggleFavorite} />)}</div>
              {candidateFoods.length > 60 && <p className="menu-food-more">食品名を検索すると、続きの食品を表示できます。</p>}
            </>
          )}
        </div>
      </details>
      {variantResult && <FoodVariantPickerModal result={variantResult.result} userFoodResult={variantResult.userFoodResult} foods={foods} foodGroups={foodGroups} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} initialFoodId={variantResult.initialFoodId} initialAmount={variantResult.initialAmount} initialAmountUnit={variantResult.initialAmountUnit} submitLabel={onAddWithAmount ? '追加する' : undefined} mealMode={Boolean(onAddWithAmount)} onSubmitMeal={onAddWithAmount ? (food, amount, unit) => { onAddWithAmount(food, amount, unit); setVariantResult(null) } : undefined} onSelect={(food) => { onAdd(food); setVariantResult(null) }} onClose={() => setVariantResult(null)} />}
      {amountPickerFood && <FoodAmountPickerModal food={amountPickerFood.food} amount={amountPickerFood.amount} unit={amountPickerFood.unit} onChangeAmount={(amount) => setAmountPickerFood((current) => current ? { ...current, amount } : current)} onChangeUnit={(unit) => setAmountPickerFood((current) => current ? { ...current, unit } : current)} onSubmit={onAddWithAmount ? (food, amount, unit) => { onAddWithAmount(food, amount, unit); setAmountPickerFood(null) } : undefined} onClose={() => setAmountPickerFood(null)} />}
    </div>
  )
}

function MenuEditorModal({ draft, setDraft, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose, mode = 'my' }: { draft: MenuDraft; setDraft: React.Dispatch<React.SetStateAction<MenuDraft | null>>; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void; mode?: 'my' | 'general' | 'temporary' }) {
  const menuTypeLabel = mode === 'general' ? '一般メニュー' : mode === 'temporary' ? '一時メニュー' : 'Myメニュー'
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${menuTypeLabel}を設定`}>
      <section className="modal-card menu-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">{mode === 'temporary' ? 'ONE-TIME MENU' : mode === 'general' ? 'GENERAL MENU' : 'MY MENU'}</span><h2>{draft.id ? `${menuTypeLabel}を編集` : `${menuTypeLabel}を設定`}</h2>{mode === 'temporary' && <p className="muted">この食事にだけ保存され、メニュー一覧には追加されません。</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="menu-editor-form" onSubmit={onSubmit}>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">BASIC</span><h3>基本情報</h3></div>
            </div>
            <div className="menu-editor-basic-fields">
              <label className="menu-editor-name-field">メニュー名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label>
              {mode !== 'temporary' && <label>区分<select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as MenuCategory } : current)}>{MENU_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
              {mode !== 'temporary' && <label className="menu-editor-alias-field">検索用エイリアス（任意）<input value={draft.aliases.join('、')} onChange={(event) => setDraft((current) => current ? { ...current, aliases: event.target.value.split(/[、,，]/).map((alias) => alias.trim()).filter(Boolean) } : current)} placeholder="例：おにぎり、朝ごはん" /></label>}
              {mode === 'my' && <label className="menu-editor-memo-field">メモ（任意）<textarea rows={4} value={draft.memo ?? ''} onChange={(event) => setDraft((current) => current ? { ...current, memo: event.target.value } : current)} placeholder="作り方や次回の調整点などを自由に記録できます。" /></label>}
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
            <button className="button primary full-width" type="submit">{mode === 'temporary' ? 'この食事に追加' : '保存する'}</button>
            <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function MenuSetEditorModal({ draft, setDraft, menus, generalMenus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose }: { draft: MenuSetDraft; setDraft: React.Dispatch<React.SetStateAction<MenuSetDraft | null>>; menus: Menu[]; generalMenus: GeneralMenu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => current && !current.foodIds.includes(food.id) ? { ...current, foodIds: [...current.foodIds, food.id] } : current)
  const addFoodWithAmount = (food: Food, amount: string, unit: QuantityUnit) => setDraft((current) => {
    if (!current || current.foodItems.some((item) => item.foodId === food.id)) return current
    const nextItem = { foodId: food.id, amount, unit }
    return { ...current, foodIds: [...current.foodIds, food.id], foodItems: [...current.foodItems, nextItem] }
  })
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== food.id) } : current)
  const addMenu = (menu: Menu) => setDraft((current) => current && !current.menuIds.includes(menu.id) ? { ...current, menuIds: [...current.menuIds, menu.id] } : current)
  const removeMenu = (menuId: string) => setDraft((current) => current ? { ...current, menuIds: current.menuIds.filter((id) => id !== menuId) } : current)
  const addGeneralMenu = (menu: GeneralMenu) => setDraft((current) => current && !current.generalMenuIds.includes(menu.id) ? { ...current, generalMenuIds: [...current.generalMenuIds, menu.id] } : current)
  const removeGeneralMenu = (menuId: string) => setDraft((current) => current ? { ...current, generalMenuIds: current.generalMenuIds.filter((id) => id !== menuId) } : current)
  const removeFoodItem = (foodId: string) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== foodId), foodItems: current.foodItems.filter((item) => item.foodId !== foodId) } : current)
  const changeFoodAmount = (foodId: string, amount: string) => setDraft((current) => current ? { ...current, foodItems: current.foodItems.map((item) => item.foodId === foodId ? { ...item, amount } : item) } : current)
  const changeFoodUnit = (foodId: string, unit: QuantityUnit) => setDraft((current) => current ? { ...current, foodItems: current.foodItems.map((item) => item.foodId === foodId ? { ...item, unit } : item) } : current)
  const selectedCount = draft.foodItems.length + draft.menuIds.length + draft.generalMenuIds.length
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Myセットを設定">
      <section className="modal-card menu-editor-modal menu-set-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">MY SET</span><h2>{draft.id ? 'Myセットを編集' : 'Myセットを設定'}</h2></div>
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
              <div><span className="eyebrow">SELECTED</span><h3>追加済み食品・メニュー</h3></div>
              <span className="menu-editor-count">{selectedCount}件</span>
            </div>
            {selectedCount > 0
              ? <div className="menu-set-selected-list">
                {draft.menuIds.map((menuId) => {
                  const menu = menus.find((item) => item.id === menuId)
                  return <MenuSetSelectedItemRow key={`menu:${menuId}`} kind="menu" name={menu?.name ?? '削除済みMyメニュー'} onRemove={() => removeMenu(menuId)} />
                })}
                {draft.generalMenuIds.map((menuId) => {
                  const menu = generalMenus.find((item) => item.id === menuId)
                  return <MenuSetSelectedItemRow key={`general-menu:${menuId}`} kind="general-menu" name={menu?.name ?? '削除済み一般メニュー'} onRemove={() => removeGeneralMenu(menuId)} />
                })}
                {draft.foodItems.map((item) => <MenuSetSelectedFoodRow key={`food:${item.foodId}`} food={foods.find((food) => food.id === item.foodId)} item={item} onChangeAmount={(amount) => changeFoodAmount(item.foodId, amount)} onChangeUnit={(unit) => changeFoodUnit(item.foodId, unit)} onRemove={() => removeFoodItem(item.foodId)} />)}
              </div>
              : <p className="menu-editor-empty">まだ食品やメニューがありません。下の追加欄から選択してください。</p>}
          </section>
          <section className="menu-editor-section menu-editor-add-section">
            <MenuFoodSelection selectedIds={draft.foodIds} selectedMenuIds={draft.menuIds} selectedGeneralMenuIds={draft.generalMenuIds} menus={menus} generalMenus={generalMenus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onAddWithAmount={addFoodWithAmount} onRemove={removeFood} onAddMenu={addMenu} onAddGeneralMenu={addGeneralMenu} showSelectedList={false} pickerTitle="食品・メニューを追加" allowFoodCategoryFilter />
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
  estimationSettings: EstimationSettings
  goalInputs: Record<NutrientKey, string>
  setGoalInputs: React.Dispatch<React.SetStateAction<Record<NutrientKey, string>>>
  onSaveGoals: (event: React.FormEvent<HTMLFormElement>) => void
  onToggleExternalApi: (enabled: boolean) => void
  onToggleNutrientEstimator: (enabled: boolean) => void
  onChangeDefaultMealTimeMode: (mode: MealTimeMode) => void
  onExportJson: () => void
  onRestoreJson: (event: React.ChangeEvent<HTMLInputElement>) => void
  onExportCsv: () => void
  onImportCsv: (event: React.ChangeEvent<HTMLInputElement>) => void
  onExportUnresolvedIngredients: (format: 'json' | 'csv') => void
  csvFrom: string
  csvTo: string
  setCsvFrom: (value: string) => void
  setCsvTo: (value: string) => void
  counts: { foods: number; meals: number; menus: number; generalMenus: number; menuSets: number }
  bodyProfileInputs: BodyProfileDraft
  setBodyProfileInputs: React.Dispatch<React.SetStateAction<BodyProfileDraft>>
  onSaveBodyProfile: (event: React.FormEvent<HTMLFormElement>) => void
  onOpenNewFood: () => void
  onOpenFoodMaster: () => void
  estimatedGoals: NutritionGoals | null
  bmi: number | null
}

function SettingsView({ settings, estimationSettings, goalInputs, setGoalInputs, onSaveGoals, onToggleExternalApi, onToggleNutrientEstimator, onChangeDefaultMealTimeMode, onExportJson, onRestoreJson, onExportCsv, onImportCsv, onExportUnresolvedIngredients, csvFrom, csvTo, setCsvFrom, setCsvTo, counts, bodyProfileInputs, setBodyProfileInputs, onSaveBodyProfile, onOpenNewFood, onOpenFoodMaster, estimatedGoals, bmi }: SettingsViewProps) {
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
      <div className="section-title"><div><span className="eyebrow">FOOD MASTER</span><h2>食品登録</h2></div></div>
      <div className="food-master-actions"><button className="button primary" type="button" onClick={onOpenNewFood}>＋ 新しい食品を登録</button><button className="button secondary" type="button" onClick={onOpenFoodMaster}>登録済み食品を確認・検索</button></div>
      <div className="settings-info-row settings-inline-row nutrient-estimate-setting">
        <label className="toggle-row"><input type="checkbox" checked={estimationSettings.enabled} onChange={(event) => onToggleNutrientEstimator(event.target.checked)} />欠損した飽和脂肪酸・食物繊維・ビタミン・ミネラルの参考推計を使う</label>
        <InfoPopover className="settings-info" label="参考推計について" text="確認済みの原材料表示と重量を使い、端末内だけで参考候補を計算します。未対応原材料、参照値欠損、栄養添加物の寄与割合不明がある場合は、該当分を加算しない既知原材料分の部分参考値を低信頼度で表示します。部分参考値は商品の保証下限ではありません。初期値は無効で、結果は確認後に手動採用し、既存値を上書きしません。" />
      </div>
      <div className="settings-info-row">
        <div className="settings-action-buttons">
          <button className="button ghost" type="button" onClick={() => onExportUnresolvedIngredients('json')}>未対応原材料 JSON</button>
          <button className="button ghost" type="button" onClick={() => onExportUnresolvedIngredients('csv')}>未対応原材料 CSV</button>
        </div>
        <InfoPopover className="settings-info" label="未対応原材料の出力について" text="推計できなかった原材料名を端末内で件数集計し、手動で出力します。商品名、メーカー、バーコード、食品・食事記録との紐付けは含みません。" />
      </div>
    </section>
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
        <div><strong>{counts.menus}</strong><span>Myメニュー</span></div>
        <div><strong>{counts.generalMenus}</strong><span>一般メニュー</span></div>
        <div><strong>{counts.menuSets}</strong><span>Myセット</span></div>
      </div>
      <p className="helper-text">最終バックアップ: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '未作成'}</p>
      <div className="settings-info-row settings-inline-row">
        <label className="toggle-row"><input type="checkbox" checked={settings.externalApiEnabled} onChange={(event) => onToggleExternalApi(event.target.checked)} />食品が見つからないときにOpen Food Factsを検索する</label>
        <InfoPopover className="settings-info" label="外部APIについて" text="外部APIにはバーコード番号のみを送り、商品情報と原材料を確認用に自動入力します。取得値はパッケージと照合してから保存してください。通信失敗時は手入力へ進みます。" />
      </div>
      <div className="settings-info-row backup-actions">
        <div className="settings-action-buttons">
          <button className="button primary" type="button" onClick={onExportJson}>JSONを出力</button>
          <label className="button secondary file-button">JSONを復元<input type="file" accept="application/json,.json" onChange={onRestoreJson} /></label>
        </div>
        <InfoPopover className="settings-info" label="JSONバックアップについて" text="JSONには食品、食事記録、お気に入り、Myメニュー、一般メニュー、Myセット、設定を含めます。復元前には現在データを自動退避します。" />
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
    <section className="settings-card body-profile-card">
      <div className="section-title"><div><span className="eyebrow">BODY PROFILE</span><h2>身体情報と推定目標</h2></div></div>
      <form onSubmit={onSaveBodyProfile} className="body-profile-form"><div className="two-fields"><label>身長（cm）<input type="number" min="1" max="300" step="0.1" value={bodyProfileInputs.heightCm} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, heightCm: event.target.value }))} placeholder="未設定" /></label><label>体重（kg）<input type="number" min="1" max="500" step="0.1" value={bodyProfileInputs.weightKg} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, weightKg: event.target.value }))} placeholder="未設定" /></label></div><div className="two-fields"><label>年齢（歳）<input type="number" min="1" max="120" step="1" value={bodyProfileInputs.ageYears} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, ageYears: event.target.value }))} placeholder="算出に使用" /></label><label>性別<select value={bodyProfileInputs.sex} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, sex: event.target.value as BiologicalSex }))}><option value="unspecified">未選択</option><option value="male">男性</option><option value="female">女性</option></select></label></div><label>活動量<select value={bodyProfileInputs.activityLevel} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, activityLevel: event.target.value as ActivityLevel }))}><option value="low">低い</option><option value="moderate">普通</option><option value="high">高い</option></select></label><button className="button primary" type="submit">身体情報を保存して目標を算出</button></form>
      <div className="estimated-target"><div><span>BMI</span><strong>{bmi === null ? '未計算' : bmi.toFixed(1)}</strong></div><div><span>推定エネルギー目標</span><strong>{estimatedGoals === null ? '未計算' : `${estimatedGoals.energyKcal ?? '未設定'} kcal`}</strong></div></div>{estimatedGoals && <div className="estimated-goals"><div className="estimated-goals-heading"><strong>栄養素の参考目標</strong><span>P15% / F25% / C60%</span></div><div className="estimated-goal-grid">{NUTRIENT_KEYS.filter((key) => key !== 'energyKcal').map((key) => <div key={key}><span>{NUTRIENT_LABELS[key]}</span><strong>{formatNutrient(estimatedGoals[key])}<small>{NUTRIENT_UNITS[key]}</small></strong></div>)}</div></div>}<div className="estimate-info-row"><span>参考目標の算出について</span><InfoPopover label="参考目標の算出について" text="算出値は一般的な推定式・栄養配分による参考値です。食塩は性別ごとの一般的な上限目安を表示しています。診断・治療・個別の栄養指導を目的とせず、体調や医療上の指示がある場合は専門家に相談してください。" /></div>
    </section>
    <section className="privacy-note"><strong>医療目的ではありません</strong><p>このアプリは日々の記録を支援するもので、診断・治療・個別の栄養指導を行いません。</p><span>Nutrition PWA v0.1.0 · 端末内のみで動作</span></section>
  </>
}

function MealTypePickerModal({ food, recordedMealTypes, onSelect }: { food: Food | null; recordedMealTypes: MealType[]; onSelect: (type: MealType) => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を追加"><section className="modal-card meal-type-picker">{food && <p className="helper-text">「{food.displayName ?? food.name}」を記録する区分を選択してください。</p>}<div className="meal-type-options">{MEAL_TYPES.map((type) => { const recorded = recordedMealTypes.includes(type); return <button key={type} className={`meal-type-option${recorded ? ' is-recorded' : ''}`} type="button" onClick={() => onSelect(type)} aria-label={`${type}${recorded ? '（記録済み）' : ''}`}><img src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{recorded && <span className="meal-type-check" aria-hidden="true">✓</span>}</button> })}</div></section></div>
}

function MealSnapshotIngredientRow({ ingredient, onChange, onRemove }: { ingredient: MealIngredientSnapshot; onChange: (ingredient: MealIngredientSnapshot) => void; onRemove: () => void }) {
  const name = ingredient.kind === 'food' ? getFoodSnapshotDisplayName(ingredient.foodSnapshot) : ingredient.name
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
  const [selectedIngredientsOpen, setSelectedIngredientsOpen] = useState(() => editing)
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
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を記録">
    <section className={`modal-card${menuSnapshot ? ' meal-menu-modal' : ''}`}>
      <div className="modal-heading"><div><span className="eyebrow">ADD MEAL</span><h2>{editing ? '食事を編集' : '食事を記録'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>
      <div className="selected-food"><strong>{menuSnapshot?.sourceMenuName ?? food.displayName ?? food.name}</strong><span>{menuSnapshot ? (menuSnapshot.sourceKind === 'temporary' ? '一時メニュー' : menuSnapshot.sourceKind === 'general-menu' ? '一般メニュー' : 'Myメニュー') : (food.maker || '一般食品')} · 基準量 {food.baseAmount}{food.baseUnit}{food.inputUnitConversions?.length ? ` · 入力用単位 ${food.inputUnitConversions.map((conversion) => `1${conversion.unit}=${conversion.baseAmount}${food.baseUnit}`).join('、')}` : ''}</span></div>
      <form onSubmit={onSubmit}>
        {menuSnapshot?.sourceKind === 'temporary' && <label>一時メニュー名<input value={menuSnapshot.sourceMenuName} onChange={(event) => setMenuSnapshot({ ...menuSnapshot, sourceMenuName: event.target.value })} required /></label>}
        <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力用単位">{getFoodQuantityUnits(food).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={incrementAmount} disabled={!canIncrement} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>
        {menuSnapshot && <section className="meal-menu-snapshot-editor">
          <details className="meal-menu-selected-details" open={selectedIngredientsOpen} onToggle={(event) => setSelectedIngredientsOpen(event.currentTarget.open)}>
            <summary><div><span className="eyebrow">SELECTED</span><h3>追加済み食材</h3><p>表示中の分量は1食分です。ここでの変更はこの食事だけに保存され、メニュー原本には反映されません。</p></div><span className="menu-editor-count">{menuSnapshot.ingredients.length}件</span><i aria-hidden="true" /></summary>
            <div className="meal-snapshot-ingredients menu-editor-selected-list">{menuSnapshot.ingredients.length > 0 ? menuSnapshot.ingredients.map((ingredient, index) => <MealSnapshotIngredientRow key={`${ingredient.kind}:${ingredient.itemId}:${index}`} ingredient={ingredient} onChange={(next) => changeIngredient(index, next)} onRemove={() => removeIngredient(index)} />) : <p className="menu-editor-empty">構成食材がありません。下から追加できます。</p>}</div>
          </details>
          <div className="menu-editor-add-section"><MenuFoodSelection selectedIds={selectedFoodIds} selectedIngredients={selectedIngredients} menus={menus} editingMenuId={menuSnapshot.sourceMenuId} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={() => undefined} onAddMenu={addMenu} showSelectedList={false} pickerTitle="食材を追加" /></div>
        </section>}
        <div className="preview-box calorie-preview"><div className="section-kicker">今回のカロリー</div><strong>{formatNutrient(preview.energyKcal)}<small> kcal</small></strong></div>
        <button className="button primary full-width" type="submit">{editing ? '変更を保存' : '食事として登録'}</button>
        <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
      </form>
    </section>
  </div>
}

function MealDetailsModal({ details, goals, onUpdateTimes, onClose }: { details: { type: MealType; entries: MealEntry[]; subtotal: Nutrients }; goals: NutritionGoals; onUpdateTimes: (entryIds: string[], time: string) => void; onClose: () => void }) {
  const [sharedTime, setSharedTime] = useState(details.entries[0] ? toTokyoTimeInput(details.entries[0].eatenAt) : '')
  const [snackTimes, setSnackTimes] = useState<Record<string, string>>(() => Object.fromEntries(details.entries.map((entry) => [entry.id, toTokyoTimeInput(entry.eatenAt)])))
  const sharedEntryIds = details.entries.map((entry) => entry.id)
  const availableNutrients = sumAvailableNutrients(details.entries)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${details.type}の栄養詳細`}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">NUTRIENTS</span><h2>{details.type}の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(details.subtotal.energyKcal)}<small> kcal</small></strong></div><NutrientGoalGraphs nutrients={details.subtotal} availableNutrients={availableNutrients} goals={goals} /><section className="meal-time-editor"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h3>食事時刻</h3></div></div>{details.type !== '間食' ? <form className="inline-time-form" onSubmit={(event) => { event.preventDefault(); onUpdateTimes(sharedEntryIds, sharedTime) }}><label><input aria-label="食事時刻" type="time" value={sharedTime} onChange={(event) => setSharedTime(event.target.value)} required /></label><button className="button secondary" type="submit">時刻を保存</button></form> : <div className="snack-time-list">{details.entries.map((entry) => <div className="snack-time-row" key={entry.id}><span>{getMealEntryDisplayName(entry)}</span><input type="time" value={snackTimes[entry.id] ?? ''} onChange={(event) => setSnackTimes((current) => ({ ...current, [entry.id]: event.target.value }))} /><button className="small-action" type="button" onClick={() => onUpdateTimes([entry.id], snackTimes[entry.id] ?? '')}>保存</button></div>)}</div>}</section><div className="detail-entry-list">{details.entries.map((entry) => <div className="detail-entry" key={entry.id}><span>{getMealEntryDisplayName(entry)} · {entry.amount}{entry.amountUnit}</span><strong>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</strong></div>)}</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}

function FoodFormView({ draft, returnView, allowCommercialClassification, estimationEnabled, setDraft, foodGroups, foodAliases, foodRelatedTerms, externalNote, onRevertEstimate, onSubmit, onClose }: { draft: FoodDraft; returnView: FoodFormReturnView; allowCommercialClassification: boolean; estimationEnabled: boolean; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; foodGroups: FoodGroup[]; foodAliases: FoodAlias[]; foodRelatedTerms: FoodRelatedTerm[]; externalNote: string | null; onRevertEstimate: (foodId: string, nutrientKey: NutrientKey) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'basic' | 'nutrition' | 'search'>('basic')
  const withoutPendingEstimation = (current: FoodDraft): FoodDraft => {
    const nutrients = { ...current.nutrients }
    for (const [key, value] of Object.entries(current.pendingEstimation?.adoption?.values ?? {}) as Array<[NutrientKey, number]>) {
      if (nutrients[key] === formatEstimateInput(value)) nutrients[key] = ''
    }
    return { ...current, nutrients, pendingEstimation: null }
  }
  const update = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => {
    if (!current) return current
    return { ...withoutPendingEstimation(current), [key]: value }
  })
  const updateBaseUnit = (baseUnit: FoodUnit) => setDraft((current) => {
    if (!current) return current
    const normalizedInputUnit = current.inputUnit.trim()
    const inputUnit = normalizedInputUnit === current.baseUnit || normalizedInputUnit === baseUnit ? '' : current.inputUnit
    const allowed = [baseUnit, ...(inputUnit.trim() && inputUnit.trim() !== baseUnit ? [inputUnit.trim()] : [])]
    return { ...withoutPendingEstimation(current), baseUnit, inputUnit, inputUnitBaseAmount: inputUnit ? current.inputUnitBaseAmount : '', servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : baseUnit }
  })
  const updateInputUnit = (inputUnit: string) => setDraft((current) => {
    if (!current) return current
    const normalized = inputUnit.trim()
    const allowed = [current.baseUnit, ...(normalized && normalized !== current.baseUnit ? [normalized] : [])]
    return { ...withoutPendingEstimation(current), inputUnit, inputUnitBaseAmount: normalized && normalized !== current.baseUnit ? current.inputUnitBaseAmount : '', servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : current.baseUnit }
  })
  const inputUnit = draft.inputUnit.trim()
  const servingUnitOptions = [...new Set([draft.baseUnit, ...(inputUnit && inputUnit !== draft.baseUnit ? [inputUnit] : [])])]
  const updateProductName = (value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const genre = refreshEstimatorGenre(
      { id: cleared.estimatorGenreId, source: cleared.estimatorGenreSource },
      { productName: value, ingredientsText: cleared.ingredientsText },
    )
    return {
      ...cleared,
      name: value,
      groupDisplayName: shouldFollowFoodName(current.groupDisplayName, current.name) ? value : current.groupDisplayName,
      estimatorGenreId: genre.id,
      estimatorGenreSource: genre.source,
    }
  })
  const updateIngredientsText = (value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const genre = refreshEstimatorGenre(
      { id: cleared.estimatorGenreId, source: cleared.estimatorGenreSource },
      { productName: cleared.name, ingredientsText: value },
    )
    return { ...cleared, ingredientsText: value, estimatorGenreId: genre.id, estimatorGenreSource: genre.source }
  })
  const selectEstimatorGenre = (value: EstimatorGenreId) => setDraft((current) => current
    ? { ...withoutPendingEstimation(current), estimatorGenreId: value, estimatorGenreSource: 'user' }
    : current)
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
  const referenceMassG = draft.baseUnit === 'g'
    ? (isPositiveFinite(Number(draft.baseAmount)) ? Number(draft.baseAmount) : null)
    : (draft.estimationReferenceMassG.trim() && isPositiveFinite(Number(draft.estimationReferenceMassG)) ? Number(draft.estimationReferenceMassG) : null)
  const referenceMassSource = draft.baseUnit === 'g' ? '基準単位がg' : (draft.estimationReferenceMassSource.trim() || null)
  const ingredientsSource = draft.ingredientsSourceProvider.trim()
    ? { provider: draft.ingredientsSourceProvider.trim(), verified: true as const }
    : null
  const currentEstimateNutrients = Object.fromEntries(ESTIMATABLE_NUTRIENT_KEYS.map((key) => [
    key,
    draft.nutrients[key].trim() === '' ? null : Number(draft.nutrients[key]),
  ])) as Pick<Nutrients, (typeof ESTIMATABLE_NUTRIENT_KEYS)[number]>
  const knownEstimateFitNutrients = Object.fromEntries(ESTIMATE_FIT_NUTRIENT_KEYS.map((key) => [
    key,
    draft.nutrients[key].trim() === '' ? null : Number(draft.nutrients[key]),
  ])) as Pick<Nutrients, (typeof ESTIMATE_FIT_NUTRIENT_KEYS)[number]>
  const hasEstimatableMissingValue = ESTIMATABLE_NUTRIENT_KEYS.some((key) => currentEstimateNutrients[key] === null)
  const queueEvaluation = (evaluation: NutrientEstimateEvaluation) => {
    if (evaluation.result.unresolvedIngredients.length > 0) {
      void recordUnresolvedIngredients(evaluation.result.unresolvedIngredients, draft.estimatorGenreId).catch(() => undefined)
    }
    setDraft((current) => {
      if (!current) return current
      return {
        ...withoutPendingEstimation(current),
        estimatorGenreSource: 'user',
        pendingEstimation: { evaluation, adoption: null, rejectedKeys: [] },
      }
    })
  }
  const queueAdoption = (adoption: NutrientEstimateAdoption) => setDraft((current) => {
    if (!current) return current
    const nutrients = { ...current.nutrients }
    for (const [key, value] of Object.entries(adoption.values) as Array<[NutrientKey, number]>) nutrients[key] = formatEstimateInput(value)
    return {
      ...current,
      nutrients,
      pendingEstimation: { evaluation: { request: adoption.request, result: adoption.result }, adoption, rejectedKeys: [] },
    }
  })
  const queueRejection = (evaluation: NutrientEstimateEvaluation, nutrientKeys: NutrientKey[]) => setDraft((current) => {
    if (!current) return current
    return { ...withoutPendingEstimation(current), pendingEstimation: { evaluation, adoption: null, rejectedKeys: nutrientKeys } }
  })
  const updateNutrientValue = (key: NutrientKey, value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const nutrientMetadata = { ...cleared.nutrientMetadata }
    if (nutrientMetadata[key]?.origin === 'estimated') delete nutrientMetadata[key]
    return { ...cleared, nutrients: { ...cleared.nutrients, [key]: value }, nutrientMetadata }
  })
  return <>
    <section className="page-heading food-form-heading"><div><span className="eyebrow">FOOD MASTER</span><h1>{draft.id ? '食品を編集' : '新しい食品を登録'}</h1></div><button className="button ghost" type="button" onClick={onClose}>{returnView === 'settings' ? '← 設定へ' : returnView === 'search-results' ? '← 検索結果へ' : '← 食品画面へ'}</button></section>
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
          {allowCommercialClassification && <div className="food-commercial-setting"><label className="toggle-row"><input type="checkbox" checked={draft.isCommercial} onChange={(event) => update('isCommercial', event.target.checked)} />外食・市販として分類する</label></div>}
          <div className="two-fields"><label>基準量*<input type="number" min="0.01" step="any" value={draft.baseAmount} onChange={(event) => update('baseAmount', event.target.value)} required /></label><label>基準単位*<select value={draft.baseUnit} onChange={(event) => updateBaseUnit(event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
          <div className="two-fields"><label>入力用単位（任意）<input list="food-input-unit-options" value={draft.inputUnit} onChange={(event) => updateInputUnit(event.target.value)} placeholder="例：個、杯、パック、切れ" /><datalist id="food-input-unit-options">{FOOD_UNITS.map((unit) => <option key={unit} value={unit} />)}</datalist></label>{inputUnit && inputUnit !== draft.baseUnit && <label>1入力単位あたりの基準量<input type="number" min="0.01" max="100000" step="any" value={draft.inputUnitBaseAmount} onChange={(event) => update('inputUnitBaseAmount', event.target.value)} placeholder={`例：60（${draft.baseUnit}）`} /><span className="field-hint">{draft.baseUnit}で入力</span></label>}</div>
          <div className="two-fields"><label>既定の入力分量<input type="number" min="0.01" step="any" value={draft.servingAmount} onChange={(event) => update('servingAmount', event.target.value)} placeholder="任意" /></label><label>既定の入力単位<select value={draft.servingUnit} onChange={(event) => update('servingUnit', event.target.value)}>{servingUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label></div>
          <div className="food-form-subsection ingredient-source-editor">
            <h3>原材料と推計用の確認情報</h3>
            <p className="helper-text">パッケージ等で確認した内容だけを保存します。Open Food Factsからの自動入力はパッケージと照合し、単位から重量を推測しません。</p>
            <label>原材料表示<textarea rows={4} value={draft.ingredientsText} onChange={(event) => updateIngredientsText(event.target.value)} placeholder="例：小麦粉、砂糖、バター、ココアパウダー" /></label>
            <label>原材料の取得元<select value={draft.ingredientsSourceProvider} onChange={(event) => update('ingredientsSourceProvider', event.target.value)}>
              <option value="">未選択</option>
              <option value="パッケージ表示">パッケージ表示（確認済み）</option>
              <option value="端末内に保存済み">端末内に保存済み（確認済み）</option>
              <option value="Open Food Facts">Open Food Facts（保存前に要確認）</option>
              <option value="その他">その他（確認済み）</option>
            </select></label>
            <label>食品ジャンル
              <select value={draft.estimatorGenreId} onChange={(event) => selectEstimatorGenre(event.target.value as EstimatorGenreId)}>
                {ESTIMATOR_GENRE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <span className="field-hint">{draft.estimatorGenreSource === 'user' ? '確認済み' : `自動候補: ${ESTIMATOR_GENRE_LABELS[draft.estimatorGenreId]}`}</span>
            </label>
            {draft.baseUnit !== 'g' && <div className="two-fields">
                <label>基準量に対応する確認済み重量（g）<input type="number" min="0.01" step="any" value={draft.estimationReferenceMassG} onChange={(event) => update('estimationReferenceMassG', event.target.value)} placeholder="例：80" /></label>
                <label>重量の根拠<input value={draft.estimationReferenceMassSource} onChange={(event) => update('estimationReferenceMassSource', event.target.value)} placeholder="例：パッケージ内容量" /></label>
              </div>}
          </div>
          <p className="source-line">出典: {draft.sourceVersion}（保存前に内容を確認してください）</p>
        </div>}

        {activeTab === 'nutrition' && <div className="food-form-tab-panel" role="tabpanel">
          <div className="section-title"><div><span className="eyebrow">NUTRIENTS</span><h2>基準量あたりの栄養値</h2></div></div>
          <div className="nutrient-input-grid">{NUTRIENT_KEYS.map((key) => {
            const metadata = draft.nutrientMetadata[key]
            return <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={draft.nutrients[key]} onChange={(event) => updateNutrientValue(key, event.target.value)} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div>
              {metadata?.origin === 'estimated' && <span className="estimated-origin-row"><small>{metadata.method === GENRE_PRIOR_PARTIAL_METHOD ? 'ジャンル補完参考推計' : metadata.method === PARTIAL_METHOD ? '部分参考推計' : '参考推計'} · 信頼度 {metadata.confidence ?? '不明'}</small>{draft.id && <button type="button" className="small-action" onClick={() => onRevertEstimate(draft.id!, key)}>採用を取り消す</button>}</span>}
            </label>
          })}</div>
          {estimationEnabled && hasEstimatableMissingValue && <NutrientEstimatePanel
            basis={{ baseAmount: Number(draft.baseAmount), baseUnit: draft.baseUnit }}
            productName={draft.name.trim() || null}
            estimatorGenreId={draft.estimatorGenreId}
            ingredientsText={draft.ingredientsText.trim() || null}
            ingredientsSource={ingredientsSource}
            referenceMassG={referenceMassG}
            referenceMassSource={referenceMassSource}
            currentNutrients={currentEstimateNutrients}
            knownNutrients={knownEstimateFitNutrients}
            onEvaluated={queueEvaluation}
            onAdopt={queueAdoption}
            onRejectAll={queueRejection}
            disabled={!isPositiveFinite(Number(draft.baseAmount))}
          />}
          {draft.pendingEstimation?.adoption && <p className="nutrient-estimate-queued" role="status">推計候補を入力欄へ反映済みです。画面下の「保存する」で採用と履歴保存を確定します。</p>}
        </div>}

        {activeTab === 'search' && <div className="food-form-tab-panel" role="tabpanel">
          <div className="section-title"><div><span className="eyebrow">SEARCH</span><h2>検索表示とバリエーション</h2></div></div>
          <label>所属するfamily<select value={draft.foodGroupId} onChange={(event) => selectFamily(event.target.value)}><option value="">新しいfamilyを作成</option>{foodGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName}{group.needsReview ? '（要確認）' : ''}</option>)}</select></label>
          <label>表示名<input value={draft.groupDisplayName} onChange={(event) => update('groupDisplayName', event.target.value)} placeholder="未入力時は食品名を使用" /></label>
          <div className="two-fields"><label>読み仮名<input value={draft.groupReading} onChange={(event) => update('groupReading', event.target.value)} placeholder="ひらがな" /></label><label>食品区分<input value={draft.groupCategory} onChange={(event) => update('groupCategory', event.target.value)} placeholder="例：主菜" /></label></div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>別名</strong><button className="small-action" type="button" onClick={addAlias}>＋追加</button></div>{draft.aliases.map((alias, index) => <div className="metadata-input-row" key={`alias-${index}`}><input value={alias.value} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="例：とりむね" /><select value={alias.type} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FoodAliasType } : item))}><option value="synonym">通称</option><option value="reading">読み</option><option value="abbreviation">略称</option></select><button className="small-action danger-text" type="button" onClick={() => update('aliases', draft.aliases.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>関連語</strong><button className="small-action" type="button" onClick={addRelatedTerm}>＋追加</button></div>{draft.relatedTerms.map((term, index) => <div className="metadata-input-row" key={`related-term-${index}`}><input value={term} onChange={(event) => update('relatedTerms', draft.relatedTerms.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="同じ食品ではないが関連する語" /><button className="small-action danger-text" type="button" onClick={() => update('relatedTerms', draft.relatedTerms.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="food-form-subsection"><h3>バリエーション属性</h3><div className="two-fields variant-attribute-inputs">{variantAttributeKeys.map((key) => <label key={key}>{variantAttributeLabels[key]}<input value={draft.variantAttributes[key]} onChange={(event) => update('variantAttributes', { ...draft.variantAttributes, [key]: event.target.value })} placeholder="任意" /></label>)}</div></div>
        </div>}

        <div className="food-form-actions"><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></div>
      </form>
    </section>
  </>
}

export default App
