import { describe, expect, it } from 'vitest'
import { normalizeMealEntryGroups, sortMealEntryGroup } from '../src/services/mealEntryOrder'
import type { MealEntry } from '../src/types'

const nutrients = {
  energyKcal: 1, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 1,
  calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null,
  vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
}

function entry(id: string, eatenAt: string, sortOrder?: number): MealEntry {
  return {
    id, eatenAt, mealType: '朝食', sortOrder, foodId: id,
    foodSnapshot: { name: id, maker: '', barcode: '', baseAmount: 1, baseUnit: 'g', nutrients },
    amount: 1, amountUnit: 'g', calculatedNutrients: nutrients,
  }
}

describe('meal entry display order', () => {
  it('全件が一意な表示順を持つ場合は時刻より表示順を優先する', () => {
    const later = entry('later', '2026-07-23T03:00:00.000Z', 0)
    const earlier = entry('earlier', '2026-07-23T00:00:00.000Z', 1)
    expect(sortMealEntryGroup([earlier, later]).map((item) => item.id)).toEqual(['later', 'earlier'])
  })

  it('表示順が欠損または重複した区分は全体を時刻とIDの安定順へ戻す', () => {
    const entries = [
      entry('b', '2026-07-23T03:00:00.000Z', 0),
      entry('a', '2026-07-23T03:00:00.000Z', 0),
      entry('first', '2026-07-23T00:00:00.000Z'),
    ]
    expect(sortMealEntryGroup(entries).map((item) => item.id)).toEqual(['first', 'a', 'b'])
  })

  it('複数区分をそれぞれ0始まりの連番へ正規化する', () => {
    const breakfast = entry('breakfast', '2026-07-23T00:00:00.000Z')
    const lunch = { ...entry('lunch', '2026-07-23T03:00:00.000Z'), mealType: '昼食' as const }
    expect(normalizeMealEntryGroups([lunch, breakfast]).map((item) => [item.id, item.sortOrder])).toEqual([
      ['breakfast', 0],
      ['lunch', 0],
    ])
  })
})
