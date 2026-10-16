import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalProgressBar, NutrientGoalGraphs } from '../src/components/NutritionGraphs'
import { isNutrientWithinGoalRange } from '../src/services/nutrition'
import { EMPTY_NUTRIENTS, NUTRIENT_LABELS, type NutrientKey, type Nutrients } from '../src/types'

const goals = { ...EMPTY_NUTRIENTS, energyKcal: 2000, saltG: 6, fiberG: 20 }
const nutrientRow = (html: string, key: NutrientKey) => {
  const label = NUTRIENT_LABELS[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return html.match(new RegExp(`<div class="nutrient-graph-row"><span class="nutrient-graph-label">${label}</span>[^]*?<span class="nutrient-graph-value[^>]*>[^]*?</span></div>`))?.[0] ?? ''
}

describe('nutrition graph display', () => {
  it('keeps scaled graph references without showing target amounts or rates in each nutrient row', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={{ ...EMPTY_NUTRIENTS, energyKcal: 500 }} goals={goals} referenceMultiplier={0.5} />)
    expect(html).toContain('nutrient-graph-target')
    expect(html).not.toContain('nutrient-graph-reference')
    expect(html).not.toMatch(/目標 1000(?:\.0)?kcal/)
    expect(html).not.toContain(' · 50%')
  })

  it('colors a displayed subtotal against its reference when the complete total is missing', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={EMPTY_NUTRIENTS} availableNutrients={{ ...EMPTY_NUTRIENTS, energyKcal: 500 }} goals={goals} />)
    expect(html).toContain('500.0')
    expect(html).not.toMatch(/目標 2000(?:\.0)?kcal/)
    expect(html).not.toContain('データ不足')
    expect(html).not.toContain('25%')
    expect(nutrientRow(html, 'energyKcal')).toContain('nutrient-graph-status-under')
  })

  it('colors known micronutrient subtotals at or above target blue and lower subtotals normally', () => {
    const targets = {
      calciumMg: 1000,
      ironMg: 10,
      vitaminAMcg: 700,
      vitaminEMg: 10,
      vitaminB1Mg: 1.2,
      vitaminB2Mg: 1.4,
      vitaminCMg: 100,
    } satisfies Partial<Nutrients>
    const microGoals = { ...EMPTY_NUTRIENTS, ...targets }
    const adequateSubtotals = { ...targets, calciumMg: 1250, vitaminCMg: 120 }
    const adequateHtml = renderToStaticMarkup(<NutrientGoalGraphs
      nutrients={EMPTY_NUTRIENTS}
      availableNutrients={{ ...EMPTY_NUTRIENTS, ...adequateSubtotals }}
      goals={microGoals}
    />)
    for (const key of Object.keys(targets) as NutrientKey[]) {
      expect(nutrientRow(adequateHtml, key)).toContain('nutrient-graph-status-ok')
    }

    const insufficientHtml = renderToStaticMarkup(<NutrientGoalGraphs
      nutrients={EMPTY_NUTRIENTS}
      availableNutrients={{ ...EMPTY_NUTRIENTS, ...Object.fromEntries(Object.keys(targets).map((key) => [key, 0])) }}
      goals={microGoals}
    />)
    for (const key of Object.keys(targets) as NutrientKey[]) {
      expect(nutrientRow(insufficientHtml, key)).toContain('nutrient-graph-status-under')
    }
  })

  it('uses displayed energy and macronutrient subtotals for status while keeping missing values uncolored', () => {
    const macroGoals = { ...EMPTY_NUTRIENTS, energyKcal: 2000, proteinG: 80, fatG: 60, carbohydrateG: 300 }
    const available: Nutrients = {
      ...EMPTY_NUTRIENTS,
      energyKcal: 1800,
      proteinG: 50,
      fatG: (2000 * 0.2) / 9,
      carbohydrateG: 275,
    }
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={EMPTY_NUTRIENTS} availableNutrients={available} goals={macroGoals} />)
    for (const key of ['energyKcal', 'proteinG', 'fatG', 'carbohydrateG'] as const) {
      expect(nutrientRow(html, key)).toContain('nutrient-graph-status-ok')
    }
    expect(nutrientRow(html, 'saltG')).toContain('nutrient-graph-status-unknown')
    expect(nutrientRow(html, 'saltG')).not.toContain('nutrient-graph-intake')
  })

  it('does not color a subtotal without a visible reference and respects one-third scaled micronutrient ranges', () => {
    const calciumKey: NutrientKey = 'calciumMg'
    const unavailableReference = renderToStaticMarkup(<NutrientGoalGraphs
      nutrients={EMPTY_NUTRIENTS}
      availableNutrients={{ ...EMPTY_NUTRIENTS, [calciumKey]: 1000 }}
      goals={{ ...EMPTY_NUTRIENTS, [calciumKey]: 1000 }}
      showReference={false}
    />)
    expect(nutrientRow(unavailableReference, calciumKey)).toContain('nutrient-graph-status-unknown')

    const missingGoal = renderToStaticMarkup(<NutrientGoalGraphs
      nutrients={EMPTY_NUTRIENTS}
      availableNutrients={{ ...EMPTY_NUTRIENTS, [calciumKey]: 1 }}
      goals={EMPTY_NUTRIENTS}
    />)
    expect(nutrientRow(missingGoal, calciumKey)).toContain('nutrient-graph-status-unknown')

    const oneThirdReference = renderToStaticMarkup(<NutrientGoalGraphs
      nutrients={EMPTY_NUTRIENTS}
      availableNutrients={{ ...EMPTY_NUTRIENTS, [calciumKey]: 300 }}
      goals={{ ...EMPTY_NUTRIENTS, [calciumKey]: 900 }}
      referenceMultiplier={1 / 3}
    />)
    expect(nutrientRow(oneThirdReference, calciumKey)).toContain('nutrient-graph-status-ok')
  })

  it('omits reference amounts when reference display is disabled', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={EMPTY_NUTRIENTS} goals={goals} showReference={false} />)
    expect(html).not.toContain('nutrient-graph-reference')
  })

  it('distinguishes missing totals from missing goals', () => {
    const html = renderToStaticMarkup(<GoalProgressBar label="エネルギー" value={null} availableValue={500} goal={2000} unit="kcal" range={{ min: 1800, max: 2200 }} />)
    expect(html).toContain('データ不足')
    expect(html).not.toContain('比較する目標がありません')
    expect(html).toContain('goal-progress-status-outside')
  })

  it('uses an adequate displayed subtotal for the overview color without changing the missing-total label', () => {
    const html = renderToStaticMarkup(<GoalProgressBar label="エネルギー" value={null} availableValue={2000} goal={2000} unit="kcal" range={{ min: 1800, max: 2200 }} />)
    expect(html).toContain('goal-progress-status-ok')
    expect(html).toContain('データ不足')
  })

  it('uses complete totals and inclusive bounds for suitable color', () => {
    expect(isNutrientWithinGoalRange(null, goals, 'energyKcal')).toBe(false)
    expect(isNutrientWithinGoalRange(1800, goals, 'energyKcal')).toBe(true)
    expect(isNutrientWithinGoalRange(2200, goals, 'energyKcal')).toBe(true)
    expect(isNutrientWithinGoalRange(1799, goals, 'energyKcal')).toBe(false)
    expect(isNutrientWithinGoalRange(2201, goals, 'energyKcal')).toBe(false)
    expect(isNutrientWithinGoalRange(20, goals, 'proteinG')).toBe(false)
    expect(isNutrientWithinGoalRange(5, goals, 'saltG')).toBe(true)
    expect(isNutrientWithinGoalRange(7, goals, 'saltG')).toBe(false)
    expect(isNutrientWithinGoalRange(21, goals, 'fiberG')).toBe(true)
    expect(isNutrientWithinGoalRange(19, goals, 'fiberG')).toBe(false)
  })
})
