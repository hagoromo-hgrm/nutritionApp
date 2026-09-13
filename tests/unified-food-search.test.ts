import { describe, expect, it } from 'vitest'
import { mextFoods } from '../src/data/mextFoods'
import { getFoodVariantBySourceId } from '../src/services/mextFoodData'
import { searchUnifiedFoodResults } from '../src/services/unifiedFoodSearch'
import type { Food, FoodGroup, Nutrients } from '../src/types'

const nutrients: Nutrients = {
  energyKcal: 100,
  proteinG: 1,
  fatG: 1,
  carbohydrateG: 1,
  fiberG: 1,
  saltG: 0,
  calciumMg: null,
  ironMg: null,
  vitaminAMcg: null,
  vitaminEMg: null,
  vitaminB1Mg: null,
  vitaminB2Mg: null,
  vitaminCMg: null,
  saturatedFatG: null,
}

function food(index: number): Food {
  return {
    id: `food-${index}`,
    name: `候補食品${index}`,
    displayName: `候補食品${index}`,
    officialName: `候補食品${index}`,
    maker: '',
    barcode: '',
    source: 'user',
    sourceVersion: 'test',
    baseAmount: 100,
    baseUnit: 'g',
    servingAmount: null,
    servingUnit: null,
    foodGroupId: `group-${index}`,
    nutrients,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  }
}

function group(index: number): FoodGroup {
  return {
    id: `group-${index}`,
    displayName: `候補食品${index}`,
    reading: null,
    category: null,
    representativeScore: 0,
    defaultVariantId: `food-${index}`,
    isActive: true,
    metadataSource: 'manual',
    generationVersion: 'test',
    needsReview: false,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  }
}

describe('unified food search', () => {
  it('ページング前に20件を超える通常候補を一つの順位配列へまとめる', () => {
    const foods = Array.from({ length: 25 }, (_, index) => food(index))
    const groups = Array.from({ length: 25 }, (_, index) => group(index))
    const results = searchUnifiedFoodResults('候補食品', {
      foods,
      groups,
      aliases: [],
      relatedTerms: [],
      usageStats: [],
    })
    expect(results).toHaveLength(25)
    expect(new Set(results.map((result) => result.candidateKey)).size).toBe(25)
  })

  it('MEXTの種類・属性候補を通常の下位グループと重複表示しない', () => {
    const searchableMextFoods = mextFoods.map((item) => ({
      ...item,
      foodGroupId: getFoodVariantBySourceId(item.id)?.foodGroupId,
    }))
    const results = searchUnifiedFoodResults('鶏肉 むね 皮なし', {
      foods: searchableMextFoods,
      groups: [],
      aliases: [],
      relatedTerms: [],
      usageStats: [],
    })
    const chicken = results.find((result) => result.userFoodResult?.group.canonicalName === '鶏肉')
    expect(chicken?.userFoodResult).toMatchObject({
      presetSelection: { chicken_cut: 'breast' },
      attributeSelection: { skin_state: 'without_skin' },
      foodGroupId: 'fg_001370',
    })
    expect(results.filter((result) => result.group.id === 'fg_001370')).toHaveLength(1)
  })

  it('20件を超えるMEXT候補もページング前の順位配列へすべて残す', () => {
    const searchableMextFoods = mextFoods.map((item) => ({
      ...item,
      foodGroupId: getFoodVariantBySourceId(item.id)?.foodGroupId,
    }))
    const results = searchUnifiedFoodResults('肉', {
      foods: searchableMextFoods,
      groups: [],
      aliases: [],
      relatedTerms: [],
      usageStats: [],
    })
    expect(results.length).toBeGreaterThan(20)
    expect(new Set(results.map((result) => result.candidateKey)).size).toBe(results.length)
  })
})
