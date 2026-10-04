import { describe, expect, it } from 'vitest'
import { candidateFitLowerBound, orderedSimplexPredictionBounds, benchmarkCandidateSearch } from '../src/services/nutrientEstimator'
import { EMPTY_NUTRIENTS } from '../src/types'
import type { IngredientProfile } from '../src/services/nutrientEstimatorProfiles'
const profile = (id: string, energy: number, fat: number | null): IngredientProfile => ({ profileId: id, canonicalName: id, nutrients: { ...EMPTY_NUTRIENTS, energyKcal: energy, fatG: fat }, sourceFoodIds: [id], priorProbability: .5 })
describe('ordered-simplex search lower bound', () => {
  it('contains every ordered three-ingredient mixture rather than only a fallback mixture', () => {
    const values = [100, 0, 1000]
    const range = orderedSimplexPredictionBounds(values, values)
    expect(range).toEqual({ min: 50, max: 1100 / 3 })
    for (let a = 0; a <= 100; a++) for (let b = 0; b <= 100 - a; b++) {
      const c = 100 - a - b
      if (a < b || b < c) continue
      const value = (100 * a + 1000 * c) / 100
      expect(value).toBeGreaterThanOrEqual(range.min - 1e-12)
      expect(value).toBeLessThanOrEqual(range.max + 1e-12)
    }
  })
  it('allows a prefix-vertex optimum which the old fallback bound penalized', () => {
    const sets = [[profile('first', 100, 0)], [profile('second', 0, 0)], [profile('third', 1000, 0)]]
    expect(candidateFitLowerBound({ profiles: [], priorProbability: 1 }, sets, { referenceMassG: 100, knownNutrients: { energyKcal: 50, fatG: 0 } })).toBe(0)
  })
  it('divides universal complete-key losses by all possible observed keys when a completion can omit a key', () => {
    const sets = [[profile('a', 100, null)], [profile('b', 100, 0)]]
    const bound = candidateFitLowerBound({ profiles: [], priorProbability: 1 }, sets, { referenceMassG: 100, knownNutrients: { energyKcal: 200, fatG: 0 } })!
    expect(bound).toBe(625 / 2)
    expect(bound).toBeLessThanOrEqual(625)
  })
  it('has deterministic exhaustive-reference and bounded beam benchmarks', () => {
    const sets = [[profile('a', 100, 0), profile('b', 200, 10)], [profile('c', 100, 0), profile('d', 400, 20)]]
    const context = { referenceMassG: 100, knownNutrients: { energyKcal: 200, fatG: 10 } }
    const full = benchmarkCandidateSearch(sets, context, 4, 16)
    const second = benchmarkCandidateSearch(sets, context, 4, 16)
    expect(second.bestProfileIds).toEqual(full.bestProfileIds)
    expect(second.bestRatios).toEqual(full.bestRatios)
    const beam = benchmarkCandidateSearch(sets, context, 2, 16)
    expect(beam.bestScore).toBeGreaterThanOrEqual(full.bestScore - 1e-10)
    expect(() => benchmarkCandidateSearch(sets, context, 4097)).toThrow()
  })
})
