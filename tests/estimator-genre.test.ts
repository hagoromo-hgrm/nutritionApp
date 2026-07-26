import { describe, expect, it } from 'vitest'
import {
  ESTIMATOR_GENRE_LABELS,
  inferEstimatorGenre,
  refreshEstimatorGenre,
} from '../src/services/estimatorGenre'
import { resolveIngredientCandidates } from '../src/services/nutrientEstimatorProfiles'

describe('estimator genre', () => {
  it('OFFカテゴリ、商品名、原材料の優先順で1ジャンルを提案する', () => {
    expect(inferEstimatorGenre({
      productName: '食パン',
      ingredientsText: '小麦粉、イースト',
      offCategories: ['en:chocolates'],
    })).toEqual({ id: 'chocolate', source: 'off_category' })
    expect(inferEstimatorGenre({
      productName: 'ショコラクッキー',
      ingredientsText: '小麦粉、イースト',
    })).toEqual({ id: 'chocolate', source: 'name_rule' })
    expect(inferEstimatorGenre({
      productName: '名称なし',
      ingredientsText: '小麦粉、ドライイースト',
    })).toEqual({ id: 'bread', source: 'ingredient_rule' })
  })

  it('ユーザー確定値は商品名や原材料の編集で上書きしない', () => {
    expect(refreshEstimatorGenre(
      { id: 'baked_sweets', source: 'user' },
      { productName: 'チョコレート', ingredientsText: 'カカオマス' },
    )).toEqual({ id: 'baked_sweets', source: 'user' })
    expect(refreshEstimatorGenre(
      { id: 'chocolate', source: 'off_category' },
      { productName: '名称を編集', ingredientsText: '砂糖' },
    )).toEqual({ id: 'chocolate', source: 'off_category' })
  })

  it('食品名の部分文字列だけで別ジャンルへ誤分類しない', () => {
    expect(inferEstimatorGenre({ productName: 'フライパン用アルミホイル' })).toEqual({
      id: 'other_unknown',
      source: 'unknown',
    })
    expect(inferEstimatorGenre({ productName: 'パインジュース' })).toEqual({
      id: 'drink_jelly_pudding',
      source: 'name_rule',
    })
    expect(inferEstimatorGenre({ productName: 'カツオだし' })).not.toMatchObject({ id: 'fried_food' })
  })

  it('ジャンルは曖昧な候補の事前確率だけを変える', () => {
    const bread = resolveIngredientCandidates('小麦粉', '名称なし', 'bread')
    const baked = resolveIngredientCandidates('小麦粉', '名称なし', 'baked_sweets')
    const explicit = resolveIngredientCandidates('強力粉', 'クッキー', 'baked_sweets')

    expect(bread[0].profileId).toBe('mext_01020')
    expect(baked[0].profileId).toBe('mext_01015')
    expect(explicit).toHaveLength(1)
    expect(explicit[0].profileId).toBe('mext_01020')
  })

  it('表示ラベルをすべてのジャンルへ定義する', () => {
    expect(ESTIMATOR_GENRE_LABELS.other_unknown).toBe('その他・不明')
    expect(Object.values(ESTIMATOR_GENRE_LABELS).every(Boolean)).toBe(true)
  })
})
