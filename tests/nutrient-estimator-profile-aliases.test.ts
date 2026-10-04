import { describe, expect, it } from 'vitest'
import { resolveIngredientCandidates } from '../src/services/nutrientEstimatorProfiles'
import { unresolvedIngredientNames } from '../src/services/nutrientEstimator'

describe('ingredient estimator profile aliases', () => {
  it('表示見出しと別名を推計へ渡しても未知原料は未対応のまま残す', () => {
    expect(unresolvedIngredientNames('原材料名\nしょう油、卵白末、未対応検証原料'))
      .toEqual(['未対応検証原料'])
    expect(unresolvedIngredientNames('【食品】原材料名 しょう油、卵白末／香料'))
      .toEqual([])
  })

  it('しょう油は既存のしょうゆ候補と同じプロファイルだけを使う', () => {
    const existing = resolveIngredientCandidates('しょうゆ', null)
    const alias = resolveIngredientCandidates('しょう油', null)

    expect(alias).toEqual(existing)
    expect(alias).toHaveLength(1)
    expect(alias[0].profileId).toBe('mext_17007')
    expect(alias[0].nutrients).toEqual(existing[0].nutrients)
    expect(resolveIngredientCandidates('粉末しょう油', null)).toEqual([])
  })

  it('卵白末は乾燥卵白に一致し、生卵白や状態不明の別表記を吸収しない', () => {
    const dried = resolveIngredientCandidates('乾燥卵白', null)
    const alias = resolveIngredientCandidates('卵白末', null)
    const raw = resolveIngredientCandidates('卵白', null)

    expect(alias).toEqual(dried)
    expect(alias).toHaveLength(1)
    expect(alias[0].profileId).toBe('mext_12016')
    expect(alias[0].nutrients).toEqual(dried[0].nutrients)
    expect(raw).toHaveLength(1)
    expect(raw[0].profileId).toBe('mext_12014')
    expect(raw[0].ambiguous).toBe(true)
    expect(resolveIngredientCandidates('卵白（生）', null)).toEqual([])
    expect(resolveIngredientCandidates('卵白末（生）', null)).toEqual([])
  })
})
