import { useEffect, useState } from 'react'
import { searchFoodResults } from '../db/db'
import { foodMatchesSearchCategory } from '../services/foodClassification'
import { normalizeSearchText } from '../services/foodSearch'
import { getMenuBase, getMenuQuantityUnits, wouldCreateMenuCycle } from '../services/menuIngredients'
import {
  MissingRequiredUserSelection,
  resolveFoodGroupId,
  type UserFoodSearchResult,
} from '../services/mextUserFoodData'
import type { UnifiedFoodSearchResult } from '../services/unifiedFoodSearch'
import { getFoodDefaultServing, getFoodQuantityUnits } from '../services/nutrition'
import {
  type Food,
  type FoodAttributePreference,
  type FoodAttributePreferences,
  type FoodGroup,
  type GeneralMenu,
  type Menu,
  type QuantityUnit,
} from '../types'
import { displayFoodName, displaySearchFoodName, foodListNutritionLabel } from './foodPresentation'
import { buildMextFoodSearchResult, selectedUserFoodDimensionLabel, selectedUserFoodLabel, type FoodVariantPickerState } from './foodSearchModels'
import { FoodRow } from './FoodsView'
import { FoodAmountPickerModal, FoodVariantPickerModal } from './FoodVariantPicker'
import type { MenuIngredientDraft } from './formDrafts'

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

const MENU_FOOD_SEARCH_PAGE_SIZE = 20

function MenuFoodChoiceRow({ food, selected, favorite, onAdd, onToggleFavorite }: { food: Food; selected: boolean; favorite: boolean; onAdd: (food: Food) => void; onToggleFavorite: (food: Food) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · {foodListNutritionLabel(food)}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(food)} disabled={selected}>{selected ? '追加済み' : '追加'}</button><button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button></div>
}

function MenuIngredientChoiceRow({ menu, selected, onAdd }: { menu: Menu; selected: boolean; onAdd: (menu: Menu) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{menu.name}</strong><span>Myメニュー · {menu.category}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(menu)} disabled={selected}>{selected ? '追加済み' : '追加'}</button></div>
}

function MenuGeneralChoiceRow({ menu, selected, onAdd }: { menu: GeneralMenu; selected: boolean; onAdd: (menu: GeneralMenu) => void }) {
  return <div className="food-row"><div className="food-main static"><strong>{menu.name}</strong><span>一般メニュー · {menu.category}</span></div><button type="button" className="small-action food-add-button" onClick={() => onAdd(menu)} disabled={selected}>{selected ? '追加済み' : '追加'}</button></div>
}

export function MenuIngredientRow({ ingredient, foods, menus, onChangeAmount, onChangeUnit, onRemove }: { ingredient: MenuIngredientDraft; foods: Food[]; menus: Menu[]; onChangeAmount: (amount: string) => void; onChangeUnit?: (unit: QuantityUnit) => void; onRemove: () => void }) {
  const food = ingredient.kind === 'food' ? foods.find((item) => item.id === ingredient.itemId) : undefined
  const menu = ingredient.kind === 'menu' ? menus.find((item) => item.id === ingredient.itemId) : undefined
  const name = food ? displayFoodName(food) : menu?.name ?? (ingredient.kind === 'food' ? '削除済み食品' : '削除済みメニュー')
  const availableUnits = food ? getFoodQuantityUnits(food) : menu ? getMenuQuantityUnits(menu) : ['食']
  const unitOptions = availableUnits.includes(ingredient.unit) ? availableUnits : [...availableUnits, ingredient.unit]
  return <div className="menu-ingredient-row"><div className="menu-ingredient-copy"><span className="source-badge">{ingredient.kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><label className="menu-ingredient-amount"><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={ingredient.amount} onChange={(event) => onChangeAmount(event.target.value)} required />{onChangeUnit ? <select value={ingredient.unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select> : <span>{ingredient.unit}</span>}</label><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

export function MenuFoodSelection({ selectedIds, selectedIngredients, selectedMenuIds = [], selectedGeneralMenuIds = [], menus = [], generalMenus = [], editingMenuId = null, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, onAdd, onAddWithAmount, onRemove, onAddMenu, onRemoveMenu, onAddGeneralMenu, onRemoveGeneralMenu, onRemoveIngredient, onChangeIngredientAmount, onChangeIngredientUnit, showSelectedList = true, pickerTitle = '食材を追加', allowFoodCategoryFilter = false, foodAttributePreferences, onSaveFoodAttributePreference }: MenuFoodSelectionProps) {
  const [foodQuery, setFoodQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [foodCategory, setFoodCategory] = useState<'all' | 'commercial'>('all')
  const [searchResults, setSearchResults] = useState<UnifiedFoodSearchResult[]>([])
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [loadingMoreSearchResults, setLoadingMoreSearchResults] = useState(false)
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

  const resetSearchResults = () => {
    setSearchedQuery('')
    setSearchResults([])
    setSearchNextCursor(null)
  }

  useEffect(() => {
    resetSearchResults()
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
    resetSearchResults()
    if (!query) return
    setSearching(true)
    try {
      const requestedCategory = allowFoodCategoryFilter ? foodCategory : 'all'
      const { page } = await searchFoodResults(query, { limit: MENU_FOOD_SEARCH_PAGE_SIZE, category: requestedCategory, log: false })
      setSearchResults(page.results)
      setSearchNextCursor(page.nextCursor)
      setSearchedQuery(normalizeSearchText(query))
    } catch {
      setSearchResults([])
      setSearchedQuery(normalizeSearchText(query))
    } finally {
      setSearching(false)
    }
  }

  const showSearchResults = normalizedQuery.length > 0 && searchedQuery === normalizedQuery
  const canLoadMoreSearchResults = searchNextCursor !== null
  const chooseSearchResult = (result: UnifiedFoodSearchResult) => {
    if (result.userFoodResult) {
      chooseUserSearchResult(result.userFoodResult)
      return
    }
    if (result.variants.length > 1) setVariantResult({ result })
    else startFoodAdd(result.food)
  }

  const chooseResolvedFoodGroup = (foodGroupId: string) => {
    const result = buildMextFoodSearchResult(foodGroupId, foods, foodGroups)
    if (!result) return
    if (result.variants.length > 1) setVariantResult({ result })
    else startFoodAdd(result.food)
  }

  const chooseUserSearchResult = (result: UserFoodSearchResult) => {
    if (result.group.selectionDimensions.length > 0 || Object.keys(result.attributeSelection ?? {}).length > 0) {
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

  const loadMoreSearchResults = async () => {
    if (!canLoadMoreSearchResults || loadingMoreSearchResults) return
    setLoadingMoreSearchResults(true)
    try {
      const query = foodQuery.trim()
      const requestedCategory = allowFoodCategoryFilter ? foodCategory : 'all'
      let additionalSearchResults: UnifiedFoodSearchResult[] = []
      let nextCursor: string | null = searchNextCursor
      if (searchNextCursor !== null) {
        const { page } = await searchFoodResults(query, { limit: MENU_FOOD_SEARCH_PAGE_SIZE, cursor: searchNextCursor, category: requestedCategory, log: false })
        additionalSearchResults = page.results
        nextCursor = page.nextCursor
      }
      setSearchResults((current) => [...current, ...additionalSearchResults])
      setSearchNextCursor(nextCursor)
    } catch {
      // 追加読み込みに失敗しても、既に表示中の検索結果は維持する。
    } finally {
      setLoadingMoreSearchResults(false)
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
              <input value={foodQuery} onChange={(event) => { setFoodQuery(event.target.value); resetSearchResults() }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder={onAddMenu ? '食品名・メーカー・メニュー名' : '食品名・メーカー'} />
            </label>
            <button className="button secondary menu-food-search-button" type="button" onClick={() => void runSearch()} disabled={searching}>{searching ? '検索中…' : '検索する'}</button>
          </div>
          {showSearchResults ? (
            <>
              <div className="menu-food-section-heading"><span className="eyebrow">SEARCH RESULTS</span><h4>検索結果：{foodQuery.trim()}</h4></div>
              <div className="menu-food-search-results">
                {searchResults.length > 0 || (onAddMenu && matchingMenus.length > 0) || (onAddGeneralMenu && matchingGeneralMenus.length > 0)
                  ? <>{onAddMenu && matchingMenus.map((menu) => { const base = getMenuBase(menu); return <button className="menu-food-search-result" type="button" key={`menu:${menu.id}`} disabled={selectedIngredientKeys.has(`menu:${menu.id}`)} onClick={() => onAddMenu(menu)}><span className="source-badge">My</span><span><strong>{menu.name}</strong><small>{menu.category} · 基準 {base.amount}{base.unit}</small></span><b>{selectedIngredientKeys.has(`menu:${menu.id}`) ? '追加済み' : '›'}</b></button> })}{onAddGeneralMenu && matchingGeneralMenus.map((menu) => { const base = getMenuBase(menu); return <button className="menu-food-search-result" type="button" key={`general-menu:${menu.id}`} disabled={selectedIngredientKeys.has(`general-menu:${menu.id}`)} onClick={() => onAddGeneralMenu(menu)}><span className="source-badge">一般</span><span><strong>{menu.name}</strong><small>{menu.category} · 基準 {base.amount}{base.unit}</small></span><b>{selectedIngredientKeys.has(`general-menu:${menu.id}`) ? '追加済み' : '›'}</b></button> })}{searchResults.map((result) => { const userResult = result.userFoodResult; const label = userResult ? selectedUserFoodLabel(userResult) : null; const selected = !userResult && result.variants.length === 1 && selectedIngredientKeys.has(`food:${result.food.id}`); return <button className="menu-food-search-result" type="button" key={result.candidateKey} disabled={selected} onClick={() => chooseSearchResult(result)}><span className="source-badge">食品</span><span><strong>{userResult ? (label ?? userResult.group.displayName) : displaySearchFoodName(result.group, result.food)}</strong><small>{userResult ? (label ? `${userResult.group.displayName} > ${selectedUserFoodDimensionLabel(userResult) ?? '種類'}` : `${userResult.group.category} · ${userResult.group.memberCount > 1 ? `${userResult.group.memberCount}種類` : '直接選択'}`) : `${result.group.category ?? '食品'} · ${result.variants.length > 1 ? `${result.variants.length}バリエーション · ${foodListNutritionLabel(result.food, false)}` : foodListNutritionLabel(result.food)}`}</small></span><b>{selected ? '追加済み' : '›'}</b></button> })}</>
                  : <p className="menu-food-empty">検索に一致する食品・メニューがありません。</p>}
              </div>
              {canLoadMoreSearchResults && <button className="button ghost menu-food-load-more" type="button" onClick={() => void loadMoreSearchResults()} disabled={loadingMoreSearchResults}>{loadingMoreSearchResults ? '読み込み中…' : 'さらに表示'}</button>}
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

export function MenuSetSelectedItemRow({ kind, name, onRemove }: { kind: 'food' | 'menu' | 'general-menu'; name: string; onRemove: () => void }) {
  return <div className="menu-set-selected-row"><div><span className="source-badge">{kind === 'food' ? '食品' : kind === 'general-menu' ? '一般' : 'My'}</span><strong>{name}</strong></div><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}
