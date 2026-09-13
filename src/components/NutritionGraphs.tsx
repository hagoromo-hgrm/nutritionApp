import { formatGraphNutrient, goalRate, nutrientGraphMax, scaleNutrientReference } from '../services/nutrition'
import {
  MEAL_TYPES,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  type MealType,
  type Nutrients,
  type NutritionGoals,
} from '../types'
import { MEAL_ICON_ASSETS, mealTone } from './mealPresentation'

interface GoalSegment { type: MealType; value: number }

export function GoalProgressBar({ label, value, availableValue = value, goal, unit, range, colorClass = 'goal-progress-accent', segments, dark = false, targetPositionPercent = 50 }: { label: string; value: number | null; availableValue?: number | null; goal: number | null; unit: string; range: { min: number | null; max: number | null }; colorClass?: string; segments?: GoalSegment[]; dark?: boolean; targetPositionPercent?: number }) {
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
  return <div className={`goal-progress-card${dark ? ' goal-progress-dark' : ''} goal-progress-status-${status}`}><div className="goal-progress-heading"><span>{label}</span><strong>{formatGraphNutrient(availableValue)}<small>{unit}</small><em>{goal === null ? '目標未設定' : ` / ${formatGraphNutrient(goal)}${unit}`}</em></strong></div><div className="goal-progress-visual"><span className="goal-range-band" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{availableValue !== null && <div className={`goal-intake-bar${segments && segmentTotal > 0 ? ' goal-intake-segmented' : ` ${colorClass}`}`} style={{ width: `${progressWidth}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <span key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</div>}{targetPosition !== null && <span className="goal-target-line" style={{ left: `${targetPosition}%` }} />}</div><div className="goal-progress-footer"><span>{!hasGoal ? '比較する目標がありません' : rate === null ? 'データ不足' : `目標の${rate.toFixed(0)}%`}</span><div className="goal-progress-legends">{targetPosition !== null && <span className="goal-line-legend"><i />目標</span>}{segments && segmentTotal > 0 && <MealColorLegend />}</div></div></div>
}

export function MealColorLegend() {
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
  return <div className="nutrient-graph-row"><span className="nutrient-graph-label">{label}</span><div className="nutrient-graph-track"><span className="nutrient-graph-range" style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }} />{availableValue !== null && <span className={`nutrient-graph-intake${segments && segmentTotal > 0 ? ' nutrient-graph-intake-segmented' : ''}`} style={{ width: `${valuePercent}%` }}>{segments && segmentTotal > 0 && segments.map((segment) => <i key={segment.type} className={`meal-segment meal-segment-${mealTone(segment.type)}`} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />)}</span>}{hasGoal && <span className="nutrient-graph-target" style={{ left: '50%' }} />}</div><span className={`nutrient-graph-value nutrient-graph-status-${status === '超過' ? 'over' : status === '不足' ? 'under' : status === '適正' ? 'ok' : 'unknown'}`}>{formatGraphNutrient(availableValue)}<small>{unit}</small></span>{hasGoal && <span className="nutrient-graph-reference">目標 {formatGraphNutrient(goal)}{unit} · {rate === null ? 'データ不足' : `${rate.toFixed(0)}%`}</span>}</div>
}

export function NutrientGoalGraphs({ nutrients, availableNutrients, goals, subtotals, availableSubtotals, colorByMeal = false, excludeEnergy = false, showReference = true, referenceMultiplier = 1 }: { nutrients: Nutrients; availableNutrients?: Nutrients; goals: NutritionGoals; subtotals?: Record<string, Nutrients>; availableSubtotals?: Record<string, Nutrients>; colorByMeal?: boolean; excludeEnergy?: boolean; showReference?: boolean; referenceMultiplier?: number }) {
  const keys = excludeEnergy ? NUTRIENT_KEYS.filter((key) => key !== 'energyKcal') : NUTRIENT_KEYS
  const segmentSubtotals = availableSubtotals ?? subtotals
  return <section className={`nutrient-graph${showReference ? '' : ' nutrient-graph-without-reference'}`}><div className="nutrient-graph-heading"><span>栄養素</span><span>{showReference ? '基準ライン' : ''}</span><span>摂取量</span></div><div className="nutrient-graph-rows">{keys.map((key) => {
    const { goal, range } = scaleNutrientReference(goals, key, referenceMultiplier)
    return <NutrientGraphRow key={key} label={NUTRIENT_LABELS[key]} value={nutrients[key]} availableValue={availableNutrients ? availableNutrients[key] : nutrients[key]} goal={goal} unit={NUTRIENT_UNITS[key]} range={range} segments={colorByMeal && segmentSubtotals ? MEAL_TYPES.map((type) => ({ type, value: segmentSubtotals[type]?.[key] ?? 0 })).filter((segment) => segment.value > 0) : undefined} showReference={showReference} />
  })}</div>{colorByMeal && segmentSubtotals && <div className="nutrient-graph-footer"><MealColorLegend /></div>}</section>
}
