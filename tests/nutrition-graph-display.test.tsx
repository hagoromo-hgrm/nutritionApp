import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalProgressBar, NutrientGoalGraphs } from '../src/components/NutritionGraphs'
import { isNutrientWithinGoalRange } from '../src/services/nutrition'
import { EMPTY_NUTRIENTS } from '../src/types'

const goals = { ...EMPTY_NUTRIENTS, energyKcal: 2000, saltG: 6, fiberG: 20 }

describe('nutrition graph display', () => {
  it('shows the scaled reference and canonical achievement rate', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={{ ...EMPTY_NUTRIENTS, energyKcal: 500 }} goals={goals} referenceMultiplier={0.5} />)
    expect(html).toMatch(/目標 1000(?:\.0)?kcal · 50%/)
  })

  it('keeps a known subtotal but marks achievement as insufficient', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={EMPTY_NUTRIENTS} availableNutrients={{ ...EMPTY_NUTRIENTS, energyKcal: 500 }} goals={goals} />)
    expect(html).toContain('500.0')
    expect(html).toMatch(/目標 2000(?:\.0)?kcal · データ不足/)
    expect(html).not.toContain('25%')
  })

  it('omits reference amounts when reference display is disabled', () => {
    const html = renderToStaticMarkup(<NutrientGoalGraphs nutrients={EMPTY_NUTRIENTS} goals={goals} showReference={false} />)
    expect(html).not.toContain('nutrient-graph-reference')
  })

  it('distinguishes missing totals from missing goals', () => {
    const html = renderToStaticMarkup(<GoalProgressBar label="エネルギー" value={null} availableValue={500} goal={2000} unit="kcal" range={{ min: 1800, max: 2200 }} />)
    expect(html).toContain('データ不足')
    expect(html).not.toContain('比較する目標がありません')
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
