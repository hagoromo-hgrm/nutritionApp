import { describe, expect, it } from 'vitest'
import importedFoodData from '../data/imported/purchase_prediction_foods.json'
import { NUTRIENT_KEYS, type Food } from '../src/types'
import { isFoodUnitConversion, isNutrients, isValidBarcode, isValidUnit } from '../src/utils/validation'

const foods = importedFoodData.foods as unknown as Food[]

describe('imported food data', () => {
  it('検証済み144件だけを再現可能な生成物として保持する', () => {
    expect(importedFoodData.format).toBe('nutrition-pwa-imported-food-db')
    expect(importedFoodData.formatVersion).toBe(1)
    expect(importedFoodData.metadata.conversionScript).toBe('scripts/import_food_database.py')
    expect(importedFoodData.summary).toEqual({
      inputCount: 255,
      outputCount: 144,
      excludedPlaceholderCount: 111,
    })
    expect(foods).toHaveLength(144)
  })

  it('ID・JAN・単位・栄養値をアプリのFood制約に合わせる', () => {
    expect(new Set(foods.map((food) => food.id)).size).toBe(foods.length)
    const barcodes = foods.map((food) => food.barcode).filter(Boolean)
    expect(new Set(barcodes).size).toBe(barcodes.length)
    expect(foods.every((food) => food.id.startsWith('imported:'))).toBe(true)
    expect(foods.every((food) => food.source === 'imported' && food.isCommercial === true)).toBe(true)
    expect(foods.every((food) => food.foodGroupId === `food:${food.id}`)).toBe(true)
    expect(foods.every((food) => !food.barcode || isValidBarcode(food.barcode))).toBe(true)
    expect(foods.every((food) => isValidUnit(food.baseUnit))).toBe(true)
    expect(foods.every((food) => food.baseAmount > 0 && food.baseAmount <= 100000)).toBe(true)
    expect(foods.every((food) => food.sourceVersion.trim().length > 0)).toBe(true)
    expect(foods.every((food) => isNutrients(food.nutrients) && food.nutrients.energyKcal !== null)).toBe(true)
    expect(foods.every((food) => Object.keys(food.nutrients).sort().join() === [...NUTRIENT_KEYS].sort().join())).toBe(true)
    expect(foods.every((food) => (food.inputUnitConversions ?? []).every((conversion) => isFoodUnitConversion(conversion) && conversion.unit !== food.baseUnit))).toBe(true)
    expect(foods.every((food) => {
      if (food.servingAmount === null || food.servingUnit === null) return food.servingAmount === null && food.servingUnit === null
      return food.servingUnit === food.baseUnit || food.inputUnitConversions?.some((conversion) => conversion.unit === food.servingUnit) === true
    })).toBe(true)
  })
})
