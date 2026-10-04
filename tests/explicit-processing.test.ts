import { describe, expect, it } from 'vitest'
import { estimateNutrients, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import { createIngredientDeclarationFingerprint, validateExplicitEstimationEvidence } from '../src/services/explicitCompositionEvidence'
import { reviewedProcessingProfile, USDA_RF6_SOURCE } from '../src/services/explicitProcessingEvidence'
import type { ExplicitEstimationEvidenceV2, ExplicitProcessingProof } from '../src/types'

const now = '2026-10-04T00:00:00.000Z'
function fixture(finished = 80): { request: NutrientEstimateRequest; evidence: ExplicitEstimationEvidenceV2; proof: ExplicitProcessingProof } {
  const source = { kind: 'user_measurement' as const, reference: 'synthetic actual edible batch', verified: true as const, checkedAt: now }
  const proof: ExplicitProcessingProof = {
    id: 'heat', ingredientPath: [0], expectedName: '牛乳',
    inputProfileId: 'processing_mext_13003_v1', inputStateId: 'mext_13003:listed-state-v1',
    outputStateId: 'mext_13003:additional-heat-approx-10min:finished-v1',
    processId: 'milk_additional_heat_approx_10min_v1', rawMassG: 100, finishedMassG: finished,
    retention: { kind: 'usda_rf6', code: '2151', source: { kind: 'official_retention_table', ...USDA_RF6_SOURCE, verified: true, checkedAt: now } },
    sodiumTransfer: 'none_confirmed', source,
  }
  const evidence: ExplicitEstimationEvidenceV2 = {
    schemaVersion: 2, declarationFingerprint: createIngredientDeclarationFingerprint('牛乳'), processing: [proof],
    compositions: [{ id: 'root', parent: { section: 'ingredient', path: [] }, expectedChildNames: ['牛乳'],
      denominator: 'product', weightStage: 'finished', amounts: { kind: 'masses_g', denominatorMassG: finished, children: [{ index: 0, value: finished }] },
      childBindings: [{ kind: 'processing', index: 0, processingId: 'heat' }], source }],
  }
  return { proof, evidence, request: { requestId: 'synthetic', baseAmount: 100, baseUnit: 'g', referenceMassG: 100,
    referenceMassSource: '100g', knownNutrients: {}, ingredientsText: '牛乳', ingredientsSource: { provider: 'synthetic', verified: true },
    estimationEvidence: evidence, requestedNutrients: ['vitaminB1Mg', 'vitaminB2Mg', 'fiberG', 'saturatedFatG'], requestedAt: now } }
}
describe('verified processing evidence', () => {
  it.each([[80, .045], [100, .036], [120, .03]])('uses actual R/F at finished mass %s without using display basis as F', (mass, expected) => {
    const { request } = fixture(mass)
    const result = estimateNutrients(request)
    expect(result.estimates.vitaminB1Mg.value).toBeCloseTo(expected, 5)
    expect(result.estimates.fiberG.status).toBe('unavailable')
    expect(result.estimates.saturatedFatG.status).toBe('unavailable')
    expect(result.optimization?.trace?.explicitCompositionEvidence?.processing?.[0].resolution).toBe('retention_factors')
  })
  it('prefers a confirmed boiled profile without applying RF twice', () => {
    const { request, evidence, proof } = fixture(80)
    request.ingredientsText = '全卵'
    evidence.declarationFingerprint = createIngredientDeclarationFingerprint('全卵')
    evidence.compositions![0].expectedChildNames = ['全卵']
    Object.assign(proof, { expectedName: '全卵', inputProfileId: 'processing_mext_12004_v1', inputStateId: 'mext_12004:listed-raw-state-v1', outputStateId: 'mext_12005:listed-boiled-state-v1', processId: 'egg_whole_hard_cooked_v1', finishedProfileId: 'processing_mext_12005_v1' })
    if (proof.retention.kind === 'usda_rf6') proof.retention.code = '0105'
    const result = estimateNutrients(request)
    expect(result.estimates.vitaminB1Mg.value).toBe(reviewedProcessingProfile(proof.finishedProfileId!)!.nutrients.vitaminB1Mg)
    expect(result.optimization?.trace?.explicitCompositionEvidence?.processing?.[0].retentionFactors).toEqual({})
    delete proof.finishedProfileId
    expect(estimateNutrients(request).estimates.vitaminB1Mg.value).toBeCloseTo(.06 * 100 / 80 * .85, 5)
  })
  it.each(['mass', 'state', 'source', 'overlap', 'unbound', 'no-root', 'fraction'] as const)('defers %s evidence without falling back to fitted ratios', (failure) => {
    const { request, evidence, proof } = fixture()
    if (failure === 'mass') proof.rawMassG = null
    if (failure === 'state') proof.outputStateId = 'unknown'
    if (failure === 'source') proof.source.reference = USDA_RF6_SOURCE.reference
    if (failure === 'overlap' || failure === 'unbound') evidence.processing = [...evidence.processing!, { ...proof, id: 'extra', ingredientPath: failure === 'overlap' ? [0] : [99] }]
    if (failure === 'no-root') evidence.compositions = []
    if (failure === 'fraction') evidence.compositions![0].amounts = { kind: 'fractions', children: [{ index: 0, value: 1 }] }
    const result = estimateNutrients(request)
    expect(result.estimates.vitaminB1Mg.status).toBe('unavailable')
    expect(result.optimization?.trace?.explicitCompositionEvidence?.status).toBe('deferred')
  })
  it('uses only supplied supported factors and does not infer missing factors', () => {
    const { request, proof } = fixture()
    proof.retention = { kind: 'user_supplied', factors: { vitaminB1Mg: .5 }, source: proof.source }
    const result = estimateNutrients(request)
    expect(result.estimates.vitaminB1Mg.value).toBe(.025)
    expect(result.estimates.vitaminB2Mg.status).toBe('unavailable')
  })
  it('rejects v1 processing bindings and unsupported factor fields', () => {
    const { evidence, proof } = fixture()
    expect(() => validateExplicitEstimationEvidence({ ...evidence, schemaVersion: 1 })).toThrow()
    proof.retention = { kind: 'user_supplied', factors: { vitaminB1Mg: 1.1 }, source: proof.source }
    expect(() => validateExplicitEstimationEvidence(evidence)).toThrow()
  })
})
