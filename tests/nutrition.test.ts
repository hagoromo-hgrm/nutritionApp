import { describe, expect, it } from 'vitest'
import { calculateBmi, calculateNutrients, estimateDailyEnergyTarget, estimateDailyGoals, formatGraphNutrient, formatNutrient, getFoodDefaultServing, goalRate, incrementByBaseAmount, nutrientRangeForGoals, scaleNutritionGoals, sumAvailableNutrients, sumByMealType, sumEntries, sumNutrients } from '../src/services/nutrition'
import { isValidQuantityUnit } from '../src/utils/validation'
import type { BodyProfile, Food, MealEntry, Nutrients } from '../src/types'

const addedNutrients = { calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }

const food: Food = {
  id: 'food_1', name: 'テスト食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
  baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null,
  nutrients: { energyKcal: 200, proteinG: 10, fatG: null, carbohydrateG: 20, fiberG: 2, saltG: 1, ...addedNutrients },
  createdAt: '', updatedAt: '',
}

const foodWithInputUnit: Food = {
  ...food,
  id: 'food_with_input_unit',
  servingAmount: 2,
  servingUnit: '個',
  inputUnitConversions: [{ unit: '個', baseAmount: 60 }],
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

  it('登録済みの入力用単位だけを基準量へ換算する', () => {
    expect(calculateNutrients(foodWithInputUnit, 2, '個').energyKcal).toBe(240)
    expect(calculateNutrients(foodWithInputUnit, 60, 'g').energyKcal).toBe(120)
    expect(calculateNutrients(foodWithInputUnit, 1, 'パック').energyKcal).toBeNull()
    expect(getFoodDefaultServing(foodWithInputUnit)).toEqual({ amount: 2, unit: '個' })
  })

  it('入力用単位ラベルは空白・制御文字・極端な長さを拒否する', () => {
    expect(isValidQuantityUnit('杯')).toBe(true)
    expect(isValidQuantityUnit('パック')).toBe(true)
    expect(isValidQuantityUnit('   ')).toBe(false)
    expect(isValidQuantityUnit('切\nれ')).toBe(false)
    expect(isValidQuantityUnit('a'.repeat(31))).toBe(false)
  })

  it('どれかの記録に欠損があれば合計も未集計にする', () => {
    const first: Nutrients = { energyKcal: 10, proteinG: 2, fatG: null, carbohydrateG: 4, fiberG: 1, saltG: 0, ...addedNutrients }
    const second: Nutrients = { energyKcal: 20, proteinG: 1, fatG: 3, carbohydrateG: 2, fiberG: 1, saltG: 0, ...addedNutrients }
    const result = sumNutrients([first, second])
    expect(result.energyKcal).toBe(30)
    expect(result.fatG).toBeNull()
  })

  it('通常集計は欠損を伝播し、グラフ用集計は既知値だけを小計する', () => {
    const first = {
      calculatedNutrients: { energyKcal: 100, proteinG: null, fatG: 5, carbohydrateG: 4, fiberG: 1, saltG: 0, ...addedNutrients },
    } as MealEntry
    const second = {
      calculatedNutrients: { energyKcal: null, proteinG: null, fatG: 3, carbohydrateG: 2, fiberG: 1, saltG: 0, ...addedNutrients },
    } as MealEntry

    expect(sumEntries([first, second]).energyKcal).toBeNull()
    expect(sumAvailableNutrients([first, second]).energyKcal).toBe(100)
    expect(sumAvailableNutrients([first, second]).proteinG).toBeNull()
  })

  it('グラフ用集計は記録がない場合に0を返す', () => {
    expect(sumAvailableNutrients([]).energyKcal).toBe(0)
    expect(sumAvailableNutrients([]).proteinG).toBe(0)
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

  it('グラフの未集計値はプレースホルダーで表示する', () => {
    expect(formatGraphNutrient(null)).toBe('--.-')
    expect(formatGraphNutrient(999.94)).toBe(formatNutrient(999.94))
    expect(formatGraphNutrient(12.345, 2)).toBe(formatNutrient(12.345, 2))
  })
})
