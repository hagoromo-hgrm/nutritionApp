import { describe, expect, it } from 'vitest'
import { buildTodayDetailSummary, resolveTodayDetailPeriod, TODAY_DETAIL_RANGE_OPTIONS } from '../src/services/todayDetails'
import { EMPTY_NUTRIENTS, type MealEntry, type Nutrients } from '../src/types'

function entry(id: string, mealType: MealEntry['mealType'], nutrients: Partial<Nutrients>): MealEntry {
  const calculatedNutrients = { ...EMPTY_NUTRIENTS, ...nutrients }
  return {
    id,
    eatenAt: '2026-07-30T03:00:00.000Z',
    mealType,
    foodId: `food_${id}`,
    amount: 1,
    amountUnit: '個',
    foodSnapshot: {
      name: 'テスト食品',
      maker: '',
      barcode: '',
      baseAmount: 1,
      baseUnit: '個',
      nutrients: calculatedNutrients,
    },
    calculatedNutrients,
  }
}

describe('today details period and summary', () => {
  it('1日・1週間・1ヶ月のラベルと日数を公開する', () => {
    expect(TODAY_DETAIL_RANGE_OPTIONS).toEqual([
      { id: 'day', label: '1日', days: 1 },
      { id: 'week', label: '1週間', days: 7 },
      { id: 'month', label: '1ヶ月', days: 30 },
    ])
  })

  it.each([
    ['day', '2026-07-30', '2026-07-30'],
    ['week', '2026-07-30', '2026-07-24'],
    ['month', '2026-07-30', '2026-07-01'],
  ] as const)('選択日を終端に含む期間を解決する (%s)', (rangeId, selectedDate, from) => {
    expect(resolveTodayDetailPeriod(rangeId, selectedDate)).toEqual({
      rangeId,
      from,
      to: selectedDate,
      days: rangeId === 'day' ? 1 : rangeId === 'week' ? 7 : 30,
    })
  })

  it('食事区分別に正規集計と既知値の小計を作る', () => {
    const breakfast = entry('breakfast', '朝食', { energyKcal: 300, proteinG: 10 })
    const lunch = entry('lunch', '昼食', { energyKcal: 500, proteinG: 20 })

    const summary = buildTodayDetailSummary([breakfast, lunch])

    expect(summary.nutrients.energyKcal).toBe(800)
    expect(summary.availableNutrients.energyKcal).toBe(800)
    expect(summary.subtotals.朝食.energyKcal).toBe(300)
    expect(summary.subtotals.昼食.energyKcal).toBe(500)
    expect(summary.availableSubtotals.朝食.energyKcal).toBe(300)
    expect(summary.availableSubtotals.昼食.energyKcal).toBe(500)
    expect(summary.availableSubtotals.夕食.energyKcal).toBe(0)
    expect(summary.availableSubtotals.間食.energyKcal).toBe(0)
  })

  it('欠損時は正規集計をnullにし、既知の小計を維持する', () => {
    const missingBreakfast = entry('missing-breakfast', '朝食', { energyKcal: null })
    const knownLunch = entry('known-lunch', '昼食', { energyKcal: 200 })

    const summary = buildTodayDetailSummary([missingBreakfast, knownLunch])

    expect(summary.nutrients.energyKcal).toBeNull()
    expect(summary.availableNutrients.energyKcal).toBe(200)
    expect(summary.availableSubtotals.朝食.energyKcal).toBeNull()
    expect(summary.availableSubtotals.昼食.energyKcal).toBe(200)
    expect(Object.keys(summary.availableSubtotals)).toEqual(['朝食', '昼食', '夕食', '間食'])
  })
})
