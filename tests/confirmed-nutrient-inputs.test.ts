import { describe, expect, it } from 'vitest'
import {
  canonicalizeConfirmedNutrientInputs,
  confirmedNutrientInputsFromFood,
  createNutrientEstimateRequestFingerprint,
  type NutrientEstimateInputFields,
} from '../src/services/confirmedNutrientInputs'
import { NUTRIENT_KEYS, type NutrientEvidence } from '../src/types'

const manual: NutrientEvidence = { origin: 'user_input', verified: true, resolution: 'explicit_metadata' }
const source = 'https://example.test/label'

describe('確認済み推計入力の境界', () => {
  it('全14項目を同じ条件で確認し、裸の数値は採用しない', () => {
    const knownNutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, 1]))
    expect(canonicalizeConfirmedNutrientInputs({ knownNutrients }).knownNutrients).toEqual({})
    const knownNutrientEvidence = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, manual]))
    expect(canonicalizeConfirmedNutrientInputs({ knownNutrients, knownNutrientEvidence, requestedNutrients: [] }).knownNutrients)
      .toEqual(knownNutrients)
  })

  it.each(['external_source', 'estimated', 'derived', 'unknown'] as const)('%sは確認済みでも既知入力へ昇格させない', (origin) => {
    expect(canonicalizeConfirmedNutrientInputs({
      requestedNutrients: ['fiberG'],
      knownNutrients: { calciumMg: 10 },
      knownNutrientEvidence: { calciumMg: { ...manual, origin } },
    }).knownNutrients).toEqual({})
  })

  it('旧手入力は限定条件で解決し、明示metadataと外部sourceを優先する', () => {
    const resolve = (input: Parameters<typeof confirmedNutrientInputsFromFood>[0]) => (
      canonicalizeConfirmedNutrientInputs({ ...confirmedNutrientInputsFromFood(input), requestedNutrients: ['fiberG'] })
    )
    const input = { source: 'user' as const, nutrients: { calciumMg: 10 } }
    expect(resolve(input).knownNutrientEvidence.calciumMg?.resolution).toBe('legacy_source_user')
    expect(resolve({ ...input, legacyFallbackBlocked: true }).knownNutrients).toEqual({})
    expect(resolve({ ...input, source: 'open_food_facts' }).knownNutrients).toEqual({})
    expect(resolve({ ...input, nutrientMetadata: { calciumMg: { origin: 'estimated', verified: true } } }).knownNutrients)
      .toEqual({})
    expect(resolve({ ...input, nutrientMetadata: { calciumMg: undefined } }).knownNutrients).toEqual({})
  })

  it('推定注記を持つ参照は点値fallbackでも再投入しない', () => {
    expect(canonicalizeConfirmedNutrientInputs({
      requestedNutrients: ['fiberG'],
      knownNutrients: { calciumMg: 10 },
      knownNutrientEvidence: { calciumMg: manual },
      knownNutrientReferences: {
        calciumMg: { origin: 'user_input', verified: true, sourceReference: source, reference: { kind: 'estimated', value: 10 } },
      },
    }).knownNutrients).toEqual({})
  })

  it('対象自身の値・根拠・参照を計算fingerprintから除外する', () => {
    const input: NutrientEstimateInputFields = {
      knownNutrients: { calciumMg: 10, fatG: 2 },
      knownNutrientEvidence: { calciumMg: manual, fatG: manual },
      requestedNutrients: ['calciumMg'],
    }
    const changed: NutrientEstimateInputFields = {
      ...input,
      knownNutrients: { calciumMg: 999, fatG: 2 },
      knownNutrientReferences: {
        calciumMg: { origin: 'manufacturer_label', verified: false, reference: { kind: 'estimated', value: 999 } },
      },
    }
    expect(createNutrientEstimateRequestFingerprint(changed)).toBe(createNutrientEstimateRequestFingerprint(input))
    expect(canonicalizeConfirmedNutrientInputs(changed).knownNutrients).toEqual({ fatG: 2 })
  })

  it('根拠・出典・計算基準だけの変更でも再計算を要求する', () => {
    const input: NutrientEstimateInputFields = {
      productName: '食品', referenceMassG: 100, ingredientsText: '乳',
      requestedNutrients: ['fiberG'],
      knownNutrients: { calciumMg: 10 }, knownNutrientEvidence: { calciumMg: { ...manual, source } },
    }
    const original = createNutrientEstimateRequestFingerprint(input)
    for (const changed of [
      { ...input, referenceMassG: 90 },
      { ...input, ingredientsText: '乳、砂糖' },
      { ...input, knownNutrientEvidence: { calciumMg: { ...manual, source: '別の記録' } } },
      { ...input, knownNutrientEvidence: { calciumMg: { ...manual, verified: false } } },
    ]) expect(createNutrientEstimateRequestFingerprint(changed)).not.toBe(original)
  })

  it('正規化後の根拠・参照・基準を元の可変入力から独立させる', () => {
    const input: NutrientEstimateInputFields = {
      requestedNutrients: ['fiberG'],
      knownNutrients: { calciumMg: 10 }, knownNutrientEvidence: { calciumMg: { ...manual } },
      knownNutrientReferenceBasis: { amount: 100, unit: 'g' },
      knownNutrientReferences: {
        calciumMg: { origin: 'user_input', verified: true, sourceReference: source,
          reference: { kind: 'fixed', value: 10 }, basis: { amount: 100, unit: 'g' } },
      },
    }
    const saved = canonicalizeConfirmedNutrientInputs(input)
    input.knownNutrientEvidence!.calciumMg!.verified = false
    input.knownNutrientReferences!.calciumMg!.reference.value = 20
    input.knownNutrientReferences!.calciumMg!.basis!.amount = 50
    input.knownNutrientReferenceBasis!.amount = 50
    expect(saved.knownNutrientEvidence.calciumMg!.verified).toBe(true)
    expect(saved.knownNutrientReferences.calciumMg!.reference.value).toBe(10)
    expect(saved.knownNutrientReferences.calciumMg!.basis!.amount).toBe(100)
    expect(saved.knownNutrientReferenceBasis!.amount).toBe(100)
  })
})
