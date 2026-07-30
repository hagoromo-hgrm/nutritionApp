import { describe, expect, it } from 'vitest'
import {
  GENRE_PRIOR_PARTIAL_METHOD,
  NUTRIENT_ESTIMATOR_MODEL_VERSION,
  PARTIAL_METHOD,
  estimateNutrients,
  isEstimateAdoptable,
  toStoredNutrientEstimateResult,
  unresolvedIngredientNames,
  type NutrientEstimateRequest,
} from '../src/services/nutrientEstimator'

const eligibleRequest: NutrientEstimateRequest = {
  requestId: 'estimate-test-1',
  productName: 'ココアバタークッキー',
  baseAmount: 1,
  baseUnit: '袋',
  referenceMassG: 80,
  referenceMassSource: 'パッケージ表示',
  ingredientsText: '小麦粉、砂糖、バター、ココアパウダー',
  ingredientsSource: { provider: 'パッケージ表示', verified: true },
  requestedAt: '2026-07-26T01:00:00.000Z',
}

describe('browser nutrient estimator', () => {
  it('同じ要求には同じ基準・推計値・範囲を決定的に返す', () => {
    const first = estimateNutrients(eligibleRequest)
    const second = estimateNutrients(eligibleRequest)

    expect(second).toEqual(first)
    expect(first.status).toBe('partial')
    expect(first.basis).toEqual({ baseAmount: 1, baseUnit: '袋' })
    expect(first.estimatedAt).toBe(eligibleRequest.requestedAt)
    expect(first.estimates.saturatedFatG.status).toBe('available')
    expect(first.estimates.fiberG.status).toBe('available')
    expect(first.estimates.fiberG.value).not.toBeNull()
    expect(first.estimates.fiberG.range).not.toBeNull()
    expect(first.estimates.calciumMg.status).toBe('available')
    expect(first.estimates.ironMg).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['reference_value_missing'],
    })
    expect(first.estimates.vitaminAMcg.status).toBe('available')
    expect(first.estimates.vitaminEMg.status).toBe('available')
    expect(first.estimates.vitaminB1Mg.status).toBe('available')
    expect(first.estimates.vitaminB2Mg.status).toBe('available')
    expect(first.estimates.vitaminCMg.status).toBe('available')
    expect(first.modelVersion).toBe(NUTRIENT_ESTIMATOR_MODEL_VERSION)
  })

  it('明示的な基準重量がなければ単位から重量を推測しない', () => {
    const result = estimateNutrients({ ...eligibleRequest, referenceMassG: null })

    expect(result.status).toBe('failed')
    expect(result.estimates.saturatedFatG).toMatchObject({
      status: 'unavailable',
      value: null,
      confidence: 'unavailable',
      limitationReasons: ['reference_mass_missing'],
    })
    expect(result.estimates.saturatedFatG.range).toBeNull()
    if (result.estimates.saturatedFatG.status === 'unavailable') {
      expect(result.estimates.saturatedFatG.reason).toContain('内容物重量')
      expect(result.estimates.saturatedFatG.nextAction).toContain('食品登録を続けて')
    }
  })

  it('重量の根拠がなければ数値があっても推計しない', () => {
    const result = estimateNutrients({ ...eligibleRequest, referenceMassSource: null })

    expect(result.status).toBe('failed')
    expect(result.estimates.fiberG.status).toBe('unavailable')
  })

  it('原材料表示がなければゼロではなく推計不可を返す', () => {
    const result = estimateNutrients({ ...eligibleRequest, ingredientsText: '  ' })

    expect(result.status).toBe('failed')
    expect(result.estimates.fiberG.value).toBeNull()
    expect(result.estimates.fiberG.confidence).toBe('unavailable')
    expect(result.estimates.fiberG.limitationReasons).toEqual(['ingredients_missing'])
  })

  it('原材料の取得元が未確認なら推計しない', () => {
    const result = estimateNutrients({ ...eligibleRequest, ingredientsSource: { provider: '外部DB', verified: false } })

    expect(result.status).toBe('failed')
    expect(result.estimates.fiberG.value).toBeNull()
    expect(result.estimates.fiberG.limitationReasons).toEqual(['ingredients_unverified'])
    if (result.estimates.fiberG.status === 'unavailable') {
      expect(result.estimates.fiberG.reason).toContain('取得元')
    }
  })

  it('栄養寄与がゼロの推計値と推計不可のnullを区別する', () => {
    const zero = estimateNutrients({ ...eligibleRequest, ingredientsText: 'ショートニング' })
    const unavailable = estimateNutrients({ ...eligibleRequest, ingredientsText: '香料' })

    expect(zero.estimates.fiberG).toMatchObject({
      status: 'available',
      value: 0,
      range: { min: 0, max: 0 },
      zeroEvidence: 'derived_from_parent_zero',
    })
    expect(unavailable.estimates.fiberG).toMatchObject({
      status: 'unavailable',
      value: null,
      range: null,
    })
    expect(isEstimateAdoptable(null, zero.estimates.fiberG)).toBe(true)
    expect(isEstimateAdoptable(0, zero.estimates.fiberG)).toBe(false)
  })

  it('内訳の推計値と範囲を入力済み総量以下に補正する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      knownNutrients: {
        fatG: 0.25,
        carbohydrateG: 0.25,
      },
      requestedNutrients: ['saturatedFatG', 'fiberG'],
    })

    for (const [key, parentLabel] of [
      ['saturatedFatG', '脂質'],
      ['fiberG', '炭水化物'],
    ] as const) {
      const estimate = result.estimates[key]
      expect(estimate.status).toBe('available')
      if (estimate.status !== 'available') continue
      expect(estimate.value).toBeLessThanOrEqual(0.25)
      expect(estimate.range.min).toBeLessThanOrEqual(estimate.value)
      expect(estimate.range.max).toBeLessThanOrEqual(0.25)
      expect(estimate.warnings.join(' ')).toContain(`${parentLabel}（0.25g）を上限`)
    }
  })

  it('未指定の栄養素は推計対象に含めない', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      requestedNutrients: ['fiberG'],
    })

    expect(result.status).toBe('completed')
    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.saturatedFatG.status).toBe('unavailable')
    expect(result.estimates.calciumMg.status).toBe('unavailable')
  })

  it('MEXTの実値からカルシウム・鉄・ビタミンを推計し出典食品IDを保持する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      referenceMassG: 100,
      ingredientsText: 'アーモンド',
    })

    expect(result.status).toBe('completed')
    expect(result.estimates.calciumMg).toMatchObject({
      status: 'available',
      value: 250,
      sourceFoodIds: ['mext_05001'],
    })
    expect(result.estimates.ironMg).toMatchObject({ status: 'available', value: 3.6 })
    expect(result.estimates.vitaminAMcg).toMatchObject({ status: 'available', value: 1 })
    expect(result.estimates.vitaminEMg).toMatchObject({ status: 'available', value: 30 })
    expect(result.estimates.vitaminB1Mg).toMatchObject({ status: 'available', value: 0.2 })
    expect(result.estimates.vitaminB2Mg).toMatchObject({ status: 'available', value: 1.06 })
    expect(result.estimates.vitaminCMg).toMatchObject({
      status: 'available',
      value: 0,
      range: { min: 0, max: 1 },
      zeroEvidence: 'uncertain',
    })
    const stored = toStoredNutrientEstimateResult(result, {
      foodId: 'food-almond',
      inputHash: 'hash-almond',
      baseAmount: 1,
      baseUnit: '袋',
    })
    expect(stored.estimates.vitaminCMg?.zeroEvidence).toBe('uncertain')
  })

  it('市販品で頻出する肉類・卵粉・小麦たんぱく・調味料をMEXT参照へ解決する', () => {
    expect(unresolvedIngredientNames(
      '鶏肉、豚脂肪、豚肉、小麦たん白、粉末卵白、しょうゆ、にんじん',
      'ソーセージ',
      'prepared_meal',
    )).toEqual([])
    expect(unresolvedIngredientNames(
      '鶏肉、酵母エキス',
      'ソーセージ',
      'prepared_meal',
    )).toEqual([])
  })

  it('一般的な穀類・肉魚・豆・野菜・果物・調味料を汎用カタログで解決する', () => {
    expect(unresolvedIngredientNames(
      'じゃがいも、国産大豆、有機ブロッコリー、鮭、マッシュルーム、マンゴー、オリーブオイル、ウスターソース',
      '一般的な食事',
      'prepared_meal',
    )).toEqual([])
    expect(unresolvedIngredientNames(
      '油揚げめん、コンソメパウダー、酵母エキス',
      '即席ラーメン',
      'noodle_flour_dish',
    )).toEqual([])
  })

  it('即席麺のスープ・かやくと濃縮度不明原料を分布候補として解決する', () => {
    expect(unresolvedIngredientNames(
      '油揚げめん、スープ、かやく',
      'カップヌードル しょうゆ',
      'noodle_flour_dish',
    )).toEqual([])
    expect(unresolvedIngredientNames(
      '油揚げめん、スープ、かやく',
      'スープ付き惣菜',
      'prepared_meal',
    )).toEqual(['スープ', 'かやく'])
    expect(unresolvedIngredientNames(
      '小麦粉、たん白加水分解物、麦芽エキス',
      '調味ビスケット',
      'baked_sweets',
    )).toEqual([])
  })

  it('分布候補で解決した原材料について対象栄養素の値を返す', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: '即席しょうゆラーメン',
      estimatorGenreId: 'noodle_flour_dish',
      ingredientsText: '油揚げめん、スープ、かやく、たん白加水分解物、麦芽エキス',
    })

    expect(result.unresolvedIngredients).toEqual([])
    expect(result.status).toBe('completed')
    expect(Object.values(result.estimates).every((estimate) => estimate.status === 'available')).toBe(true)
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('麺重量比')
  })

  it('入力済みの主要栄養値を使い、原材料順を保った配合比推定へ切り替える', () => {
    const request: NutrientEstimateRequest = {
      ...eligibleRequest,
      referenceMassG: 100,
      ingredientsText: '小麦粉、バター、ココアパウダー、卵',
      knownNutrients: {
        energyKcal: 439,
        proteinG: 8.2,
        fatG: 24.9,
        carbohydrateG: 48.9,
        saltG: 0.5,
      },
    }
    const result = estimateNutrients(request)

    expect(result.status).toBe('completed')
    expect(result.estimates.fiberG.method).toBe('browser_ingredient_macro_fit')
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('主要栄養値との整合')
    expect(estimateNutrients(request)).toEqual(result)
  })

  it('MEXT参照値の欠損をゼロ補完せずジャンル事前分布の低信頼度範囲で補う', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      ingredientsText: '脱脂粉乳',
    })

    expect(result.status).toBe('partial')
    expect(result.estimates.calciumMg.status).toBe('available')
    expect(result.estimates.vitaminEMg).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['reference_value_missing'],
    })
    expect(result.estimates.vitaminEMg.warnings.join(' ')).toContain('事前分布の中央値')
  })

  it('未知または曖昧な原材料を警告し信頼度を低くする', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      ingredientsText: '小麦粉、植物油脂、香料',
    })
    const estimate = result.estimates.saturatedFatG

    expect(estimate.status).toBe('available')
    expect(estimate.confidence).toBe('low')
    expect(estimate.warnings.join(' ')).toContain('香料')
    expect(estimate.warnings.join(' ')).toContain('複数の参照食品候補')
  })

  it('複合原材料の括弧内を階層化し、外側と内側の表示順を別々に保つ', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: 'ゆずピール砂糖漬け',
      referenceMassG: 100,
      ingredientsText: 'ゆず砂糖漬け（ゆず、砂糖）',
      knownNutrients: {
        energyKcal: 203,
        proteinG: 0.7,
        fatG: 0.3,
        carbohydrateG: 52.5,
        saltG: 0,
      },
    })

    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.vitaminCMg.status).toBe('available')
    expect(result.estimates.fiberG.sourceFoodIds).toEqual(expect.arrayContaining(['mext_07142', 'mext_03003']))
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('複合原材料')
    // ADR-015の限定規則に従い、脂質0gから導出した場合は警告を残す。
    expect(result.estimates.saturatedFatG.status).toBe('available')
    expect(result.estimates.saturatedFatG.warnings.join(' ')).toContain('脂質が0g')
  })

  it('スラッシュ以降の添加物を主原材料の配合比から分離する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: 'はちみつビスケット',
      ingredientsText: '小麦粉、はちみつ／増粘剤、香料',
    })

    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.fiberG.confidence).toBe('low')
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('添加物区画（増粘剤、香料）')
    expect(result.estimates.fiberG.warnings.join(' ')).not.toContain('未対応原材料')
  })

  it('商品名を曖昧候補の弱い事前確率に使い、原材料の明示語を優先する', () => {
    const chocolate = estimateNutrients({
      ...eligibleRequest,
      productName: 'チョコクッキー',
      referenceMassG: 100,
      ingredientsText: '小麦粉、植物油脂',
      knownNutrients: undefined,
    })
    const dressing = estimateNutrients({
      ...eligibleRequest,
      productName: '和風ドレッシング',
      referenceMassG: 100,
      ingredientsText: '小麦粉、植物油脂',
      knownNutrients: undefined,
    })
    const explicitCanola = estimateNutrients({
      ...eligibleRequest,
      productName: 'チョコクッキー',
      referenceMassG: 100,
      ingredientsText: '小麦粉、なたね油',
      knownNutrients: undefined,
    })

    expect(chocolate.estimates.saturatedFatG.sourceFoodIds).toContain('mext_14009')
    expect(dressing.estimates.saturatedFatG.sourceFoodIds).toContain('mext_14008')
    expect(explicitCanola.estimates.saturatedFatG.sourceFoodIds).toContain('mext_14008')
    expect(explicitCanola.estimates.saturatedFatG.sourceFoodIds).not.toContain('mext_14009')
    expect(chocolate.estimates.saturatedFatG.warnings.join(' ')).toContain('弱い事前確率')
  })

  it('未対応原材料の重量枠を残し、既知原材料分を低信頼度の部分参考値として返す', () => {
    const fullyKnown = estimateNutrients({
      ...eligibleRequest,
      referenceMassG: 100,
      ingredientsText: '小麦粉',
    })
    const result = estimateNutrients({
      ...eligibleRequest,
      referenceMassG: 100,
      ingredientsText: '小麦粉、未対応の果実加工品',
    })

    expect(result.status).toBe('partial')
    expect(result.unresolvedIngredients).toEqual(['未対応の果実加工品'])
    expect(result.estimates.fiberG).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['ingredient_unresolved'],
    })
    if (
      fullyKnown.estimates.fiberG.status === 'available'
      && result.estimates.fiberG.status === 'available'
    ) {
      expect(result.estimates.fiberG.value).toBeCloseTo(fullyKnown.estimates.fiberG.value * 2 / 3, 6)
      expect(result.estimates.fiberG.warnings.join(' ')).toContain('保証された下限ではありません')
      expect(result.estimates.fiberG.warnings.join(' ')).toContain('100%へ再配分していません')
      expect(result.estimates.fiberG.warnings.join(' ')).toContain('推定範囲にだけ使用')
    }
    expect(result.globalWarnings.join(' ')).toContain('ジャンル補完参考値')
    const stored = toStoredNutrientEstimateResult(result, {
      foodId: 'food-partial',
      inputHash: 'hash-partial',
      baseAmount: 1,
      baseUnit: '袋',
    })
    expect(stored.status).toBe('partial')
    expect(stored.unresolvedIngredients).toEqual(['未対応の果実加工品'])
    expect(stored.limitationReasons).toEqual(['ingredient_unresolved'])
    expect(stored.estimates.fiberG?.method).toBe(GENRE_PRIOR_PARTIAL_METHOD)
    expect(stored.estimates.fiberG?.limitationReasons).toEqual(['ingredient_unresolved'])
  })

  it('参照できる原材料が1件もない場合は全体分布へ縮約した低信頼度参考値を返す', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      ingredientsText: '未対応原料A、未対応原料B',
    })

    expect(result.status).toBe('partial')
    expect(result.estimates.fiberG).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['ingredient_unresolved'],
    })
    const stored = toStoredNutrientEstimateResult(result, {
      foodId: 'food-unresolved',
      inputHash: 'hash-unresolved',
      baseAmount: 1,
      baseUnit: '袋',
    })
    expect(stored.limitationReasons).toEqual(['ingredient_unresolved'])
    expect(stored.error).toBeUndefined()
    expect(stored.estimates.fiberG?.calibration?.scope).toBe('pooled_nutrient')
  })

  it('カカオマス・乳糖・ココアバター・イーストを含む商品を代理参照付きで部分推計する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: '発酵カカオクッキー',
      referenceMassG: 100,
      ingredientsText: '小麦粉、砂糖、カカオマス、乳糖、ココアバター、イースト／乳化剤、香料',
      knownNutrients: {
        energyKcal: 500,
        proteinG: 7,
        fatG: 25,
        carbohydrateG: 62,
        saltG: 0.2,
      },
    })

    expect(result.status).toBe('partial')
    expect(result.estimates.saturatedFatG.status).toBe('available')
    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.calciumMg.status).toBe('available')
    expect(result.estimates.ironMg).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['reference_value_missing'],
    })
    expect(result.estimates.vitaminEMg).toMatchObject({
      status: 'available',
      confidence: 'low',
      method: GENRE_PRIOR_PARTIAL_METHOD,
      limitationReasons: ['reference_value_missing'],
    })
    expect(result.estimates.fiberG.confidence).toBe('low')
    expect(result.estimates.fiberG.sourceFoodIds).toEqual(expect.arrayContaining([
      'mext_15187',
      'mext_03003',
      'fdc:171421',
      'mext_17083',
    ]))
    expect(result.estimates.fiberG.source).toContain('USDA FoodData Central')
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('代理参照')
    expect(result.estimates.fiberG.warnings.join(' ')).not.toContain('未対応原材料')
  })

  it('ココアバターはFDCのレビュー済み直接値を使いMEXT代理参照を置き換える', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: 'ココアバター',
      referenceMassG: 100,
      ingredientsText: 'ココアバター',
    })

    expect(result.status).toBe('completed')
    expect(result.estimates.saturatedFatG).toMatchObject({
      status: 'available',
      value: 59.7,
      sourceFoodIds: ['fdc:171421'],
    })
    expect(result.estimates.vitaminEMg).toMatchObject({ status: 'available', value: 1.8 })
    expect(result.estimates.saturatedFatG.warnings.join(' ')).toContain('FoodData Central')
  })

  it('FDC直接値と乾物候補で小麦外皮・油脂・酵母エキスを解決する', () => {
    expect(unresolvedIngredientNames(
      '小麦外皮、ココナッツオイル、鶏脂、酵母エキスパウダー、グァーガム分解物',
      '食物繊維入り調理品',
      'prepared_meal',
    )).toEqual([])

    const result = estimateNutrients({
      ...eligibleRequest,
      productName: '酵母エキス粉末',
      referenceMassG: 100,
      ingredientsText: '酵母エキスパウダー',
    })
    expect(result.status).toBe('completed')
    expect(result.estimates.vitaminB1Mg.status).toBe('available')
    expect(result.estimates.vitaminB1Mg.sourceFoodIds).toEqual(['fdc:167717'])
    expect(result.estimates.vitaminB1Mg.source).toBe('USDA FoodData Central SR Legacy 04/2018')
    expect(result.estimates.vitaminB1Mg.warnings.join(' ')).toContain('乾物換算')
  })

  it('公式原料仕様で単一糖質・L-カルニチン・ガラクトオリゴ糖を解決する', () => {
    expect(unresolvedIngredientNames(
      '麦芽糖、エリスリトール、パラチノース、L-カルニチン酒石酸塩、ガラクトオリゴ糖粉末、ミルクカルシウム',
      '栄養補助食品',
      'drink_jelly_pudding',
    )).toEqual([])

    const result = estimateNutrients({
      ...eligibleRequest,
      productName: '麦芽糖',
      referenceMassG: 100,
      ingredientsText: '麦芽糖',
    })
    expect(result.status).toBe('completed')
    expect(result.estimates.calciumMg).toMatchObject({
      status: 'available',
      value: 0,
      sourceFoodIds: ['spec:nagase-foods:sunmalt-s'],
      source: '原料メーカー・業界団体公式仕様',
    })
    expect(result.estimates.saturatedFatG).toMatchObject({ status: 'available', value: 0 })
    expect(result.estimates.calciumMg.warnings.join(' ')).toContain('公式仕様')
  })

  it('公式説明と低信頼度警告付きでパネトーネ種を候補分布へ解決する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: 'ロングライフパン',
      estimatorGenreId: 'bread',
      referenceMassG: 100,
      ingredientsText: '小麦粉、砂糖、パネトーネ種',
    })

    expect(result.unresolvedIngredients).toEqual([])
    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.fiberG.confidence).toBe('low')
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('コモ公式情報')
  })

  it('MEXT直接項目と明示した代理参照で市販品の頻出原材料を解決する', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      productName: '食物繊維入りチーズゼリー',
      referenceMassG: 100,
      ingredientsText: 'デキストリン、乳清たんぱく、ナチュラルチーズ、寒天、ゼラチン',
      knownNutrients: {
        energyKcal: 250,
        proteinG: 20,
        fatG: 5,
        carbohydrateG: 40,
        saltG: 0.5,
      },
    })

    expect(result.status).not.toBe('failed')
    expect(result.unresolvedIngredients).toEqual([])
    expect(result.estimates.fiberG.sourceFoodIds).toEqual(expect.arrayContaining([
      'mext_09049',
      'mext_13010',
      'mext_11198',
    ]))
    expect(result.estimates.fiberG.warnings.join(' ')).toContain('代理参照')
  })

  it('栄養添加物の配合量が不明でも、数値がある原材料分を部分参考値として返す', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      ingredientsText: '小麦粉、砂糖、乳糖／乳酸Ca、ピロリン酸鉄、V.B1、V.C',
    })

    expect(result.status).toBe('partial')
    for (const key of ['calciumMg', 'ironMg', 'vitaminB1Mg', 'vitaminCMg'] as const) {
      expect(result.estimates[key]).toMatchObject({
        status: 'available',
        confidence: 'low',
        method: key === 'ironMg' ? GENRE_PRIOR_PARTIAL_METHOD : PARTIAL_METHOD,
      })
      expect(result.estimates[key].limitationReasons).toContain('additive_contribution_unknown')
      expect(result.estimates[key].warnings.join(' ')).toContain('配合量は不明なため加算していません')
    }
    expect(result.estimates.vitaminB2Mg.status).toBe('available')
    expect(result.estimates.fiberG.status).toBe('available')
  })

  it('デキストリンを通常原料と食物繊維用途で商品名から分ける', () => {
    const ordinary = estimateNutrients({
      ...eligibleRequest,
      productName: 'プロテインパウダー',
      referenceMassG: 100,
      ingredientsText: 'デキストリン',
      knownNutrients: undefined,
      requestedNutrients: ['fiberG'],
    })
    const fiberProduct = estimateNutrients({
      ...eligibleRequest,
      productName: '食物繊維入りトロメイク',
      referenceMassG: 100,
      ingredientsText: 'デキストリン',
      knownNutrients: undefined,
      requestedNutrients: ['fiberG'],
    })

    expect(ordinary.estimates.fiberG).toMatchObject({
      status: 'available',
      value: 0,
      sourceFoodIds: ['mext_02035'],
    })
    expect(fiberProduct.estimates.fiberG).toMatchObject({
      status: 'available',
      value: 79,
      sourceFoodIds: ['mext_09049'],
    })
  })
})
