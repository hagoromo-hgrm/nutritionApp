import { describe, expect, it } from 'vitest'
import { estimateNutrients, isEstimateAdoptable, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'

const eligibleRequest: NutrientEstimateRequest = {
  requestId: 'estimate-test-1',
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
    expect(first.status).toBe('completed')
    expect(first.basis).toEqual({ baseAmount: 1, baseUnit: '袋' })
    expect(first.estimatedAt).toBe(eligibleRequest.requestedAt)
    expect(first.estimates.saturatedFatG.status).toBe('available')
    expect(first.estimates.fiberG.status).toBe('available')
    expect(first.estimates.fiberG.value).not.toBeNull()
    expect(first.estimates.fiberG.range).not.toBeNull()
    expect(first.estimates.calciumMg.status).toBe('available')
    expect(first.estimates.ironMg.status).toBe('available')
    expect(first.estimates.vitaminAMcg.status).toBe('available')
    expect(first.estimates.vitaminEMg.status).toBe('available')
    expect(first.estimates.vitaminB1Mg.status).toBe('available')
    expect(first.estimates.vitaminB2Mg.status).toBe('available')
    expect(first.estimates.vitaminCMg.status).toBe('available')
    expect(first.modelVersion).toBe('browser-rule-0.3.0')
  })

  it('明示的な基準重量がなければ単位から重量を推測しない', () => {
    const result = estimateNutrients({ ...eligibleRequest, referenceMassG: null })

    expect(result.status).toBe('failed')
    expect(result.estimates.saturatedFatG).toMatchObject({
      status: 'unavailable',
      value: null,
      confidence: 'unavailable',
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
  })

  it('原材料の取得元が未確認なら推計しない', () => {
    const result = estimateNutrients({ ...eligibleRequest, ingredientsSource: { provider: '外部DB', verified: false } })

    expect(result.status).toBe('failed')
    expect(result.estimates.fiberG.value).toBeNull()
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
    })
    expect(unavailable.estimates.fiberG).toMatchObject({
      status: 'unavailable',
      value: null,
      range: null,
    })
    expect(isEstimateAdoptable(null, zero.estimates.fiberG)).toBe(true)
    expect(isEstimateAdoptable(0, zero.estimates.fiberG)).toBe(false)
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
      range: { min: 0, max: 0 },
    })
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

  it('MEXT参照値の欠損をゼロ補完せず栄養素単位の部分成功にする', () => {
    const result = estimateNutrients({
      ...eligibleRequest,
      ingredientsText: '脱脂粉乳',
    })

    expect(result.status).toBe('partial')
    expect(result.estimates.calciumMg.status).toBe('available')
    expect(result.estimates.vitaminEMg).toMatchObject({
      status: 'unavailable',
      value: null,
      range: null,
      confidence: 'unavailable',
    })
    expect(result.estimates.vitaminEMg.warnings.join(' ')).toContain('mext_13010')
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
    expect(estimate.warnings.join(' ')).toContain('参照食品の種類に幅')
  })
})
