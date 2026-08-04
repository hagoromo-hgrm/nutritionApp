import { describe, expect, it } from 'vitest'
import { resolveMealEntryTime } from '../src/services/mealTime'

const proposedEatenAt = '2026-08-04T23:00:00.000Z'
const existingMealTime = '2026-08-04T22:00:00.000Z'
const editingEatenAt = '2026-08-04T21:00:00.000Z'

describe('meal entry time', () => {
  it('朝食の初回登録では現在の時刻を使う', () => {
    expect(resolveMealEntryTime({ mealType: '朝食', proposedEatenAt })).toBe(proposedEatenAt)
  })

  it('朝食の追加入力では既存の区分時刻を使う', () => {
    expect(resolveMealEntryTime({ mealType: '朝食', proposedEatenAt, existingMealTime })).toBe(existingMealTime)
  })

  it('編集時は現行の共有時刻を優先する', () => {
    expect(resolveMealEntryTime({
      mealType: '朝食',
      proposedEatenAt,
      existingMealTime,
      editingEatenAt,
    })).toBe(existingMealTime)
  })

  it('間食の追加はその都度の時刻を使い、編集時は元の時刻を保つ', () => {
    expect(resolveMealEntryTime({ mealType: '間食', proposedEatenAt, existingMealTime })).toBe(proposedEatenAt)
    expect(resolveMealEntryTime({
      mealType: '間食',
      proposedEatenAt,
      existingMealTime,
      editingEatenAt,
    })).toBe(editingEatenAt)
  })
})
