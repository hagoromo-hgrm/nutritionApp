import { describe, expect, it } from 'vitest'
import { averageNutritionGoalsForPeriod, resolveNutritionGoals } from '../src/services/goalHistory'
import { DEFAULT_GOALS, type NutritionGoalRecord, type NutritionGoals } from '../src/types'

function goals(energyKcal: number, proteinG: number): NutritionGoals {
  return { ...DEFAULT_GOALS, energyKcal, proteinG }
}

const records: NutritionGoalRecord[] = [
  { effectiveFrom: '2026-08-10', recordedAt: '2026-08-09T15:00:00.000Z', goals: goals(2200, 70) },
  { effectiveFrom: '2026-08-01', recordedAt: '2026-07-31T15:00:00.000Z', goals: goals(1800, 50) },
]

describe('nutrition goal history', () => {
  it('適用開始日より前は移行時の最古値、その日以降は最新値を返す', () => {
    expect(resolveNutritionGoals(records, '2020-01-01', DEFAULT_GOALS).energyKcal).toBe(1800)
    expect(resolveNutritionGoals(records, '2026-08-09', DEFAULT_GOALS).energyKcal).toBe(1800)
    expect(resolveNutritionGoals(records, '2026-08-10', DEFAULT_GOALS).energyKcal).toBe(2200)
  })

  it('期間表示用目標は日別目標を平均し、欠損が含まれる栄養素は欠損を維持する', () => {
    const average = averageNutritionGoalsForPeriod(records, '2026-08-09', '2026-08-10', DEFAULT_GOALS)
    expect(average.energyKcal).toBe(2000)
    expect(average.proteinG).toBe(60)
    expect(average.fiberG).toBeNull()
  })
})
