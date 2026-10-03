import { describe, expect, it } from 'vitest'
import { ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH } from '../src/data/nutrientEstimatorGenreNutrientPriors'
import {
  assertManifestBijection,
  assertApprovedPriorDataset,
  buildRequest,
  meetsEvaluationFloor,
  modeMetric,
  pairedSummary,
  parseTargetReference,
  recommendDefaultFitMode,
} from '../scripts/lib/nutrientEstimatorComparison'

describe('nutrient estimator fit comparison helpers', () => {
  it('uses fixed labels as printed points and rejects estimated and malformed ranges', () => {
    expect(parseTargetReference({ valueKind: 'fixed', value: 0, decimalPlaces: 0 })).toEqual({
      reference: { kind: 'fixed', value: 0, decimalPlaces: 0 },
      fixed: true,
    })
    expect(parseTargetReference({ valueKind: 'declared_range', rangeMin: 1, rangeMax: 3, decimalPlaces: 0 })).toEqual({
      reference: { kind: 'declared_range', min: 1, max: 3, decimalPlaces: 0 },
      fixed: false,
    })
    expect(parseTargetReference({ valueKind: 'estimated', value: 2, decimalPlaces: 0 })).toBe('estimated')
    expect(parseTargetReference({ valueKind: 'fixed', value: true, decimalPlaces: 0 })).toBe('invalid_boolean')
    expect(parseTargetReference({ valueKind: 'fixed', value: Number.POSITIVE_INFINITY, decimalPlaces: 0 })).toBe('invalid_nonfinite')
    expect(parseTargetReference({ valueKind: 'declared_range', rangeMin: 3, rangeMax: 2, decimalPlaces: 0 })).toBe('invalid_range_order')
    expect(parseTargetReference({ valueKind: 'fixed', value: -1, decimalPlaces: 0 })).toBe('invalid_negative')
  })

  it('gates robust recommendations on family count, maker diversity, and maximum maker share', () => {
    const sufficient = {
      observedCount: 40,
      acceptedCount: 40,
      independentFamilyCount: 30,
      makerCount: 3,
      maximumMakerShare: 0.5,
      maximumFamilyShare: 1 / 30,
      missingCount: 0,
      estimatedCount: 0,
      invalidExcluded: {
        missing: 0,
        estimated: 0,
        invalid_format: 0,
        invalid_boolean: 0,
        invalid_nonfinite: 0,
        invalid_negative: 0,
        invalid_range_order: 0,
        invalid_value_kind: 0,
        invalid_reference_mass: 0,
      },
    }
    expect(meetsEvaluationFloor(sufficient)).toBe(true)
    expect(meetsEvaluationFloor({ ...sufficient, independentFamilyCount: 29 })).toBe(false)
    expect(meetsEvaluationFloor({ ...sufficient, makerCount: 2 })).toBe(false)
    expect(meetsEvaluationFloor({ ...sufficient, maximumMakerShare: 0.51 })).toBe(false)
  })

  it('keeps the global default at legacy while any target remains unsupported', () => {
    expect(recommendDefaultFitMode([
      { recommendation: 'robust_interval' },
      { recommendation: 'legacy_point' },
    ])).toBe('legacy_point')
    expect(recommendDefaultFitMode([
      { recommendation: 'robust_interval' },
    ])).toBe('robust_interval')
  })

  it('pairs only commonly available results and rejects a fixed-point regression', () => {
    const legacy = [
      observation({ fixed: true, pointAbsoluteError: 1, intervalOutsideError: 2, intervalOverlap: false }),
      observation({ fixed: false, pointAbsoluteError: null, intervalOutsideError: 4, intervalOverlap: false }),
      observation({ available: false }),
    ]
    const robust = [
      observation({ fixed: true, pointAbsoluteError: 1.5, intervalOutsideError: 1, intervalOverlap: true }),
      observation({ fixed: false, pointAbsoluteError: null, intervalOutsideError: 3, intervalOverlap: true }),
      observation({ fixed: true, pointAbsoluteError: 0, intervalOutsideError: 0, intervalOverlap: true }),
    ]
    expect(pairedSummary(legacy, robust)).toEqual({
      comparableAvailableCount: 2,
      robustFixedPointMaeDeltaPer100g: 0.5,
      robustIntervalOutsideMaeDeltaPer100g: -1,
      robustIntervalOverlapRateDelta: 1,
      nonRegression: false,
    })
  })

  it('compares fixed-label MAE only on fixed records and keeps all errors on per-100g scale', () => {
    const metric = modeMetric([
      observation({ fixed: true, pointAbsoluteError: 2, pointSignedError: -2, intervalOutsideError: 1, referenceWidth: 4 }),
      observation({ fixed: false, pointAbsoluteError: null, pointSignedError: null, intervalOutsideError: 3, referenceWidth: 6 }),
    ])
    expect(metric.referenceCount).toBe(2)
    expect(metric.availableCount).toBe(2)
    expect(metric.fixedPointMaePer100g).toBe(2)
    expect(metric.fixedPointBiasPer100g).toBe(-2)
    expect(metric.intervalOutsideMaePer100g).toBe(2)
    expect(metric.meanReferenceIntervalWidthPer100g).toBe(5)
  })

  it('keeps target labels out of known inputs and only adds verified fixed/range major references', () => {
    const record = {
      recordId: 'fixture-1',
      genreId: 'dairy',
      productName: 'synthetic fixture',
      maker: 'Fixture maker',
      productFamily: 'Fixture family',
      ingredientsText: '乳製品',
      baseAmount: 1,
      baseUnit: '袋',
      referenceMassG: 50,
      referenceMassSource: 'fixture',
      sourceReference: 'https://example.invalid/fixture',
      verifiedAt: '2026-01-01T00:00:00+09:00',
      nutrients: {
        fiberG: { valueKind: 'fixed', value: 2, rangeMin: null, rangeMax: null, decimalPlaces: 0 },
        energyKcal: { valueKind: 'fixed', value: 100, rangeMin: null, rangeMax: null, decimalPlaces: 0 },
        proteinG: { valueKind: 'declared_range', value: null, rangeMin: 3, rangeMax: 5, decimalPlaces: 0 },
        fatG: { valueKind: 'estimated', value: 4, rangeMin: null, rangeMax: null, decimalPlaces: 0 },
      },
    } as const
    const legacy = buildRequest(record, 'fiberG', 'legacy_point')
    const robust = buildRequest(record, 'fiberG', 'robust_interval')

    expect(legacy.requestedNutrients).toEqual(['fiberG'])
    expect(legacy.knownNutrients).toEqual({ energyKcal: 100, proteinG: 4 })
    expect(legacy.knownNutrientReferences?.energyKcal?.reference).toEqual({ kind: 'fixed', value: 100, decimalPlaces: 0 })
    expect(legacy.knownNutrientReferences?.proteinG?.reference).toEqual({ kind: 'declared_range', min: 3, max: 5, decimalPlaces: 0 })
    expect(legacy.knownNutrientReferences?.fatG).toBeUndefined()
    expect(legacy.knownNutrientReferences?.energyKcal?.basis).toEqual({ amount: 50, unit: 'g' })
    expect(legacy.requestId).toBe(robust.requestId)
    expect(legacy.requestedAt).toBe(robust.requestedAt)
  })

  it('accepts only the existing prior dataset for aggregate publication', () => {
    const approved = {
      format: 'nutrition-estimator-training-manifest',
      formatVersion: 1,
      sourceFileSha256: 'a'.repeat(64),
      normalizedDatasetSha256: ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH,
      recordCount: 1,
      records: [],
    }
    expect(() => assertApprovedPriorDataset(approved)).not.toThrow()
    expect(() => assertApprovedPriorDataset({
      ...approved,
      normalizedDatasetSha256: 'b'.repeat(64),
    })).toThrow(/既存prior教師データ/)
    expect(() => assertApprovedPriorDataset({
      ...approved,
      publicTrainingOrAggregateRedistributionPermitted: false,
    })).toThrow(/公開比較レポート/)
    expect(() => assertApprovedPriorDataset({ ...approved, seal: {} })).toThrow(/マニフェスト形式/)
  })

  it('rejects duplicate, missing, extra, and genre-mismatched manifest identities', () => {
    const dataset = {
      records: [
        { recordId: 'fixture-a', genreId: 'dairy' as const },
        { recordId: 'fixture-b', genreId: 'bread' as const },
      ],
    }
    const manifest = {
      format: 'nutrition-estimator-training-manifest' as const,
      formatVersion: 1 as const,
      sourceFileSha256: 'a'.repeat(64),
      normalizedDatasetSha256: ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH,
      recordCount: 2,
      records: [
        { recordId: 'fixture-a', genreId: 'dairy' as const, groupKey: 'family-a', split: 'calibration' as const },
        { recordId: 'fixture-b', genreId: 'bread' as const, groupKey: 'family-b', split: 'train' as const },
      ],
    }
    expect(assertManifestBijection(dataset, manifest).size).toBe(2)
    expect(() => assertManifestBijection(dataset, {
      ...manifest,
      records: [manifest.records[0]!, manifest.records[0]!],
    })).toThrow(/重複/)
    expect(() => assertManifestBijection(dataset, {
      ...manifest,
      records: [manifest.records[0]!, { ...manifest.records[1]!, recordId: 'fixture-extra' }],
    })).toThrow(/一致しません/)
    expect(() => assertManifestBijection(dataset, {
      ...manifest,
      records: [manifest.records[0]!, { ...manifest.records[1]!, genreId: 'dairy' }],
    })).toThrow(/ジャンル/)
  })
})

function observation(overrides: Partial<{
  available: boolean
  estimateKind: 'full' | 'known_only' | 'genre_prior' | null
  point: number | null
  rangeMin: number | null
  rangeMax: number | null
  pointAbsoluteError: number | null
  pointSignedError: number | null
  intervalOutsideError: number | null
  intervalOverlap: boolean | null
  referenceWidth: number
  fixed: boolean
}> = {}) {
  return {
    available: true,
    estimateKind: 'full' as const,
    point: 10,
    rangeMin: 8,
    rangeMax: 12,
    pointAbsoluteError: 1,
    pointSignedError: -1,
    intervalOutsideError: 2,
    intervalOverlap: false,
    referenceWidth: 3,
    fixed: true,
    ...overrides,
  }
}
