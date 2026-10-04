import { describe, expect, it } from 'vitest'
import { createEstimationInputHash } from '../src/services/foodRevision'
import { EMPTY_NUTRIENTS, NUTRIENT_KEYS, type Food } from '../src/types'

const food: Food = {
  id: 'food_revision',
  name: '食品',
  maker: 'メーカー',
  barcode: '',
  source: 'user',
  sourceVersion: 'test',
  baseAmount: 100,
  baseUnit: 'g',
  servingAmount: null,
  servingUnit: null,
  nutrients: { ...EMPTY_NUTRIENTS },
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
}

describe('createEstimationInputHash', () => {
  it('uses a new explicit version so legacy hashes cannot validate a pending result', () => {
    expect(createEstimationInputHash(food)).toMatch(/^fnv1a-v2:[0-9a-f]{8}$/)
  })

  it.each(NUTRIENT_KEYS)('includes provenance for every nutrient key (%s)', (key) => {
    const withEvidence: Food = {
      ...food,
      nutrientMetadata: { [key]: { origin: 'user_input', verified: true, source: 'manual entry' } },
    }
    expect(createEstimationInputHash(withEvidence)).not.toBe(createEstimationInputHash(food))
  })

  it('includes the Food source and each provenance detail in the conflict stamp', () => {
    const verified: Food = {
      ...food,
      nutrientMetadata: { energyKcal: { origin: 'manufacturer_label', verified: true, source: 'label' } },
    }
    expect(createEstimationInputHash({ ...food, source: 'imported' })).not.toBe(createEstimationInputHash(food))
    expect(createEstimationInputHash({ ...verified, nutrientMetadata: { energyKcal: { ...verified.nutrientMetadata!.energyKcal!, verified: false } } }))
      .not.toBe(createEstimationInputHash(verified))
    expect(createEstimationInputHash({ ...verified, nutrientMetadata: { energyKcal: { ...verified.nutrientMetadata!.energyKcal!, source: 'different label' } } }))
      .not.toBe(createEstimationInputHash(verified))
  })

  it('canonicalizes nested metadata keys regardless of object insertion order and hashes future fields', () => {
    const firstMetadata = {
      origin: 'manufacturer_label',
      verified: true,
      source: 'label',
      estimatedRange: { min: 1, max: 2 },
      futureEvidence: { reference: 'source-id', details: { a: 1, z: 2 } },
    }
    const reorderedMetadata = {
      futureEvidence: { details: { z: 2, a: 1 }, reference: 'source-id' },
      estimatedRange: { max: 2, min: 1 },
      source: 'label',
      verified: true,
      origin: 'manufacturer_label',
    }
    const first = { ...food, nutrientMetadata: { energyKcal: firstMetadata } } as unknown as Food
    const reordered = { ...food, nutrientMetadata: { energyKcal: reorderedMetadata } } as unknown as Food
    const changedFutureValue = {
      ...food,
      nutrientMetadata: { energyKcal: { ...firstMetadata, futureEvidence: { ...firstMetadata.futureEvidence, reference: 'other-source' } } },
    } as unknown as Food

    expect(createEstimationInputHash(first)).toBe(createEstimationInputHash(reordered))
    expect(createEstimationInputHash(first)).not.toBe(createEstimationInputHash(changedFutureValue))
  })

  it('blocks legacy source-user fallback when either old exclusion hint is present', () => {
    const withoutHint = createEstimationInputHash(food)
    const estimatedHint = { ...food, estimatedNutrients: undefined } as Food & { estimatedNutrients?: unknown }
    const externalHint = { ...food, externalSource: { provider: 'legacy' } } as Food & { externalSource?: unknown }

    expect(createEstimationInputHash(estimatedHint)).not.toBe(withoutHint)
    expect(createEstimationInputHash(externalHint)).not.toBe(withoutHint)
  })

  it('treats an unreadable legacy exclusion hint conservatively without throwing', () => {
    const unreadable = new Proxy(food, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'externalSource') throw new Error('not inspectable')
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })

    expect(() => createEstimationInputHash(unreadable)).not.toThrow()
    expect(createEstimationInputHash(unreadable)).not.toBe(createEstimationInputHash(food))
  })
})
