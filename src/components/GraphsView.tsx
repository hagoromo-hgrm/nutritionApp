import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  getEntriesBetween,
  getWeightRecordsBetween,
} from '../db/db'
import { sortMealEntries } from '../services/mealEntryOrder'
import { formatGraphNutrient } from '../services/nutrition'
import { buildDailyNutrientTrend, buildTrendAxisTicks, buildTrendAxisTicksForRange } from '../services/trend'
import { shouldShowTrendDate } from '../services/trendDateLabels'
import { buildDailyWeightTrend, buildWeightChartRange } from '../services/weightHistory'
import {
  MEAL_TYPES,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  type MealEntry,
  type NutrientKey,
  type NutritionGoals,
  type WeightRecord,
} from '../types'
import { addDays, currentDateKey } from '../utils/date'
import { mealTone, type TrendRangeId } from './mealPresentation'
import { MealColorLegend } from './NutritionGraphs'

const TREND_RANGE_OPTIONS: Array<{ id: TrendRangeId; label: string; days: number }> = [
  { id: 'week', label: '1週間', days: 7 },
  { id: 'month', label: '1ヶ月', days: 30 },
  { id: 'threeMonths', label: '3ヶ月', days: 90 },
  { id: 'year', label: '1年', days: 365 },
]

const TREND_RANGE_DAYS: Record<TrendRangeId, number> = Object.fromEntries(
  TREND_RANGE_OPTIONS.map((option) => [option.id, option.days]),
) as Record<TrendRangeId, number>

type TrendMetric = NutrientKey | 'weightKg'

const TREND_METRIC_OPTIONS: Array<{ value: TrendMetric; label: string }> = [
  ...(['energyKcal', 'proteinG', 'fatG', 'carbohydrateG'] as NutrientKey[])
    .map((value) => ({ value, label: NUTRIENT_LABELS[value] })),
  { value: 'weightKg', label: '体重' },
]
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

export function GraphsView({ range, goals, onRangeChange }: GraphsViewProps) {
  const [metric, setMetric] = useState<TrendMetric>('energyKcal')
  const rangeDays = TREND_RANGE_DAYS[range]
  const [historyDays, setHistoryDays] = useState(() => Math.max(TREND_MIN_HISTORY_DAYS, rangeDays * 2))
  const [historyEntries, setHistoryEntries] = useState<MealEntry[]>([])
  const [historyWeightRecords, setHistoryWeightRecords] = useState<WeightRecord[]>([])
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
  const nutrientPoints = useMemo(
    () => buildDailyNutrientTrend(historyEntries, historyFrom, today, historyDays),
    [historyDays, historyEntries, historyFrom, today],
  )
  const weightPoints = useMemo(
    () => buildDailyWeightTrend(historyWeightRecords, nutrientPoints.map((point) => point.date)),
    [historyWeightRecords, nutrientPoints],
  )
  const weightMode = metric === 'weightKg'
  const nutrientMetric = weightMode ? null : metric
  const goal = nutrientMetric ? goals[nutrientMetric] : null
  const nutrientValues = nutrientMetric
    ? nutrientPoints.map((point) => point.availableNutrients[nutrientMetric] ?? 0)
    : []
  const weightRange = buildWeightChartRange(weightPoints)
  const chartMin = weightMode ? weightRange.min : 0
  const chartMax = weightMode ? weightRange.max : Math.max(goal ?? 0, ...nutrientValues, 1) * 1.15
  const axisTicks = weightMode
    ? buildTrendAxisTicksForRange(chartMin, chartMax)
    : buildTrendAxisTicks(chartMax)
  const goalPosition = !weightMode && goal !== null && goal > 0 ? Math.min(100, (goal / chartMax) * 100) : null
  const dayStep = Math.max(1, (chartViewportWidth || 320) / rangeDays)
  const dayGap = dayStep / 5
  const chartWidth = Math.max(chartViewportWidth, nutrientPoints.length * dayStep)
  const chartGridStyle = {
    gridTemplateColumns: `repeat(${Math.max(nutrientPoints.length, 1)}, minmax(0, 1fr))`,
    gap: `${dayGap}px`,
  }
  const weightPath = weightPoints
    .map((point, index) => {
      if (point.weightKg === null) return null
      const x = ((index + 0.5) / Math.max(weightPoints.length, 1)) * 100
      const y = 100 - ((point.weightKg - chartMin) / Math.max(chartMax - chartMin, 1)) * 100
      return `${x},${Math.min(100, Math.max(0, y))}`
    })
    .filter((point): point is string => point !== null)
    .join(' ')
  const metricLabel = nutrientMetric ? NUTRIENT_LABELS[nutrientMetric] : '体重'
  const metricUnit = nutrientMetric ? NUTRIENT_UNITS[nutrientMetric] : 'kg'

  useEffect(() => {
    let active = true
    void Promise.all([
      getEntriesBetween(historyFrom, today),
      getWeightRecordsBetween(historyFrom, today),
    ])
      .then(([loadedEntries, loadedWeightRecords]) => {
        if (!active) return
        setHistoryEntries(loadedEntries)
        setHistoryWeightRecords(loadedWeightRecords)
        setHistoryReady(true)
        setHistoryError(null)
      })
      .catch(() => {
        if (!active) return
        setHistoryReady(true)
        setHistoryError('グラフ用の履歴を読み込めませんでした。')
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
  }, [chartWidth, dayStep, historyReady, nutrientPoints.length])

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
      const [olderEntries, olderWeightRecords] = await Promise.all([
        getEntriesBetween(olderFrom, olderTo),
        getWeightRecordsBetween(olderFrom, olderTo),
      ])
      pendingPrependWidthRef.current = previousScrollWidth
      historyDaysRef.current = nextDays
      setHistoryDays(nextDays)
      setHistoryEntries((current) => {
        const byId = new Map([...olderEntries, ...current].map((entry) => [entry.id, entry]))
        return sortMealEntries([...byId.values()])
      })
      setHistoryWeightRecords((current) => {
        const byId = new Map([...olderWeightRecords, ...current].map((record) => [record.id, record]))
        return [...byId.values()].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
      })
      setHistoryError(null)
    } catch {
      setHistoryError('過去のグラフ履歴を追加で読み込めませんでした。')
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
    <section className="settings-card trend-toolbar-card"><div className="trend-range-tabs" role="tablist" aria-label="1画面に表示する期間">{TREND_RANGE_OPTIONS.map((option) => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? 'active' : ''} onClick={() => changeRange(option.id)}>{option.label}</button>)}</div><select className="trend-metric-select" aria-label="表示項目" value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>{TREND_METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></section>
    <section className="trend-chart-card" aria-busy={!historyReady || loadingOlder}>
      {!weightMode && <div className="trend-chart-legend">
        <MealColorLegend />
        {goalPosition !== null && <span className="trend-goal-legend"><i className="trend-legend-line" />目標 {formatGraphNutrient(goal)}{metricUnit}</span>}
      </div>}
      {historyError && <p className="trend-load-status error-text">{historyError}</p>}
      <div className="trend-chart-body">
        <div ref={scrollRef} className="trend-chart-scroll" onScroll={handleScroll}>
          <div className="trend-chart" style={{ width: `${chartWidth}px` }}>
            <div className="trend-chart-plot">
              <div className="trend-chart-values" style={chartGridStyle}>
                {weightMode
                  ? weightPoints.map((point) => {
                    const showLabel = point.weightKg !== null && shouldShowTrendDate(point.date, range)
                    return <span key={point.date} className={`trend-bar-value${point.weightKg === null ? ' is-missing' : ''}${showLabel ? '' : ' is-hidden'}`}>{point.weightKg === null ? '' : formatGraphNutrient(point.weightKg)}{point.weightKg !== null && <small>kg</small>}</span>
                  })
                  : nutrientMetric && nutrientPoints.map((point) => {
                    const availableValue = point.availableNutrients[nutrientMetric]
                    const showLabel = shouldShowTrendDate(point.date, range)
                    return <span key={point.date} className={`trend-bar-value${availableValue === null ? ' is-missing' : ''}${showLabel ? '' : ' is-hidden'}`}>{formatGraphNutrient(availableValue)}<small>{metricUnit}</small></span>
                  })}
              </div>
              <div className={`trend-chart-track-area${weightMode ? ' weight-trend-track-area' : ''}`}>
                {weightMode ? <>
                  {weightPath && <svg className="weight-trend-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={weightPath} /></svg>}
                  <div className="weight-trend-points">
                    {weightPoints.map((point, index) => {
                      if (point.weightKg === null) return null
                      const left = ((index + 0.5) / Math.max(weightPoints.length, 1)) * 100
                      const bottom = ((point.weightKg - chartMin) / Math.max(chartMax - chartMin, 1)) * 100
                      return <span key={point.recordId ?? point.date} className="weight-trend-point" style={{ left: `${left}%`, bottom: `${Math.min(100, Math.max(0, bottom))}%` }} title={`${point.date} 体重 ${formatGraphNutrient(point.weightKg)}kg`} aria-label={`${point.date} 体重 ${formatGraphNutrient(point.weightKg)}kg`} />
                    })}
                  </div>
                </> : <>
                  {goalPosition !== null && <span className="trend-chart-goal-line" style={{ bottom: `${goalPosition}%` }} />}
                  <div className="trend-chart-bars" style={chartGridStyle}>
                  {nutrientMetric && nutrientPoints.map((point) => {
                    const availableValue = point.availableNutrients[nutrientMetric]
                    const height = availableValue === null ? 0 : Math.min(100, Math.max(0, (availableValue / chartMax) * 100))
                    const segments = MEAL_TYPES.map((type) => ({ type, value: point.availableNutrientsByMealType[type]?.[nutrientMetric] ?? 0 })).filter((segment) => segment.value > 0)
                    const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0)
                    return <div className="trend-bar-track" key={point.date} title={`${point.date} ${metricLabel} ${formatGraphNutrient(availableValue)}${metricUnit}`}>{availableValue !== null && segmentTotal > 0 && <span className="trend-bar-fill" style={{ height: `${height}%` }}>{segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ height: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}</div>
                  })}
                  </div>
                </>}
              </div>
              <div className="trend-chart-dates" style={chartGridStyle}>
                {nutrientPoints.map((point) => {
                  const showLabel = shouldShowTrendDate(point.date, range)
                  return <span key={point.date} className={`trend-bar-date${showLabel ? '' : ' is-hidden'}`}>{formatTrendDate(point.date)}</span>
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="trend-chart-y-axis" aria-label={`${metricLabel}の縦軸、単位${metricUnit}`}>
          <span className="trend-chart-y-unit">{metricUnit}</span>
          <div className="trend-chart-y-scale">
            {axisTicks.map((tick) => <span key={tick.position} style={{ bottom: `${tick.position}%` }}>{formatGraphNutrient(tick.value)}</span>)}
          </div>
          <span aria-hidden="true" />
        </div>
      </div>
      {loadingOlder && <p className="trend-load-status">過去の記録を読み込んでいます…</p>}
    </section>
  </>
}
