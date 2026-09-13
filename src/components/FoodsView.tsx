import { useEffect, useMemo, useRef, useState } from 'react'
import { foodMatchesSearchCategory } from '../services/foodClassification'
import { groupFoodsByKana, type FoodIndexGroupKey } from '../services/foodIndex'
import { getMenuIngredients, menuToFood } from '../services/menuIngredients'
import { getMenuSetFoodItems } from '../services/menuSetMeals'
import { formatNutrient } from '../services/nutrition'
import {
  MEAL_TYPES,
  MENU_CATEGORIES,
  type Food,
  type FoodGroup,
  type GeneralMenu,
  type MealType,
  type Menu,
  type MenuSet,
} from '../types'
import { displayFoodName, foodListNutritionLabel, generalMenuToFood, menuSetPreviewFood } from './foodPresentation'

function QuickFoodGroup({ title, foods, favoriteIds, onSelect, onToggleFavorite, emptyText = 'まだお気に入りがありません。食品の☆から追加できます。' }: { title: string; foods: Food[]; favoriteIds: Set<string>; onSelect?: (food: Food) => void; onToggleFavorite: (food: Food) => void; emptyText?: string }) {
  return <div className="quick-group"><h3>{title}</h3>{foods.length > 0 ? <div className="quick-list">{foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />)}</div> : <p className="quick-empty-inline">{emptyText}</p>}</div>
}

export function FoodRow({ food, favorite, onSelect, onAdd, onToggleFavorite, onEdit, onDelete, onRemove }: { food: Food; favorite: boolean; onSelect?: (food: Food) => void; onAdd?: (food: Food) => void; onToggleFavorite: (food: Food) => void; onEdit?: (food: Food) => void; onDelete?: (food: Food) => void; onRemove?: (food: Food) => void }) {
  const name = displayFoodName(food)
  const nutritionLabel = foodListNutritionLabel(food)
  return <div className="food-row">{onSelect ? <button type="button" className="food-main" onClick={() => onSelect(food)}><strong>{name}</strong><span>{food.maker || '一般食品'} · {nutritionLabel}</span></button> : <div className="food-main static"><strong>{name}</strong><span>{food.maker || '一般食品'} · {nutritionLabel}</span></div>}{onAdd && <button type="button" className="small-action food-add-button" onClick={() => onAdd(food)}>追加</button>}<button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`} onClick={() => onToggleFavorite(food)} aria-label={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}>{favorite ? '★' : '☆'}</button>{onEdit && <button type="button" className="small-action" onClick={() => onEdit(food)}>編集</button>}{onDelete && <button type="button" className="small-action danger-text" onClick={() => onDelete(food)}>削除</button>}{onRemove && <button type="button" className="small-action danger-text" onClick={() => onRemove(food)}>外す</button>}</div>
}

function FavoriteFoodsManager({ foods, favoriteIds, onToggleFavorite, onEditFood, onReorder }: { foods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; onEditFood: (food: Food) => void; onReorder: (orderedFoodIds: string[]) => Promise<void> }) {
  const [orderedFoods, setOrderedFoods] = useState(foods)
  const [draggedFoodId, setDraggedFoodId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const orderedFoodsRef = useRef(foods)
  const foodsRef = useRef(foods)
  const draggedFoodIdRef = useRef<string | null>(null)
  const dragStartOrderRef = useRef(foods)
  const dragOffsetYRef = useRef(0)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragHandleRef = useRef<HTMLButtonElement | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const latestDragYRef = useRef(0)
  const updateDragPositionRef = useRef<(clientY: number) => void>(() => undefined)
  const finishDragRef = useRef<(pointerId: number | null, commit: boolean) => void>(() => undefined)
  const savingOrderRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const updateLocalOrder = (next: Food[]) => {
    orderedFoodsRef.current = next
    setOrderedFoods(next)
  }

  useEffect(() => {
    foodsRef.current = foods
    if (!draggedFoodIdRef.current && !savingOrderRef.current) {
      orderedFoodsRef.current = foods
      setOrderedFoods(foods)
    }
  }, [foods])

  const commitOrder = async (next: Food[]) => {
    const nextIds = next.map((food) => food.id)
    const persistedFoods = foodsRef.current
    if (nextIds.every((id, index) => id === persistedFoods[index]?.id)) return
    if (savingOrderRef.current) return
    savingOrderRef.current = true
    setSavingOrder(true)
    try {
      await onReorder(nextIds)
    } catch {
      updateLocalOrder(persistedFoods)
    } finally {
      savingOrderRef.current = false
      setSavingOrder(false)
    }
  }

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, foodId: string) => {
    if (savingOrderRef.current || orderedFoodsRef.current.length < 2) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-favorite-food-id]')
    if (!row) return
    const rect = row.getBoundingClientRect()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer captureが使えない環境でも、グローバルイベントで終了を受け取る。
    }
    dragStartOrderRef.current = orderedFoodsRef.current
    dragOffsetYRef.current = event.clientY - rect.top
    dragPointerIdRef.current = event.pointerId
    dragHandleRef.current = event.currentTarget
    latestDragYRef.current = event.clientY
    draggedFoodIdRef.current = foodId
    setDraggedFoodId(foodId)
    setDragPreview({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }

  const updateDragPosition = (clientY: number) => {
    const sourceId = draggedFoodIdRef.current
    if (!sourceId) return
    setDragPreview((current) => current ? { ...current, top: clientY - dragOffsetYRef.current } : current)
    const source = orderedFoodsRef.current.find((food) => food.id === sourceId)
    if (!source || !listRef.current) return
    const remaining = orderedFoodsRef.current.filter((food) => food.id !== sourceId)
    const rowById = new Map(Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-favorite-food-id]')).map((row) => [row.dataset.favoriteFoodId, row] as const))
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
    if (!next.every((food, index) => food.id === orderedFoodsRef.current[index]?.id)) updateLocalOrder(next)
  }

  updateDragPositionRef.current = updateDragPosition

  const finalizeDrag = (pointerId: number | null, commit: boolean) => {
    if (!draggedFoodIdRef.current || dragPointerIdRef.current === null || (pointerId !== null && dragPointerIdRef.current !== pointerId)) return
    const activePointerId = dragPointerIdRef.current
    const handle = dragHandleRef.current
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
      if (commit) updateDragPositionRef.current(latestDragYRef.current)
    }
    const finalOrder = orderedFoodsRef.current
    dragPointerIdRef.current = null
    draggedFoodIdRef.current = null
    dragHandleRef.current = null
    setDraggedFoodId(null)
    setDragPreview(null)
    try {
      if (handle?.hasPointerCapture(activePointerId)) handle.releasePointerCapture(activePointerId)
    } catch {
      // 行が移動してブラウザー側で先に解放される場合がある。
    }
    if (commit) void commitOrder(finalOrder)
    else updateLocalOrder(dragStartOrderRef.current)
  }

  finishDragRef.current = finalizeDrag

  useEffect(() => {
    if (!draggedFoodId) return
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
    const cancelWhenHidden = () => { if (document.visibilityState === 'hidden') cancelWithoutPointer() }
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
  }, [draggedFoodId])

  const draggedFood = draggedFoodId ? orderedFoods.find((food) => food.id === draggedFoodId) : null
  return <>
    {orderedFoods.length === 0 ? <div className="empty-state">お気に入りはありません。</div> : <div ref={listRef} className={`favorite-food-list${draggedFoodId ? ' is-reordering' : ''}`}>{orderedFoods.map((food) => <div className={`favorite-food-row${draggedFoodId === food.id ? ' is-drag-placeholder' : ''}`} data-favorite-food-id={food.id} key={food.id}><button className="meal-order-handle favorite-food-order-handle" type="button" aria-label={`${displayFoodName(food)}をドラッグして並び替え`} disabled={savingOrder || orderedFoods.length < 2} onPointerDown={(event) => startDrag(event, food.id)} onPointerUp={(event) => finishDragRef.current(event.pointerId, true)} onPointerCancel={(event) => finishDragRef.current(event.pointerId, false)}>≡</button><div className="favorite-food-row-content"><FoodRow food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onEdit={onEditFood} /></div></div>)}</div>}
    {draggedFood && dragPreview && <div className="favorite-food-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle favorite-food-order-handle">≡</span><div className="favorite-food-drag-copy"><strong>{displayFoodName(draggedFood)}</strong><span>{draggedFood.maker || '一般食品'} · {foodListNutritionLabel(draggedFood)}</span></div></div>}
  </>
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

function formatMealSelectionDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  return `${Number(match[2])}月${Number(match[3])}日`
}

interface FoodsViewProps { selectedDate: string; recordingMealType: MealType | null; recordingEntryCount: number; foods: Food[]; foodGroups: FoodGroup[]; menus: Menu[]; generalMenus: GeneralMenu[]; menuSets: MenuSet[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onSelectFood: (food: Food) => void; onSelectMenuSet: (menuSet: MenuSet) => void; onCreateTemporaryMenu: () => void; onToggleFavorite: (food: Food) => void; onReorderFavorites: (orderedFoodIds: string[]) => Promise<void>; onEditFood: (food: Food) => void; onDeleteFood: (food: Food) => void; onOpenSearch?: () => void; onOpenScanner: () => void; onOpenConfirmation: () => void; onBack: () => void; backLabel: string; copyMealType: 'すべて' | MealType; setCopyMealType: (value: 'すべて' | MealType) => void; onCopyPrevious: () => void }
export function FoodsView({ selectedDate, recordingMealType, recordingEntryCount, foods, foodGroups, menus, generalMenus, menuSets, recentFoods, favoriteFoods, favoriteIds, onSelectFood, onSelectMenuSet, onCreateTemporaryMenu, onToggleFavorite, onReorderFavorites, onEditFood, onDeleteFood, onOpenSearch, onOpenScanner, onOpenConfirmation, onBack, backLabel, copyMealType, setCopyMealType, onCopyPrevious }: FoodsViewProps) {
  const selectable = Boolean(recordingMealType)
  const [activeTab, setActiveTab] = useState<'favorites' | 'history' | 'foods' | 'menus'>(selectable ? 'favorites' : 'foods')
  const [foodMasterCategory, setFoodMasterCategory] = useState<'all' | 'favorites' | 'commercial'>('all')
  const [openFoodGroups, setOpenFoodGroups] = useState<Set<FoodIndexGroupKey>>(new Set())
  const visibleFoods = useMemo(() => {
    if (selectable) return foods
    if (foodMasterCategory === 'favorites') return favoriteFoods
    return foods.filter((food) => foodMatchesSearchCategory(food, foodMasterCategory))
  }, [favoriteFoods, foodMasterCategory, foods, selectable])
  const indexedFoodGroups = useMemo(() => groupFoodsByKana(visibleFoods, foodGroups), [foodGroups, visibleFoods])
  useEffect(() => {
    setActiveTab(selectable ? 'favorites' : 'foods')
    setFoodMasterCategory('all')
  }, [selectable])
  const tabs: Array<{ id: 'favorites' | 'history' | 'foods' | 'menus'; label: string }> = selectable
    ? [{ id: 'favorites', label: 'お気に入り' }, { id: 'history', label: '履歴' }, { id: 'menus', label: 'メニュー' }]
    : []
  return <><section className="page-heading food-screen-heading"><div><span className="eyebrow">{recordingMealType ? 'SELECT FOOD' : 'FOOD MASTER'}</span><h1>{recordingMealType ? `${formatMealSelectionDate(selectedDate)} ${recordingMealType}` : '食品を登録・管理'}</h1></div></section><div className="action-row">{onOpenSearch && <button className="button primary" type="button" onClick={onOpenSearch}>⌕ 食品を検索</button>}<button className="button secondary" type="button" onClick={onOpenScanner}>{recordingMealType ? '▦ バーコードで追加' : '▦ バーコード検索'}</button></div><div className="search-category-tabs food-screen-tabs" role="tablist" aria-label="食品登録方法">{tabs.map((tab) => <button key={tab.id} id={`food-screen-tab-${tab.id}`} className={activeTab === tab.id ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="food-screen-tab-panel" onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div><div id="food-screen-tab-panel" role="tabpanel" aria-labelledby={`food-screen-tab-${activeTab}`} className="food-screen-sections">{activeTab === 'menus' && selectable && <MenuFoodPicker menus={menus} generalMenus={generalMenus} menuSets={menuSets} foods={foods} onSelect={onSelectFood} onSelectMenuSet={onSelectMenuSet} onCreateTemporaryMenu={onCreateTemporaryMenu} />}{activeTab === 'favorites' && selectable && <section className="section-block food-section-card food-quick-section"><div className="section-title"><div><span className="eyebrow">FAVORITES</span><h2>お気に入り</h2></div><span className="count-label quick-count">{favoriteFoods.length}件</span></div><QuickFoodGroup title="お気に入りの食品" foods={favoriteFoods.slice(0, 20)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} /></section>}{activeTab === 'history' && selectable && <section className="section-block food-section-card food-quick-section"><div className="section-title"><div><span className="eyebrow">HISTORY</span><h2>{recordingMealType}の履歴</h2></div><span className="count-label quick-count">{recentFoods.length}件</span></div><QuickFoodGroup title={`${recordingMealType}で最近使った食品`} foods={recentFoods.slice(0, 20)} favoriteIds={favoriteIds} onSelect={onSelectFood} onToggleFavorite={onToggleFavorite} emptyText={`${recordingMealType}の食事を記録すると、ここに表示されます。`} />{recordingMealType && <section className="copy-panel quick-copy-panel"><div><strong>前日の食事をコピー</strong><span>当日の現在時刻で登録します</span></div><select value={copyMealType} onChange={(event) => setCopyMealType(event.target.value as 'すべて' | MealType)}><option>すべて</option>{MEAL_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button className="button ghost" type="button" onClick={onCopyPrevious}>コピー</button></section>}</section>}{activeTab === 'foods' && <section className="section-block food-section-card"><div className="section-title"><div><span className="eyebrow">FOODS</span><h2>食品</h2></div><span className="count-label">{visibleFoods.length}件</span></div>{!selectable && <div className="search-category-tabs food-master-list-tabs" role="tablist" aria-label="食品一覧の分類"><button className={foodMasterCategory === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={foodMasterCategory === 'all'} onClick={() => setFoodMasterCategory('all')}>すべて</button><button className={foodMasterCategory === 'favorites' ? 'active' : ''} type="button" role="tab" aria-selected={foodMasterCategory === 'favorites'} onClick={() => setFoodMasterCategory('favorites')}>お気に入り</button><button className={foodMasterCategory === 'commercial' ? 'active' : ''} type="button" role="tab" aria-selected={foodMasterCategory === 'commercial'} onClick={() => setFoodMasterCategory('commercial')}>外食・市販</button></div>}{!selectable && foodMasterCategory === 'favorites' ? <FavoriteFoodsManager foods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} onEditFood={onEditFood} onReorder={onReorderFavorites} /> : <div className="menu-picker-groups">{indexedFoodGroups.map((group) => { const open = openFoodGroups.has(group.key); return <details className="menu-picker-group" key={group.key} open={open} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenFoodGroups((current) => { const next = new Set(current); if (isOpen) next.add(group.key); else next.delete(group.key); return next }) }}><summary><span className="menu-picker-summary-label"><i aria-hidden="true" />{group.label}</span><small>{group.foods.length > 0 ? `${group.foods.length}件` : '登録なし'}</small></summary>{open && <div className="food-results">{group.foods.length > 0 ? group.foods.map((food) => <FoodRow key={food.id} food={food} favorite={favoriteIds.has(food.id)} onToggleFavorite={onToggleFavorite} onEdit={onEditFood} onDelete={onDeleteFood} />) : <p className="menu-picker-empty">この行に登録された食品はありません。</p>}</div>}</details> })}</div>}</section>}</div><button className="floating-back" type="button" onClick={onBack}><span aria-hidden="true">←</span>{backLabel.replace(/^←\s*/, '')}</button>{recordingMealType && <button className="floating-next" type="button" onClick={onOpenConfirmation} disabled={recordingEntryCount === 0}>確認<span aria-hidden="true">→</span></button>}</>
}
