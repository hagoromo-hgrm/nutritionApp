import { describe, expect, it } from 'vitest'
import { NUTRIENT_KEYS, type Nutrients } from '../src/types'
import {
  combineCandidateSets,
  type CandidateSelectionContext,
} from '../src/services/nutrientEstimator'
import { saturatedFatRatioPrior } from '../src/data/nutrientEstimatorGenreNutrientPriors'
import mextFoodData from '../data/mext/processed/mext_foods.json'
import {
  resolveIngredientCandidates,
  type IngredientProfile,
} from '../src/services/nutrientEstimatorProfiles'

const mextFoods = mextFoodData.foods as { id: string; nutrients: Nutrients }[]

function mextNutrients(profile: IngredientProfile): Nutrients {
  const sourceFoodId = profile.sourceFoodIds[0]
  const source = mextFoods.find((food) => food.id === sourceFoodId)
  if (!source) throw new Error(`MEXT参照値がありません: ${sourceFoodId}`)
  return source.nutrients
}

function directCandidate(ingredientName: string): IngredientProfile {
  const candidates = resolveIngredientCandidates(ingredientName, null)
  if (candidates.length !== 1) throw new Error(`${ingredientName}の直接候補が一意ではありません`)
  return candidates[0]
}

function candidate(setIndex: number, candidateIndex: number): IngredientProfile {
  const target = candidateIndex === 3
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [
    key,
    key === 'energyKcal'
      ? (target ? 400 : 100 + candidateIndex * 100)
      : key === 'fatG'
        ? 100
        : key === 'saturatedFatG'
          ? (target ? 50 : 200)
          : 0,
  ])) as Nutrients
  return {
    profileId: `set-${setIndex}-candidate-${candidateIndex}`,
    canonicalName: `候補${setIndex}-${candidateIndex}`,
    nutrients,
    sourceFoodIds: [`test-${setIndex}-${candidateIndex}`],
    priorProbability: target ? 0.01 : [0.4, 0.3, 0.29][candidateIndex],
  }
}

describe('nutrient estimator candidate selection', () => {
  const candidateSets = Array.from({ length: 4 }, (_value, setIndex) => (
    Array.from({ length: 4 }, (_candidate, candidateIndex) => candidate(setIndex, candidateIndex))
  ))
  const context: CandidateSelectionContext = {
    referenceMassG: 100,
    knownNutrients: { energyKcal: 400 },
  }

  it('組合せ上限を超えても低事前確率で栄養表示に整合する候補を残す', () => {
    const combinations = combineCandidateSets(candidateSets, 64, context)

    expect(combinations).toHaveLength(64)
    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(true)
  })

  it('同じ入力から候補集合と順序を決定的に再現する', () => {
    const first = combineCandidateSets(candidateSets, 64, context)
    const second = combineCandidateSets(candidateSets, 64, context)

    expect(second).toEqual(first)
  })

  it('組合せ上限を超えても比率分布に整合する低事前確率候補を残す', () => {
    const prior = saturatedFatRatioPrior('chocolate')
    if (!prior) throw new Error('比率事前分布がありません')
    const ratioContext: CandidateSelectionContext = {
      referenceMassG: 100,
      knownNutrients: { fatG: 100 },
      ratioFeedback: {
        parentValue: 100,
        feedbackWeight: 0.2,
        prior,
      },
    }
    const combinations = combineCandidateSets(candidateSets, 64, ratioContext)

    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(true)
  })

  it('栄養表示がなければ従来どおり事前確率順で枝刈りする', () => {
    const combinations = combineCandidateSets(candidateSets, 64)

    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(false)
    expect(combinations.every((combination, index) => (
      index === 0 || combinations[index - 1].priorProbability >= combination.priorProbability
    ))).toBe(true)
  })

  it('粉あめ、還元水あめ、糖化法が明記された水あめをMEXT直接項目へ分ける', () => {
    const powdered = directCandidate('粉あめ')
    const reduced = directCandidate('還元水あめ')
    const enzyme = directCandidate('水あめ（酵素糖化）')
    const acid = directCandidate('水あめ（酸糖化）')

    expect(powdered.profileId).toBe('mext_03015')
    expect(reduced.profileId).toBe('mext_03032')
    expect(enzyme.profileId).toBe('mext_03024')
    expect(acid.profileId).toBe('mext_03025')
    expect(powdered.nutrients).toEqual({
      ...mextNutrients(powdered),
      saturatedFatG: 0,
    })
    expect(powdered.derivationWarnings).toContain('MEXTの脂質が0gのため、飽和脂肪酸を0gと導出しています。')
    expect(reduced.nutrients).toEqual(mextNutrients(reduced))
    expect(reduced.nutrients.fatG).toBeNull()
    expect(reduced.nutrients.saturatedFatG).toBeNull()
    expect(enzyme.nutrients).toEqual({
      ...mextNutrients(enzyme),
      saturatedFatG: 0,
    })
    expect(acid.nutrients).toEqual({
      ...mextNutrients(acid),
      saturatedFatG: 0,
    })
  })

  it('糖化法のない水あめは直接値の加工状態を決めず候補を曖昧扱いにする', () => {
    const candidates = resolveIngredientCandidates('水あめ', null)

    expect(candidates.map((profile) => profile.profileId).sort()).toEqual(['mext_03024', 'mext_03025'])
    expect(candidates.every((profile) => profile.ambiguous)).toBe(true)
    expect(candidates.every((profile) => (
      profile.derivationWarnings?.join(' ').includes('糖化法が表示されていない')
    ))).toBe(true)
  })

  it('一般バターとバターオイルを同じ直接値として無警告にしない', () => {
    const saltedUnfermented = directCandidate('無発酵バター 有塩バター')
    const unsaltedUnfermented = directCandidate('食塩不使用バター')
    const saltedCultured = directCandidate('発酵バター 有塩バター')
    const genericButter = resolveIngredientCandidates('バター', null)
    const butterOil = directCandidate('バターオイル')

    expect(saltedUnfermented.profileId).toBe('mext_14017')
    expect(saltedUnfermented.nutrients).toEqual(mextNutrients(saltedUnfermented))
    expect(unsaltedUnfermented.profileId).toBe('mext_14018')
    expect(unsaltedUnfermented.nutrients).toEqual(mextNutrients(unsaltedUnfermented))
    expect(saltedCultured.profileId).toBe('mext_14019')
    expect(saltedCultured.nutrients).toEqual(mextNutrients(saltedCultured))
    expect(genericButter.map((profile) => profile.profileId).sort()).toEqual([
      'mext_14017', 'mext_14018', 'mext_14019',
    ])
    expect(genericButter.every((profile) => profile.ambiguous)).toBe(true)
    expect(genericButter.every((profile) => profile.derivationWarnings?.join(' ').includes('発酵の有無と食塩'))).toBe(true)
    expect(butterOil).toMatchObject({
      profileId: 'proxy_butter_oil_mext_14017',
      ambiguous: true,
      sourceFoodIds: ['mext_14017'],
    })
    expect(butterOil.derivationWarnings?.join(' ')).toContain('水分をほぼ除いた乳脂肪原料')
  })

  it('卵粉は乾燥全卵の直接値、粉末しょうゆは濃縮不明の代理候補へ分ける', () => {
    const eggPowder = directCandidate('卵粉')
    const eggYolk = directCandidate('卵黄')
    const eggWhite = directCandidate('卵白')
    const rawYolk = directCandidate('鶏卵 卵黄 生')
    const rawWhite = directCandidate('鶏卵 卵白 生')
    const soySaucePowder = directCandidate('粉末しょうゆ')

    expect(eggPowder.profileId).toBe('mext_12009')
    expect(eggPowder.nutrients).toEqual(mextNutrients(eggPowder))
    expect(eggYolk.profileId).toBe('mext_12010')
    expect(eggYolk.nutrients).toEqual(mextNutrients(eggYolk))
    expect(eggYolk.ambiguous).toBe(true)
    expect(eggYolk.derivationWarnings?.join(' ')).toContain('生の状態')
    expect(eggWhite.profileId).toBe('mext_12014')
    expect(eggWhite.nutrients).toEqual(mextNutrients(eggWhite))
    expect(eggWhite.ambiguous).toBe(true)
    expect(eggWhite.derivationWarnings?.join(' ')).toContain('生の状態')
    expect(eggWhite.nutrients.fatG).toBeNull()
    expect(eggWhite.nutrients.saturatedFatG).toBeNull()
    expect(rawYolk.ambiguous).toBeUndefined()
    expect(rawYolk.nutrients).toEqual(mextNutrients(rawYolk))
    expect(rawWhite.ambiguous).toBeUndefined()
    expect(rawWhite.nutrients).toEqual(mextNutrients(rawWhite))
    expect(soySaucePowder).toMatchObject({
      profileId: 'proxy_powdered_soy_sauce_mext_17007',
      ambiguous: true,
      sourceFoodIds: ['mext_17007'],
    })
    expect(soySaucePowder.derivationWarnings?.join(' ')).toContain('濃縮度やデキストリン等の賦形剤量が不明')
  })

  it('デキストリンの商品名から無関係な粉寒天を選ばない', () => {
    const candidates = resolveIngredientCandidates('デキストリン', '食物繊維入りトロメイク')

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      profileId: 'proxy_dextrin_mext_02035',
      sourceFoodIds: ['mext_02035'],
    })
  })

  it('一般名の乳製品に液状乳を含め、粉乳の明示名は直接値のまま保つ', () => {
    const dairy = resolveIngredientCandidates('乳製品', null)
    const milk = directCandidate('牛乳')
    const wholePowder = directCandidate('全粉乳')
    const skimPowder = directCandidate('脱脂粉乳')
    const whey = directCandidate('ホエイたんぱく')

    expect(dairy.map((item) => item.sourceFoodIds[0])).toContain('mext_13003')
    expect(dairy.map((item) => item.sourceFoodIds[0])).toEqual(expect.arrayContaining([
      'mext_13003', 'mext_13009', 'mext_13010', 'mext_13014',
    ]))
    expect(dairy.every((item) => item.ambiguous)).toBe(true)
    expect(dairy.every((item) => item.derivationWarnings?.some((warning) => warning.includes('加工状態を特定できない')))).toBe(true)

    expect(milk).toMatchObject({ profileId: 'mext_13003', nutrients: mextNutrients(milk) })
    expect(milk.ambiguous).toBeUndefined()
    expect(wholePowder).toMatchObject({ profileId: 'mext_13009', nutrients: mextNutrients(wholePowder) })
    expect(wholePowder.ambiguous).toBeUndefined()
    expect(skimPowder).toMatchObject({ profileId: 'mext_13010', nutrients: mextNutrients(skimPowder) })
    expect(skimPowder.ambiguous).toBeUndefined()

    expect(whey).toMatchObject({
      profileId: 'proxy_milk_protein_mext_13010',
      ambiguous: true,
      nutrients: {
        proteinG: 34,
        calciumMg: null,
        ironMg: null,
        vitaminB2Mg: null,
        saltG: null,
        fiberG: null,
        saturatedFatG: null,
      },
    })
    expect(whey.derivationWarnings?.join(' ')).toContain('濃縮物／分離物で確認できない')
  })

  it('昆布エキスを乾燥昆布へ無警告対応せず、粉末エキスは未解決に保つ', () => {
    const kombu = directCandidate('昆布')
    const extract = directCandidate('昆布エキス')

    expect(kombu).toMatchObject({ sourceFoodIds: ['mext_09017'], ambiguous: true })
    expect(kombu.derivationWarnings?.join(' ')).toContain('素干し・乾')
    expect(extract).toMatchObject({
      profileId: 'proxy_kombu_extract_mext_17020',
      sourceFoodIds: ['mext_17020'],
      ambiguous: true,
    })
    expect(extract.nutrients).toEqual(mextNutrients(extract))
    expect(extract.derivationWarnings?.join(' ')).toContain('抽出濃度と液状・粉末')
    expect(resolveIngredientCandidates('昆布エキスパウダー', null)).toEqual([])
    expect(resolveIngredientCandidates('こんぶエキスパウダー', null)).toEqual([])
    expect(resolveIngredientCandidates('昆布エキス粉末', null)).toEqual([])
    expect(resolveIngredientCandidates('こんぶエキス粉末', null)).toEqual([])
  })

  it('ローストオニオン粉末は通常オニオン粉末の警告付き代理とし、濃縮果汁や具・衣を推測しない', () => {
    const onionPowder = directCandidate('オニオンパウダー')
    const roastedOnionPowder = directCandidate('ローストオニオンパウダー')
    const concentratedLemon = directCandidate('濃縮レモン果汁')
    const lemonConcentrate = directCandidate('レモン濃縮果汁')

    expect(onionPowder.profileId).toBe('general_mext_17056')
    expect(onionPowder.nutrients).toEqual(mextNutrients(onionPowder))
    expect(onionPowder.ambiguous).toBeUndefined()
    expect(roastedOnionPowder).toMatchObject({
      profileId: 'proxy_roasted_onion_powder_mext_17056',
      sourceFoodIds: ['mext_17056'],
      ambiguous: true,
    })
    expect(roastedOnionPowder.derivationWarnings?.join(' ')).toContain('ロースト状態')
    expect(roastedOnionPowder.nutrients).toEqual(mextNutrients(roastedOnionPowder))
    expect(concentratedLemon).toMatchObject({
      profileId: 'proxy_concentrated_lemon_juice_mext_07156',
      ambiguous: true,
      sourceFoodIds: ['mext_07156'],
    })
    expect(concentratedLemon.derivationWarnings?.join(' ')).toContain('Brix・希釈率')
    expect(concentratedLemon.nutrients).toEqual(mextNutrients(concentratedLemon))
    expect(lemonConcentrate.profileId).toBe(concentratedLemon.profileId)
    for (const unresolved of ['濃縮りんご果汁', '濃縮ぶどう果汁', '具', '衣']) {
      expect(resolveIngredientCandidates(unresolved, null), unresolved).toEqual([])
    }
  })
})
