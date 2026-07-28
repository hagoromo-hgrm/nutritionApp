import { describe, expect, it } from 'vitest'
import {
  ESTIMATABLE_NUTRIENT_KEYS,
  GENRE_PRIOR_PARTIAL_METHOD,
  PARTIAL_METHOD,
  estimateNutrients,
  type EstimatableNutrientKey,
} from '../src/services/nutrientEstimator'
import {
  SYNTHETIC_NUTRIENT_ESTIMATOR_CASES,
  SYNTHETIC_TARGET_NUTRIENTS,
} from './fixtures/nutrient-estimator-synthetic'

interface NutrientAccuracy {
  nutrient: EstimatableNutrientKey
  comparableCount: number
  nonZeroCount: number
  mae: number
  mapePercent: number | null
  rangeCoveragePercent: number
  availabilityConsistencyPercent: number
}

interface AccuracyBenchmark {
  byNutrient: NutrientAccuracy[]
  overallMapePercent: number
  rangeCoveragePercent: number
  availabilityConsistencyPercent: number
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function calculateBenchmark(): AccuracyBenchmark {
  const absoluteErrors = new Map<EstimatableNutrientKey, number[]>()
  const absolutePercentageErrors = new Map<EstimatableNutrientKey, number[]>()
  const rangeHits = new Map<EstimatableNutrientKey, boolean[]>()
  const availabilityMatches = new Map<EstimatableNutrientKey, boolean[]>()

  for (const key of SYNTHETIC_TARGET_NUTRIENTS) {
    absoluteErrors.set(key, [])
    absolutePercentageErrors.set(key, [])
    rangeHits.set(key, [])
    availabilityMatches.set(key, [])
  }

  for (const fixture of SYNTHETIC_NUTRIENT_ESTIMATOR_CASES) {
    const result = estimateNutrients({
      requestId: `accuracy-${fixture.id}`,
      productName: fixture.name,
      baseAmount: 1,
      baseUnit: '袋',
      referenceMassG: fixture.referenceMassG,
      referenceMassSource: '人工配合fixture',
      ingredientsText: fixture.ingredientsText,
      ingredientsSource: { provider: '人工配合fixture', verified: true },
      knownNutrients: fixture.knownNutrients,
      requestedNutrients: SYNTHETIC_TARGET_NUTRIENTS,
      requestedAt: '2026-07-26T00:00:00.000Z',
    })

    for (const key of SYNTHETIC_TARGET_NUTRIENTS) {
      const truth = fixture.trueNutrients[key]
      const estimate = result.estimates[key]
      const truthAvailable = truth !== null
      const estimateAvailable = estimate.status === 'available'
      const fullEstimateAvailable = estimateAvailable
        && ![PARTIAL_METHOD, GENRE_PRIOR_PARTIAL_METHOD].includes(estimate.method)
      availabilityMatches.get(key)!.push(
        truthAvailable ? estimateAvailable : !fullEstimateAvailable,
      )

      if (truth === null || estimate.status !== 'available') continue
      expect([
        'browser_ingredient_macro_fit',
        'browser_ingredient_rule',
        PARTIAL_METHOD,
        GENRE_PRIOR_PARTIAL_METHOD,
      ]).toContain(estimate.method)
      const error = Math.abs(estimate.value - truth)
      absoluteErrors.get(key)!.push(error)
      if (truth !== 0) absolutePercentageErrors.get(key)!.push(error / Math.abs(truth))
      rangeHits.get(key)!.push(truth >= estimate.range.min && truth <= estimate.range.max)
    }
  }

  const byNutrient = SYNTHETIC_TARGET_NUTRIENTS.map<NutrientAccuracy>((nutrient) => {
    const errors = absoluteErrors.get(nutrient)!
    const percentageErrors = absolutePercentageErrors.get(nutrient)!
    const hits = rangeHits.get(nutrient)!
    const availability = availabilityMatches.get(nutrient)!
    return {
      nutrient,
      comparableCount: errors.length,
      nonZeroCount: percentageErrors.length,
      mae: round(errors.reduce((sum, value) => sum + value, 0) / errors.length, 4),
      mapePercent: percentageErrors.length === 0
        ? null
        : round(percentageErrors.reduce((sum, value) => sum + value, 0) / percentageErrors.length * 100),
      rangeCoveragePercent: round(hits.filter(Boolean).length / hits.length * 100),
      availabilityConsistencyPercent: round(availability.filter(Boolean).length / availability.length * 100),
    }
  })
  const allPercentageErrors = [...absolutePercentageErrors.values()].flat()
  const allRangeHits = [...rangeHits.values()].flat()
  const allAvailability = [...availabilityMatches.values()].flat()

  return {
    byNutrient,
    overallMapePercent: round(
      allPercentageErrors.reduce((sum, value) => sum + value, 0) / allPercentageErrors.length * 100,
    ),
    rangeCoveragePercent: round(allRangeHits.filter(Boolean).length / allRangeHits.length * 100),
    availabilityConsistencyPercent: round(
      allAvailability.filter(Boolean).length / allAvailability.length * 100,
    ),
  }
}

describe('browser nutrient estimator synthetic accuracy benchmark', () => {
  it('原材料表示順とfixtureの配合比・既知macroを健全に保つ', () => {
    expect(SYNTHETIC_NUTRIENT_ESTIMATOR_CASES.length).toBeGreaterThanOrEqual(10)
    expect(SYNTHETIC_TARGET_NUTRIENTS).toEqual(ESTIMATABLE_NUTRIENT_KEYS)

    for (const fixture of SYNTHETIC_NUTRIENT_ESTIMATOR_CASES) {
      expect(fixture.trueComposition.reduce((sum, ingredient) => sum + ingredient.ratio, 0)).toBeCloseTo(1, 5)
      for (let index = 1; index < fixture.trueComposition.length; index += 1) {
        expect(fixture.trueComposition[index - 1].massG).toBeGreaterThanOrEqual(
          fixture.trueComposition[index].massG,
        )
      }
      expect(Object.values(fixture.knownNutrients).every(Number.isFinite)).toBe(true)
      expect(Object.keys(fixture.trueNutrients)).toEqual(SYNTHETIC_TARGET_NUTRIENTS)
    }
  })

  it('栄養素別精度・全体MAPE・範囲包含率・available/null整合を計測する', () => {
    const benchmark = calculateBenchmark()

    console.info('[nutrient-estimator synthetic benchmark]')
    console.table(benchmark.byNutrient)
    console.info({
      overallMapePercent: benchmark.overallMapePercent,
      rangeCoveragePercent: benchmark.rangeCoveragePercent,
      availabilityConsistencyPercent: benchmark.availabilityConsistencyPercent,
    })

    expect(benchmark.byNutrient.every((metric) => Number.isFinite(metric.mae))).toBe(true)
    expect(benchmark.overallMapePercent).toBeLessThan(5)
    expect(benchmark.rangeCoveragePercent).toBeGreaterThanOrEqual(80)
    expect(benchmark.availabilityConsistencyPercent).toBe(100)
  })
})
