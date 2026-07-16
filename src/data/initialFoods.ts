import type { Food, FoodUnit } from '../types'

const sourceVersion = '日本食品標準成分表（八訂）増補2023年・初期サンプル v3'
const now = '2026-07-15T00:00:00.000Z'

function food(
  id: string,
  name: string,
  baseAmount: number,
  baseUnit: FoodUnit,
  nutrients: Food['nutrients'],
): Food {
  return {
    id, name, maker: '', barcode: '', source: 'mext', sourceVersion,
    baseAmount, baseUnit, servingAmount: baseAmount, servingUnit: baseUnit, nutrients,
    createdAt: now, updatedAt: now,
  }
}

// 初期データは、ユーザーが量を迷いにくい食品固有の単位を優先する。
export const initialFoods: Food[] = [
  food('mext_rice_white', 'こめ［水稲めし］精白米', 1, '合', {
    energyKcal: 234, proteinG: 3.8, fatG: 0.5, carbohydrateG: 55.7, fiberG: 2.3, saltG: 0,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
  food('mext_chicken_breast', '若鶏むね肉（皮なし）', 100, 'g', {
    energyKcal: 105, proteinG: 23.3, fatG: 1.9, carbohydrateG: 0.1, fiberG: 0, saltG: 0.1,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
  food('mext_egg', '鶏卵（全卵）', 1, '個', {
    energyKcal: 85, proteinG: 7.3, fatG: 6.1, carbohydrateG: 0.2, fiberG: 0, saltG: 0.2,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
  food('mext_banana', 'バナナ', 1, '本', {
    energyKcal: 93, proteinG: 1.1, fatG: 0.2, carbohydrateG: 22.5, fiberG: 1.1, saltG: 0,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
  food('mext_milk', '普通牛乳', 200, 'ml', {
    energyKcal: 122, proteinG: 6.6, fatG: 7.6, carbohydrateG: 9.6, fiberG: 0, saltG: 0.2,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
  food('mext_tofu', '木綿豆腐', 100, 'g', {
    energyKcal: 73, proteinG: 7.0, fatG: 4.9, carbohydrateG: 1.5, fiberG: 1.1, saltG: 0,
    calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
  }),
]
