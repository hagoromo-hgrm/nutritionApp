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
  saveFoodWithMetadata,
  saveMealEntries,
  saveMealEntry,
  saveMenu,
  saveMenuSet,
  saveSettings,
  searchFoodResults,
  searchMenus,
  searchMenuSets,
  setFavorite,
} from './db/db'
import { searchExternalFood, type ExternalFoodPreview } from './services/externalFoodApi'
import { backupToJson, downloadBlob, parseBackupText } from './services/backup'
import { mealsToCsv, parseMealsCsv } from './services/csv'
import { calculateBmi, calculateNutrients, estimateDailyGoals, formatNutrient, goalRate, incrementByBaseAmount, nutrientRangeForGoals, scaleNutritionGoals, sumByMealType, sumEntries, sumNutrients } from './services/nutrition'
import { buildDailyNutrientTrend } from './services/trend'
import {
  EMPTY_NUTRIENTS,
  FOOD_UNITS,
  MEAL_TYPES,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  MENU_CATEGORIES,
  DEFAULT_BODY_PROFILE,
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
  type MealTimeMode,
  type MealType,
  type Menu,
  type MenuCategory,
  type MenuSet,
  type NutrientKey,
  type Nutrients,
  type NutritionGoals,
} from './types'
import { normalizeSearchText, type FoodSearchResult } from './services/foodSearch'
import { filterVariantsBySelection, getVariantOptionGroups, getVariantSelection, resolveVariantForSelection, variantOptionText, type VariantOptionGroup } from './services/foodVariants'
import {
  AmbiguousFoodVariant,
  getDefaultSelectedAttributes,
  getFoodVariantBySourceId,
  getSelectableAttributes,
  hasFoodGroup as hasMextFoodGroup,
  MissingRequiredAttribute,
  resolveFoodVariantForUi,
} from './services/mextFoodData'
import { addDays, currentDateKey, currentMonthRange, formatDateKey, formatDateTime, formatFileTimestamp, isoFromTokyoTimeInput, toTokyoTimeInput, formatTime } from './utils/date'
import { isPositiveFinite, isValidBarcode, isValidUnit } from './utils/validation'
import './styles.css'

const BarcodeScanner = lazy(() => import('./components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })))

type View = 'today' | 'graphs' | 'food-screen' | 'food-form' | 'settings' | 'menus' | 'search-input' | 'search-results'
type FoodFormReturnView = 'food-screen' | 'settings'
type FoodScreenReturnView = 'today' | 'settings'
type SearchPurpose = 'meal' | 'food-master'

interface SearchResultItem {
  id: string
  kind: 'food' | 'menu' | 'set'
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
}

interface SearchResultGroup {
  query: string
  items: SearchResultItem[]
  searchLogId: string | null
  nextCursor: string | null
}

interface MenuDraft {
  id: string | null
  name: string
  category: MenuCategory
  foodIds: string[]
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
  source: Food['source']
  sourceVersion: string
  baseAmount: string
  baseUnit: FoodUnit
  servingAmount: string
  servingUnit: FoodUnit
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
  result: FoodSearchResult
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
    id: null, name: initialName, maker: '', barcode, source: 'user', sourceVersion: 'ユーザー入力',
    baseAmount: '100', baseUnit: 'g', servingAmount: '', servingUnit: 'g', menuIds: [], foodGroupId: '', groupDisplayName: initialName,
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
  return {
    id: food.id, name: food.name, maker: food.maker, barcode: food.barcode, source: food.source,
    sourceVersion: food.sourceVersion, baseAmount: String(food.baseAmount), baseUnit: food.baseUnit,
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
  return {
    ...emptyFoodDraft(preview.barcode, preview.name), maker: preview.maker, source: 'open_food_facts',
    sourceVersion: 'Open Food Facts（取得値は確認後に保存）', baseAmount: String(preview.baseAmount), baseUnit: preview.baseUnit,
    servingAmount: '', servingUnit: preview.baseUnit, menuIds: [],
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, preview.nutrients[key] === null ? '' : String(preview.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function snapshotToFood(entry: MealEntry): Food {
  return {
    id: entry.foodId, name: entry.foodSnapshot.name, displayName: entry.foodSnapshot.displayName ?? entry.foodSnapshot.name, officialName: entry.foodSnapshot.officialName, maker: entry.foodSnapshot.maker, barcode: entry.foodSnapshot.barcode,
    source: 'user', sourceVersion: '食事記録スナップショット', baseAmount: entry.foodSnapshot.baseAmount,
    baseUnit: entry.foodSnapshot.baseUnit, servingAmount: null, servingUnit: null, nutrients: entry.foodSnapshot.nutrients,
    createdAt: entry.eatenAt, updatedAt: entry.eatenAt,
  }
}

function menuToFood(menu: Menu, foods: Food[]): Food {
  const nutrients = sumNutrients(menu.foodIds.map((foodId) => foods.find((food) => food.id === foodId)).filter((food): food is Food => Boolean(food)).map((food) => calculateNutrients(food, food.baseAmount, food.baseUnit)))
  return {
    id: `menu:${menu.id}`, name: menu.name, maker: '', barcode: '', source: 'user', sourceVersion: `メニュー「${menu.category}」`,
    baseAmount: 1, baseUnit: '食', servingAmount: 1, servingUnit: '食', nutrients, createdAt: menu.createdAt, updatedAt: menu.updatedAt,
  }
}

function menuSetToFood(menuSet: MenuSet, menus: Menu[], foods: Food[]): Food {
  const menuNutrients = menuSet.menuIds.map((menuId) => menus.find((menu) => menu.id === menuId)).filter((menu): menu is Menu => Boolean(menu)).map((menu) => menuToFood(menu, foods)).map((food) => food.nutrients)
  const foodNutrients = (menuSet.foodIds ?? []).map((foodId) => foods.find((food) => food.id === foodId)).filter((food): food is Food => Boolean(food)).map((food) => calculateNutrients(food, food.baseAmount, food.baseUnit))
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

function menuIngredientNames(menu: Menu, foods: Food[]): string {
  return menu.foodIds
    .map((foodId) => {
      const food = foods.find((item) => item.id === foodId)
      return food ? displayFoodName(food) : undefined
    })
    .filter((name): name is string => Boolean(name))
    .join('、')
}

function App() {
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('today')
  const [selectedDate, setSelectedDate] = useState(currentDateKey())
  const [graphFrom, setGraphFrom] = useState(() => addDays(currentDateKey(), -13))
  const [graphTo, setGraphTo] = useState(currentDateKey())
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
  const [variantPicker, setVariantPicker] = useState<VariantPickerState | null>(null)
  const [foodFormReturnView, setFoodFormReturnView] = useState<FoodFormReturnView>('settings')
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
  const [mealType, setMealType] = useState<MealType>('朝食')
  const [recordingMealType, setRecordingMealType] = useState<MealType | null>(null)
  const [mealTypePicker, setMealTypePicker] = useState<{ food: Food | null } | null>(null)
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null)
  const [mealDetails, setMealDetails] = useState<{ type: MealType; entries: MealEntry[]; subtotal: Nutrients } | null>(null)
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

  const notify = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3500)
  }, [])

  const load = useCallback(async () => {
    try {
      const trendEntriesPromise = graphFrom && graphTo && graphFrom <= graphTo ? getEntriesBetween(graphFrom, graphTo) : Promise.resolve([] as MealEntry[])
      const [dateEntries, rangeEntries, resultFoods, resultGroups, resultAliases, resultRelatedTerms, recent, favorites, ids, currentSettings, foodCount, mealCount, menuCount, menuSetCount, foodKeys, resultMenus, resultMenuSets] = await Promise.all([
        getEntriesForDate(selectedDate), trendEntriesPromise, getAllFoods(), getAllFoodGroups(), getAllFoodAliases(), getAllFoodRelatedTerms(), getRecentFoods(), getFavoriteFoods(), getFavoriteIds(),
        getSettings(), db.foods.count(), db.mealEntries.count(), db.menus.count(), db.menuSets.count(), db.foods.toCollection().primaryKeys(), getAllMenus(), getAllMenuSets(),
      ])
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
      setError(null)
    } catch {
      setError('データを読み込めませんでした。ページを再読み込みして再試行してください。')
    }
  }, [graphFrom, graphTo, selectedDate])

  useEffect(() => {
    void initializeDatabase().then(() => setReady(true)).catch(() => setError('端末内データベースを初期化できませんでした。'))
    const updateSW = registerSW({
      onNeedRefresh: () => setUpdateAvailable(true),
      onOfflineReady: () => notify('オフライン利用の準備ができました。'),
    })
    updateSWRef.current = updateSW
    return () => { updateSWRef.current = null }
  }, [notify])

  useEffect(() => { if (ready) void load() }, [load, ready])

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

  const openMealForm = useCallback((food: Food, entry?: MealEntry, forcedMealType?: MealType) => {
    setMealFood(food)
    setEditingEntry(entry ?? null)
    setMealAmount(String(entry?.amount ?? food.servingAmount ?? food.baseAmount))
    setMealType(forcedMealType ?? entry?.mealType ?? '朝食')
    setError(null)
  }, [])

  const openMealTypePicker = () => setMealTypePicker({ food: null })

  const startCategoryRecord = (type: MealType) => {
    setRecordingMealType(type)
    setMealType(type)
    setFoodScreenReturnView('today')
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

  const openFoodForm = useCallback((food?: Food, barcode = '', returnView: FoodFormReturnView = 'settings', returnMealType: MealType | null = null, returnSearchQuery: string | null = null, initialName = '') => {
    setExternalNote(null)
    const group = food ? foodGroups.find((item) => item.id === food.foodGroupId) : undefined
    const aliases = group ? foodAliases.filter((alias) => alias.foodGroupId === group.id) : []
    const relatedTerms = group ? foodRelatedTerms.filter((term) => term.foodGroupId === group.id) : []
    setFoodDraft(food ? foodToDraft(food, group, aliases, relatedTerms) : emptyFoodDraft(barcode, initialName))
    setFoodFormMealType(returnMealType)
    setFoodFormSearchQuery(returnSearchQuery)
    setFoodFormReturnView(returnView)
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
        } else openFoodForm(local, '', 'food-screen')
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
            setView('food-form')
            notify('外部商品情報を取得しました。内容を確認して保存してください。')
            return
          }
          notify('商品が見つかりませんでした。バーコードを保持して手入力登録へ進みます。')
        } catch {
          notify('外部商品APIに接続できません。バーコードを保持して手入力登録へ進みます。')
        }
      }
      openFoodForm(undefined, normalized, 'food-screen', recordingMealType)
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
    if (servingAmount !== null && foodDraft.servingUnit !== foodDraft.baseUnit) { showError('単位変換を推測しないため、既定量の単位は基準単位と一致させてください。'); return }
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
      const groupDisplayName = foodDraft.groupDisplayName.trim() || foodDraft.name.trim()
      const existingGroup = foodGroups.find((group) => group.id === groupId)
      const isBundledMextGroup = hasMextFoodGroup(groupId)
      const variantAttributes = Object.fromEntries(variantAttributeKeys.map((key) => [key, foodDraft.variantAttributes[key].trim() || null])) as FoodVariantAttributes
      const food: Food = {
        id: foodId, name: foodDraft.name.trim(), officialName: foodDraft.name.trim(), displayName: groupDisplayName, maker: foodDraft.maker.trim(), barcode: foodDraft.barcode.trim(),
        source: foodDraft.source, sourceVersion: foodDraft.sourceVersion || 'ユーザー入力', baseAmount, baseUnit: foodDraft.baseUnit,
        servingAmount, servingUnit: servingAmount === null ? null : foodDraft.servingUnit, menuIds: foodDraft.menuIds, foodGroupId: groupId, variantAttributes, nutrients,
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
      await load()
      notify(foodDraft.id ? '食品を更新しました。' : '食品を登録しました。')
    } catch {
      showError('食品を保存できませんでした。入力を確認して再試行してください。')
    }
  }

  const saveMealRecord = async (food: Food, amountText: string, entryToEdit: MealEntry | null = editingEntry) => {
    const amount = Number(amountText)
    if (!isPositiveFinite(amount) || amount > 100000) { showError('分量は0より大きく、現実的な範囲の数値で入力してください。'); return }
    const calculated = calculateNutrients(food, amount, food.baseUnit)
    const currentMealTime = entries.find((current) => current.mealType === mealType)?.eatenAt
    const eatenAt = entryToEdit
      ? (mealType === '間食' ? entryToEdit.eatenAt : (currentMealTime ?? entryToEdit.eatenAt))
      : isoForDate(selectedDate)
    const entry: MealEntry = {
      id: entryToEdit?.id ?? createNewMealId(), eatenAt, mealType,
      foodId: food.id, foodSnapshot: {
        name: food.displayName ?? food.name, officialName: food.officialName, displayName: food.displayName, maker: food.maker, barcode: food.barcode, baseAmount: food.baseAmount,
        baseUnit: food.baseUnit, nutrients: { ...food.nutrients },
      }, amount, amountUnit: food.baseUnit, calculatedNutrients: calculated,
    }
    try {
      const entriesToSave = mealType === '間食'
        ? [entry]
        : [entry, ...entries.filter((current) => current.mealType === mealType && current.id !== entry.id).map((current) => ({ ...current, eatenAt }))]
      const returnToSearchResults = pendingSearchQuery !== null
      await saveMealEntries(entriesToSave)
      if (pendingSearchQuery) {
        setSearchResults((current) => current.filter((group) => group.query !== pendingSearchQuery))
        setPendingSearchQuery(null)
      }
      const continueFoodSelection = recordingMealType !== null && !entryToEdit
      setMealFood(null)
      setEditingEntry(null)
      setRecordingMealType(returnToSearchResults ? recordingMealType : continueFoodSelection ? recordingMealType : null)
      setView(returnToSearchResults ? 'search-results' : continueFoodSelection ? 'food-screen' : 'today')
      await load()
      notify(entryToEdit ? '食事記録を更新しました。' : '食事を記録しました。')
    } catch {
      showError('食事を保存できませんでした。保存先の空き容量を確認して再試行してください。')
    }
  }

  const saveMeal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mealFood) await saveMealRecord(mealFood, mealAmount)
  }

  const removeMeal = async (entry: MealEntry) => {
    if (!window.confirm(`「${entry.foodSnapshot.name}」の食事記録を削除しますか？`)) return
    try { await deleteMealEntry(entry.id); await load(); notify('食事記録を削除しました。') } catch { showError('食事記録を削除できませんでした。') }
  }

  const copyPreviousMeals = async () => {
    const previous = await getEntriesForDate(addDays(selectedDate, -1))
    const selected = copyMealType === 'すべて' ? previous : previous.filter((entry) => entry.mealType === copyMealType)
    if (!selected.length) { notify('コピーできる前日の食事がありません。'); return }
    if (!window.confirm(`${selected.length}件の前日の食事を${selectedDate}へコピーしますか？`)) return
    try {
      const eatenAt = isoForDate(selectedDate)
      for (const entry of selected) await saveMealEntry({ ...entry, id: createNewMealId(), eatenAt })
      await load()
      notify(`${selected.length}件をコピーしました。`)
    } catch { showError('前日の食事をコピーできませんでした。') }
  }

  const toggleFavorite = async (food: Food) => {
    try { await setFavorite(food.id, !favoriteIds.has(food.id)); await load() } catch { showError('お気に入りを更新できませんでした。') }
  }

  const openMealDetails = (type: MealType, mealEntries: MealEntry[], subtotal: Nutrients) => {
    setMealDetails({ type, entries: mealEntries, subtotal })
  }

  const updateMealTimes = async (entryIds: string[], time: string) => {
    const eatenAt = isoFromTokyoTimeInput(selectedDate, time)
    if (!eatenAt) { showError('食事時刻を正しく入力してください。'); return }
    const ids = new Set(entryIds)
    const updates = entries.filter((entry) => ids.has(entry.id)).map((entry) => ({ ...entry, eatenAt }))
    if (updates.length === 0) return
    try {
      await saveMealEntries(updates)
      setMealDetails(null)
      await load()
      notify('食事時刻を更新しました。')
    } catch {
      showError('食事時刻を保存できませんでした。')
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
    setSearchBars([''])
    setSearchResults([])
    setPendingSearchQuery(null)
    setSearchPurpose(purpose)
    setView('search-input')
  }

  const searchFoodsAndMenus = async () => {
    const enteredQueries = searchBars.map((query) => query.trim()).filter(Boolean)
    const queries = enteredQueries.length > 0 ? enteredQueries : ['']
    try {
      const groups = await Promise.all(queries.map(async (query) => {
        const [{ page, logId }, resultMenus, resultMenuSets] = await Promise.all([searchFoodResults(query, { limit: 20 }), searchMenus(query), searchMenuSets(query)])
        const items: SearchResultItem[] = [
          ...page.results.map((result, index) => ({ id: result.group.id, kind: 'food' as const, title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · ${formatNutrient(result.food.nutrients.energyKcal)}kcal`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: index + 1 })),
          ...(query && searchPurpose === 'meal' ? resultMenus.map((menu) => ({ id: menu.id, kind: 'menu' as const, title: menu.name, subtitle: `メニュー · ${menu.category} · 食材: ${menuIngredientNames(menu, foods) || '未登録'}`, food: menuToFood(menu, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })) : []),
          ...(query && searchPurpose === 'meal' ? resultMenuSets.map((menuSet) => ({ id: menuSet.id, kind: 'set' as const, title: menuSet.name, subtitle: 'メニューセット', food: menuSetToFood(menuSet, menus, foods), group: null, variants: [] as Food[], score: null, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null })) : []),
        ]
        return { query: query || '最近・お気に入り', items, searchLogId: logId, nextCursor: page.nextCursor }
      }))
      setSearchResults(groups)
      setView('search-results')
      setError(null)
    } catch {
      showError('検索に失敗しました。検索語句を確認して再試行してください。')
    }
  }

  const leaveSearchResults = () => {
    for (const group of searchResults) if (group.searchLogId) void markSearchLogUnselected(group.searchLogId)
    setView('search-input')
  }

  const loadMoreSearchResults = async (groupIndex: number) => {
    const group = searchResults[groupIndex]
    if (!group?.nextCursor) return
    try {
      const actualQuery = group.query === '最近・お気に入り' ? '' : group.query
      const { page, logId } = await searchFoodResults(actualQuery, { limit: 20, cursor: group.nextCursor })
      const additionalItems: SearchResultItem[] = page.results.map((result, resultIndex) => ({
        id: result.group.id, kind: 'food', title: displaySearchFoodName(result.group, result.food), subtitle: `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · ${formatNutrient(result.food.nutrients.energyKcal)}kcal`, food: result.food, group: result.group, variants: result.variants, score: result.score, matchedBy: result.matchedBy, recentlyUsed: result.recentlyUsed, searchLogId: logId, searchRank: group.items.length + resultIndex + 1,
      }))
      setSearchResults((current) => current.map((item, index) => index === groupIndex ? { ...item, items: [...item.items, ...additionalItems], nextCursor: page.nextCursor } : item))
    } catch { showError('検索結果を追加で読み込めませんでした。') }
  }

  const selectSearchFood = (groupQuery: string, item: SearchResultItem, food: Food, amount?: string) => {
    if (item.searchLogId && item.group) void recordFoodSelection(item.searchLogId, item.group.id, food.id, item.searchRank ?? 0)
    if (searchPurpose === 'food-master') {
      setPendingSearchQuery(null)
      openFoodForm(food, '', 'food-screen')
      return
    }
    setPendingSearchQuery(groupQuery)
    openMealForm(food, undefined, recordingMealType ?? mealType)
    if (amount !== undefined) setMealAmount(amount)
  }

  const handleSearchResultSelect = (groupQuery: string, item: SearchResultItem) => {
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
    const now = new Date().toISOString()
    const menu: Menu = {
      id: menuDraft.id ?? createNewMenuId(), name: menuDraft.name.trim(), category: menuDraft.category, foodIds: menuDraft.foodIds,
      aliases: [...new Set(menuDraft.aliases.map((alias) => alias.trim()).filter(Boolean))],
      createdAt: menuDraft.id ? (menus.find((item) => item.id === menuDraft.id)?.createdAt ?? now) : now, updatedAt: now,
    }
    try { await saveMenu(menu); setMenuDraft(null); await load(); notify(menuDraft.id ? 'メニューを更新しました。' : 'メニューを登録しました。') } catch { showError('メニューを保存できませんでした。') }
  }

  const saveMenuSetDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!menuSetDraft || !menuSetDraft.name.trim()) { showError('セット名を入力してください。'); return }
    const now = new Date().toISOString()
    const menuSet: MenuSet = {
      id: menuSetDraft.id ?? createNewMenuSetId(), name: menuSetDraft.name.trim(), menuIds: menuSetDraft.menuIds, foodIds: menuSetDraft.foodIds,
      createdAt: menuSetDraft.id ? (menuSets.find((item) => item.id === menuSetDraft.id)?.createdAt ?? now) : now, updatedAt: now,
    }
    try { await saveMenuSet(menuSet); setMenuSetDraft(null); await load(); notify(menuSetDraft.id ? 'メニューセットを更新しました。' : 'メニューセットを登録しました。') } catch { showError('メニューセットを保存できませんでした。') }
  }

  const removeMenu = async (menu: Menu) => {
    if (!window.confirm(`「${menu.name}」を削除しますか？`)) return
    try { await deleteMenu(menu.id); await load(); notify('メニューを削除しました。') } catch { showError('メニューを削除できませんでした。') }
  }

  const removeMenuSet = async (menuSet: MenuSet) => {
    if (!window.confirm(`「${menuSet.name}」を削除しますか？`)) return
    try { await deleteMenuSet(menuSet.id); await load(); notify('メニューセットを削除しました。') } catch { showError('メニューセットを削除できませんでした。') }
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

  const exportJson = async () => {
    try {
      const backup = await exportBackup()
      downloadBlob(backupToJson(backup), `nutrition-backup-${formatFileTimestamp(new Date(backup.exportedAt))}.json`, 'application/json')
      const next = settings ? { ...settings, lastBackupAt: backup.exportedAt } : null
      if (next) { await saveSettings(next); setSettings(next) }
      notify('JSONバックアップを出力しました。')
    } catch { showError('JSONバックアップを作成できませんでした。') }
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
      await replaceAllData(backup)
      await load()
      notify(`復元しました。食品${backup.foods.length}件、食事${backup.mealEntries.length}件、メニュー${backup.menus?.length ?? 0}件、セット${backup.menuSets?.length ?? 0}件です。自動退避も出力しました。`)
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
      await load()
      notify(`${imported.length}件の食事履歴を取り込みました。`)
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'CSVを取り込めませんでした。既存データは変更していません。')
    }
  }

  const removeFood = async (food: Food) => {
    if (!window.confirm(`「${displayFoodName(food)}」を食品マスターから削除しますか？食事履歴は残ります。`)) return
    try { await deleteFood(food.id); await load(); notify('食品を削除しました。食事履歴はスナップショットで残っています。') } catch { showError('食品を削除できませんでした。') }
  }

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
          selectedDate={selectedDate} setSelectedDate={setSelectedDate} total={total} goals={settings.goals} entries={entries} subtotals={subtotals}
          existingFoodIds={existingFoodIds} onStartCategoryRecord={startCategoryRecord}
          onEditEntry={(entry) => openMealForm(snapshotToFood(entry), entry)} onDeleteEntry={removeMeal} onShowMealDetails={openMealDetails} onShowTodayDetails={() => setShowTodayDetails(true)}
        />}
        {view === 'graphs' && <GraphsView entries={trendEntries} from={graphFrom} to={graphTo} goals={settings.goals} onFromChange={setGraphFrom} onToChange={setGraphTo} />}
        {view === 'food-screen' && <FoodsView recordingMealType={recordingMealType} foods={foods} menus={menus} menuSets={menuSets} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onSelectFood={handleFoodSelection} onToggleFavorite={toggleFavorite} onEditFood={(food) => openFoodForm(food, '', 'food-screen')} onDeleteFood={removeFood} onOpenSearch={() => openSearchInput(recordingMealType ? 'meal' : 'food-master')} onOpenScanner={() => setShowScanner(true)} onBack={() => { setRecordingMealType(null); setView(foodScreenReturnView) }} backLabel={foodScreenReturnView === 'settings' ? '← 設定' : '← 記録'} copyMealType={copyMealType} setCopyMealType={setCopyMealType} onCopyPrevious={copyPreviousMeals} />}
        {view === 'food-form' && foodDraft && <><FoodFormView draft={foodDraft} returnView={foodFormReturnView} setDraft={setFoodDraft} foodGroups={foodGroups} foodAliases={foodAliases} foodRelatedTerms={foodRelatedTerms} externalNote={externalNote} onSubmit={saveFoodDraft} onClose={() => { setFoodDraft(null); setFoodFormMealType(null); setFoodFormSearchQuery(null); setView(foodFormReturnView) }} /><FoodMenuSelection draft={foodDraft} setDraft={setFoodDraft} menus={menus} /></>}
        {view === 'settings' && <><SettingsView settings={settings} goalInputs={goalInputs} setGoalInputs={setGoalInputs} onSaveGoals={saveGoals} onToggleExternalApi={toggleExternalApi} onChangeDefaultMealTimeMode={changeDefaultMealTimeMode} onExportJson={exportJson} onRestoreJson={restoreJson} onExportCsv={exportCsv} onImportCsv={importCsv} csvFrom={csvFrom} csvTo={csvTo} setCsvFrom={setCsvFrom} setCsvTo={setCsvTo} counts={counts} /><SettingsExtras bodyProfileInputs={bodyProfileInputs} setBodyProfileInputs={setBodyProfileInputs} onSaveBodyProfile={saveBodyProfile} onOpenNewFood={() => openFoodForm(undefined, '', 'settings')} onOpenFoodMaster={() => { setRecordingMealType(null); setFoodScreenReturnView('settings'); setView('food-screen') }} estimatedGoals={estimateDailyGoals(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} bmi={calculateBmi(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} /></>}
        {view === 'menus' && <MenuView menus={menus} menuSets={menuSets} foods={foods} onNewMenu={() => setMenuDraft({ id: null, name: '', category: '主菜', foodIds: [], aliases: [] })} onEditMenu={(menu) => setMenuDraft({ id: menu.id, name: menu.name, category: menu.category, foodIds: menu.foodIds, aliases: menu.aliases ?? [] })} onDeleteMenu={removeMenu} onNewMenuSet={() => setMenuSetDraft({ id: null, name: '', menuIds: [], foodIds: [] })} onEditMenuSet={(menuSet) => setMenuSetDraft({ id: menuSet.id, name: menuSet.name, menuIds: menuSet.menuIds, foodIds: menuSet.foodIds ?? [] })} onDeleteMenuSet={removeMenuSet} onBack={() => setView('today')} />}
        {view === 'search-input' && <SearchInputView bars={searchBars} setBars={setSearchBars} onSearch={() => void searchFoodsAndMenus()} onBack={() => setView('food-screen')} />}
        {view === 'search-results' && <SearchResultsView groups={searchResults} purpose={searchPurpose} onSelect={handleSearchResultSelect} onAddFood={(query) => openFoodForm(undefined, '', 'food-screen', searchPurpose === 'meal' ? (recordingMealType ?? mealType) : null, searchPurpose === 'meal' ? (query || null) : null, query)} onLoadMore={(index) => void loadMoreSearchResults(index)} onBack={leaveSearchResults} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavButton active={view === 'today'} onClick={() => { setRecordingMealType(null); setView('today') }} icon="◷" iconClass="today-icon" label="記録" />
        <NavButton active={view === 'graphs'} onClick={() => { setRecordingMealType(null); setView('graphs') }} icon="↗" iconClass="graphs-icon" label="グラフ" />
        <NavButton active={view === 'menus'} onClick={() => { setRecordingMealType(null); setView('menus') }} icon="menu-grid" iconClass="menu-grid-icon" label="メニュー" />
        <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="settings" iconClass="settings-icon" label="設定" />
      </nav>

      {view === 'today' && <button className="floating-add" type="button" onClick={openMealTypePicker} aria-label="食事を追加">＋</button>}

      {mealTypePicker && <MealTypePickerModal food={mealTypePicker.food} recordedMealTypes={recordedMealTypes} onSelect={chooseMealType} />}
      {variantPicker && <FoodVariantPickerModal result={variantPicker.result} mealMode={searchPurpose === 'meal'} onSubmitMeal={async (food, amount) => { await saveMealRecord(food, amount); setVariantPicker(null) }} onSelect={(food) => { setVariantPicker(null); selectSearchFood(variantPicker.query, variantPicker.item, food) }} onClose={() => setVariantPicker(null)} />}
      {mealFood && <MealModal food={mealFood} amount={mealAmount} setAmount={setMealAmount} editing={Boolean(editingEntry)} onSubmit={saveMeal} onClose={() => { setMealFood(null); setEditingEntry(null); setRecordingMealType(null) }} />}
      {mealDetails && <MealDetailsModal details={mealDetails} goals={scaleNutritionGoals(settings.goals, 1 / 3)} onUpdateTimes={updateMealTimes} onClose={() => setMealDetails(null)} />}
      {showTodayDetails && <TodayDetailsModal total={total} goals={settings.goals} subtotals={subtotals} onClose={() => setShowTodayDetails(false)} />}
      {menuDraft && <MenuEditorModal draft={menuDraft} setDraft={setMenuDraft} foods={foods} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onSubmit={saveMenuDraft} onClose={() => setMenuDraft(null)} />}
      {menuSetDraft && <MenuSetEditorModal draft={menuSetDraft} setDraft={setMenuSetDraft} menus={menus} foods={foods} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onSubmit={saveMenuSetDraft} onClose={() => setMenuSetDraft(null)} />}
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
  return ({ 朝食: 'lunch', 昼食: 'breakfast', 夕食: 'dinner', 間食: 'snack' })[type]
}

function GoalProgressBar({ label, value, goal, unit, range, colorClass = 'goal-progress-accent', segments, dark = false, targetPositionPercent = 50 }: { label: string; value: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; colorClass?: string; segments?: GoalSegment[]; dark?: boolean; targetPositionPercent?: number }) {
  const rate = goalRate(value, goal)
  const hasGoal = goal !== null && goal > 0
  const targetPercent = Math.min(90, Math.max(10, targetPositionPercent))
  const graphMax = hasGoal ? goal / (targetPercent / 100) : Math.max(value ?? 0, 1)
  const progressWidth = value === null ? 0 : Math.min(100, Math.max(0, (value / graphMax) * 100))
  const rangeLeft = hasGoal ? Math.min(100, Math.max(0, ((range.min ?? 0) / graphMax) * 100)) : 0
  const rangeRight = hasGoal ? Math.min(100, Math.max(rangeLeft, ((range.max ?? graphMax) / graphMax) * 100)) : 0
  const targetPosition = hasGoal ? targetPercent : null
  const segmentTotal = segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0
  return <div className={`goal-progress-card${dark ? ' goal-progress-dark' : ''}`}><div className="goal-progress-heading"><span>{label}</span><strong>{formatNutrient(value)}<small>{unit}</small><em>{goal === null ? '目標未設定' : ` / ${formatNutrient(goal)}${unit}`}</em></strong></div><div className="goal-progress-visual"><span className="goal-range-band" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{value !== null && <div className={`goal-intake-bar${segments && segmentTotal > 0 ? ' goal-intake-segmented' : ` ${colorClass}`}`} style={{ width: `${progressWidth}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <span key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</div>}{targetPosition !== null && <span className="goal-target-line" style={{ left: `${targetPosition}%` }} />}</div><div className="goal-progress-footer"><span>{rate === null ? '比較する目標がありません' : `目標の${rate.toFixed(0)}%`}</span><div className="goal-progress-legends">{targetPosition !== null && <span className="goal-line-legend"><i />目標</span>}{segments && segmentTotal > 0 && <MealColorLegend />}</div></div></div>
}

function MealColorLegend() {
  return <div className="meal-color-legend">{MEAL_TYPES.map((type) => <span key={type}><i className={`meal-dot meal-dot-${mealTone(type)}`} /><img className="meal-legend-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</span>)}</div>
}

function NutrientGraphRow({ label, value, goal, unit, range, segments }: { label: string; value: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; segments?: GoalSegment[] }) {
  const hasGoal = goal !== null && goal > 0
  const graphMax = hasGoal ? Math.max(goal * 2, value ?? 0, 1) : Math.max(value ?? 0, 1)
  const valuePercent = value === null ? 0 : Math.min(100, Math.max(0, (value / graphMax) * 100))
  const rangeLeft = hasGoal ? Math.min(100, Math.max(0, ((range.min ?? 0) / graphMax) * 100)) : 0
  const rangeRight = hasGoal ? Math.min(100, Math.max(rangeLeft, ((range.max ?? graphMax) / graphMax) * 100)) : 0
  const segmentTotal = segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0
  const rate = goalRate(value, goal)
  const status = rate === null ? '未設定' : range.max !== null && value !== null && value > range.max ? '超過' : range.min !== null && value !== null && value < range.min ? '不足' : '適正'
  return <div className="nutrient-graph-row"><span className="nutrient-graph-label">{label}</span><div className="nutrient-graph-track"><span className="nutrient-graph-range" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{value !== null && <span className={`nutrient-graph-intake${segments && segmentTotal > 0 ? ' nutrient-graph-intake-segmented' : ''}`} style={{ width: `${valuePercent}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}{hasGoal && <span className="nutrient-graph-target" style={{ left: '50%' }} />}</div><span className={`nutrient-graph-value nutrient-graph-status-${status === '超過' ? 'over' : status === '不足' ? 'under' : status === '適正' ? 'ok' : 'unknown'}`}>{formatNutrient(value)}<small>{unit}</small></span></div>
}

function NutrientGoalGraphs({ nutrients, goals, subtotals, colorByMeal = false, excludeEnergy = false }: { nutrients: Nutrients; goals: NutritionGoals; subtotals?: Record<string, Nutrients>; colorByMeal?: boolean; excludeEnergy?: boolean }) {
  const keys = excludeEnergy ? NUTRIENT_KEYS.filter((key) => key !== 'energyKcal') : NUTRIENT_KEYS
  return <section className="nutrient-graph"><div className="nutrient-graph-heading"><span>栄養素</span><span>基準ライン</span><span>摂取量</span></div><div className="nutrient-graph-rows">{keys.map((key) => <NutrientGraphRow key={key} label={NUTRIENT_LABELS[key]} value={nutrients[key]} goal={goals[key]} unit={NUTRIENT_UNITS[key]} range={nutrientRangeForGoals(goals, key)} segments={colorByMeal && subtotals ? MEAL_TYPES.map((type) => ({ type, value: subtotals[type]?.[key] ?? 0 })).filter((segment) => segment.value > 0) : undefined} />)}</div>{colorByMeal && subtotals && <div className="nutrient-graph-footer"><MealColorLegend /></div>}</section>
}

const TREND_NUTRIENT_KEYS: NutrientKey[] = ['energyKcal', 'proteinG', 'fatG', 'carbohydrateG']

function formatTrendDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

interface GraphsViewProps {
  entries: MealEntry[]
  from: string
  to: string
  goals: NutritionGoals
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}

function GraphsView({ entries, from, to, goals, onFromChange, onToChange }: GraphsViewProps) {
  const [metric, setMetric] = useState<NutrientKey>('energyKcal')
  const points = useMemo(() => buildDailyNutrientTrend(entries, from, to), [entries, from, to])
  const invalidRange = !from || !to || from > to
  const rangeTooLong = !invalidRange && addDays(from, 30) < to
  const goal = goals[metric]
  const values = points.map((point) => point.nutrients[metric] ?? 0)
  const chartMax = Math.max(goal ?? 0, ...values, 1) * 1.15
  const goalPosition = goal !== null && goal > 0 ? Math.min(100, (goal / chartMax) * 100) : null
  const recordedDays = new Set(entries.map((entry) => formatDateKey(entry.eatenAt))).size

  return <>
    <section className="page-heading"><div><span className="eyebrow">GRAPHS</span><h1>グラフ</h1></div></section>
    <section className="settings-card trend-toolbar-card"><div className="section-title"><div><span className="eyebrow">TREND</span><h2>表示する期間と栄養素</h2></div></div><div className="trend-range"><label>開始日<input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} /></label><label>終了日<input type="date" value={to} onChange={(event) => onToChange(event.target.value)} /></label></div><label>表示する栄養素<select value={metric} onChange={(event) => setMetric(event.target.value as NutrientKey)}>{TREND_NUTRIENT_KEYS.map((key) => <option key={key} value={key}>{NUTRIENT_LABELS[key]}</option>)}</select></label><InfoPopover label="グラフの表示について" text="最大31日分を表示します。線は設定された1日の目標値です。" /></section>
    {invalidRange ? <p className="trend-empty">開始日は終了日以前にしてください。</p> : rangeTooLong ? <p className="trend-empty">表示期間は31日以内に設定してください。</p> : <section className="trend-chart-card"><div className="trend-chart-heading"><div><span className="eyebrow">DAILY TREND</span><h2>{NUTRIENT_LABELS[metric]}の推移</h2></div><span>{recordedDays}日記録 / {points.length}日</span></div><div className="trend-chart-legend"><span className="trend-legend-bar" />摂取量{goalPosition !== null && <><span className="trend-legend-line" />目標 {formatNutrient(goal)}{NUTRIENT_UNITS[metric]}</>}</div><div className="trend-chart-scroll"><div className="trend-chart"><div className="trend-chart-plot">{goalPosition !== null && <span className="trend-chart-goal-line" style={{ bottom: `${goalPosition}%` }} />}<div className="trend-chart-bars" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(2.7rem, 1fr))`, minWidth: `${Math.max(points.length * 3.2, 31)}rem` }}>{points.map((point) => { const value = point.nutrients[metric]; const numericValue = value ?? 0; const height = Math.min(100, Math.max(0, (numericValue / chartMax) * 100)); return <div className="trend-bar-column" key={point.date} title={`${point.date} ${NUTRIENT_LABELS[metric]} ${formatNutrient(value)}${NUTRIENT_UNITS[metric]}`}><span className={`trend-bar-value${value === null ? ' is-missing' : ''}`}>{formatNutrient(value)}<small>{NUTRIENT_UNITS[metric]}</small></span><div className="trend-bar-track"><span className="trend-bar-fill" style={{ height: `${height}%` }} /></div><span className="trend-bar-date">{formatTrendDate(point.date)}</span></div> })}</div></div></div></div></section>}
  </>
}

interface TodayViewProps {
  selectedDate: string; setSelectedDate: (value: string) => void; total: Nutrients; goals: NutritionGoals; entries: MealEntry[]; subtotals: Record<string, Nutrients>
  existingFoodIds: Set<string>; onStartCategoryRecord: (type: MealType) => void
  onEditEntry: (entry: MealEntry) => void; onDeleteEntry: (entry: MealEntry) => void; onShowMealDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onShowTodayDetails: () => void
}

function TodayView(props: TodayViewProps) {
  const { selectedDate, setSelectedDate, total, goals, entries, subtotals, existingFoodIds, onStartCategoryRecord, onEditEntry, onDeleteEntry, onShowMealDetails, onShowTodayDetails } = props
  return <>
    <section className="page-heading"><div><span className="eyebrow">DAILY LOG</span><h1>今日の記録</h1><p className="muted">食べたものを、あとから振り返れる形で。</p></div><div className="date-picker"><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button></div></section>
    <section className="hero-summary"><div className="hero-summary-heading"><div className="today-hero-copy"><span className="section-kicker">{selectedDate === currentDateKey() ? 'TODAY' : selectedDate}</span><strong>今日の進捗</strong></div><button className="hero-detail-button" type="button" onClick={onShowTodayDetails}>詳細を見る</button></div><GoalProgressBar label="カロリー" value={total.energyKcal} goal={goals.energyKcal} unit="kcal" range={nutrientRangeForGoals(goals, 'energyKcal')} segments={MEAL_TYPES.map((type) => ({ type, value: subtotals[type]?.energyKcal ?? 0 })).filter((segment) => segment.value > 0)} targetPositionPercent={75} dark /></section>
    <section className="section-block meals-section"><div className="section-title"><div><span className="eyebrow">MEALS</span><h2>食事の内訳</h2></div><span className="count-label">{entries.length}件</span></div>{MEAL_TYPES.map((type) => <MealGroup key={type} type={type} entries={entries.filter((entry) => entry.mealType === type)} subtotal={subtotals[type]} existingFoodIds={existingFoodIds} onEdit={onEditEntry} onDelete={onDeleteEntry} onShowDetails={onShowMealDetails} onRecord={onStartCategoryRecord} />)}</section>
  </>
}

function TodayDetailsModal({ total, goals, subtotals, onClose }: { total: Nutrients; goals: NutritionGoals; subtotals: Record<string, Nutrients>; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="今日の栄養詳細"><section className="modal-card today-details-modal"><div className="modal-heading"><div><span className="eyebrow">TODAY DETAILS</span><h2>今日の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><NutrientGoalGraphs nutrients={total} goals={goals} subtotals={subtotals} colorByMeal /></section></div>
}

function QuickFoodGroup({ title, foods, favoriteIds, onSelect, onToggleFavorite }: { title: string; foods: Food[]; favoriteIds: Set<string>; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="quick-group"><h3>{title}</h3>{foods.length > 0 ? <div className="quick-list">{foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />)}</div> : <p className="quick-empty-inline">まだお気に入りがありません。食品の☆から追加できます。</p>}</div>
}

function FoodRow({ food, favorite, onSelect, onAdd, onToggleFavorite, onEdit, onDelete, onRemove }: { food: Food; favorite: boolean; onSelect?: (food: Food) => void; onAdd?: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEdit?: (food: Food) => void; onDelete?: (food: Food) => void; onRemove?: (food: Food) => void }) {
  const name = displayFoodName(food)
  return <div className="food-row">{onSelect ? <button type="button" className="food-main" onClick={() => onSelect(food)}><strong>{name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></button> : <div className="food-main static"><strong>{name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></div>}{onAdd && <button type="button" className="small-action food-add-button" onClick={() => onAdd(food)}>追加</button>}<button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button>{onEdit && <button type="button" className="small-action" onClick={() => onEdit(food)}>編集</button>}{onDelete && <button type="button" className="small-action danger-text" onClick={() => onDelete(food)}>削除</button>}{onRemove && <button type="button" className="small-action danger-text" onClick={() => onRemove(food)}>外す</button>}</div>
}

function MenuFoodPicker({ menus, menuSets, foods, onSelect }: { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onSelect: (food: Food) => void }) {
  const categoryGroups = MENU_CATEGORIES.map((category) => ({ category, menus: menus.filter((menu) => menu.category === category) }))
  return <details className="section-block menu-picker-section food-section-card food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">MENUS</span><h2>メニューから探す</h2></div></summary><div className="menu-picker-groups">{categoryGroups.map(({ category, menus: categoryMenus }) => <details className="menu-picker-group" key={category}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{categoryMenus.length > 0 ? categoryMenus.map((menu) => { const food = menuToFood(menu, foods); return <button className="menu-picker-row" type="button" key={menu.id} onClick={() => onSelect(food)}><span className="source-badge">料理</span><span className="menu-picker-copy"><strong>{menu.name}</strong><small>{menu.foodIds.length}食材 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button> }) : <p className="menu-picker-empty">この区分に登録されたメニューはありません。</p>}</div></details>)}{<details className="menu-picker-group"><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />セット</span><small>{menuSets.length > 0 ? `${menuSets.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{menuSets.length > 0 ? menuSets.map((menuSet) => { const food = menuSetToFood(menuSet, menus, foods); return <button className="menu-picker-row" type="button" key={menuSet.id} onClick={() => onSelect(food)}><span className="source-badge">セット</span><span className="menu-picker-copy"><strong>{menuSet.name}</strong><small>料理・食品をまとめて · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button> }) : <p className="menu-picker-empty">セットはまだ登録されていません。</p>}</div></details>}</div></details>
}

function MealGroup({ type, entries, subtotal, existingFoodIds, onEdit, onDelete, onShowDetails, onRecord }: { type: MealType; entries: MealEntry[]; subtotal?: Nutrients; existingFoodIds: Set<string>; onEdit: (entry: MealEntry) => void; onDelete: (entry: MealEntry) => void; onShowDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onRecord: (type: MealType) => void }) {
  const sharedTime = entries[0]?.eatenAt
  return <div className="meal-group"><div className="meal-heading"><h3><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</h3><div className="meal-heading-actions"><span>{entries.length ? `${formatNutrient(subtotal?.energyKcal ?? null)} kcal` : '記録なし'}</span>{entries.length > 0 && <button type="button" className="small-action" onClick={() => onShowDetails(type, entries, subtotal ?? EMPTY_NUTRIENTS)}>詳細</button>}<button type="button" className="meal-record-button" onClick={() => onRecord(type)}>＋ 記録</button></div></div>{entries.length > 0 && type !== '間食' && <div className="meal-shared-time">食事時刻：{sharedTime ? formatTime(sharedTime) : '未設定'}</div>}{entries.map((entry) => <div className="meal-entry" key={entry.id}><div><strong>{entry.foodSnapshot.name}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}{existingFoodIds.has(entry.foodId) ? '' : ' · 削除済み食品'}</span></div><div className="meal-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b><button type="button" onClick={() => onEdit(entry)}>編集</button><button type="button" className="danger-text" onClick={() => onDelete(entry)}>削除</button></div></div>)}</div>
}

interface FoodsViewProps { recordingMealType: MealType | null; foods: Food[]; menus: Menu[]; menuSets: MenuSet[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onSelectFood: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEditFood: (food: Food) => void; onDeleteFood: (food: Food) => void; onOpenSearch?: () => void; onOpenScanner: () => void; onBack: () => void; backLabel: string; copyMealType: 'すべて' | MealType; setCopyMealType: (value: 'すべて' | MealType) => void; onCopyPrevious: () => void }
function FoodsView({ recordingMealType, foods, menus, menuSets, recentFoods, favoriteFoods, favoriteIds, onSelectFood, onToggleFavorite, onEditFood, onDeleteFood, onOpenSearch, onOpenScanner, onBack, backLabel, copyMealType, setCopyMealType, onCopyPrevious }: FoodsViewProps) {
  const selectable = Boolean(recordingMealType)
  return <><section className="page-heading food-screen-heading"><div><span className="eyebrow">{recordingMealType ? 'SELECT FOOD' : 'FOOD MASTER'}</span><h1>{recordingMealType ? `${recordingMealType}の食品を選ぶ` : '食品を登録・管理'}</h1>{!recordingMealType && <p className="muted">食品の編集・検索はこの画面で行います。新規登録は設定から行えます。</p>}</div><button className="button ghost" type="button" onClick={onBack}>{backLabel}</button></section><div className="action-row">{onOpenSearch && <button className="button primary" type="button" onClick={onOpenSearch}>⌕ 食品を検索</button>}<button className="button secondary" type="button" onClick={onOpenScanner}>▦ バーコード</button></div><div className="food-screen-sections">{selectable && <MenuFoodPicker menus={menus} menuSets={menuSets} foods={foods} onSelect={onSelectFood} />}<details className="section-block food-section-card food-quick-section food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">QUICK ADD</span><h2>すぐに記録</h2></div><span className="count-label quick-count">最近 {recentFoods.length} / お気に入り {favoriteFoods.length}</span></summary><div className="quick-groups">{recentFoods.length > 0 && <QuickFoodGroup title="最近使った食品" foods={recentFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} />}{<QuickFoodGroup title="お気に入り" foods={favoriteFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} />}</div>{recordingMealType && <section className="copy-panel quick-copy-panel"><div><strong>前日の食事をコピー</strong><span>当日の現在時刻で登録します</span></div><select value={copyMealType} onChange={(event) => setCopyMealType(event.target.value as 'すべて' | MealType)}><option>すべて</option>{MEAL_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button className="button ghost" type="button" onClick={onCopyPrevious}>コピー</button></section>}{!selectable && <p className="helper-text quick-mode-note">食事を記録するときは、「記録」で区分を先に選択してください。</p>}</details><details className="section-block food-section-card food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">FOODS</span><h2>食品</h2></div></summary><div className="food-results">{foods.slice(0, 50).map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={undefined} onAdd={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} onEdit={selectable ? undefined : onEditFood} onDelete={selectable ? undefined : onDeleteFood} />)}</div></details></div></>
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

function SearchResultsView({ groups, purpose, onSelect, onAddFood, onLoadMore, onBack }: { groups: SearchResultGroup[]; purpose: SearchPurpose; onSelect: (query: string, item: SearchResultItem) => void; onAddFood: (query: string) => void; onLoadMore: (index: number) => void; onBack: () => void }) {
  const helperText = purpose === 'food-master' ? '食品を選ぶと、登録内容を確認・編集できます。' : '食品を選ぶと、その検索結果リストだけ閉じます。'
  return <><section className="page-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h1>検索結果</h1><p className="muted">{helperText}</p></div><button className="button ghost" type="button" onClick={onBack}>← 検索画面へ</button></section><div className="search-result-groups">{groups.map((group, groupIndex) => <section className="search-result-group" key={`${group.query}:${groupIndex}`}><div className="search-result-heading"><strong>検索結果：</strong><span>{group.query}</span></div><div className="food-results">{group.items.map((item) => <button className="search-result-row" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(group.query, item)}><span className="source-badge">{item.kind === 'food' ? '食品' : item.kind === 'menu' ? 'メニュー' : 'セット'}</span><span className="search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small>{item.kind === 'food' && <span className="search-result-meta">{item.recentlyUsed && <em>最近使った</em>}{item.variants.length > 1 && <span>{item.variants.length}種類から選択</span>}</span>}</span><b>›</b></button>)}{group.items.length === 0 && <div className="search-empty-state"><p>一致する食品・メニューがありません。</p><button className="button secondary" type="button" onClick={() => onAddFood(group.query === '最近・お気に入り' ? '' : group.query)}>食品を追加</button></div>}{group.nextCursor && <button className="button secondary search-load-more" type="button" onClick={() => onLoadMore(groupIndex)}>さらに表示</button>}</div></section>)}{groups.length === 0 && <div className="empty-state">検索結果はありません。検索画面へ戻って再検索してください。</div>}</div></>
}

interface FoodVariantPickerModalProps {
  result: FoodSearchResult
  onSelect: (food: Food) => void
  onClose: () => void
  mealMode?: boolean
  onSubmitMeal?: (food: Food, amount: string) => void | Promise<void>
}

function FoodVariantPickerModal(props: FoodVariantPickerModalProps) {
  return hasMextFoodGroup(props.result.group.id)
    ? <MextFoodVariantPickerModal {...props} />
    : <LegacyFoodVariantPickerModal {...props} />
}

function MextFoodVariantPickerModal({ result, onSelect, onClose, mealMode = false, onSubmitMeal }: FoodVariantPickerModalProps) {
  const attributes = useMemo(() => getSelectableAttributes(result.group.id), [result.group.id])
  const visibleAttributes = useMemo(() => attributes.filter((attribute) => attribute.visibility !== 'hidden'), [attributes])
  const hiddenAttributes = useMemo(() => attributes.filter((attribute) => attribute.visibility === 'hidden'), [attributes])
  const supplementalFoods = useMemo(() => result.variants.filter((food) => !getFoodVariantBySourceId(food.id)), [result.variants])
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    const visibleAttributeIds = new Set(visibleAttributes.map((attribute) => attribute.id))
    return Object.fromEntries(Object.entries(getDefaultSelectedAttributes(result.group.id)).filter(([attributeId]) => visibleAttributeIds.has(attributeId)))
  })
  const [supplementalFoodId, setSupplementalFoodId] = useState<string | null>(null)
  const resolution = useMemo(() => {
    try {
      return { variant: resolveFoodVariantForUi(result.group.id, selection), error: null, requiresHiddenSelection: false }
    } catch (error) {
      if (error instanceof MissingRequiredAttribute) return { variant: null, error: '必要な属性を選択してください。', requiresHiddenSelection: false }
      if (error instanceof AmbiguousFoodVariant) return { variant: null, error: '食品を一意に決めるため、追加の属性を選択してください。', requiresHiddenSelection: true }
      return { variant: null, error: error instanceof Error ? error.message : '食品を決定できません。', requiresHiddenSelection: false }
    }
  }, [result.group.id, selection])
  const supplementalFood = supplementalFoods.find((food) => food.id === supplementalFoodId) ?? null
  const resolvedMextFood = resolution.variant
    ? result.variants.find((food) => food.id === resolution.variant?.sourceId) ?? null
    : null
  const selectedFood = supplementalFood ?? resolvedMextFood
  const attributesToShow = resolution.requiresHiddenSelection ? attributes : visibleAttributes
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  const selectedFoodName = supplementalFood ? (supplementalFood.officialName ?? supplementalFood.name) : resolution.variant?.sourceName
  const [amount, setAmount] = useState(selectedFoodDefaultAmount)
  useEffect(() => {
    setAmount(selectedFoodDefaultAmount)
  }, [selectedFoodDefaultAmount, selectedFoodId])

  const chooseAttribute = (attributeId: string, valueId: string, hidden: boolean) => {
    setSupplementalFoodId(null)
    setSelection((current) => {
      const next = { ...current, [attributeId]: valueId }
      if (!hidden) hiddenAttributes.forEach((attribute) => { delete next[attribute.id] })
      return next
    })
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品のバリエーションを選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">VARIATIONS</span><h2>{result.group.displayName}</h2><p className="muted">条件ごとに選択してください</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>{supplementalFoods.length > 0 && <div className="variant-choice-groups"><section className="variant-choice-group"><h3>手動登録食品</h3><div className="variant-choice-buttons">{supplementalFoods.map((food) => <button className={`variant-choice-button${supplementalFoodId === food.id ? ' is-selected' : ''}`} type="button" aria-pressed={supplementalFoodId === food.id} key={food.id} onClick={() => setSupplementalFoodId(food.id)}>{food.officialName ?? food.name}</button>)}</div></section></div>}{attributesToShow.length > 0 && <div className="variant-choice-groups">{attributesToShow.map((attribute) => <section className="variant-choice-group" key={attribute.id}><h3>{attribute.displayName}</h3><div className="variant-choice-buttons">{attribute.values.map((value) => <button className={`variant-choice-button${selection[attribute.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={selection[attribute.id] === value.id} key={`${attribute.id}:${value.id}`} onClick={() => chooseAttribute(attribute.id, value.id, attribute.visibility === 'hidden')}>{value.displayName}</button>)}</div></section>)}</div>}{selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{selectedFoodName}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}kcal</small></div> : <p className="variant-picker-no-match">{resolution.error}</p>}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span className="field-suffix">{selectedFood.baseUnit}</span></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByBaseAmount(Number(amount), selectedFood.baseAmount)))} aria-label={`分量を基準量1つ分（${selectedFood.baseAmount}${selectedFood.baseUnit}）増やす`}>＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount) }}>食事として登録</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

function LegacyFoodVariantPickerModal({ result, onSelect, onClose, mealMode = false, onSubmitMeal }: FoodVariantPickerModalProps) {
  const optionGroups = useMemo(() => getVariantOptionGroups(result.variants), [result.variants])
  const defaultVariant = result.variants.find((food) => food.id === result.group.defaultVariantId) ?? result.food
  const [selection, setSelection] = useState(() => getVariantSelection(defaultVariant, optionGroups))
  const [fallbackVariantId, setFallbackVariantId] = useState(defaultVariant.id)
  const [amount, setAmount] = useState(String(defaultVariant.servingAmount ?? defaultVariant.baseAmount))
  const fallbackGroup: VariantOptionGroup = useMemo(() => ({ key: 'variant', label: 'バリエーション', options: result.variants.map((food) => ({ value: food.id, label: variantOptionText(food) })) }), [result.variants])
  const groups = optionGroups.length > 0 ? optionGroups : [fallbackGroup]
  const matchingVariants = optionGroups.length > 0 ? filterVariantsBySelection(result.variants, selection) : result.variants.filter((food) => food.id === fallbackVariantId)
  const selectedFood = optionGroups.length > 0 ? resolveVariantForSelection(result.variants, selection, result.group.defaultVariantId) : matchingVariants[0] ?? null
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  useEffect(() => {
    if (selectedFoodId) setAmount(selectedFoodDefaultAmount)
  }, [selectedFoodDefaultAmount, selectedFoodId])
  const isSelected = (group: VariantOptionGroup, value: string | null) => group.key === 'variant' ? fallbackVariantId === value : selection[group.key] === value
  const chooseOption = (group: VariantOptionGroup, value: string | null) => {
    if (group.key === 'variant') setFallbackVariantId(value ?? '')
    else setSelection((current) => ({ ...current, [group.key]: value }))
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品のバリエーションを選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">VARIATIONS</span><h2>{result.group.displayName}</h2><p className="muted">条件ごとに選択してください</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="variant-choice-groups">{groups.map((group) => <section className="variant-choice-group" key={group.key}><h3>{group.label}</h3><div className="variant-choice-buttons">{group.options.map((option) => <button className={`variant-choice-button${isSelected(group, option.value) ? ' is-selected' : ''}`} type="button" aria-pressed={isSelected(group, option.value)} key={`${group.key}:${option.value ?? 'none'}`} onClick={() => chooseOption(group, option.value)}>{option.label}</button>)}</div></section>)}</div>{selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{variantOptionText(selectedFood)}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}kcal{matchingVariants.length > 1 ? ` · ${matchingVariants.length}件が該当` : ''}</small></div> : <p className="variant-picker-no-match">この組み合わせに該当する食品がありません。</p>}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span className="field-suffix">{selectedFood.baseUnit}</span></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByBaseAmount(Number(amount), selectedFood.baseAmount)))} aria-label={`分量を基準量1つ分（${selectedFood.baseAmount}${selectedFood.baseUnit}）増やす`}>＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount) }}>食事として登録</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

interface MenuViewProps { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onNewMenu: () => void; onEditMenu: (menu: Menu) => void; onDeleteMenu: (menu: Menu) => void; onNewMenuSet: () => void; onEditMenuSet: (menuSet: MenuSet) => void; onDeleteMenuSet: (menuSet: MenuSet) => void; onBack: () => void }
function MenuView({ menus, menuSets, foods, onNewMenu, onEditMenu, onDeleteMenu, onNewMenuSet, onEditMenuSet, onDeleteMenuSet }: MenuViewProps) {
  const foodName = (id: string) => {
    const food = foods.find((item) => item.id === id)
    return food ? displayFoodName(food) : '削除済み食品'
  }
  const menuName = (id: string) => menus.find((menu) => menu.id === id)?.name ?? '削除済みメニュー'
  const menuSetItems = (menuSet: MenuSet) => [...menuSet.menuIds.map(menuName), ...(menuSet.foodIds ?? []).map(foodName)]
  return <><section className="page-heading"><div><span className="eyebrow">MENUS</span><h1>メニュー</h1></div></section><div className="action-row"><button className="button primary" type="button" onClick={onNewMenu}>＋ 料理メニュー</button><button className="button secondary" type="button" onClick={onNewMenuSet}>＋ メニューセット</button></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">DISHES</span><h2>料理メニュー</h2></div><span className="count-label">{menus.length}件</span></div>{menus.length === 0 ? <div className="empty-state">料理メニューはまだありません。</div> : <div className="menu-list">{menus.map((menu) => <div className="menu-card" key={menu.id}><div><span className="source-badge">{menu.category}</span><strong>{menu.name}</strong><small>{menu.foodIds.length ? menu.foodIds.map(foodName).join('・') : '食材未選択'}</small></div><div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenu(menu)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenu(menu)}>削除</button></div></div>)}</div>}</section><section className="section-block"><div className="section-title"><div><span className="eyebrow">SETS</span><h2>メニューセット</h2></div><span className="count-label">{menuSets.length}件</span></div>{menuSets.length === 0 ? <div className="empty-state">メニューセットはまだありません。</div> : <div className="menu-list">{menuSets.map((menuSet) => { const items = menuSetItems(menuSet); return <div className="menu-card" key={menuSet.id}><div><span className="source-badge">セット</span><strong>{menuSet.name}</strong><small>{items.length ? items.join('・') : 'メニュー・食品未選択'}</small></div><div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenuSet(menuSet)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenuSet(menuSet)}>削除</button></div></div> })}</div>}</section></>
}

interface MenuFoodSelectionProps {
  selectedIds: string[]
  foods: Food[]
  recentFoods: Food[]
  favoriteFoods: Food[]
  favoriteIds: Set<string>
  onToggleFavorite: (food: Food) => void
  onAdd: (food: Food) => void
  onRemove: (food: Food) => void
}

function MenuFoodChoiceRow({ food, selected, favorite, onAdd, onToggleFavorite }: { food: Food; selected: boolean; favorite: boolean; onAdd: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(food)} disabled={selected}>{selected ? '追加済み' : '追加'}</button><button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button></div>
}

function MenuFoodSelection({ selectedIds, foods, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onAdd, onRemove }: MenuFoodSelectionProps) {
  const [foodQuery, setFoodQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [variantResult, setVariantResult] = useState<FoodSearchResult | null>(null)
  const normalizedQuery = normalizeSearchText(foodQuery)
  const selectedFoods = selectedIds.map((id) => foods.find((food) => food.id === id)).filter((food): food is Food => Boolean(food))
  const quickFoods = [...recentFoods, ...favoriteFoods].filter((food, index, all) => all.findIndex((item) => item.id === food.id) === index).slice(0, 8)

  const runSearch = async () => {
    const query = foodQuery.trim()
    if (!query) { setSearchedQuery(''); setSearchResults([]); return }
    setSearching(true)
    try {
      const { page } = await searchFoodResults(query, { limit: 20 })
      setSearchResults(page.results)
      setSearchedQuery(normalizeSearchText(query))
    } catch {
      setSearchResults([])
      setSearchedQuery(normalizeSearchText(query))
    } finally {
      setSearching(false)
    }
  }

  const showSearchResults = normalizedQuery.length > 0 && searchedQuery === normalizedQuery
  const chooseSearchResult = (result: FoodSearchResult) => {
    if (result.variants.length > 1) setVariantResult(result)
    else onAdd(result.food)
  }

  return (
    <div className="menu-food-selection">
      <div className="menu-selected-heading"><span>選択中の食材</span><span>{selectedFoods.length}件</span></div>
      {selectedFoods.length > 0
        ? <div className="menu-selected-foods">{selectedFoods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onRemove={onRemove} />)}</div>
        : <p className="menu-food-empty">まだ食材がありません。下の「食材を追加」から選択してください。</p>}
      <details className="food-collapsible menu-food-picker">
        <summary className="section-title collapsible-summary"><div><span className="eyebrow">FOODS</span><h3>食材を追加</h3></div></summary>
        <div className="menu-food-picker-body">
          <div className="menu-food-search-row">
            <label className="menu-food-search">食材を検索
              <input value={foodQuery} onChange={(event) => { setFoodQuery(event.target.value); setSearchedQuery('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder="食品名・メーカー" />
            </label>
            <button className="button secondary menu-food-search-button" type="button" onClick={() => void runSearch()} disabled={searching}>{searching ? '検索中…' : '検索する'}</button>
          </div>
          {showSearchResults ? (
            <>
              <div className="menu-food-section-heading"><span className="eyebrow">SEARCH RESULTS</span><h4>検索結果：{foodQuery.trim()}</h4></div>
              <div className="menu-food-search-results">
                {searchResults.length > 0
                  ? searchResults.map((result) => <button className="menu-food-search-result" type="button" key={result.group.id} onClick={() => chooseSearchResult(result)}><span className="source-badge">食品</span><span><strong>{displaySearchFoodName(result.group, result.food)}</strong><small>{result.group.category ?? '食品'} · {result.variants.length > 1 ? `${result.variants.length}バリエーション` : `${result.food.baseAmount}${result.food.baseUnit}`} · {formatNutrient(result.food.nutrients.energyKcal)}kcal</small></span><b>›</b></button>)
                  : <p className="menu-food-empty">検索に一致する食品がありません。</p>}
              </div>
            </>
          ) : (
            <>
              <div className="menu-food-quick">
                <div className="menu-food-section-heading"><span className="eyebrow">QUICK ADD</span><h4>最近・お気に入り</h4></div>
                {quickFoods.length > 0
                  ? <div className="menu-food-list">{quickFoods.map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIds.includes(food.id)} favorite={favoriteIds.has(food.id)} onAdd={onAdd} onToggleFavorite={onToggleFavorite} />)}</div>
                  : <p className="menu-food-empty">最近使った食品やお気に入りはありません。</p>}
              </div>
              <div className="menu-food-section-heading"><span className="eyebrow">FOODS</span><h4>食品</h4></div>
              <div className="menu-food-list">{foods.slice(0, 60).map((food) => <MenuFoodChoiceRow key={food.id} food={food} selected={selectedIds.includes(food.id)} favorite={favoriteIds.has(food.id)} onAdd={onAdd} onToggleFavorite={onToggleFavorite} />)}</div>
              {foods.length > 60 && <p className="menu-food-more">食品名を検索すると、続きの食品を表示できます。</p>}
            </>
          )}
        </div>
      </details>
      {variantResult && <FoodVariantPickerModal result={variantResult} onSelect={(food) => { onAdd(food); setVariantResult(null) }} onClose={() => setVariantResult(null)} />}
    </div>
  )
}

function MenuEditorModal({ draft, setDraft, foods, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onSubmit, onClose }: { draft: MenuDraft; setDraft: React.Dispatch<React.SetStateAction<MenuDraft | null>>; foods: Food[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => current && !current.foodIds.includes(food.id) ? { ...current, foodIds: [...current.foodIds, food.id] } : current)
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== food.id) } : current)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="料理メニューを設定"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">MENU</span><h2>{draft.id ? '料理メニューを編集' : '料理メニューを設定'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}><label>メニュー名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label><label>区分<select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as MenuCategory } : current)}>{MENU_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label>検索用エイリアス（任意）<input value={draft.aliases.join('、')} onChange={(event) => setDraft((current) => current ? { ...current, aliases: event.target.value.split(/[、,，]/).map((alias) => alias.trim()).filter(Boolean) } : current)} placeholder="例：おにぎり、朝ごはん" /></label><fieldset><legend>食材</legend><MenuFoodSelection selectedIds={draft.foodIds} foods={foods} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} onAdd={addFood} onRemove={removeFood} /></fieldset><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

function MenuSetEditorModal({ draft, setDraft, menus, foods, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onSubmit, onClose }: { draft: MenuSetDraft; setDraft: React.Dispatch<React.SetStateAction<MenuSetDraft | null>>; menus: Menu[]; foods: Food[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => current && !current.foodIds.includes(food.id) ? { ...current, foodIds: [...current.foodIds, food.id] } : current)
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== food.id) } : current)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="メニューセットを設定"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">MENU SET</span><h2>{draft.id ? 'メニューセットを編集' : 'メニューセットを設定'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}><label>セット名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label><fieldset><legend>まとめるメニュー</legend><div className="checkbox-list">{menus.length > 0 ? menus.map((menu) => <label className="checkbox-row" key={menu.id}><input type="checkbox" checked={draft.menuIds.includes(menu.id)} onChange={(event) => setDraft((current) => current ? { ...current, menuIds: event.target.checked ? [...current.menuIds, menu.id] : current.menuIds.filter((id) => id !== menu.id) } : current)} /><span>{menu.name}（{menu.category}）</span></label>) : <p className="empty-state">料理メニューがありません。</p>}</div></fieldset><fieldset><legend>食品</legend><MenuFoodSelection selectedIds={draft.foodIds} foods={foods} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} onAdd={addFood} onRemove={removeFood} /></fieldset><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
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
  return <>
    <section className="page-heading"><div><span className="eyebrow">SETTINGS</span><h1>設定・データ管理</h1></div></section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">GOALS</span><h2>栄養目標</h2></div></div>
      <form onSubmit={onSaveGoals} className="goal-form">
        {NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={goalInputs[key]} onChange={(event) => setGoalInputs((current) => ({ ...current, [key]: event.target.value }))} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}
        <button className="button primary" type="submit">目標を保存</button>
      </form>
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
        <div><strong>{counts.menus}</strong><span>料理メニュー</span></div>
        <div><strong>{counts.menuSets}</strong><span>メニューセット</span></div>
      </div>
      <p className="helper-text">最終バックアップ: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '未作成'}</p>
      <div className="settings-inline-row">
        <label className="toggle-row"><input type="checkbox" checked={settings.externalApiEnabled} onChange={(event) => onToggleExternalApi(event.target.checked)} />食品が見つからないときにOpen Food Factsを検索する</label>
        <InfoPopover className="settings-info" label="外部APIについて" text="外部APIにはバーコード番号のみを送り、取得値は確認後に保存します。通信失敗時は手入力へ進みます。" />
      </div>
      <div className="backup-actions">
        <button className="button primary" type="button" onClick={onExportJson}>JSONを出力</button>
        <label className="button secondary file-button">JSONを復元<input type="file" accept="application/json,.json" onChange={onRestoreJson} /></label>
        <InfoPopover className="settings-info" label="JSONバックアップについて" text="JSONには食品、食事記録、お気に入り、料理メニュー、メニューセット、設定を含めます。復元前には現在データを自動退避します。" />
      </div>
    </section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">CSV EXPORT / IMPORT</span><h2>食事履歴CSV</h2></div></div>
      <div className="date-range"><label>開始日<input type="date" value={csvFrom} onChange={(event) => setCsvFrom(event.target.value)} /></label><span>〜</span><label>終了日<input type="date" value={csvTo} onChange={(event) => setCsvTo(event.target.value)} /></label></div>
      <div className="csv-action-row">
        <button className="button secondary" type="button" onClick={onExportCsv}>CSVを出力</button>
        <label className="button secondary file-button csv-import-button">CSVを取り込む<input type="file" accept="text/csv,.csv" onChange={onImportCsv} /></label>
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

function MealModal({ food, amount, setAmount, editing, onSubmit, onClose }: { food: Food; amount: string; setAmount: (value: string) => void; editing: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const preview = calculateNutrients(food, Number(amount), food.baseUnit)
  const numericAmount = Number(amount)
  const canIncrement = !Number.isFinite(numericAmount) || numericAmount < 100000
  const incrementAmount = () => setAmount(String(incrementByBaseAmount(numericAmount, food.baseAmount)))
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を記録"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">ADD MEAL</span><h2>{editing ? '食事を編集' : '食事を記録'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="selected-food"><strong>{food.displayName ?? food.name}</strong><span>{food.maker || '一般食品'} · 基準量 {food.baseAmount}{food.baseUnit}</span></div><form onSubmit={onSubmit}><label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span className="field-suffix">{food.baseUnit}</span></div><button className="amount-increment" type="button" onClick={incrementAmount} disabled={!canIncrement} aria-label={`分量を基準量1つ分（${food.baseAmount}${food.baseUnit}）増やす`}>＋1</button></div></label><div className="preview-box calorie-preview"><div className="section-kicker">今回のカロリー</div><strong>{formatNutrient(preview.energyKcal)}<small> kcal</small></strong></div><button className="button primary full-width" type="submit">{editing ? '変更を保存' : '食事として登録'}</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

function MealDetailsModal({ details, goals, onUpdateTimes, onClose }: { details: { type: MealType; entries: MealEntry[]; subtotal: Nutrients }; goals: NutritionGoals; onUpdateTimes: (entryIds: string[], time: string) => void; onClose: () => void }) {
  const [sharedTime, setSharedTime] = useState(details.entries[0] ? toTokyoTimeInput(details.entries[0].eatenAt) : '')
  const [snackTimes, setSnackTimes] = useState<Record<string, string>>(() => Object.fromEntries(details.entries.map((entry) => [entry.id, toTokyoTimeInput(entry.eatenAt)])))
  const sharedEntryIds = details.entries.map((entry) => entry.id)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${details.type}の栄養詳細`}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">NUTRIENTS</span><h2>{details.type}の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(details.subtotal.energyKcal)}<small> kcal</small></strong></div><NutrientGoalGraphs nutrients={details.subtotal} goals={goals} /><section className="meal-time-editor"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h3>食事時刻</h3></div></div>{details.type !== '間食' ? <form className="inline-time-form" onSubmit={(event) => { event.preventDefault(); onUpdateTimes(sharedEntryIds, sharedTime) }}><label><input aria-label="食事時刻" type="time" value={sharedTime} onChange={(event) => setSharedTime(event.target.value)} required /></label><button className="button secondary" type="submit">時刻を保存</button></form> : <div className="snack-time-list">{details.entries.map((entry) => <div className="snack-time-row" key={entry.id}><span>{entry.foodSnapshot.name}</span><input type="time" value={snackTimes[entry.id] ?? ''} onChange={(event) => setSnackTimes((current) => ({ ...current, [entry.id]: event.target.value }))} /><button className="small-action" type="button" onClick={() => onUpdateTimes([entry.id], snackTimes[entry.id] ?? '')}>保存</button></div>)}</div>}</section><div className="detail-entry-list">{details.entries.map((entry) => <div className="detail-entry" key={entry.id}><span>{entry.foodSnapshot.name} · {entry.amount}{entry.amountUnit}</span><strong>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</strong></div>)}</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}

function FoodFormView({ draft, returnView, setDraft, foodGroups, foodAliases, foodRelatedTerms, externalNote, onSubmit, onClose }: { draft: FoodDraft; returnView: FoodFormReturnView; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; foodGroups: FoodGroup[]; foodAliases: FoodAlias[]; foodRelatedTerms: FoodRelatedTerm[]; externalNote: string | null; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const update = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current)
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
  return <><section className="page-heading food-form-heading"><div><span className="eyebrow">FOOD MASTER</span><h1>{draft.id ? '食品を編集' : '新しい食品を登録'}</h1></div><button className="button ghost" type="button" onClick={onClose}>{returnView === 'settings' ? '← 設定へ' : '← 食品画面へ'}</button></section><section className="settings-card food-form-card">{externalNote && <div className="external-warning">{externalNote}</div>}<form onSubmit={onSubmit}>
    <label>食品名*<input value={draft.name} onChange={(event) => update('name', event.target.value)} required /></label>
    <label>メーカー<input value={draft.maker} onChange={(event) => update('maker', event.target.value)} /></label>
    <label>バーコード（JAN/GTIN）<input inputMode="numeric" value={draft.barcode} onChange={(event) => update('barcode', event.target.value)} placeholder="任意・8〜14桁" /></label>
    <fieldset><legend>検索用 family</legend>
      <label>所属するfamily<select value={draft.foodGroupId} onChange={(event) => selectFamily(event.target.value)}><option value="">新しいfamilyを作成</option>{foodGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName}{group.needsReview ? '（要確認）' : ''}</option>)}</select></label>
      <label>表示名*<input value={draft.groupDisplayName} onChange={(event) => update('groupDisplayName', event.target.value)} placeholder="検索結果に表示する名前" required /></label>
      <div className="two-fields"><label>読み仮名<input value={draft.groupReading} onChange={(event) => update('groupReading', event.target.value)} placeholder="ひらがな" /></label><label>食品区分<input value={draft.groupCategory} onChange={(event) => update('groupCategory', event.target.value)} placeholder="例：主菜" /></label></div>
      <div className="metadata-editor"><div className="metadata-editor-heading"><strong>別名</strong><button className="small-action" type="button" onClick={addAlias}>＋追加</button></div>{draft.aliases.map((alias, index) => <div className="metadata-input-row" key={`${index}:${alias.value}`}><input value={alias.value} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="例：とりむね" /><select value={alias.type} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FoodAliasType } : item))}><option value="synonym">通称</option><option value="reading">読み</option><option value="abbreviation">略称</option></select><button className="small-action danger-text" type="button" onClick={() => update('aliases', draft.aliases.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
      <div className="metadata-editor"><div className="metadata-editor-heading"><strong>関連語</strong><button className="small-action" type="button" onClick={addRelatedTerm}>＋追加</button></div>{draft.relatedTerms.map((term, index) => <div className="metadata-input-row" key={`${index}:${term}`}><input value={term} onChange={(event) => update('relatedTerms', draft.relatedTerms.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="同じ食品ではないが関連する語" /><button className="small-action danger-text" type="button" onClick={() => update('relatedTerms', draft.relatedTerms.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
    </fieldset>
    <fieldset><legend>バリエーション属性</legend><p className="helper-text">食品の状態・分量の選択肢として表示する属性です。空欄は指定なしで保存します。</p><div className="two-fields variant-attribute-inputs">{variantAttributeKeys.map((key) => <label key={key}>{variantAttributeLabels[key]}<input value={draft.variantAttributes[key]} onChange={(event) => update('variantAttributes', { ...draft.variantAttributes, [key]: event.target.value })} placeholder="任意" /></label>)}</div></fieldset>
    <div className="two-fields"><label>基準量*<input type="number" min="0.01" step="any" value={draft.baseAmount} onChange={(event) => update('baseAmount', event.target.value)} required /></label><label>基準単位*<select value={draft.baseUnit} onChange={(event) => update('baseUnit', event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
    <div className="two-fields"><label>既定量<input type="number" min="0.01" step="any" value={draft.servingAmount} onChange={(event) => update('servingAmount', event.target.value)} placeholder="任意" /></label><label>既定単位<select value={draft.servingUnit} onChange={(event) => update('servingUnit', event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
    <fieldset><legend>栄養値（基準量あたり）</legend><div className="nutrient-input-grid">{NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={draft.nutrients[key]} onChange={(event) => update('nutrients', { ...draft.nutrients, [key]: event.target.value })} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}</div></fieldset>
    <p className="source-line">出典: {draft.sourceVersion}（保存前に内容を確認してください）</p><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
  </form></section></>
}

function FoodMenuSelection({ draft, setDraft, menus }: { draft: FoodDraft; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; menus: Menu[] }) {
  return <section className="settings-card food-menu-selection"><div className="section-title"><div><span className="eyebrow">MENU LINK</span><h2>メニューから選択</h2></div><span className="count-label">任意</span></div><p className="helper-text">この食品を料理メニューに紐づけます。複数選択できます。</p>{menus.length === 0 ? <div className="empty-state">メニュータブで料理メニューを先に設定してください。</div> : <div className="checkbox-list">{menus.map((menu) => <label className="checkbox-row" key={menu.id}><input type="checkbox" checked={draft.menuIds.includes(menu.id)} onChange={(event) => setDraft((current) => current ? { ...current, menuIds: event.target.checked ? [...current.menuIds, menu.id] : current.menuIds.filter((id) => id !== menu.id) } : current)} /><span>{menu.name}（{menu.category}）</span></label>)}</div>}</section>
}

export default App
