import { formatNutrient, goalRate } from '../services/nutrition'
import { NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, type NutritionGoals, type Nutrients } from '../types'

interface NutrientSummaryProps {
  nutrients: Nutrients
  goals?: NutritionGoals
  compact?: boolean
}

export function NutrientSummary({ nutrients, goals, compact = false }: NutrientSummaryProps) {
  return (
    <div className={`nutrient-grid${compact ? ' compact' : ''}`}>
      {NUTRIENT_KEYS.map((key) => {
        const rate = goals ? goalRate(nutrients[key], goals[key]) : null
        return (
          <div className="nutrient-card" key={key}>
            <span className="nutrient-label">{NUTRIENT_LABELS[key]}</span>
            <strong>{formatNutrient(nutrients[key])}<small>{NUTRIENT_UNITS[key]}</small></strong>
            {goals?.[key] !== null && goals?.[key] !== undefined && (
              <span className="nutrient-goal">目標 {formatNutrient(goals[key])}{NUTRIENT_UNITS[key]}{rate === null ? '' : ` / ${rate.toFixed(0)}%`}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
