import { describe, expect, it } from 'vitest'
import { FOOD_INDEX_GROUPS, groupFoodsByKana } from '../src/services/foodIndex'
import type { Food, FoodGroup, Nutrients } from '../src/types'

const nutrients = {
  energyKcal: 0,
  proteinG: 0,
  fatG: 0,
  carbohydrateG: 0,
  fiberG: 0,
  calciumMg: 0,
  ironMg: 0,
  vitaminAMcg: 0,
  vitaminEMg: 0,
  vitaminB1Mg: 0,
  vitaminB2Mg: 0,
  vitaminCMg: 0,
  saturatedFatG: 0,
  saltG: 0,
} satisfies Nutrients

function food(id: string, name: string, overrides: Partial<Food> = {}): Food {
  return {
    id,
    name,
    maker: '',
    barcode: '',
    source: 'user',
    sourceVersion: 'test',
    baseAmount: 100,
    baseUnit: 'g',
    servingAmount: null,
    servingUnit: null,
    nutrients,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function foodGroup(id: string, reading: string | null): FoodGroup {
  return {
    id,
    displayName: id,
    reading,
    category: null,
    representativeScore: 0,
    defaultVariantId: null,
    isActive: true,
    metadataSource: 'manual',
    generationVersion: 'test',
    needsReview: false,
    createdAt: '',
    updatedAt: '',
  }
}

function idsIn(
  groups: ReturnType<typeof groupFoodsByKana>,
  label: (typeof FOOD_INDEX_GROUPS)[number]['label'],
): string[] {
  return groups.find((group) => group.label === label)?.foods.map(({ id }) => id) ?? []
}

describe('food master kana index', () => {
  it('固定順の全グループを空グループも含めて返す', () => {
    const result = groupFoodsByKana([], [])

    expect(result.map(({ key, label }) => ({ key, label }))).toEqual(FOOD_INDEX_GROUPS)
    expect(result.every(({ foods }) => foods.length === 0)).toBe(true)
  })

  it('食品の読み、食品グループの読み、表示名の優先順で分類する', () => {
    const foods = [
      food('food-reading', '漢字名', { reading: 'あんず', foodGroupId: 'ra' }),
      food('group-reading', '林檎', { foodGroupId: 'ra' }),
      food('display-name', 'fallback', { displayName: 'みかん' }),
    ]
    const result = groupFoodsByKana(foods, [foodGroup('ra', 'りんご')])

    expect(idsIn(result, 'あ行')).toEqual(['food-reading'])
    expect(idsIn(result, 'ら行')).toEqual(['group-reading'])
    expect(idsIn(result, 'ま行')).toEqual(['display-name'])
  })

  it('Unicodeを正規化し、カタカナ・濁音・半濁音・小書き文字を対応する行へ入れる', () => {
    const foods = [
      food('katakana', 'バナナ', { reading: 'バナナ' }),
      food('half-width', 'ガム', { reading: 'ｶﾞﾑ' }),
      food('semi-voiced', 'パプリカ', { reading: 'パプリカ' }),
      food('small-kana', '小書き', { reading: 'ゃさい' }),
    ]
    const result = groupFoodsByKana(foods, [])

    expect(idsIn(result, 'か行')).toEqual(['half-width'])
    expect(idsIn(result, 'は行')).toEqual(['katakana', 'semi-voiced'])
    expect(idsIn(result, 'や行')).toEqual(['small-kana'])
  })

  it('先頭の空白や記号を除去し、英数字と分類不能な名前をその他へ入れる', () => {
    const foods = [
      food('symbol-kana', '記号つき', { reading: '  ・「さとう」' }),
      food('latin', 'Protein Bar', { reading: 'Protein Bar' }),
      food('number', '100%ジュース', { reading: '100%ジュース' }),
      food('kanji', '砂糖'),
    ]
    const result = groupFoodsByKana(foods, [])

    expect(idsIn(result, 'さ行')).toEqual(['symbol-kana'])
    expect(idsIn(result, '英数字・その他')).toEqual(['number', 'latin', 'kanji'])
  })

  it('読み、表示名、入力順で安定ソートし、同じ食品IDを重複させない', () => {
    const foods = [
      food('ao', '青菜', { reading: 'あおな' }),
      food('ai-b', 'アイスB', { reading: 'あいす' }),
      food('ai-a', 'アイスA', { reading: 'あいす' }),
      food('same-1', '同名', { reading: 'あさ' }),
      food('same-2', '同名', { reading: 'あさ' }),
      food('ao', '重複した別データ', { reading: 'わさび' }),
    ]
    const result = groupFoodsByKana(foods, [])

    expect(idsIn(result, 'あ行')).toEqual(['ai-a', 'ai-b', 'ao', 'same-1', 'same-2'])
    expect(idsIn(result, 'わ行')).toEqual([])
    expect(result.flatMap(({ foods: items }) => items).filter(({ id }) => id === 'ao')).toHaveLength(1)
  })
})
