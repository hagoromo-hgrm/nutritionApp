import { useEffect, useMemo, useRef, useState } from 'react'
import { getEntriesBetween } from '../db/db'
import { getMealEntryDisplayName, isMealEntryDeleted } from '../services/mealEntryDisplay'
import { formatNutrient, nutrientRangeForGoals, sumAvailableNutrients } from '../services/nutrition'
import {
  buildTodayDetailSummary,
  resolveTodayDetailPeriod,
  TODAY_DETAIL_RANGE_OPTIONS,
  type TodayDetailRangeId,
} from '../services/todayDetails'
import {
  EMPTY_NUTRIENTS,
  MEAL_TYPES,
  type MealEntry,
  type MealType,
  type Nutrients,
  type NutritionGoals,
} from '../types'
import { addDays, currentDateKey, formatTime } from '../utils/date'
import { MEAL_ICON_ASSETS } from './mealPresentation'
import { GoalProgressBar, NutrientGoalGraphs } from './NutritionGraphs'

interface TodayViewProps {
  selectedDate: string; setSelectedDate: (value: string) => void; total: Nutrients; goals: NutritionGoals; entries: MealEntry[]; subtotals: Record<string, Nutrients>
  existingFoodIds: Set<string>; onOpenMealConfirmation: (type: MealType) => void
  onShowMealDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onShowTodayDetails: () => void
}

export function TodayView(props: TodayViewProps) {
  const { selectedDate, setSelectedDate, total, goals, entries, subtotals, existingFoodIds, onOpenMealConfirmation, onShowMealDetails, onShowTodayDetails } = props
  const availableNutrients = sumAvailableNutrients(entries)
  const availableSubtotals = Object.fromEntries(MEAL_TYPES.map((type) => [type, sumAvailableNutrients(entries.filter((entry) => entry.mealType === type))])) as Record<string, Nutrients>
  return <>
    <section className="page-heading"><div><span className="eyebrow">DAILY LOG</span><h1>記録</h1></div><div className="date-picker"><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value) }} /><button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button></div></section>
    <section className="hero-summary"><div className="hero-summary-heading"><div className="today-hero-copy"><span className="section-kicker">{selectedDate === currentDateKey() ? 'TODAY' : selectedDate}</span><strong>今日の進捗</strong></div><button className="hero-detail-button" type="button" onClick={onShowTodayDetails}>詳細</button></div><GoalProgressBar label="カロリー" value={total.energyKcal} availableValue={availableNutrients.energyKcal} goal={goals.energyKcal} unit="kcal" range={nutrientRangeForGoals(goals, 'energyKcal')} segments={MEAL_TYPES.map((type) => ({ type, value: availableSubtotals[type]?.energyKcal ?? 0 })).filter((segment) => segment.value > 0)} dark targetPositionPercent={75} /></section>
    <section className="section-block meals-section"><div className="section-title"><div><span className="eyebrow">MEALS</span><h2>食事の内訳</h2></div><span className="count-label">{entries.length}件</span></div>{MEAL_TYPES.map((type) => <MealGroup key={type} type={type} entries={entries.filter((entry) => entry.mealType === type)} subtotal={subtotals[type]} existingFoodIds={existingFoodIds} onOpenConfirmation={onOpenMealConfirmation} onShowDetails={onShowMealDetails} />)}</section>
  </>
}

export function MealConfirmationView({ type, entries, subtotal, onAdd, onEdit, onDelete, onReorder, onDone }: {
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
    <section className="page-heading meal-confirmation-heading"><div><span className="eyebrow">MEAL CONFIRMATION</span><h1>{type}の確認</h1></div><button className="button ghost" type="button" onClick={onDone}>記録へ</button></section>
    <section className="settings-card meal-confirmation-card">
      <div className="meal-confirmation-summary"><div><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" /><span>{type}</span></div><strong>{entries.length}件 · {formatNutrient(subtotal.energyKcal)} kcal</strong></div>
      {orderedEntries.length > 0 ? <div ref={listRef} className={`meal-confirmation-list${draggedEntryId ? ' is-reordering' : ''}`}>{orderedEntries.map((entry) => { const entryName = getMealEntryDisplayName(entry); return <div className={`meal-confirmation-entry${draggedEntryId === entry.id ? ' is-drag-placeholder' : ''}`} key={entry.id} data-meal-entry-id={entry.id}><button className="meal-order-handle" type="button" aria-label={`${entryName}をドラッグして並び替え`} disabled={savingOrder || orderedEntries.length < 2} onPointerDown={(event) => startDrag(event, entry.id)} onPointerUp={(event) => finishDragRef.current(event.pointerId, true)} onPointerCancel={(event) => finishDragRef.current(event.pointerId, false)}>≡</button><div className="meal-confirmation-entry-copy"><strong>{entryName}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}</span></div><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b><button className="small-action" type="button" disabled={savingOrder} onClick={() => onEdit(entry)}>編集</button><button className="small-action danger-text" type="button" disabled={savingOrder} onClick={() => onDelete(entry)}>削除</button></div> })}</div> : <div className="empty-state">記録なし</div>}
      <div className="meal-confirmation-actions"><button className="button primary" type="button" onClick={onAdd}>＋ {type}を追加</button><button className="button secondary" type="button" onClick={onDone}>登録を完了</button></div>
    </section>
    {draggedEntry && dragPreview && <div className="meal-drag-overlay" style={dragPreview} aria-hidden="true"><span className="meal-order-handle">≡</span><div className="meal-confirmation-entry-copy"><strong>{getMealEntryDisplayName(draggedEntry)}{draggedEntry.foodSnapshot.maker ? `（${draggedEntry.foodSnapshot.maker}）` : ''}</strong><span>{draggedEntry.amount}{draggedEntry.amountUnit}{type === '間食' ? ` · ${formatTime(draggedEntry.eatenAt)}` : ''}</span></div><b>{formatNutrient(draggedEntry.calculatedNutrients.energyKcal)} kcal</b></div>}
  </>
}

export function TodayDetailsModal({ selectedDate, goals, entries, onClose }: { selectedDate: string; goals: NutritionGoals; entries: MealEntry[]; onClose: () => void }) {
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
    () => displayedEntries ? buildTodayDetailSummary(displayedEntries, period.days) : null,
    [displayedEntries, period.days],
  )
  const currentLoadError = loadError?.key === periodKey ? loadError.message : null
  const waitingForPeriod = rangeId !== 'day' && loadedPeriod?.key !== periodKey && currentLoadError === null
  const periodLabel = period.from === period.to ? period.to : `${period.from}〜${period.to}`

  return <div className="modal-backdrop nutrient-detail-backdrop" role="dialog" aria-modal="true" aria-label="詳細"><section className="modal-card nutrient-detail-modal today-details-modal" aria-busy={loading || waitingForPeriod}><div className="modal-heading"><div><span className="eyebrow">DETAILS</span><h2>詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="today-detail-range-control"><div className="today-detail-range-tabs" role="tablist" aria-label="詳細の集計期間">{TODAY_DETAIL_RANGE_OPTIONS.map((option) => <button key={option.id} id={`today-detail-range-${option.id}`} type="button" role="tab" aria-selected={rangeId === option.id} aria-controls="today-detail-period-panel" className={rangeId === option.id ? 'active' : ''} onClick={() => setRangeId(option.id)}>{option.label}</button>)}</div><div className="today-detail-range-summary"><span>{periodLabel}</span><strong>{period.days === 1 ? '当日' : '1日平均'}</strong></div></div><div id="today-detail-period-panel" role="tabpanel" aria-labelledby={`today-detail-range-${rangeId}`}>{(loading || waitingForPeriod) && !summary ? <p className="today-detail-load-status" role="status">期間の食事記録を読み込んでいます…</p> : currentLoadError ? <div className="today-detail-load-status error-text" role="alert"><p>{currentLoadError}</p><button className="button secondary" type="button" onClick={() => setReloadToken((current) => current + 1)}>再試行</button></div> : summary && <NutrientGoalGraphs nutrients={summary.nutrients} availableNutrients={summary.availableNutrients} goals={goals} subtotals={summary.subtotals} availableSubtotals={summary.availableSubtotals} colorByMeal />}</div></section></div>
}

function MealGroup({ type, entries, subtotal, existingFoodIds, onShowDetails, onOpenConfirmation }: { type: MealType; entries: MealEntry[]; subtotal?: Nutrients; existingFoodIds: Set<string>; onShowDetails: (type: MealType, entries: MealEntry[], subtotal: Nutrients) => void; onOpenConfirmation: (type: MealType) => void }) {
  const sharedTime = entries[0]?.eatenAt
  return <div className="meal-group"><div className="meal-heading"><h3><img className="meal-icon" src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{type}</h3><div className="meal-heading-actions"><span>{entries.length ? `${formatNutrient(subtotal?.energyKcal ?? null)} kcal` : '記録なし'}</span>{entries.length > 0 && <button type="button" className="small-action" onClick={() => onShowDetails(type, entries, subtotal ?? EMPTY_NUTRIENTS)}>詳細</button>}<button type="button" className="meal-record-button" onClick={() => onOpenConfirmation(type)}>編集</button></div></div>{entries.length > 0 && type !== '間食' && <div className="meal-shared-time">食事時刻：{sharedTime ? formatTime(sharedTime) : '未設定'}</div>}{entries.map((entry) => <div className="meal-entry" key={entry.id}><div className="meal-entry-copy"><strong>{getMealEntryDisplayName(entry)}{entry.foodSnapshot.maker ? `（${entry.foodSnapshot.maker}）` : ''}</strong><span>{entry.amount}{entry.amountUnit}{type === '間食' ? ` · ${formatTime(entry.eatenAt)}` : ''}{isMealEntryDeleted(entry, existingFoodIds) ? ' · 削除済み食品' : ''}</span></div><div className="meal-entry-actions"><b>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</b></div></div>)}</div>
}
