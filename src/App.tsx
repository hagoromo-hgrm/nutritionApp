import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  createNewFoodId,
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
  getFavoriteFoods,
  getFavoriteIds,
  getFoodByBarcode,
  getRecentFoods,
  getSettings,
  initializeDatabase,
  replaceAllData,
  saveFood,
  saveMealEntries,
  saveMealEntry,
  saveMenu,
  saveMenuSet,
  saveSettings,
  searchFoods,
  searchMenus,
  searchMenuSets,
  setFavorite,
} from './db/db'
import { searchExternalFood, type ExternalFoodPreview } from './services/externalFoodApi'
import { backupToJson, downloadBlob, parseBackupText } from './services/backup'
import { mealsToCsv } from './services/csv'
import { calculateBmi, calculateNutrients, estimateDailyGoals, formatNutrient, goalRate, nutrientRangeForGoals, scaleNutritionGoals, sumByMealType, sumEntries, sumNutrients } from './services/nutrition'
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
import { addDays, currentDateKey, currentMonthRange, formatDateKey, formatDateTime, formatFileTimestamp, isoFromTokyoTimeInput, toTokyoTimeInput, formatTime } from './utils/date'
import { isPositiveFinite, isValidBarcode, isValidUnit } from './utils/validation'
import './styles.css'

const BarcodeScanner = lazy(() => import('./components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })))

type View = 'today' | 'graphs' | 'food-screen' | 'food-form' | 'settings' | 'menus' | 'search-input' | 'search-results'
type FoodFormReturnView = 'food-screen' | 'settings'

interface SearchResultItem {
  id: string
  kind: 'food' | 'menu' | 'set'
  title: string
  subtitle: string
  food: Food
}

interface SearchResultGroup {
  query: string
  items: SearchResultItem[]
}

interface MenuDraft {
  id: string | null
  name: string
  category: MenuCategory
  foodIds: string[]
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
  nutrients: Record<NutrientKey, string>
}

const MEAL_ICON_ASSETS: Record<MealType, string> = {
  朝食: '/assets/meal-icon-breakfast.png',
  昼食: '/assets/meal-icon-lunch.png',
  夕食: '/assets/meal-icon-dinner.png',
  間食: '/assets/meal-icon-snack.png',
}

const nutrientKeys = [...NUTRIENT_KEYS]
const emptyNutrientInputs = (): Record<NutrientKey, string> => Object.fromEntries(nutrientKeys.map((key) => [key, ''])) as Record<NutrientKey, string>

function emptyFoodDraft(barcode = ''): FoodDraft {
  return {
    id: null, name: '', maker: '', barcode, source: 'user', sourceVersion: 'ユーザー入力',
    baseAmount: '100', baseUnit: 'g', servingAmount: '', servingUnit: 'g', menuIds: [], nutrients: emptyNutrientInputs(),
  }
}

function bodyProfileToDraft(profile: BodyProfile | undefined): BodyProfileDraft {
  const current = profile ?? DEFAULT_BODY_PROFILE
  return {
    heightCm: current.heightCm === null ? '' : String(current.heightCm), weightKg: current.weightKg === null ? '' : String(current.weightKg),
    ageYears: current.ageYears === null ? '' : String(current.ageYears), sex: current.sex, activityLevel: current.activityLevel,
  }
}

function foodToDraft(food: Food): FoodDraft {
  return {
    id: food.id, name: food.name, maker: food.maker, barcode: food.barcode, source: food.source,
    sourceVersion: food.sourceVersion, baseAmount: String(food.baseAmount), baseUnit: food.baseUnit,
    servingAmount: food.servingAmount === null ? '' : String(food.servingAmount), servingUnit: food.servingUnit ?? food.baseUnit,
    menuIds: food.menuIds ?? [],
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, food.nutrients[key] === null ? '' : String(food.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function previewToDraft(preview: ExternalFoodPreview): FoodDraft {
  return {
    ...emptyFoodDraft(preview.barcode), name: preview.name, maker: preview.maker, source: 'open_food_facts',
    sourceVersion: 'Open Food Facts（取得値は確認後に保存）', baseAmount: String(preview.baseAmount), baseUnit: preview.baseUnit,
    servingAmount: '', servingUnit: preview.baseUnit, menuIds: [],
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, preview.nutrients[key] === null ? '' : String(preview.nutrients[key])])) as Record<NutrientKey, string>,
  }
}

function snapshotToFood(entry: MealEntry): Food {
  return {
    id: entry.foodId, name: entry.foodSnapshot.name, maker: entry.foodSnapshot.maker, barcode: entry.foodSnapshot.barcode,
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
  return food.maker ? `${food.name}（${food.maker}）` : food.name
}

function menuIngredientNames(menu: Menu, foods: Food[]): string {
  return menu.foodIds
    .map((foodId) => foods.find((food) => food.id === foodId)?.name)
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
  const [foodFormReturnView, setFoodFormReturnView] = useState<FoodFormReturnView>('settings')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [foodDraft, setFoodDraft] = useState<FoodDraft | null>(null)
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
      const [dateEntries, rangeEntries, resultFoods, recent, favorites, ids, currentSettings, foodCount, mealCount, menuCount, menuSetCount, foodKeys, resultMenus, resultMenuSets] = await Promise.all([
        getEntriesForDate(selectedDate), trendEntriesPromise, getAllFoods(), getRecentFoods(), getFavoriteFoods(), getFavoriteIds(),
        getSettings(), db.foods.count(), db.mealEntries.count(), db.menus.count(), db.menuSets.count(), db.foods.toCollection().primaryKeys(), getAllMenus(), getAllMenuSets(),
      ])
      setEntries(dateEntries)
      setTrendEntries(rangeEntries)
      setFoods(resultFoods)
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
    setMealTypePicker({ food })
  }

  const openFoodForm = (food?: Food, barcode = '', returnView: FoodFormReturnView = 'settings') => {
    setExternalNote(null)
    setFoodDraft(food ? foodToDraft(food) : emptyFoodDraft(barcode))
    setFoodFormReturnView(returnView)
    setView('food-form')
    setError(null)
  }

  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    const normalized = barcode.trim()
    setShowScanner(false)
    try {
      const local = await getFoodByBarcode(normalized)
      if (local) {
        if (recordingMealType) {
          openMealForm(local, undefined, recordingMealType)
        } else {
          setMealTypePicker({ food: local })
        }
        notify('端末内の食品を見つけました。分量を入力してください。')
        return
      }
      if (settings?.externalApiEnabled) {
        try {
          const preview = await searchExternalFood(normalized, settings.externalApiEndpoint)
          if (preview) {
            setExternalNote('Open Food Factsの取得値です。栄養成分表示と照合してから保存してください。')
            setFoodDraft(previewToDraft(preview))
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
      openFoodForm(undefined, normalized, 'food-screen')
    } catch {
      showError('バーコード検索に失敗しました。番号を確認して再試行してください。')
    }
  }, [notify, openMealForm, recordingMealType, settings])

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
      const food: Food = {
        id: foodDraft.id ?? createNewFoodId(), name: foodDraft.name.trim(), maker: foodDraft.maker.trim(), barcode: foodDraft.barcode.trim(),
        source: foodDraft.source, sourceVersion: foodDraft.sourceVersion || 'ユーザー入力', baseAmount, baseUnit: foodDraft.baseUnit,
        servingAmount, servingUnit: servingAmount === null ? null : foodDraft.servingUnit, menuIds: foodDraft.menuIds, nutrients,
        createdAt: foodDraft.id ? (foods.find((item) => item.id === foodDraft.id)?.createdAt ?? now) : now, updatedAt: now,
      }
      await saveFood(food)
      setFoodDraft(null)
      setView(foodFormReturnView)
      await load()
      notify(foodDraft.id ? '食品を更新しました。' : '食品を登録しました。')
    } catch {
      showError('食品を保存できませんでした。入力を確認して再試行してください。')
    }
  }

  const saveMeal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mealFood) return
    const amount = Number(mealAmount)
    if (!isPositiveFinite(amount) || amount > 100000) { showError('分量は0より大きく、現実的な範囲の数値で入力してください。'); return }
    const calculated = calculateNutrients(mealFood, amount, mealFood.baseUnit)
    const currentMealTime = entries.find((current) => current.mealType === mealType)?.eatenAt
    const eatenAt = editingEntry
      ? (mealType === '間食' ? editingEntry.eatenAt : (currentMealTime ?? editingEntry.eatenAt))
      : isoForDate(selectedDate)
    const entry: MealEntry = {
      id: editingEntry?.id ?? createNewMealId(), eatenAt, mealType,
      foodId: mealFood.id, foodSnapshot: {
        name: mealFood.name, maker: mealFood.maker, barcode: mealFood.barcode, baseAmount: mealFood.baseAmount,
        baseUnit: mealFood.baseUnit, nutrients: { ...mealFood.nutrients },
      }, amount, amountUnit: mealFood.baseUnit, calculatedNutrients: calculated,
    }
    try {
      const entriesToSave = mealType === '間食'
        ? [entry]
        : [entry, ...entries.filter((current) => current.mealType === mealType && current.id !== entry.id).map((current) => ({ ...current, eatenAt }))]
      await saveMealEntries(entriesToSave)
      if (pendingSearchQuery) {
        setSearchResults((current) => current.filter((group) => group.query !== pendingSearchQuery))
        setPendingSearchQuery(null)
      }
      setMealFood(null)
      setEditingEntry(null)
      setRecordingMealType(null)
      setView('today')
      await load()
      notify(editingEntry ? '食事記録を更新しました。' : '食事を記録しました。')
    } catch {
      showError('食事を保存できませんでした。保存先の空き容量を確認して再試行してください。')
    }
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

  const openSearchInput = () => {
    setSearchBars([''])
    setSearchResults([])
    setPendingSearchQuery(null)
    setView('search-input')
  }

  const searchFoodsAndMenus = async () => {
    const queries = searchBars.map((query) => query.trim()).filter(Boolean)
    if (queries.length === 0) { showError('検索語句を1つ以上入力してください。'); return }
    try {
      const groups = await Promise.all(queries.map(async (query) => {
        const [resultFoods, resultMenus, resultMenuSets] = await Promise.all([searchFoods(query), searchMenus(query), searchMenuSets(query)])
        const items: SearchResultItem[] = [
          ...resultFoods.map((food) => ({ id: food.id, kind: 'food' as const, title: displayFoodName(food), subtitle: `${food.maker || '一般食品'} · ${food.baseAmount}${food.baseUnit} · ${formatNutrient(food.nutrients.energyKcal)}kcal`, food })),
          ...resultMenus.map((menu) => ({ id: menu.id, kind: 'menu' as const, title: menu.name, subtitle: `メニュー · ${menu.category} · 食材: ${menuIngredientNames(menu, foods) || '未登録'}`, food: menuToFood(menu, foods) })),
          ...resultMenuSets.map((menuSet) => ({ id: menuSet.id, kind: 'set' as const, title: menuSet.name, subtitle: 'メニューセット', food: menuSetToFood(menuSet, menus, foods) })),
        ]
        return { query, items }
      }))
      setSearchResults(groups)
      setView('search-results')
      setError(null)
    } catch {
      showError('検索に失敗しました。検索語句を確認して再試行してください。')
    }
  }

  const handleSearchResultSelect = (groupQuery: string, item: SearchResultItem) => {
    setPendingSearchQuery(groupQuery)
    if (recordingMealType) openMealForm(item.food, undefined, recordingMealType)
    else setMealTypePicker({ food: item.food })
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
      notify(`復元しました。食品${backup.foods.length}件、食事${backup.mealEntries.length}件です。自動退避も出力しました。`)
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

  const removeFood = async (food: Food) => {
    if (!window.confirm(`「${displayFoodName(food)}」を食品マスターから削除しますか？食事履歴は残ります。`)) return
    try { await deleteFood(food.id); await load(); notify('食品を削除しました。食事履歴はスナップショットで残っています。') } catch { showError('食品を削除できませんでした。') }
  }

  if (!ready || !settings) return <div className="loading-screen"><div className="brand-mark">N</div><p>Nutritionを準備しています…</p></div>

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><div className="brand-mark">N</div><div><strong>Nutrition</strong><span>日々の記録を、軽やかに。</span></div></div>
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
        {view === 'food-screen' && <FoodsView recordingMealType={recordingMealType} foods={foods} menus={menus} menuSets={menuSets} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onSelectFood={handleFoodSelection} onToggleFavorite={toggleFavorite} onEditFood={(food) => openFoodForm(food, '', 'food-screen')} onDeleteFood={removeFood} onOpenSearch={recordingMealType ? openSearchInput : undefined} onOpenScanner={() => setShowScanner(true)} onBack={() => { setRecordingMealType(null); setView('today') }} copyMealType={copyMealType} setCopyMealType={setCopyMealType} onCopyPrevious={copyPreviousMeals} />}
        {view === 'food-form' && foodDraft && <><FoodFormView draft={foodDraft} returnView={foodFormReturnView} setDraft={setFoodDraft} externalNote={externalNote} onSubmit={saveFoodDraft} onClose={() => { setFoodDraft(null); setView(foodFormReturnView) }} /><FoodMenuSelection draft={foodDraft} setDraft={setFoodDraft} menus={menus} /></>}
        {view === 'settings' && <><SettingsView settings={settings} goalInputs={goalInputs} setGoalInputs={setGoalInputs} onSaveGoals={saveGoals} onToggleExternalApi={toggleExternalApi} onChangeDefaultMealTimeMode={changeDefaultMealTimeMode} onExportJson={exportJson} onRestoreJson={restoreJson} onExportCsv={exportCsv} csvFrom={csvFrom} csvTo={csvTo} setCsvFrom={setCsvFrom} setCsvTo={setCsvTo} counts={counts} /><SettingsExtras bodyProfileInputs={bodyProfileInputs} setBodyProfileInputs={setBodyProfileInputs} onSaveBodyProfile={saveBodyProfile} onOpenNewFood={() => openFoodForm(undefined, '', 'settings')} estimatedGoals={estimateDailyGoals(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} bmi={calculateBmi(settings.bodyProfile ?? DEFAULT_BODY_PROFILE)} /></>}
        {view === 'menus' && <MenuView menus={menus} menuSets={menuSets} foods={foods} onNewMenu={() => setMenuDraft({ id: null, name: '', category: '主菜', foodIds: [] })} onEditMenu={(menu) => setMenuDraft({ id: menu.id, name: menu.name, category: menu.category, foodIds: menu.foodIds })} onDeleteMenu={removeMenu} onNewMenuSet={() => setMenuSetDraft({ id: null, name: '', menuIds: [], foodIds: [] })} onEditMenuSet={(menuSet) => setMenuSetDraft({ id: menuSet.id, name: menuSet.name, menuIds: menuSet.menuIds, foodIds: menuSet.foodIds ?? [] })} onDeleteMenuSet={removeMenuSet} onBack={() => setView('today')} />}
        {view === 'search-input' && <SearchInputView bars={searchBars} setBars={setSearchBars} onSearch={() => void searchFoodsAndMenus()} onBack={() => setView('food-screen')} />}
        {view === 'search-results' && <SearchResultsView groups={searchResults} onSelect={handleSearchResultSelect} onAddFood={() => openFoodForm(undefined, '', 'food-screen')} onBack={() => setView('search-input')} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavButton active={view === 'today'} onClick={() => { setRecordingMealType(null); setView('today') }} icon="◷" iconClass="today-icon" label="記録" />
        <NavButton active={view === 'graphs'} onClick={() => { setRecordingMealType(null); setView('graphs') }} icon="↗" iconClass="graphs-icon" label="グラフ" />
        <NavButton active={view === 'menus'} onClick={() => { setRecordingMealType(null); setView('menus') }} icon="menu-grid" iconClass="menu-grid-icon" label="メニュー" />
        <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" iconClass="settings-icon" label="設定" />
      </nav>

      {view === 'today' && <button className="floating-add" type="button" onClick={openMealTypePicker} aria-label="食事を追加">＋</button>}

      {mealTypePicker && <MealTypePickerModal food={mealTypePicker.food} recordedMealTypes={recordedMealTypes} onSelect={chooseMealType} onClose={() => setMealTypePicker(null)} />}
      {mealFood && <MealModal food={mealFood} amount={mealAmount} setAmount={setMealAmount} editing={Boolean(editingEntry)} onSubmit={saveMeal} onClose={() => { setMealFood(null); setEditingEntry(null); setRecordingMealType(null) }} />}
      {mealDetails && <MealDetailsModal details={mealDetails} goals={scaleNutritionGoals(settings.goals, 1 / 3)} onUpdateTimes={updateMealTimes} onClose={() => setMealDetails(null)} />}
      {showTodayDetails && <TodayDetailsModal total={total} goals={settings.goals} entries={entries} subtotals={subtotals} onClose={() => setShowTodayDetails(false)} />}
      {menuDraft && <MenuEditorModal draft={menuDraft} setDraft={setMenuDraft} foods={foods} onSubmit={saveMenuDraft} onClose={() => setMenuDraft(null)} />}
      {menuSetDraft && <MenuSetEditorModal draft={menuSetDraft} setDraft={setMenuSetDraft} menus={menus} foods={foods} onSubmit={saveMenuSetDraft} onClose={() => setMenuSetDraft(null)} />}
      {showScanner && <Suspense fallback={<div className="modal-backdrop"><section className="modal-card"><p>バーコード画面を準備しています…</p></section></div>}><BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setShowScanner(false)} /></Suspense>}
    </div>
  )
}

interface NavButtonProps { active: boolean; onClick: () => void; icon: string; iconClass?: string; label: string }
function NavButton({ active, onClick, icon, iconClass, label }: NavButtonProps) {
  return <button type="button" className={`nav-item${active ? ' active' : ''}`} onClick={onClick}><span className={iconClass}>{icon === 'menu-grid' ? <span className="menu-grid-table" aria-hidden="true"><i /><i /><i /><i /></span> : icon}</span>{label}</button>
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

function NutrientGoalGraphs({ nutrients, goals, subtotals, colorByMeal = false, dark = false, excludeEnergy = false }: { nutrients: Nutrients; goals: NutritionGoals; subtotals?: Record<string, Nutrients>; colorByMeal?: boolean; dark?: boolean; excludeEnergy?: boolean }) {
  const keys = excludeEnergy ? NUTRIENT_KEYS.filter((key) => key !== 'energyKcal') : NUTRIENT_KEYS
  return <div className="goal-progress-list">{keys.map((key) => <GoalProgressBar key={key} label={NUTRIENT_LABELS[key]} value={nutrients[key]} goal={goals[key]} unit={NUTRIENT_UNITS[key]} range={nutrientRangeForGoals(goals, key)} colorClass={dark ? 'goal-progress-light' : undefined} dark={dark} segments={colorByMeal && subtotals ? MEAL_TYPES.map((type) => ({ type, value: subtotals[type]?.[key] ?? 0 })).filter((segment) => segment.value > 0) : undefined} />)}</div>
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

function TodayDetailsModal({ total, goals, entries, subtotals, onClose }: { total: Nutrients; goals: NutritionGoals; entries: MealEntry[]; subtotals: Record<string, Nutrients>; onClose: () => void }) {
  const calorieSegments = MEAL_TYPES.map((type) => ({ type, value: subtotals[type]?.energyKcal ?? 0 })).filter((segment) => segment.value > 0)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="今日の栄養詳細"><section className="modal-card today-details-modal"><div className="modal-heading"><div><span className="eyebrow">TODAY DETAILS</span><h2>今日の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><GoalProgressBar label="カロリー" value={total.energyKcal} goal={goals.energyKcal} unit="kcal" range={nutrientRangeForGoals(goals, 'energyKcal')} segments={calorieSegments} /><NutrientGoalGraphs nutrients={total} goals={goals} subtotals={subtotals} colorByMeal excludeEnergy /><div className="today-detail-count">食事記録 {entries.length}件</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}

function QuickFoodGroup({ title, foods, favoriteIds, onSelect, onToggleFavorite }: { title: string; foods: Food[]; favoriteIds: Set<string>; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="quick-group"><h3>{title}</h3>{foods.length > 0 ? <div className="quick-list">{foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />)}</div> : <p className="quick-empty-inline">まだお気に入りがありません。食品の☆から追加できます。</p>}</div>
}

function FoodRow({ food, favorite, onSelect, onToggleFavorite, onEdit, onDelete }: { food: Food; favorite: boolean; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEdit?: (food: Food) => void; onDelete?: (food: Food) => void }) {
  return <div className="food-row">{onSelect ? <button type="button" className="food-main" onClick={() => onSelect(food)}><strong>{food.name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></button> : <div className="food-main static"><strong>{food.name}</strong><span>{food.maker || '一般食品'} · {food.baseAmount}{food.baseUnit} · {formatNutrient(food.nutrients.energyKcal)}kcal</span></div>}<button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button>{onEdit && <button type="button" className="small-action" onClick={() => onEdit(food)}>編集</button>}{onDelete && <button type="button" className="small-action danger-text" onClick={() => onDelete(food)}>削除</button>}</div>
}

function MenuFoodPicker({ menus, menuSets, foods, onSelect }: { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onSelect: (food: Food) => void }) {
  const categoryGroups = MENU_CATEGORIES.map((category) => ({ category, menus: menus.filter((menu) => menu.category === category) }))
  return <details className="section-block menu-picker-section food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">MENUS</span><h2>メニューから探す</h2></div></summary><div className="menu-picker-groups">{categoryGroups.map(({ category, menus: categoryMenus }) => <details className="menu-picker-group" key={category}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{category}</span><small>{categoryMenus.length > 0 ? `${categoryMenus.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{categoryMenus.length > 0 ? categoryMenus.map((menu) => { const food = menuToFood(menu, foods); return <button className="menu-picker-row" type="button" key={menu.id} onClick={() => onSelect(food)}><span className="source-badge">料理</span><span className="menu-picker-copy"><strong>{menu.name}</strong><small>{menu.foodIds.length}食材 · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button> }) : <p className="menu-picker-empty">この区分に登録されたメニューはありません。</p>}</div></details>)}{<details className="menu-picker-group"><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />セット</span><small>{menuSets.length > 0 ? `${menuSets.length}件` : '登録なし'}</small></summary><div className="menu-picker-list">{menuSets.length > 0 ? menuSets.map((menuSet) => { const food = menuSetToFood(menuSet, menus, foods); return <button className="menu-picker-row" type="button" key={menuSet.id} onClick={() => onSelect(food)}><span className="source-badge">セット</span><span className="menu-picker-copy"><strong>{menuSet.name}</strong><small>料理・食品をまとめて · {formatNutrient(food.nutrients.energyKcal)}kcal</small></span><b>›</b></button> }) : <p className="menu-picker-empty">セットはまだ登録されていません。</p>}</div></details>}</div></details>
}

function MealGroup({ type, entries, subtotal, existingFoodIds, onEdit, onDelete, onShowDetails, onRecord }: { type: MealType; entries: MealEntry[]; subtotal?: Nutrients; existingFoodIds: Set<string>; onEdit: (entry: MealEntry) => void; onDelete: (entry: MealEntry) => void; onShowDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onRecord: (type: MealType) => void }) {
  const sharedTime = entries[0]?.eatenAt
  return <div className="meal-group"><div className="meal-heading"><h3><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</h3><div className="meal-heading-actions"><span>{entries.length ? `${formatNutrient(subtotal?.energyKcal ?? null)} kcal` : '記録なし'}</span>{entries.length > 0 && <button type="button" className="small-action" onClick={() => onShowDetails(type, entries, subtotal ?? EMPTY_NUTRIENTS)}>詳細</button>}<button type="button" className="meal-record-button" onClick={() => onRecord(type)}>＋ 記録</button></div></div>{entries.length > 0 && type !== '間食' && <div className="meal-shared-time">食事時刻：{sharedTime ? formatTime(sharedTime) : '未設定'}</div>}{entries.map((entry) => <div className="meal-entry" key={entry.id}><div><strong>{entry.foodSnapshot.name}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}{existingFoodIds.has(entry.foodId) ? '' : ' · 削除済み食品'}</span></div><div className="meal-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b><button type="button" onClick={() => onEdit(entry)}>編集</button><button type="button" className="danger-text" onClick={() => onDelete(entry)}>削除</button></div></div>)}</div>
}

interface FoodsViewProps { recordingMealType: MealType | null; foods: Food[]; menus: Menu[]; menuSets: MenuSet[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onSelectFood: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEditFood: (food: Food) => void; onDeleteFood: (food: Food) => void; onOpenSearch?: () => void; onOpenScanner: () => void; onBack: () => void; copyMealType: 'すべて' | MealType; setCopyMealType: (value: 'すべて' | MealType) => void; onCopyPrevious: () => void }
function FoodsView({ recordingMealType, foods, menus, menuSets, recentFoods, favoriteFoods, favoriteIds, onSelectFood, onToggleFavorite, onEditFood, onDeleteFood, onOpenSearch, onOpenScanner, onBack, copyMealType, setCopyMealType, onCopyPrevious }: FoodsViewProps) {
  const selectable = Boolean(recordingMealType)
  return <><section className="page-heading food-screen-heading"><div><span className="eyebrow">{recordingMealType ? 'SELECT FOOD' : 'FOOD MASTER'}</span><h1>{recordingMealType ? `${recordingMealType}の食品を選ぶ` : '食品を登録・管理'}</h1><p className="muted">{recordingMealType ? '記録する食品を選択してください。' : '食品の編集・検索はこの画面で行います。新規登録は設定から行えます。'}</p></div><button className="button ghost" type="button" onClick={onBack}>← 記録</button></section><div className="action-row">{onOpenSearch && <button className="button primary" type="button" onClick={onOpenSearch}>⌕ 食品を検索</button>}<button className="button secondary" type="button" onClick={onOpenScanner}>▦ バーコード</button></div>{selectable && <MenuFoodPicker menus={menus} menuSets={menuSets} foods={foods} onSelect={onSelectFood} />}<details className="section-block food-quick-section food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">QUICK ADD</span><h2>すぐに記録</h2></div><span className="count-label quick-count">最近 {recentFoods.length} / お気に入り {favoriteFoods.length}</span></summary><div className="quick-groups">{recentFoods.length > 0 && <QuickFoodGroup title="最近使った食品" foods={recentFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} />}{<QuickFoodGroup title="お気に入り" foods={favoriteFoods.slice(0, 6)} favoriteIds={favoriteIds} onSelect={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} />}</div>{recordingMealType && <section className="copy-panel quick-copy-panel"><div><strong>前日の食事をコピー</strong><span>当日の現在時刻で登録します</span></div><select value={copyMealType} onChange={(event) => setCopyMealType(event.target.value as 'すべて' | MealType)}><option>すべて</option>{MEAL_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button className="button ghost" type="button" onClick={onCopyPrevious}>コピー</button></section>}{!selectable && <p className="helper-text quick-mode-note">食事を記録するときは、「記録」で区分を先に選択してください。</p>}</details><details className="section-block food-collapsible"><summary className="section-title collapsible-summary"><div><span className="eyebrow">FOODS</span><h2>食品</h2></div></summary><div className="food-results">{foods.slice(0, 50).map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={selectable ? onSelectFood : undefined} onToggleFavorite={onToggleFavorite} onEdit={onEditFood} onDelete={onDeleteFood} />)}</div></details></>
}

function SearchInputView({ bars, setBars, onSearch, onBack }: { bars: string[]; setBars: React.Dispatch<React.SetStateAction<string[]>>; onSearch: () => void; onBack: () => void }) {
  return <><section className="page-heading"><div><span className="eyebrow">SEARCH</span><h1>食品・メニューを検索</h1></div><button className="button ghost" type="button" onClick={onBack}>← 食品画面へ</button></section><section className="settings-card search-input-card"><div className="search-bar-list">{bars.map((bar, index) => <div className="search-bar-row" key={index}><label><input aria-label="検索バー" autoFocus={index === 0} value={bar} onChange={(event) => setBars((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} placeholder="食品名・メーカー・メニュー名" /></label>{bars.length > 1 && <button className="small-action danger-text" type="button" onClick={() => setBars((current) => current.filter((_, currentIndex) => currentIndex !== index))}>削除</button>}</div>)}</div><div className="search-input-actions"><button className="button secondary" type="button" onClick={() => setBars((current) => [...current, ''])}>＋ 検索バーを追加</button><button className="button primary" type="button" onClick={onSearch}>検索する</button></div></section></>
}

function SearchResultsView({ groups, onSelect, onAddFood, onBack }: { groups: SearchResultGroup[]; onSelect: (query: string, item: SearchResultItem) => void; onAddFood: () => void; onBack: () => void }) {
  return <><section className="page-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h1>検索結果</h1><p className="muted">食品を選ぶと、その検索結果リストだけ閉じます。</p></div><button className="button ghost" type="button" onClick={onBack}>← 検索画面へ</button></section><div className="search-result-groups">{groups.map((group) => <section className="search-result-group" key={group.query}><div className="search-result-heading"><strong>検索結果：</strong><span>{group.query}</span></div><div className="food-results">{group.items.map((item) => <button className="search-result-row" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(group.query, item)}><span className="source-badge">{item.kind === 'food' ? '食品' : item.kind === 'menu' ? 'メニュー' : 'セット'}</span><span className="search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span><b>›</b></button>)}{group.items.length === 0 && <div className="search-empty-state"><p>一致する食品・メニューがありません。</p><button className="button secondary" type="button" onClick={onAddFood}>食品を追加</button></div>}</div></section>)}{groups.length === 0 && <div className="empty-state">検索結果はありません。検索画面へ戻って再検索してください。</div>}</div></>
}

interface MenuViewProps { menus: Menu[]; menuSets: MenuSet[]; foods: Food[]; onNewMenu: () => void; onEditMenu: (menu: Menu) => void; onDeleteMenu: (menu: Menu) => void; onNewMenuSet: () => void; onEditMenuSet: (menuSet: MenuSet) => void; onDeleteMenuSet: (menuSet: MenuSet) => void; onBack: () => void }
function MenuView({ menus, menuSets, foods, onNewMenu, onEditMenu, onDeleteMenu, onNewMenuSet, onEditMenuSet, onDeleteMenuSet }: MenuViewProps) {
  const foodName = (id: string) => foods.find((food) => food.id === id)?.name ?? '削除済み食品'
  const menuName = (id: string) => menus.find((menu) => menu.id === id)?.name ?? '削除済みメニュー'
  const menuSetItems = (menuSet: MenuSet) => [...menuSet.menuIds.map(menuName), ...(menuSet.foodIds ?? []).map(foodName)]
  return <><section className="page-heading"><div><span className="eyebrow">MENUS</span><h1>メニュー</h1></div></section><div className="action-row"><button className="button primary" type="button" onClick={onNewMenu}>＋ 料理メニュー</button><button className="button secondary" type="button" onClick={onNewMenuSet}>＋ メニューセット</button></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">DISHES</span><h2>料理メニュー</h2></div><span className="count-label">{menus.length}件</span></div>{menus.length === 0 ? <div className="empty-state">料理メニューはまだありません。</div> : <div className="menu-list">{menus.map((menu) => <div className="menu-card" key={menu.id}><div><span className="source-badge">{menu.category}</span><strong>{menu.name}</strong><small>{menu.foodIds.length ? menu.foodIds.map(foodName).join('・') : '食材未選択'}</small></div><div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenu(menu)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenu(menu)}>削除</button></div></div>)}</div>}</section><section className="section-block"><div className="section-title"><div><span className="eyebrow">SETS</span><h2>メニューセット</h2></div><span className="count-label">{menuSets.length}件</span></div>{menuSets.length === 0 ? <div className="empty-state">メニューセットはまだありません。</div> : <div className="menu-list">{menuSets.map((menuSet) => { const items = menuSetItems(menuSet); return <div className="menu-card" key={menuSet.id}><div><span className="source-badge">セット</span><strong>{menuSet.name}</strong><small>{items.length ? items.join('・') : 'メニュー・食品未選択'}</small></div><div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenuSet(menuSet)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenuSet(menuSet)}>削除</button></div></div> })}</div>}</section></>
}

function MenuEditorModal({ draft, setDraft, foods, onSubmit, onClose }: { draft: MenuDraft; setDraft: React.Dispatch<React.SetStateAction<MenuDraft | null>>; foods: Food[]; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [foodQuery, setFoodQuery] = useState('')
  const normalizedQuery = foodQuery.trim().toLocaleLowerCase('ja-JP')
  const filteredFoods = normalizedQuery ? foods.filter((food) => displayFoodName(food).toLocaleLowerCase('ja-JP').includes(normalizedQuery)) : foods
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="料理メニューを設定"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">MENU</span><h2>{draft.id ? '料理メニューを編集' : '料理メニューを設定'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}><label>メニュー名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label><label>区分<select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as MenuCategory } : current)}>{MENU_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><fieldset><legend>構成する食材</legend><label className="menu-food-search">食材を検索<input value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} placeholder="食材名・メーカー" /></label><div className="checkbox-list">{filteredFoods.length > 0 ? filteredFoods.map((food) => <label className="checkbox-row" key={food.id}><input type="checkbox" checked={draft.foodIds.includes(food.id)} onChange={(event) => setDraft((current) => current ? { ...current, foodIds: event.target.checked ? [...current.foodIds, food.id] : current.foodIds.filter((id) => id !== food.id) } : current)} /><span>{displayFoodName(food)}（{food.baseAmount}{food.baseUnit}）</span></label>) : <p className="empty-state">検索に一致する食材がありません。</p>}</div></fieldset><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

function MenuSetEditorModal({ draft, setDraft, menus, foods, onSubmit, onClose }: { draft: MenuSetDraft; setDraft: React.Dispatch<React.SetStateAction<MenuSetDraft | null>>; menus: Menu[]; foods: Food[]; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [foodQuery, setFoodQuery] = useState('')
  const normalizedQuery = foodQuery.trim().toLocaleLowerCase('ja-JP')
  const filteredFoods = normalizedQuery ? foods.filter((food) => displayFoodName(food).toLocaleLowerCase('ja-JP').includes(normalizedQuery)) : foods
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="メニューセットを設定"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">MENU SET</span><h2>{draft.id ? 'メニューセットを編集' : 'メニューセットを設定'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}><label>セット名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label><fieldset><legend>まとめるメニュー</legend><div className="checkbox-list">{menus.length > 0 ? menus.map((menu) => <label className="checkbox-row" key={menu.id}><input type="checkbox" checked={draft.menuIds.includes(menu.id)} onChange={(event) => setDraft((current) => current ? { ...current, menuIds: event.target.checked ? [...current.menuIds, menu.id] : current.menuIds.filter((id) => id !== menu.id) } : current)} /><span>{menu.name}（{menu.category}）</span></label>) : <p className="empty-state">料理メニューがありません。</p>}</div></fieldset><fieldset><legend>追加する食品</legend><label className="menu-food-search">食品を検索<input value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} placeholder="食品名・メーカー" /></label><div className="checkbox-list">{filteredFoods.length > 0 ? filteredFoods.map((food) => <label className="checkbox-row" key={food.id}><input type="checkbox" checked={draft.foodIds.includes(food.id)} onChange={(event) => setDraft((current) => current ? { ...current, foodIds: event.target.checked ? [...current.foodIds, food.id] : current.foodIds.filter((id) => id !== food.id) } : current)} /><span>{displayFoodName(food)}（{food.baseAmount}{food.baseUnit}）</span></label>) : <p className="empty-state">検索に一致する食品がありません。</p>}</div></fieldset><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

interface SettingsViewProps { settings: Awaited<ReturnType<typeof getSettings>>; goalInputs: Record<NutrientKey, string>; setGoalInputs: React.Dispatch<React.SetStateAction<Record<NutrientKey, string>>>; onSaveGoals: (event: React.FormEvent<HTMLFormElement>) => void; onToggleExternalApi: (enabled: boolean) => void; onChangeDefaultMealTimeMode: (mode: MealTimeMode) => void; onExportJson: () => void; onRestoreJson: (event: React.ChangeEvent<HTMLInputElement>) => void; onExportCsv: () => void; csvFrom: string; csvTo: string; setCsvFrom: (value: string) => void; setCsvTo: (value: string) => void; counts: { foods: number; meals: number } }
function SettingsView({ settings, goalInputs, setGoalInputs, onSaveGoals, onToggleExternalApi, onChangeDefaultMealTimeMode, onExportJson, onRestoreJson, onExportCsv, csvFrom, csvTo, setCsvFrom, setCsvTo, counts }: SettingsViewProps) {
  return <><section className="page-heading"><div><span className="eyebrow">SETTINGS</span><h1>設定・データ管理</h1></div></section><section className="settings-card"><div className="section-title"><div><span className="eyebrow">GOALS</span><h2>栄養目標</h2></div></div><form onSubmit={onSaveGoals} className="goal-form">{NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={goalInputs[key]} onChange={(event) => setGoalInputs((current) => ({ ...current, [key]: event.target.value }))} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}<button className="button primary" type="submit">目標を保存</button></form></section><section className="settings-card"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h2>食事時刻</h2></div></div><label>既定の時刻入力<select value={settings.mealTimeMode ?? 'auto'} onChange={(event) => onChangeDefaultMealTimeMode(event.target.value as MealTimeMode)}><option value="auto">現在時刻を自動挿入</option><option value="manual">自分で入力</option></select></label></section><section className="settings-card"><div className="section-title"><div><span className="eyebrow">BACKUP</span><h2>バックアップ</h2></div></div><div className="data-stats"><div><strong>{counts.foods}</strong><span>食品</span></div><div><strong>{counts.meals}</strong><span>食事記録</span></div><div><strong>{settings.dataFormatVersion}</strong><span>データ形式</span></div></div><p className="helper-text">最終バックアップ: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '未作成'}</p><label className="toggle-row"><input type="checkbox" checked={settings.externalApiEnabled} onChange={(event) => onToggleExternalApi(event.target.checked)} />食品が見つからないときにOpen Food Factsを検索する</label><InfoPopover className="settings-info" label="外部APIについて" text="外部APIにはバーコード番号のみを送り、取得値は確認後に保存します。通信失敗時は手入力へ進みます。" /><div className="backup-actions"><button className="button primary" type="button" onClick={onExportJson}>JSONを出力</button><label className="button secondary file-button">JSONを復元<input type="file" accept="application/json,.json" onChange={onRestoreJson} /></label></div><InfoPopover className="settings-info" label="復元について" text="復元前に現在データを自動退避し、復元方式は全置換です。不正ファイルは変更を行いません。" /></section><section className="settings-card"><div className="section-title"><div><span className="eyebrow">CSV EXPORT</span><h2>食事履歴をCSV出力</h2></div></div><div className="date-range"><label>開始日<input type="date" value={csvFrom} onChange={(event) => setCsvFrom(event.target.value)} /></label><span>〜</span><label>終了日<input type="date" value={csvTo} onChange={(event) => setCsvTo(event.target.value)} /></label></div><button className="button secondary" type="button" onClick={onExportCsv}>CSVを出力</button><InfoPopover className="settings-info" label="CSV出力について" text="UTF-8 BOM付き。CSVは閲覧・分析用で、復元には使いません。" /></section></>
}

function SettingsExtras({ bodyProfileInputs, setBodyProfileInputs, onSaveBodyProfile, onOpenNewFood, estimatedGoals, bmi }: { bodyProfileInputs: BodyProfileDraft; setBodyProfileInputs: React.Dispatch<React.SetStateAction<BodyProfileDraft>>; onSaveBodyProfile: (event: React.FormEvent<HTMLFormElement>) => void; onOpenNewFood: () => void; estimatedGoals: NutritionGoals | null; bmi: number | null }) {
  return <><section className="settings-card body-profile-card"><div className="section-title"><div><span className="eyebrow">BODY PROFILE</span><h2>身体情報と推定目標</h2></div></div><form onSubmit={onSaveBodyProfile} className="body-profile-form"><div className="two-fields"><label>身長（cm）<input type="number" min="1" max="300" step="0.1" value={bodyProfileInputs.heightCm} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, heightCm: event.target.value }))} placeholder="未設定" /></label><label>体重（kg）<input type="number" min="1" max="500" step="0.1" value={bodyProfileInputs.weightKg} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, weightKg: event.target.value }))} placeholder="未設定" /></label></div><div className="two-fields"><label>年齢（歳）<input type="number" min="1" max="120" step="1" value={bodyProfileInputs.ageYears} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, ageYears: event.target.value }))} placeholder="算出に使用" /></label><label>性別<select value={bodyProfileInputs.sex} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, sex: event.target.value as BiologicalSex }))}><option value="unspecified">未選択</option><option value="male">男性</option><option value="female">女性</option></select></label></div><label>活動量<select value={bodyProfileInputs.activityLevel} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, activityLevel: event.target.value as ActivityLevel }))}><option value="low">低い</option><option value="moderate">普通</option><option value="high">高い</option></select></label><button className="button primary" type="submit">身体情報を保存して目標を算出</button></form><div className="estimated-target"><div><span>BMI</span><strong>{bmi === null ? '未計算' : bmi.toFixed(1)}</strong></div><div><span>推定エネルギー目標</span><strong>{estimatedGoals === null ? '未計算' : `${estimatedGoals.energyKcal ?? '未設定'} kcal`}</strong></div></div>{estimatedGoals && <div className="estimated-goals"><div className="estimated-goals-heading"><strong>栄養素の参考目標</strong><span>P15% / F25% / C60%</span></div><div className="estimated-goal-grid">{NUTRIENT_KEYS.filter((key) => key !== 'energyKcal').map((key) => <div key={key}><span>{NUTRIENT_LABELS[key]}</span><strong>{formatNutrient(estimatedGoals[key])}<small>{NUTRIENT_UNITS[key]}</small></strong></div>)}</div></div>}<div className="estimate-info-row"><span>参考目標の算出について</span><InfoPopover label="参考目標の算出について" text="算出値は一般的な推定式・栄養配分による参考値です。食塩は性別ごとの一般的な上限目安を表示しています。診断・治療・個別の栄養指導を目的とせず、体調や医療上の指示がある場合は専門家に相談してください。" /></div></section><section className="settings-card"><div className="section-title food-master-title"><div><span className="eyebrow">FOOD MASTER</span><h2>食品登録</h2></div><button className="button primary" type="button" onClick={onOpenNewFood}>＋ 新しい食品を登録</button></div></section><section className="privacy-note"><strong>医療目的ではありません</strong><p>このアプリは日々の記録を支援するもので、診断・治療・個別の栄養指導を行いません。</p><span>Nutrition PWA v0.1.0 · 端末内のみで動作</span></section></>
}

function MealTypePickerModal({ food, recordedMealTypes, onSelect, onClose }: { food: Food | null; recordedMealTypes: MealType[]; onSelect: (type: MealType) => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を追加"><section className="modal-card meal-type-picker"><div className="modal-heading"><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>{food && <p className="helper-text">「{food.name}」を記録する区分を選択してください。</p>}<div className="meal-type-options">{MEAL_TYPES.map((type) => { const recorded = recordedMealTypes.includes(type); return <button key={type} className={`meal-type-option${recorded ? ' is-recorded' : ''}`} type="button" onClick={() => onSelect(type)} aria-label={`${type}${recorded ? '（記録済み）' : ''}`}><img src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{recorded && <span className="meal-type-check" aria-hidden="true">✓</span>}</button> })}</div><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></section></div>
}

function MealModal({ food, amount, setAmount, editing, onSubmit, onClose }: { food: Food; amount: string; setAmount: (value: string) => void; editing: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const preview = calculateNutrients(food, Number(amount), food.baseUnit)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を記録"><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">ADD MEAL</span><h2>{editing ? '食事を編集' : '食事を記録'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="selected-food"><strong>{food.name}</strong><span>{food.maker || '一般食品'} · 基準量 {food.baseAmount}{food.baseUnit}</span></div><form onSubmit={onSubmit}><label>分量<div className="amount-input"><input autoFocus type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span className="field-suffix">{food.baseUnit}</span></div></label><div className="preview-box calorie-preview"><div className="section-kicker">今回のカロリー</div><strong>{formatNutrient(preview.energyKcal)}<small> kcal</small></strong></div><button className="button primary full-width" type="submit">{editing ? '変更を保存' : '食事として登録'}</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></div>
}

function MealDetailsModal({ details, goals, onUpdateTimes, onClose }: { details: { type: MealType; entries: MealEntry[]; subtotal: Nutrients }; goals: NutritionGoals; onUpdateTimes: (entryIds: string[], time: string) => void; onClose: () => void }) {
  const [sharedTime, setSharedTime] = useState(details.entries[0] ? toTokyoTimeInput(details.entries[0].eatenAt) : '')
  const [snackTimes, setSnackTimes] = useState<Record<string, string>>(() => Object.fromEntries(details.entries.map((entry) => [entry.id, toTokyoTimeInput(entry.eatenAt)])))
  const sharedEntryIds = details.entries.map((entry) => entry.id)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${details.type}の栄養詳細`}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">NUTRIENTS</span><h2>{details.type}の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(details.subtotal.energyKcal)}<small> kcal</small></strong></div><NutrientGoalGraphs nutrients={details.subtotal} goals={goals} /><section className="meal-time-editor"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h3>食事時刻</h3></div></div>{details.type !== '間食' ? <form className="inline-time-form" onSubmit={(event) => { event.preventDefault(); onUpdateTimes(sharedEntryIds, sharedTime) }}><label><input aria-label="食事時刻" type="time" value={sharedTime} onChange={(event) => setSharedTime(event.target.value)} required /></label><button className="button secondary" type="submit">時刻を保存</button></form> : <div className="snack-time-list">{details.entries.map((entry) => <div className="snack-time-row" key={entry.id}><span>{entry.foodSnapshot.name}</span><input type="time" value={snackTimes[entry.id] ?? ''} onChange={(event) => setSnackTimes((current) => ({ ...current, [entry.id]: event.target.value }))} /><button className="small-action" type="button" onClick={() => onUpdateTimes([entry.id], snackTimes[entry.id] ?? '')}>保存</button></div>)}</div>}</section><div className="detail-entry-list">{details.entries.map((entry) => <div className="detail-entry" key={entry.id}><span>{entry.foodSnapshot.name} · {entry.amount}{entry.amountUnit}</span><strong>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</strong></div>)}</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}

function FoodFormView({ draft, returnView, setDraft, externalNote, onSubmit, onClose }: { draft: FoodDraft; returnView: FoodFormReturnView; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; externalNote: string | null; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const update = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current)
  return <><section className="page-heading food-form-heading"><div><span className="eyebrow">FOOD MASTER</span><h1>{draft.id ? '食品を編集' : '新しい食品を登録'}</h1></div><button className="button ghost" type="button" onClick={onClose}>{returnView === 'settings' ? '← 設定へ' : '← 食品画面へ'}</button></section><section className="settings-card food-form-card">{externalNote && <div className="external-warning">{externalNote}</div>}<form onSubmit={onSubmit}><label>食品名*<input value={draft.name} onChange={(event) => update('name', event.target.value)} required /></label><label>メーカー<input value={draft.maker} onChange={(event) => update('maker', event.target.value)} /></label><label>バーコード（JAN/GTIN）<input inputMode="numeric" value={draft.barcode} onChange={(event) => update('barcode', event.target.value)} placeholder="任意・8〜14桁" /></label><div className="two-fields"><label>基準量*<input type="number" min="0.01" step="any" value={draft.baseAmount} onChange={(event) => update('baseAmount', event.target.value)} required /></label><label>基準単位*<select value={draft.baseUnit} onChange={(event) => update('baseUnit', event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><div className="two-fields"><label>既定量<input type="number" min="0.01" step="any" value={draft.servingAmount} onChange={(event) => update('servingAmount', event.target.value)} placeholder="任意" /></label><label>既定単位<select value={draft.servingUnit} onChange={(event) => update('servingUnit', event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><fieldset><legend>栄養値（基準量あたり）</legend><div className="nutrient-input-grid">{NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={draft.nutrients[key]} onChange={(event) => update('nutrients', { ...draft.nutrients, [key]: event.target.value })} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}</div></fieldset><p className="source-line">出典: {draft.sourceVersion}（保存前に内容を確認してください）</p><button className="button primary full-width" type="submit">保存する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></form></section></>
}

function FoodMenuSelection({ draft, setDraft, menus }: { draft: FoodDraft; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; menus: Menu[] }) {
  return <section className="settings-card food-menu-selection"><div className="section-title"><div><span className="eyebrow">MENU LINK</span><h2>メニューから選択</h2></div><span className="count-label">任意</span></div><p className="helper-text">この食品を料理メニューに紐づけます。複数選択できます。</p>{menus.length === 0 ? <div className="empty-state">メニュータブで料理メニューを先に設定してください。</div> : <div className="checkbox-list">{menus.map((menu) => <label className="checkbox-row" key={menu.id}><input type="checkbox" checked={draft.menuIds.includes(menu.id)} onChange={(event) => setDraft((current) => current ? { ...current, menuIds: event.target.checked ? [...current.menuIds, menu.id] : current.menuIds.filter((id) => id !== menu.id) } : current)} /><span>{menu.name}（{menu.category}）</span></label>)}</div>}</section>
}

export default App
