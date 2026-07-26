import type { EstimatableNutrientKey } from '../../src/services/nutrientEstimator'

export const SYNTHETIC_TARGET_NUTRIENTS = [
  'saturatedFatG',
  'fiberG',
  'calciumMg',
  'ironMg',
  'vitaminAMcg',
  'vitaminEMg',
  'vitaminB1Mg',
  'vitaminB2Mg',
  'vitaminCMg',
] as const satisfies readonly EstimatableNutrientKey[]

type MacroKey = 'energyKcal' | 'proteinG' | 'fatG' | 'carbohydrateG' | 'saltG'
type ReferenceNutrients = Record<MacroKey, number> & Record<EstimatableNutrientKey, number | null>

export interface SyntheticIngredient {
  ingredient: string
  sourceFoodId: keyof typeof SYNTHETIC_MEXT_REFERENCE
  massG: number
}

export interface SyntheticNutrientEstimatorCase {
  id: string
  name: string
  referenceMassG: number
  ingredientsText: string
  trueComposition: Array<SyntheticIngredient & { ratio: number }>
  knownNutrients: Record<MacroKey, number>
  trueNutrients: Record<EstimatableNutrientKey, number | null>
}

/**
 * `data/mext/processed/mext_foods.json` からテスト用に独立転記した100g値。
 * 出典版: 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）。
 * null はMEXT生成物の欠損を保ち、0へ置換しない。
 */
export const SYNTHETIC_MEXT_REFERENCE = {
  mext_01004: {
    energyKcal: 350, proteinG: 13.7, fatG: 5.7, carbohydrateG: 69.1, saltG: 0,
    saturatedFatG: 1.01, fiberG: 9.4, calciumMg: 47, ironMg: 3.9,
    vitaminAMcg: 0, vitaminEMg: 0.6, vitaminB1Mg: 0.2, vitaminB2Mg: 0.08, vitaminCMg: 0,
  },
  mext_01015: {
    energyKcal: 349, proteinG: 8.3, fatG: 1.5, carbohydrateG: 75.8, saltG: 0,
    saturatedFatG: 0.34, fiberG: 2.5, calciumMg: 20, ironMg: 0.5,
    vitaminAMcg: 0, vitaminEMg: 0.3, vitaminB1Mg: 0.11, vitaminB2Mg: 0.03, vitaminCMg: 0,
  },
  mext_01023: {
    energyKcal: 320, proteinG: 12.8, fatG: 2.9, carbohydrateG: 68.2, saltG: 0,
    saturatedFatG: 0.53, fiberG: 11.2, calciumMg: 26, ironMg: 3.1,
    vitaminAMcg: 0, vitaminEMg: 1, vitaminB1Mg: 0.34, vitaminB2Mg: 0.09, vitaminCMg: 0,
  },
  mext_04029: {
    energyKcal: 451, proteinG: 36.7, fatG: 25.7, carbohydrateG: 28.5, saltG: 0,
    saturatedFatG: 3.59, fiberG: 18.1, calciumMg: 190, ironMg: 8,
    vitaminAMcg: null, vitaminEMg: 1.7, vitaminB1Mg: 0.07, vitaminB2Mg: 0.24, vitaminCMg: 1,
  },
  mext_05001: {
    energyKcal: 609, proteinG: 19.6, fatG: 51.8, carbohydrateG: 20.9, saltG: 0,
    saturatedFatG: 3.95, fiberG: 10.1, calciumMg: 250, ironMg: 3.6,
    vitaminAMcg: 1, vitaminEMg: 30, vitaminB1Mg: 0.2, vitaminB2Mg: 1.06, vitaminCMg: 0,
  },
  mext_05017: {
    energyKcal: 604, proteinG: 19.8, fatG: 53.8, carbohydrateG: 16.5, saltG: 0,
    saturatedFatG: 7.8, fiberG: 10.8, calciumMg: 1200, ironMg: 9.6,
    vitaminAMcg: 1, vitaminEMg: 0.1, vitaminB1Mg: 0.95, vitaminB2Mg: 0.25, vitaminCMg: null,
  },
  mext_12004: {
    energyKcal: 142, proteinG: 12.2, fatG: 10.2, carbohydrateG: 0.4, saltG: 0.4,
    saturatedFatG: 3.12, fiberG: 0, calciumMg: 46, ironMg: 1.5,
    vitaminAMcg: 210, vitaminEMg: 1.3, vitaminB1Mg: 0.06, vitaminB2Mg: 0.37, vitaminCMg: 0,
  },
  mext_13009: {
    energyKcal: 490, proteinG: 25.5, fatG: 26.2, carbohydrateG: 39.3, saltG: 1.1,
    saturatedFatG: 16.28, fiberG: 0, calciumMg: 890, ironMg: 0.4,
    vitaminAMcg: 180, vitaminEMg: 0.6, vitaminB1Mg: 0.25, vitaminB2Mg: 1.1, vitaminCMg: 5,
  },
  mext_13010: {
    energyKcal: 354, proteinG: 34, fatG: 1, carbohydrateG: 53.3, saltG: 1.4,
    saturatedFatG: 0.44, fiberG: 0, calciumMg: 1100, ironMg: 0.5,
    vitaminAMcg: 6, vitaminEMg: null, vitaminB1Mg: 0.3, vitaminB2Mg: 1.6, vitaminCMg: 5,
  },
  mext_14017: {
    energyKcal: 700, proteinG: 0.6, fatG: 81, carbohydrateG: 0.2, saltG: 1.9,
    saturatedFatG: 50.45, fiberG: 0, calciumMg: 15, ironMg: 0.1,
    vitaminAMcg: 520, vitaminEMg: 1.5, vitaminB1Mg: 0.01, vitaminB2Mg: 0.03, vitaminCMg: 0,
  },
  mext_14030: {
    energyKcal: 881, proteinG: 0, fatG: 99.9, carbohydrateG: 0, saltG: 0,
    saturatedFatG: 51.13, fiberG: 0, calciumMg: 0, ironMg: 0,
    vitaminAMcg: 0, vitaminEMg: 9.5, vitaminB1Mg: 0, vitaminB2Mg: 0, vitaminCMg: 0,
  },
  mext_15116: {
    energyKcal: 550, proteinG: 6.9, fatG: 34.1, carbohydrateG: 55.8, saltG: 0.2,
    saturatedFatG: 19.88, fiberG: 3.9, calciumMg: 240, ironMg: 2.4,
    vitaminAMcg: 66, vitaminEMg: 0.7, vitaminB1Mg: 0.19, vitaminB2Mg: 0.41, vitaminCMg: 0,
  },
  mext_16048: {
    energyKcal: 386, proteinG: 18.5, fatG: 21.6, carbohydrateG: 42.4, saltG: 0,
    saturatedFatG: 12.4, fiberG: 23.9, calciumMg: 140, ironMg: 14,
    vitaminAMcg: 3, vitaminEMg: 0.3, vitaminB1Mg: 0.16, vitaminB2Mg: 0.22, vitaminCMg: 0,
  },
} as const satisfies Record<string, ReferenceNutrients>

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function weightedTotal(
  ingredients: readonly SyntheticIngredient[],
  key: MacroKey | EstimatableNutrientKey,
): number | null {
  let total = 0
  for (const ingredient of ingredients) {
    const value = SYNTHETIC_MEXT_REFERENCE[ingredient.sourceFoodId][key]
    if (value === null) return null
    total += value * ingredient.massG / 100
  }
  return round(total, 6)
}

function makeCase(
  id: string,
  name: string,
  ingredients: readonly SyntheticIngredient[],
): SyntheticNutrientEstimatorCase {
  const referenceMassG = ingredients.reduce((total, ingredient) => total + ingredient.massG, 0)
  return {
    id,
    name,
    referenceMassG,
    ingredientsText: ingredients.map((ingredient) => ingredient.ingredient).join('、'),
    trueComposition: ingredients.map((ingredient) => ({
      ...ingredient,
      ratio: round(ingredient.massG / referenceMassG, 6),
    })),
    knownNutrients: {
      energyKcal: Math.round(weightedTotal(ingredients, 'energyKcal')!),
      proteinG: round(weightedTotal(ingredients, 'proteinG')!, 1),
      fatG: round(weightedTotal(ingredients, 'fatG')!, 1),
      carbohydrateG: round(weightedTotal(ingredients, 'carbohydrateG')!, 1),
      saltG: round(weightedTotal(ingredients, 'saltG')!, 1),
    },
    trueNutrients: Object.fromEntries(SYNTHETIC_TARGET_NUTRIENTS.map((key) => [
      key,
      weightedTotal(ingredients, key),
    ])) as Record<EstimatableNutrientKey, number | null>,
  }
}

export const SYNTHETIC_NUTRIENT_ESTIMATOR_CASES: readonly SyntheticNutrientEstimatorCase[] = [
  makeCase('cookie-01', 'バターココアクッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 32 },
    { ingredient: 'バター', sourceFoodId: 'mext_14017', massG: 24 },
    { ingredient: 'ココアパウダー', sourceFoodId: 'mext_16048', massG: 16 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 8 },
  ]),
  makeCase('biscuit-02', '全粒オートアーモンドビスケット', [
    { ingredient: '小麦全粒粉', sourceFoodId: 'mext_01023', massG: 45 },
    { ingredient: 'オートミール', sourceFoodId: 'mext_01004', massG: 25 },
    { ingredient: 'アーモンド', sourceFoodId: 'mext_05001', massG: 20 },
    { ingredient: '脱脂粉乳', sourceFoodId: 'mext_13010', massG: 10 },
  ]),
  makeCase('cookie-03', 'ミルクチョコクッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 50 },
    { ingredient: 'チョコレート', sourceFoodId: 'mext_15116', massG: 25 },
    { ingredient: '全粉乳', sourceFoodId: 'mext_13009', massG: 15 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 10 },
  ]),
  makeCase('biscuit-04', '全粒ごまきな粉ビスケット', [
    { ingredient: '小麦全粒粉', sourceFoodId: 'mext_01023', massG: 42 },
    { ingredient: 'ごま', sourceFoodId: 'mext_05017', massG: 28 },
    { ingredient: 'きな粉', sourceFoodId: 'mext_04029', massG: 18 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 12 },
  ]),
  makeCase('cookie-05', '脱脂粉乳ココアクッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 48 },
    { ingredient: '脱脂粉乳', sourceFoodId: 'mext_13010', massG: 28 },
    { ingredient: 'ココアパウダー', sourceFoodId: 'mext_16048', massG: 16 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 8 },
  ]),
  makeCase('cookie-06', 'オートチョコアーモンドクッキー', [
    { ingredient: 'オートミール', sourceFoodId: 'mext_01004', massG: 45 },
    { ingredient: 'チョコレート', sourceFoodId: 'mext_15116', massG: 25 },
    { ingredient: 'アーモンド', sourceFoodId: 'mext_05001', massG: 20 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 10 },
  ]),
  makeCase('biscuit-07', 'アーモンドショートブレッド', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 55 },
    { ingredient: 'バター', sourceFoodId: 'mext_14017', massG: 25 },
    { ingredient: 'アーモンド', sourceFoodId: 'mext_05001', massG: 15 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 5 },
  ]),
  makeCase('cookie-08', 'ココアアーモンドバタークッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 40 },
    { ingredient: 'ココアパウダー', sourceFoodId: 'mext_16048', massG: 30 },
    { ingredient: 'アーモンド', sourceFoodId: 'mext_05001', massG: 20 },
    { ingredient: 'バター', sourceFoodId: 'mext_14017', massG: 10 },
  ]),
  makeCase('biscuit-09', '全粒ミルクバタービスケット', [
    { ingredient: '小麦全粒粉', sourceFoodId: 'mext_01023', massG: 48 },
    { ingredient: '全粉乳', sourceFoodId: 'mext_13009', massG: 24 },
    { ingredient: 'バター', sourceFoodId: 'mext_14017', massG: 18 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 10 },
  ]),
  makeCase('cookie-10', 'ごまココアクッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 46 },
    { ingredient: 'ごま', sourceFoodId: 'mext_05017', massG: 26 },
    { ingredient: 'ココアパウダー', sourceFoodId: 'mext_16048', massG: 18 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 10 },
  ]),
  makeCase('biscuit-11', 'きな粉アーモンドビスケット', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 44 },
    { ingredient: 'きな粉', sourceFoodId: 'mext_04029', massG: 26 },
    { ingredient: 'アーモンド', sourceFoodId: 'mext_05001', massG: 20 },
    { ingredient: '卵', sourceFoodId: 'mext_12004', massG: 10 },
  ]),
  makeCase('cookie-12', 'ショートニングココアクッキー', [
    { ingredient: '小麦粉', sourceFoodId: 'mext_01015', massG: 50 },
    { ingredient: 'ショートニング', sourceFoodId: 'mext_14030', massG: 30 },
    { ingredient: 'ココアパウダー', sourceFoodId: 'mext_16048', massG: 15 },
    { ingredient: '脱脂粉乳', sourceFoodId: 'mext_13010', massG: 5 },
  ]),
]
