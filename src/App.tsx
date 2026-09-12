import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { FoodFormView } from './components/FoodFormView'
import { displayFoodName, displaySearchFoodName, foodListNutritionLabel, generalMenuToFood, menuIngredientNames, menuSetPreviewFood, snapshotToFood, temporaryMenuToFood } from './components/foodPresentation'
import {
  buildMextFoodSearchResult,
  getSearchResultUserFacingName,
  selectedUserFoodDimensionLabel,
  selectedUserFoodLabel,
  type SearchPurpose,
  type SearchResultGroup,
  type SearchResultItem,
} from './components/foodSearchModels'
import { FoodsView } from './components/FoodsView'
import { FoodVariantPickerModal } from './components/FoodVariantPicker'
import {
  bodyProfileToDraft,
  emptyFoodDraft,
  emptyNutrientInputs,
  foodToDraft,
  formatEstimateInput,
  nutrientKeys,
  previewToDraft,
  variantAttributeKeys,
  type BodyProfileDraft,
  type FoodDraft,
  type FoodFormReturnView,
  type MenuDraft,
  type MenuSetDraft,
} from './components/formDrafts'
import { GraphsView } from './components/GraphsView'
import { MealDetailsModal, MealModal, MealTypePickerModal } from './components/MealModals'
import { SETTINGS_ICON_ASSET, type TrendRangeId } from './components/mealPresentation'
import { MenuEditorModal, MenuSetEditorModal } from './components/MenuEditors'
import { MenuNutritionDetailsModal, MenuView } from './components/MenuView'
import { SearchInputView, SearchResultsView } from './components/SearchViews'
import { SettingsView } from './components/SettingsView'
import { MealConfirmationView, TodayDetailsModal, TodayView } from './components/TodayView'
import {
  createNewFoodGroupId,
  createNewFoodId,
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
  getAllFoodAliases,
  getAllFoodGroups,
  getAllFoodRelatedTerms,
  getAllFoods,
  getAllGeneralMenus,
  getAllMenus,
  getAllMenuSets,
  getEntriesBetween,
  getEntriesForDate,
  getFavoriteFoods,
  getFavoriteIds,
  getFoodByBarcode,
  getRecentFoods,
  getSettings,
  initializeDatabase,
  markSearchLogUnselected,
  recordFoodSelection,
  reorderFavorites,
  reorderMealEntries,
  reorderMenuSets,
  replaceAllData,
  saveBodyProfileSettings,
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
import { backupToJson, downloadBlob, parseBackupText } from './services/backup'
import { barcodeMissAction, type BarcodePurpose } from './services/barcodeFlow'
import { mealsToCsv, parseMealsCsv } from './services/csv'
import { externalFoodErrorMessage, searchExternalFood } from './services/externalFoodApi'
import { setFoodAttributePreference } from './services/foodAttributePreferences'
import {
  foodSearchCategoryIncludesFoods,
  foodSearchCategoryIncludesMenus,
  type FoodSearchCategory,
} from './services/foodClassification'
import { resolveBarcodeCommercialFlag, resolveFoodGroupDisplayName } from './services/foodDraft'
import { normalizeSearchText, type FoodSearchResult } from './services/foodSearch'
import { getMealEntryDisplayName, getMextUserFacingFoodName } from './services/mealEntryDisplay'
import { normalizeMealEntryOrder, sortMealEntries, sortMealEntryGroup } from './services/mealEntryOrder'
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
import { resolveMealRegistrationTransition } from './services/mealRegistrationFlow'
import { resolveMealEntryTime } from './services/mealTime'
import { getMenuIngredients, menuToFood, wouldCreateMenuCycle } from './services/menuIngredients'
import { createMenuSetMealBatch, getMenuSetFoodItems } from './services/menuSetMeals'
import {
  getFoodVariantBySourceId,
  hasFoodGroup as hasMextFoodGroup,
} from './services/mextFoodData'
import {
  getUserFoodGroup,
  getUserFoodGroupForFoodGroup,
  MissingRequiredUserSelection,
  resolveFoodGroupId,
  searchUserFoodGroups,
  type UserFoodSearchResult,
} from './services/mextUserFoodData'
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
import { ESTIMATE_FIT_NUTRIENT_KEYS, toStoredNutrientEstimateResult } from './services/nutrientEstimator'
import { calculateBmi, calculateNutrients, estimateDailyGoals, getFoodDefaultServing, getFoodQuantityUnits, mealDetailNutritionGoals, scaleNutritionGoals, sumByMealType, sumEntries } from './services/nutrition'
import { consumeSearchSelectionGroup } from './services/searchSelection'
import {
  unresolvedIngredientsToCsv,
  unresolvedIngredientsToJson,
} from './services/unresolvedIngredients'
import './styles.css'
import {
  DEFAULT_BODY_PROFILE,
  EMPTY_NUTRIENTS,
  MEAL_TYPES,
  NUTRIENT_LABELS,
  type BodyProfile,
  type EstimationSettings,
  type Food,
  type FoodAlias,
  type FoodAliasType,
  type FoodAttributePreference,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodVariantAttributes,
  type GeneralMenu,
  type MealEntry,
  type MealIngredientSnapshot,
  type MealMenuSnapshot,
  type MealTimeMode,
  type MealType,
  type Menu,
  type MenuIngredient,
  type MenuSet,
  type MenuSetFoodItem,
  type NutrientKey,
  type NutrientMetadataMap,
  type Nutrients,
  type QuantityUnit,
} from './types'
import { addDays, currentDateKey, currentMonthRange, formatFileTimestamp, isoFromTokyoTimeInput } from './utils/date'
import { isPositiveFinite, isValidBarcode, isValidQuantityUnit, isValidUnit } from './utils/validation'

const BarcodeScanner = lazy(() => import('./components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })))

type View = 'today' | 'meal-confirmation' | 'graphs' | 'food-screen' | 'food-form' | 'settings' | 'menus' | 'search-input' | 'search-results'
type FoodFormOrigin = 'settings' | 'meal' | 'barcode'
type FoodScreenReturnView = 'today' | 'meal-confirmation' | 'settings'

interface VariantPickerState {
  query: string
  item: SearchResultItem
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
}

interface MealVariantEditState {
  entry: MealEntry
  result: FoodSearchResult
  userFoodResult?: UserFoodSearchResult
}

function isoForDate(dateKey: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '12'
  return new Date(`${dateKey}T${get('hour')}:${get('minute')}:00+09:00`).toISOString()
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
  const [recentFoodsByMealType, setRecentFoodsByMealType] = useState<Record<MealType, Food[]>>({
    朝食: [], 昼食: [], 夕食: [], 間食: [],
  })
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
  const [barcodePurpose, setBarcodePurpose] = useState<BarcodePurpose | null>(null)
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
  const foodFormSavedFoodRef = useRef<Food | null>(null)

  const notify = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3500)
  }, [])

  const load = useCallback(async (): Promise<boolean> => {
    const requestId = ++loadRequestIdRef.current
    const requestedDate = selectedDateRef.current
    setLoadedDate(null)
    try {
      const [dateEntries, resultFoods, resultGroups, resultAliases, resultRelatedTerms, recent, recentByMealType, favorites, ids, currentSettings, currentEstimationSettings, foodCount, mealCount, menuCount, generalMenuCount, menuSetCount, foodKeys, resultMenus, resultGeneralMenus, resultMenuSets] = await Promise.all([
        getEntriesForDate(requestedDate), getAllFoods(), getAllFoodGroups(), getAllFoodAliases(), getAllFoodRelatedTerms(), getRecentFoods(), Promise.all(MEAL_TYPES.map(async (type) => [type, await getRecentFoods(20, type)] as const)), getFavoriteFoods(), getFavoriteIds(),
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
      setRecentFoodsByMealType(Object.fromEntries(recentByMealType) as Record<MealType, Food[]>)
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

  const openBarcodeScanner = (purpose: BarcodePurpose) => {
    setBarcodePurpose(purpose)
    setShowScanner(true)
  }

  const closeBarcodeScanner = () => {
    setShowScanner(false)
    setBarcodePurpose(null)
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
    foodFormSavedFoodRef.current = null
    setView('food-form')
    setError(null)
  }, [foodAliases, foodGroups, foodRelatedTerms])

  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    const normalized = barcode.trim()
    const purpose = barcodePurpose ?? (recordingMealType ? 'meal' : 'lookup')
    setShowScanner(false)
    setBarcodePurpose(null)
    try {
      const local = await getFoodByBarcode(normalized)
      if (local) {
        if (purpose === 'meal' && recordingMealType) {
          openMealForm(local, undefined, recordingMealType)
        } else {
          openFoodForm(local, '', purpose === 'register' ? 'settings' : 'food-screen', null, null, '', 'settings')
        }
        notify(purpose === 'meal' ? '端末内の食品を見つけました。分量を入力してください。' : '登録済み食品を開きました。')
        return
      }
      if (barcodeMissAction(purpose) === 'stay-food-master') {
        setView('food-screen')
        notify('一致する登録済み食品がありません。')
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
            setFoodFormMealType(purpose === 'meal' ? recordingMealType : null)
            setFoodFormSearchQuery(null)
            setFoodFormReturnView(purpose === 'register' ? 'settings' : 'food-screen')
            setFoodFormOrigin('barcode')
            foodFormSavedFoodRef.current = null
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
      openFoodForm(undefined, normalized, purpose === 'register' ? 'settings' : 'food-screen', purpose === 'meal' ? recordingMealType : null, null, '', 'barcode')
    } catch {
      showError('バーコード検索に失敗しました。番号を確認して再試行してください。')
    }
  }, [barcodePurpose, notify, openFoodForm, openMealForm, recordingMealType, settings])

  const saveFoodDraft = async () => {
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
      await saveFoodWithMetadata(food, { group, aliases, relatedTerms: related }, pendingEstimation ? foodDraft.originalInputHash : undefined)
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
      foodFormSavedFoodRef.current = savedFood
      setFoodDraft(foodToDraft(savedFood, group, aliases, related))
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
    const currentMealTime = currentEntries.find((current) => (
      current.mealType === mealType && current.id !== entryToEdit?.id
    ))?.eatenAt
    const eatenAt = resolveMealEntryTime({
      mealType,
      proposedEatenAt: isoForDate(targetDate),
      existingMealTime: currentMealTime,
      editingEatenAt: entryToEdit?.eatenAt,
    })
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
      const transition = resolveMealRegistrationTransition({
        editing: Boolean(entryToEdit),
        source: searchProgress.matched ? 'search' : 'selection',
        searchMatched: searchProgress.matched,
        remainingSearchGroups: searchProgress.remainingGroups.length,
      })
      const currentGroup = sortMealEntryGroup(currentEntries.filter((current) => current.mealType === mealType))
      const previousIndex = entryToEdit?.mealType === mealType
        ? currentGroup.findIndex((current) => current.id === entry.id)
        : -1
      const orderedGroup = currentGroup.filter((current) => current.id !== entry.id)
      orderedGroup.splice(previousIndex >= 0 ? Math.min(previousIndex, orderedGroup.length) : orderedGroup.length, 0, entry)
      const entriesToSave = normalizeMealEntryOrder(orderedGroup)
      await saveMealEntries(entriesToSave)
      if (searchProgress.matched) setSearchResults(searchProgress.remainingGroups)
      setPendingSearchQuery(null)
      setMealFood(null)
      setMealUserFacingName(null)
      setEditingEntry(null)
      setMealMenuSnapshot(null)
      setRecordingMealType(transition.keepRecordingMealType ? mealType : null)
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
      if (transition.nextView === 'search-results') {
        setConfirmingMealType(null)
        setView('search-results')
      } else if (transition.nextView === 'meal-confirmation') {
        setConfirmingMealType(mealType)
        setView('meal-confirmation')
      } else {
        setConfirmingMealType(null)
        setView('food-screen')
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
      const eatenAt = resolveMealEntryTime({
        mealType: targetMealType,
        proposedEatenAt: isoForDate(targetDate),
        existingMealTime: currentMealTime,
      })
      const batch = createMenuSetMealBatch({
        menuSet, menus, generalMenus, foods, mealType: targetMealType, eatenAt, createId: createNewMealId,
      })
      const missingCount = batch.missingMenuIds.length + batch.missingGeneralMenuIds.length + batch.missingFoodIds.length
      if (batch.entries.length === 0) {
        showError(`「${menuSet.name}」には登録できるメニュー・食品がありません。Myセットの内容を確認してください。`)
        return false
      }
      const existingGroup = sortMealEntryGroup(currentEntries.filter((entry) => entry.mealType === targetMealType))
      const orderedGroup = normalizeMealEntryOrder([...existingGroup, ...batch.entries])
      await saveMealEntries(orderedGroup)
      const searchProgress = consumeSearchSelectionGroup(searchResults, returnSearchQuery)
      const transition = resolveMealRegistrationTransition({
        editing: false,
        source: searchProgress.matched ? 'search' : 'menu-set',
        searchMatched: searchProgress.matched,
        remainingSearchGroups: searchProgress.remainingGroups.length,
      })
      if (searchProgress.matched) setSearchResults(searchProgress.remainingGroups)
      setPendingSearchQuery(null)
      setRecordingMealType(transition.keepRecordingMealType ? targetMealType : null)
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
      if (transition.nextView === 'search-results') {
        setConfirmingMealType(null)
        setView('search-results')
      } else {
        setConfirmingMealType(null)
        setView('food-screen')
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

  const reorderFavoriteFoods = async (orderedFoodIds: string[]) => {
    const previousFoods = favoriteFoods
    const foodsById = new Map(previousFoods.map((food) => [food.id, food]))
    if (orderedFoodIds.length !== previousFoods.length || orderedFoodIds.some((id) => !foodsById.has(id))) {
      throw new Error('お気に入りが変更されたため、並び替えを再試行してください。')
    }
    setFavoriteFoods(orderedFoodIds.map((id) => foodsById.get(id)!))
    try {
      await reorderFavorites(orderedFoodIds)
      const refreshed = await getFavoriteFoods()
      setFavoriteFoods(refreshed)
      setFavoriteIds(new Set(refreshed.map((food) => food.id)))
      notify('お気に入りの並び順を更新しました。')
    } catch (caught) {
      const refreshed = await getFavoriteFoods().catch(() => previousFoods)
      setFavoriteFoods(refreshed)
      setFavoriteIds(new Set(refreshed.map((food) => food.id)))
      showError(caught instanceof Error ? caught.message : 'お気に入りの並び順を更新できませんでした。')
      throw caught
    }
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

  const openMealConfirmationFromFoodSelection = () => {
    if (!recordingMealType || !requireLoadedDate()) return
    setConfirmingMealType(recordingMealType)
    setRecordingMealType(null)
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
      await saveBodyProfileSettings(next)
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

  const removeFood = async (food: Food): Promise<boolean> => {
    if (!window.confirm(`「${displayFoodName(food)}」を食品マスターから削除しますか？食事履歴は残ります。`)) return false
    try {
      await deleteFood(food.id)
      await reloadAfterMutation('食品を削除しました。食事履歴はスナップショットで残っています。')
      return true
    } catch {
      showError('食品を削除できませんでした。')
      return false
    }
  }

  const removeFoodFromForm = async () => {
    if (!foodDraft?.id) return
    const food = foods.find((item) => item.id === foodDraft.id)
    if (!food) {
      showError('削除する食品が見つかりません。')
      return
    }
    if (!await removeFood(food)) return
    setSearchResults((current) => current.map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (item.kind !== 'food' && item.kind !== 'user-food') return [item]
        const variants = item.variants.filter((variant) => variant.id !== food.id)
        if (item.food.id !== food.id) return [{ ...item, variants }]
        return variants.length > 0 ? [{ ...item, food: variants[0], variants }] : []
      }),
    })))
    setFoodDraft(null)
    foodFormSavedFoodRef.current = null
    setFoodFormMealType(null)
    setFoodFormSearchQuery(null)
    setView(foodFormReturnView)
  }

  const closeFoodForm = () => {
    const draft = foodDraft
    const savedFood = foodFormSavedFoodRef.current ?? (draft?.id ? foods.find((item) => item.id === draft.id) : undefined)
    const returnMealType = foodFormMealType
    const returnSearchQuery = foodFormSearchQuery
    setFoodDraft(null)
    setFoodFormMealType(null)
    setFoodFormSearchQuery(null)
    foodFormSavedFoodRef.current = null
    if (returnMealType && savedFood) {
      openMealForm(savedFood, undefined, returnMealType)
      setView(returnSearchQuery ? 'search-results' : 'food-screen')
      return
    }
    setView(foodFormReturnView)
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
        {view === 'food-screen' && <FoodsView recordingMealType={recordingMealType} recordingEntryCount={recordingMealType ? entries.filter((entry) => entry.mealType === recordingMealType).length : 0} foods={foods} foodGroups={foodGroups} menus={menus} generalMenus={generalMenus} menuSets={menuSets} recentFoods={recordingMealType ? recentFoodsByMealType[recordingMealType] : recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onSelectFood={handleFoodSelection} onSelectMenuSet={(menuSet) => void registerMenuSet(menuSet)} onCreateTemporaryMenu={() => setTemporaryMenuDraft({ id: null, name: '', category: 'その他', ingredients: [], aliases: [] })} onToggleFavorite={toggleFavorite} onReorderFavorites={reorderFavoriteFoods} onEditFood={(food) => openFoodForm(food, '', 'food-screen', null, null, '', foodScreenReturnView === 'settings' ? 'settings' : 'meal')} onDeleteFood={(food) => void removeFood(food)} onOpenSearch={() => openSearchInput(recordingMealType ? 'meal' : 'food-master')} onOpenScanner={() => openBarcodeScanner(recordingMealType ? 'meal' : 'lookup')} onOpenConfirmation={openMealConfirmationFromFoodSelection} onBack={() => { setRecordingMealType(null); setView(foodScreenReturnView) }} backLabel={foodScreenReturnView === 'settings' ? '← 設定' : '← 記録'} copyMealType={copyMealType} setCopyMealType={setCopyMealType} onCopyPrevious={copyPreviousMeals} />}
        {view === 'food-form' && foodDraft && <FoodFormView draft={foodDraft} returnView={foodFormReturnView} allowCommercialClassification={foodFormOrigin === 'settings'} estimationEnabled={estimationSettings?.enabled === true} setDraft={setFoodDraft} foodGroups={foodGroups} foodAliases={foodAliases} foodRelatedTerms={foodRelatedTerms} externalNote={externalNote} onRevertEstimate={(foodId, nutrientKey) => void revertFoodEstimate(foodId, nutrientKey)} onSubmit={saveFoodDraft} onDelete={foodDraft.id ? () => void removeFoodFromForm() : undefined} onClose={closeFoodForm} />}
        {view === 'settings' && estimationSettings && <SettingsView settings={settings} estimationSettings={estimationSettings} goalInputs={goalInputs} setGoalInputs={setGoalInputs} onSaveGoals={saveGoals} onToggleExternalApi={toggleExternalApi} onToggleNutrientEstimator={toggleNutrientEstimator} onChangeDefaultMealTimeMode={changeDefaultMealTimeMode} onExportJson={exportJson} onRestoreJson={restoreJson} onExportCsv={exportCsv} onImportCsv={importCsv} onExportUnresolvedIngredients={exportUnresolvedIngredients} csvFrom={csvFrom} csvTo={csvTo} setCsvFrom={setCsvFrom} setCsvTo={setCsvTo} counts={counts} bodyProfileInputs={bodyProfileInputs} setBodyProfileInputs={setBodyProfileInputs} onSaveBodyProfile={saveBodyProfile} onOpenNewFood={() => openFoodForm(undefined, '', 'settings', null, null, '', 'settings')} onOpenBarcodeRegister={() => openBarcodeScanner('register')} onOpenFoodMaster={() => { setRecordingMealType(null); setFoodScreenReturnView('settings'); setView('food-screen') }} estimatedGoals={estimateDailyGoals(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} bmi={calculateBmi(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} />}
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
      {showScanner && <Suspense fallback={<div className="modal-backdrop"><section className="modal-card"><p>バーコード画面を準備しています…</p></section></div>}><BarcodeScanner purpose={barcodePurpose ?? 'meal'} onDetected={handleBarcodeDetected} onClose={closeBarcodeScanner} /></Suspense>}
    </div>
  )
}

interface NavButtonProps { active: boolean; onClick: () => void; icon: string; iconClass?: string; label: string }
function NavButton({ active, onClick, icon, iconClass, label }: NavButtonProps) {
  return <button type="button" className={`nav-item${active ? ' active' : ''}`} onClick={onClick}><span className={iconClass}>{icon === 'menu-grid' ? <span className="menu-grid-table" aria-hidden="true"><i /><i /><i /><i /></span> : icon === 'settings' ? <span className="settings-nav-icon" style={{ '--settings-icon-image': `url(${SETTINGS_ICON_ASSET})` } as React.CSSProperties} aria-hidden="true" /> : icon}</span>{label}</button>
}

export default App
