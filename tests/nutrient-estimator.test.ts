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

    expect(result.status).toBe('partial')
    expect(result.estimates.fiberG.status).toBe('available')
    expect(result.estimates.saturatedFatG.status).toBe('unavailable')
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
