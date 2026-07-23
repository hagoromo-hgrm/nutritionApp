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
    expect(points[0].availableNutrients.energyKcal).toBe(0)
    expect(points[1].nutrients.energyKcal).toBe(300)
    expect(points[1].availableNutrients.energyKcal).toBe(300)
  })

  it('正本では欠損を維持し、グラフの高さには既知分だけを集計する', () => {
    const incompleteEntry: MealEntry = {
      ...entry,
      id: 'meal_2',
      calculatedNutrients: {
        ...entry.calculatedNutrients,
        energyKcal: null,
        proteinG: null,
      },
    }

    const points = buildDailyNutrientTrend([entry, incompleteEntry], '2026-07-16', '2026-07-16')
    expect(points[0].nutrients.energyKcal).toBeNull()
    expect(points[0].availableNutrients.energyKcal).toBe(300)
    expect(points[0].nutrients.proteinG).toBeNull()
    expect(points[0].availableNutrients.proteinG).toBe(10)
  })

  it('食事区分ごとのグラフ用既知小計をMEAL_TYPESの順序で分けて集計する', () => {
    const lunchEntry: MealEntry = {
      ...entry,
      id: 'meal_lunch',
      mealType: '昼食',
      calculatedNutrients: {
        ...entry.calculatedNutrients,
        energyKcal: 120,
        proteinG: 4,
      },
    }

    const points = buildDailyNutrientTrend([entry, lunchEntry], '2026-07-16', '2026-07-16')
    const point = points[0]
    expect(Object.keys(point.availableNutrientsByMealType)).toEqual(['朝食', '昼食', '夕食', '間食'])
    expect(point.availableNutrientsByMealType.朝食.energyKcal).toBe(300)
    expect(point.availableNutrientsByMealType.昼食.energyKcal).toBe(120)
    expect(point.availableNutrientsByMealType.夕食.energyKcal).toBe(0)
    expect(point.availableNutrientsByMealType.間食.energyKcal).toBe(0)
  })

  it('区分ごとの欠損値は他区分の既知小計をゼロ扱いにしない', () => {
    const missingBreakfastEntry: MealEntry = {
      ...entry,
      id: 'meal_missing_breakfast',
      calculatedNutrients: {
        ...entry.calculatedNutrients,
        energyKcal: null,
      },
    }
    const lunchEntry: MealEntry = {
      ...entry,
      id: 'meal_known_lunch',
      mealType: '昼食',
      calculatedNutrients: {
        ...entry.calculatedNutrients,
        energyKcal: 120,
      },
    }

    const points = buildDailyNutrientTrend([missingBreakfastEntry, lunchEntry], '2026-07-16', '2026-07-16')
    const point = points[0]
    expect(point.availableNutrientsByMealType.朝食.energyKcal).toBeNull()
    expect(point.availableNutrientsByMealType.昼食.energyKcal).toBe(120)
    expect(point.availableNutrients.energyKcal).toBe(120)
  })

  it('その栄養素が全件欠損ならグラフ用集計も未集計にする', () => {
    const allMissingEntry: MealEntry = {
      ...entry,
      calculatedNutrients: {
        ...entry.calculatedNutrients,
        energyKcal: null,
      },
    }

    const points = buildDailyNutrientTrend([allMissingEntry], '2026-07-16', '2026-07-16')
    expect(points[0].nutrients.energyKcal).toBeNull()
    expect(points[0].availableNutrients.energyKcal).toBeNull()
  })

  it('1年表示では365日分を生成し、31日上限に切り詰めない', () => {
    const points = buildDailyNutrientTrend([], '2025-07-24', '2026-07-23', 365)
    expect(points).toHaveLength(365)
    expect(points.at(-1)?.date).toBe('2026-07-23')
  })
})
