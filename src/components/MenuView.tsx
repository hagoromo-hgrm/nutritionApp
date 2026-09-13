import { useEffect, useRef, useState } from 'react'
import { menuToFood } from '../services/menuIngredients'
import { getMenuSetCalorieSummary, getMenuSetFoodItems } from '../services/menuSetMeals'
import { formatGraphNutrient, formatNutrient } from '../services/nutrition'
import {
  MENU_CATEGORIES,
  type Food,
  type GeneralMenu,
  type Menu,
  type MenuSet,
  type NutritionGoals,
} from '../types'
import { NutrientGoalGraphs } from './NutritionGraphs'
import { displayFoodName, generalMenuToFood } from './foodPresentation'

export function MenuNutritionDetailsModal({ menu, menus, foods, goals, onClose }: { menu: Menu; menus: Menu[]; foods: Food[]; goals: NutritionGoals; onClose: () => void }) {
  const menuFood = menuToFood(menu, menus, foods)
  const memo = menu.memo?.trim()
  return <div className="modal-backdrop nutrient-detail-backdrop" role="dialog" aria-modal="true" aria-label={`${menu.name}の詳細`}><section className="modal-card nutrient-detail-modal menu-nutrition-details-modal"><div className="modal-heading"><div><span className="eyebrow">MY MENU DETAILS</span><h2>{menu.name}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(menuFood.nutrients.energyKcal)}<small> kcal</small></strong></div><section className="menu-detail-nutrients" aria-label="栄養価"><span className="eyebrow">NUTRIENTS</span><h3>栄養価</h3><NutrientGoalGraphs nutrients={menuFood.nutrients} goals={goals} /></section>{memo && <section className="menu-detail-memo" aria-label="メモ"><span className="eyebrow">MEMO</span><h3>メモ</h3><p>{memo}</p></section>}</section></div>
}

interface MenuViewProps { menus: Menu[]; generalMenus: GeneralMenu[]; menuSets: MenuSet[]; foods: Food[]; onNewMenu: () => void; onShowMenuNutrition: (menu: Menu) => void; onEditMenu: (menu: Menu) => void; onDeleteMenu: (menu: Menu) => void; onNewGeneralMenu: () => void; onEditGeneralMenu: (menu: GeneralMenu) => void; onDeleteGeneralMenu: (menu: GeneralMenu) => void; onCloneGeneralMenu: (menu: GeneralMenu) => void; onNewMenuSet: () => void; onEditMenuSet: (menuSet: MenuSet) => void; onDeleteMenuSet: (menuSet: MenuSet) => void; onReorderMenuSets: (orderedMenuSetIds: string[]) => Promise<void>; onBack: () => void }
export function MenuView({ menus, generalMenus, menuSets, foods, onNewMenu, onShowMenuNutrition, onEditMenu, onDeleteMenu, onNewGeneralMenu, onEditGeneralMenu, onDeleteGeneralMenu, onCloneGeneralMenu, onNewMenuSet, onEditMenuSet, onDeleteMenuSet, onReorderMenuSets }: MenuViewProps) {
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
      const menuFood = kind === 'general'
        ? generalMenuToFood(menu, menus, foods)
        : menuToFood(menu, menus, foods)
      return <div className="menu-card" key={menu.id}><div><strong>{menu.name}</strong><small>{formatGraphNutrient(menuFood.nutrients.energyKcal)}kcal</small></div><div className="menu-card-actions">{kind === 'my' && <button type="button" className="small-action" onClick={() => onShowMenuNutrition(menu)}>詳細</button>}{kind === 'general' && <button type="button" className="small-action" onClick={() => onCloneGeneralMenu(menu)}>Myメニューに複製</button>}<button type="button" className="small-action" onClick={() => kind === 'general' ? onEditGeneralMenu(menu) : onEditMenu(menu)}>編集</button><button type="button" className="small-action danger-text" onClick={() => kind === 'general' ? onDeleteGeneralMenu(menu) : onDeleteMenu(menu)}>削除</button></div></div>
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
      {orderedMenuSets.length === 0 ? <div className="empty-state">Myセットはまだありません。</div> : <><div ref={listRef} className={`menu-set-list${draggedMenuSetId ? ' is-reordering' : ''}`}>{orderedMenuSets.map((menuSet) => { const setDisplay = menuSetItems(menuSet); const items = setDisplay.items; return <div className="menu-set-order-row" key={menuSet.id}><div className={`menu-set-card-shell${draggedMenuSetId === menuSet.id ? ' is-drag-placeholder' : ''}`} data-menu-set-id={menuSet.id}><button className="meal-order-handle menu-set-order-handle" type="button" aria-label={`${menuSet.name}をドラッグして並び替え`} disabled={savingMenuSetOrder || orderedMenuSets.length < 2} onPointerDown={(event) => startMenuSetDrag(event, menuSet.id)} onPointerUp={(event) => finishDragRef.current(event.pointerId, true)} onPointerCancel={(event) => finishDragRef.current(event.pointerId, false)}>≡</button><details className="menu-set-card"><summary><span><span className="source-badge">セット</span><strong>{menuSet.name}</strong></span><small>{formatMenuSetCalories(setDisplay.energyKcal)}</small></summary><div className="menu-set-card-body">{items.length > 0 ? <ul>{items.map((item) => <li key={item.id}><span>{item.kind}</span><strong>{item.name}</strong><small>{formatMenuSetCalories(item.energyKcal)}</small></li>)}</ul> : <p className="menu-picker-empty">メニュー・食品が選択されていません。</p>}<div className="menu-card-actions"><button type="button" className="small-action" onClick={() => onEditMenuSet(menuSet)}>編集</button><button type="button" className="small-action danger-text" onClick={() => onDeleteMenuSet(menuSet)}>削除</button></div></div></details></div></div> })}</div></>}
    </section> : <section className="section-block menu-management-panel" role="tabpanel">
      <div className="section-title"><div><span className="eyebrow">GENERAL MENUS</span><h2>一般メニュー</h2></div><button className="button primary" type="button" onClick={onNewGeneralMenu}>＋ 一般メニュー</button></div>
      {menuList(generalMenus, 'general')}
    </section>}
    {draggedMenuSet && dragPreview && <div className="menu-set-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle">≡</span><div className="menu-set-drag-copy"><span><span className="source-badge">セット</span><strong>{draggedMenuSet.name}</strong></span><small>{formatMenuSetCalories(menuSetItems(draggedMenuSet).energyKcal)}</small></div></div>}
  </>
}
