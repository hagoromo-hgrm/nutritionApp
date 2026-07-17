import { describe, expect, it } from 'vitest'
import { calculateBmi, calculateNutrients, estimateDailyEnergyTarget, estimateDailyGoals, formatNutrient, goalRate, incrementByBaseAmount, nutrientRangeForGoals, scaleNutritionGoals, sumByMealType, sumNutrients } from '../src/services/nutrition'
import type { BodyProfile, Food, MealEntry, Nutrients } from '../src/types'

const addedNutrients = { calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }

const food: Food = {
  id: 'food_1', name: 'テスト食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
  baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null,
  nutrients: { energyKcal: 200, proteinG: 10, fatG: null, carbohydrateG: 20, fiberG: 2, saltG: 1, ...addedNutrients },
  createdAt: '', updatedAt: '',
}

describe('nutrition calculation', () => {
  it('基準量に対して比例計算し、欠損値は未集計のままにする', () => {
    const result = calculateNutrients(food, 50, 'g')
    expect(result.energyKcal).toBe(100)
    expect(result.proteinG).toBe(5)
    expect(result.fatG).toBeNull()
    expect(result.saltG).toBe(0.5)
  })

  it('＋1は基準量一つ分を増やす', () => {
    expect(incrementByBaseAmount(100, 100)).toBe(200)
    expect(incrementByBaseAmount(1, 1)).toBe(2)
    expect(incrementByBaseAmount(Number.NaN, 1)).toBe(1)
  })

  it('単位が異なる場合は推測変換しない', () => {
    expect(calculateNutrients(food, 1, '個').energyKcal).toBeNull()
  })

  it('どれかの記録に欠損があれば合計も未集計にする', () => {
    const first: Nutrients = { energyKcal: 10, proteinG: 2, fatG: null, carbohydrateG: 4, fiberG: 1, saltG: 0, ...addedNutrients }
    const second: Nutrients = { energyKcal: 20, proteinG: 1, fatG: 3, carbohydrateG: 2, fiberG: 1, saltG: 0, ...addedNutrients }
    const result = sumNutrients([first, second])
    expect(result.energyKcal).toBe(30)
    expect(result.fatG).toBeNull()
  })

  it('目標値に対する達成率を計算する', () => {
    expect(goalRate(25, 100)).toBe(25)
    expect(goalRate(null, 100)).toBeNull()
  })

  it('食事区分ごとの最初の値を欠損値で初期化しない', () => {
    const entry = { mealType: '朝食', calculatedNutrients: { energyKcal: 80, proteinG: 2, fatG: 1, carbohydrateG: 10, fiberG: 1, saltG: 0, ...addedNutrients } } as MealEntry
    expect(sumByMealType([entry]).朝食.energyKcal).toBe(80)
  })

  it('身体情報から参考エネルギー目標とBMIを算出する', () => {
    const profile: BodyProfile = { heightCm: 170, weightKg: 65, ageYears: 30, sex: 'male', activityLevel: 'moderate' }
    expect(estimateDailyEnergyTarget(profile)).toBe(2160)
    expect(calculateBmi(profile)).toBeCloseTo(22.49, 2)
  })

  it('身体情報からエネルギー以外の参考目標も算出する', () => {
    const profile: BodyProfile = { heightCm: 170, weightKg: 65, ageYears: 30, sex: 'male', activityLevel: 'moderate' }
    expect(estimateDailyGoals(profile)).toEqual({
      energyKcal: 2160,
      proteinG: 81,
      fatG: 60,
      carbohydrateG: 324,
      fiberG: 30.2,
      saltG: 7.5,
      calciumMg: 750,
      ironMg: 7.5,
      vitaminAMcg: 850,
      vitaminEMg: 6.5,
      vitaminB1Mg: 1.2,
      vitaminB2Mg: 1.7,
      vitaminCMg: 100,
      saturatedFatG: 16.8,
    })
  })

  it('算出に必要な性別が未選択なら目標を推測しない', () => {
    const profile: BodyProfile = { heightCm: 170, weightKg: 65, ageYears: 30, sex: 'unspecified', activityLevel: 'moderate' }
    expect(estimateDailyEnergyTarget(profile)).toBeNull()
    expect(estimateDailyGoals(profile)).toBeNull()
  })

  it('目標線の適正範囲を栄養素ごとの条件から算出する', () => {
    const goals = estimateDailyGoals({ heightCm: 170, weightKg: 65, ageYears: 30, sex: 'male', activityLevel: 'moderate' })
    expect(goals).not.toBeNull()
    if (!goals) return
    expect(nutrientRangeForGoals(goals, 'energyKcal')).toEqual({ min: 1960, max: 2360 })
    expect(nutrientRangeForGoals(goals, 'proteinG')).toEqual({ min: 54, max: 108 })
    expect(nutrientRangeForGoals(goals, 'calciumMg')).toEqual({ min: 750, max: null })
    expect(nutrientRangeForGoals(goals, 'saltG')).toEqual({ min: null, max: 7.5 })
    expect(scaleNutritionGoals(goals, 1 / 3).energyKcal).toBe(720)
  })

  it('4桁以上の表示値は小数点以下を丸める', () => {
    expect(formatNutrient(999.94)).toBe('999.9')
    expect(formatNutrient(1234.56)).toBe('1235')
  })
})
