import { describe, expect, it } from 'vitest'
import { estimateNutrients, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import { resolveIngredientCandidates } from '../src/services/nutrientEstimatorProfiles'
const request: NutrientEstimateRequest = {
  requestId: 'underidentified synthetic', baseAmount: 100, baseUnit: 'g', referenceMassG: 100, referenceMassSource: 'synthetic',
  ingredientsText: '大豆油、なたね油', ingredientsSource: { provider: 'synthetic', verified: true },
  knownNutrients: { energyKcal: 900, fatG: 100 }, knownNutrientEvidence: {
    energyKcal: { origin: 'user_input', verified: true, resolution: 'explicit_metadata' }, fatG: { origin: 'user_input', verified: true, resolution: 'explicit_metadata' },
  }, requestedNutrients: ['vitaminEMg'], requestedAt: '2026-10-04T00:00:00Z', fitMode: 'robust_interval',
  knownNutrientReferenceBasis: { amount: 100, unit: 'g' }, knownNutrientReferences: {
    energyKcal: { origin: 'user_input', verified: true, sourceReference: 'synthetic', basis: { amount: 100, unit: 'g' }, reference: { kind: 'fixed', value: 900, decimalPlaces: 0 } },
    fatG: { origin: 'user_input', verified: true, sourceReference: 'synthetic', basis: { amount: 100, unit: 'g' }, reference: { kind: 'fixed', value: 100, decimalPlaces: 0 } },
  },
}
describe('multiple mixtures and conditional material bounds', () => {
  it('retains multiple feasible ratios for one candidate combination deterministically', () => {
    const first = estimateNutrients(request)
    const second = estimateNutrients(request)
    const trace = first.optimization!.trace!
    expect(trace.ratioScenarioPolicy).toBe('same_candidate_max4_v1')
    expect(trace.plausibleScenarioCount).toBeGreaterThan(trace.retainedCandidateCombinationCount)
    expect(trace.plausibleScenarioCount).toBeLessThanOrEqual(trace.retainedCandidateCombinationCount * 4)
    expect(second.optimization!.trace).toEqual(trace)
    expect(second.estimates.vitaminEMg).toEqual(first.estimates.vitaminEMg)
    expect(first.estimates.vitaminEMg.range!.min).toBeLessThanOrEqual(first.estimates.vitaminEMg.value!)
    expect(first.estimates.vitaminEMg.range!.max).toBeGreaterThanOrEqual(first.estimates.vitaminEMg.value!)
  })
  it('keeps conditional minimum Ca out of general-name fit and point estimates', () => {
    const profile = resolveIngredientCandidates('乳清ミネラル', null)[0]
    expect(profile.nutrients.calciumMg).toBeNull()
    expect(profile.conditionalSourceBounds!.calciumMg).toMatchObject({ kind: 'minimum', minPer100g: 22000, maxPer100g: null })
    expect(profile.conditionalSourceBounds!.calciumMg!.requiredMaterial).toContain('確認済み')
  })
  it('does not apply agar carrier values or a supplier minimum to generic soluble-fiber ingredients', () => {
    const profile = resolveIngredientCandidates('難消化性デキストリン', null)[0]
    expect(Object.values(profile.nutrients).every((value) => value === null)).toBe(true)
    expect(profile.conditionalSourceBounds!.fiberG).toMatchObject({ minPer100g: 85, maxPer100g: null, basis: 'ingredient_as_supplied' })
  })
})
