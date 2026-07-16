import { describe, expect, it } from 'vitest'
import { buildDailyNutrientTrend } from '../src/services/trend'
import type { MealEntry } from '../src/types'

const entry: MealEntry = {
  id: 'meal_1', eatenAt: '2026-07-16T00:00:00.000Z', mealType: '朝食', foodId: 'food_1', amount: 1, amountUnit: '個',
  foodSnapshot: { name: 'テスト食品', maker: '', barcode: '', baseAmount: 1, baseUnit: '個', nutrients: { energyKcal: 300, proteinG: 10, fatG: 5, carbohydrateG: 20, fiberG: 1, saltG: 0.5, calciumMg: 10, ironMg: 1, vitaminAMcg: 10, vitaminEMg: 1, vitaminB1Mg: 0.1, vitaminB2Mg: 0.1, vitaminCMg: 5, saturatedFatG: 2 } },
  calculatedNutrients: { energyKcal: 300, proteinG: 10, fatG: 5, carbohydrateG: 20, fiberG: 1, saltG: 0.5, calciumMg: 10, ironMg: 1, vitaminAMcg: 10, vitaminEMg: 1, vitaminB1Mg: 0.1, vitaminB2Mg: 0.1, vitaminCMg: 5, saturatedFatG: 2 },
}

describe('daily nutrient trend', () => {
  it('指定期間の日付ごとに記録を集計し、記録がない日も含める', () => {
    const points = buildDailyNutrientTrend([entry], '2026-07-15', '2026-07-16')
    expect(points).toHaveLength(2)
    expect(points[0].date).toBe('2026-07-15')
    expect(points[0].nutrients.energyKcal).toBe(0)
    expect(points[1].nutrients.energyKcal).toBe(300)
  })
})
