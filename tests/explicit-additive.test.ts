import { describe, expect, it } from 'vitest'
import { estimateNutrients, toStoredNutrientEstimateResult, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import { createIngredientDeclarationFingerprint, validateExplicitEstimationEvidence } from '../src/services/explicitCompositionEvidence'
import { isExplicitAdditiveTraceArray } from '../src/services/explicitAdditiveEvidence'
import { REVIEWED_COMPOSITION_STATES, reviewedCompositionProfile } from '../src/services/reviewedCompositionStates'
import type { ExplicitAdditiveProof, ExplicitEstimationEvidenceV3 } from '../src/types'
const now = '2026-10-04T00:00:00Z'
const source = { kind: 'user_measurement' as const, reference: 'synthetic edible batch', verified: true as const, checkedAt: now }
function fixture(section: 'ingredient' | 'additive' = 'additive') {
  const ingredientsText = section === 'ingredient' ? '上白糖、合成製剤' : '上白糖／合成製剤'
  const state = REVIEWED_COMPOSITION_STATES.mext_03003
  const proof: ExplicitAdditiveProof = {
    id: 'dose', declaration: { section, path: [section === 'ingredient' ? 1 : 0], expectedName: '合成製剤' },
    materialId: 'synthetic material', grade: 'synthetic confirmed grade', dose: { kind: 'preparation_mass_g', value: 1, stage: 'finished' },
    contentsPerG: { calciumMg: { kind: 'fixed', valuePerG: 200 } }, doseSource: source,
    contentSource: { ...source, kind: 'material_specification', reference: 'synthetic material specification' },
  }
  const evidence: ExplicitEstimationEvidenceV3 = { schemaVersion: 3, declarationFingerprint: createIngredientDeclarationFingerprint(ingredientsText), additives: [proof],
    compositions: [{ id: 'root', parent: { section: 'ingredient', path: [] }, expectedChildNames: section === 'ingredient' ? ['上白糖', '合成製剤'] : ['上白糖'], denominator: 'product', weightStage: 'finished',
      ...(section === 'additive' ? { massScope: 'food_remainder_after_additives' as const, wholeParentMassG: 100 } : {}),
      amounts: { kind: 'masses_g', denominatorMassG: section === 'ingredient' ? 100 : 99,
        children: section === 'ingredient' ? [{ index: 0, value: 99 }, { index: 1, value: 1 }] : [{ index: 0, value: 99 }] },
      childBindings: [{ kind: 'profile', index: 0, expectedProfileId: 'mext_03003', expectedProfileStateId: state.profileStateId, finishedIngredientStateId: state.finishedIngredientStateId, stateSource: source },
        ...(section === 'ingredient' ? [{ kind: 'additive' as const, index: 1, additiveId: 'dose' }] : [])], source }],
  }
  const request: NutrientEstimateRequest = { requestId: 'synthetic', baseAmount: 100, baseUnit: 'g', referenceMassG: 100, referenceMassSource: '100g',
    ingredientsText, ingredientsSource: { provider: 'synthetic', verified: true }, knownNutrients: {}, requestedNutrients: ['calciumMg', 'fiberG'], estimationEvidence: evidence, requestedAt: now }
  return { request, evidence, proof }
}
describe('explicit additive doses', () => {
  it.each(['ingredient', 'additive'] as const)('counts material exactly once in %s section', (section) => {
    const { request } = fixture(section)
    const result = estimateNutrients(request)
    const calcium = reviewedCompositionProfile('mext_03003')!.profile.nutrients.calciumMg!
    expect(result.estimates.calciumMg.value).toBeCloseTo(calcium * .99 + 200, 3)
    expect(result.estimates.fiberG.method).toBe('browser_ingredient_partial_rule')
    const traces = result.optimization!.trace!.explicitCompositionEvidence!.additives!
    expect(traces[0]).toMatchObject({ status: 'applied', preparationMassG: 1, unknownAdditiveMass: false })
    expect(isExplicitAdditiveTraceArray(traces)).toBe(true)
    const stored = toStoredNutrientEstimateResult(result, { foodId: 'test', inputHash: 'hash', baseAmount: 100, baseUnit: 'g' })
    traces[0].pointsPer100g.calciumMg = 999
    expect(stored.optimization!.trace!.explicitCompositionEvidence!.additives![0].pointsPer100g.calciumMg).toBe(200)
  })
  it.each(['minimum', 'declared_range'] as const)('preserves %s bounds without inventing a point', (kind) => {
    const { request, proof } = fixture()
    proof.contentsPerG.calciumMg = kind === 'minimum' ? { kind, minPerG: 200 } : { kind, minPerG: 200, maxPerG: 220 }
    const result = estimateNutrients(request)
    const trace = result.optimization!.trace!.explicitCompositionEvidence!.additives![0]
    expect(trace.pointsPer100g.calciumMg).toBeUndefined()
    expect(trace.boundsPer100g.calciumMg).toEqual({ min: 200, max: kind === 'minimum' ? null : 220 })
    expect(result.estimates.calciumMg.value).toBeCloseTo(reviewedCompositionProfile('mext_03003')!.profile.nutrients.calciumMg! * .99, 3)
    expect(result.estimates.calciumMg.method).toBe('browser_ingredient_partial_rule')
  })
  it('marks a published reference as a reference, without guaranteed bounds', () => {
    const { request, proof } = fixture()
    proof.contentsPerG.calciumMg = { kind: 'published_reference', valuePerG: 200 }
    const trace = estimateNutrients(request).optimization!.trace!.explicitCompositionEvidence!.additives![0]
    expect(trace.referenceOnlyNutrients).toEqual(['calciumMg'])
    expect(trace.boundsPer100g).toEqual({})
  })
  it.each(['whole', 'raw', 'active', 'missing', 'mass', 'name', 'position'] as const)('defers %s contradiction without fitting a dose', (condition) => {
    const { request, evidence, proof } = fixture()
    if (condition === 'whole') { evidence.compositions![0].massScope = 'whole_parent'; evidence.compositions![0].wholeParentMassG = 99 }
    if (condition === 'raw') proof.dose.stage = 'raw'
    if (condition === 'active') proof.dose = { kind: 'active_nutrient_amount', nutrient: 'calciumMg', value: 200, stage: 'finished' }
    if (condition === 'missing') evidence.additives = []
    if (condition === 'mass') evidence.compositions![0].wholeParentMassG = 101
    if (condition === 'name') proof.declaration.expectedName = '別製剤'
    if (condition === 'position') proof.declaration.path = [1]
    const result = estimateNutrients(request)
    expect(result.estimates.calciumMg.status).toBe('unavailable')
    expect(result.optimization?.trace?.explicitCompositionEvidence?.status).toBe('deferred')
  })
  it('rejects duplicate positions, reversed ranges and unknown content keys', () => {
    const { evidence, proof } = fixture()
    expect(() => validateExplicitEstimationEvidence({ ...evidence, additives: [proof, { ...proof, id: 'second' }] })).toThrow()
    proof.contentsPerG.calciumMg = { kind: 'declared_range', minPerG: 220, maxPerG: 200 }
    expect(() => validateExplicitEstimationEvidence(evidence)).toThrow()
    const unknown = { ...proof, contentsPerG: { mystery: { kind: 'fixed', valuePerG: 1 } } }
    expect(() => validateExplicitEstimationEvidence({ ...evidence, additives: [unknown] })).toThrow()
  })
  it('round trips v3 as independent evidence and rejects old schema additive fields', () => {
    const { evidence } = fixture()
    const restored = validateExplicitEstimationEvidence(JSON.parse(JSON.stringify(evidence)))
    expect(restored).toEqual(evidence)
    expect(() => validateExplicitEstimationEvidence({ ...evidence, schemaVersion: 2 })).toThrow()
  })
})
