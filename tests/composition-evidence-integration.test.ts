import { describe, expect, it } from 'vitest'
import { createNutrientEstimateRequestFingerprint } from '../src/services/confirmedNutrientInputs'
import { createIngredientDeclarationFingerprint, validateExplicitEstimationEvidence } from '../src/services/explicitCompositionEvidence'
import { nutrientEstimatePanelRequestKey } from '../src/services/nutrientEstimateRequestKey'
import { EMPTY_NUTRIENTS, type ExplicitEstimationEvidence } from '../src/types'

const declaration = '上白糖、脱脂粉乳'
function evidence(reference = '合成計測記録'): ExplicitEstimationEvidence {
  return {
    schemaVersion: 1,
    declarationFingerprint: createIngredientDeclarationFingerprint(declaration),
    compositions: [{
      id: 'synthetic-batch', parent: { section: 'ingredient', path: [] },
      expectedChildNames: ['上白糖', '脱脂粉乳'], denominator: 'product', weightStage: 'finished',
      amounts: { kind: 'masses_g', denominatorMassG: 500, children: [{ index: 0, value: 300 }, { index: 1, value: 200 }] },
      source: { kind: 'user_measurement', reference, verified: true, checkedAt: '2026-10-04T00:00:00.000Z' },
    }],
  }
}

describe('composition evidence request integration', () => {
  it('changes the calculation fingerprint for evidence source changes while preserving absent evidence', () => {
    const input = { ingredientsText: declaration, referenceMassG: 100, requestedNutrients: ['fiberG'] as const }
    expect(createNutrientEstimateRequestFingerprint(input)).toBe(createNutrientEstimateRequestFingerprint({ ...input, estimationEvidence: undefined }))
    expect(createNutrientEstimateRequestFingerprint({ ...input, estimationEvidence: evidence() }))
      .not.toBe(createNutrientEstimateRequestFingerprint({ ...input, estimationEvidence: evidence('別の合成計測記録') }))
  })

  it('invalidates the panel result for source changes and keeps the old declaration fingerprint after editing text', () => {
    const input = {
      productName: '合成配合粉', estimatorGenreId: 'other_unknown' as const,
      basis: { baseAmount: 100, baseUnit: 'g' }, referenceMassG: 100, referenceMassSource: 'g基準',
      ingredientsText: declaration, ingredientsSource: { provider: '合成記録', verified: true },
      currentNutrients: EMPTY_NUTRIENTS, knownNutrientEvidence: {}, estimationEvidence: evidence(),
    }
    const previous = nutrientEstimatePanelRequestKey(input)
    expect(nutrientEstimatePanelRequestKey({ ...input, estimationEvidence: evidence('出典変更') })).not.toBe(previous)
    expect(nutrientEstimatePanelRequestKey({ ...input, ingredientsText: '上白糖、脱脂粉乳、ココア' })).not.toBe(previous)
    expect(input.estimationEvidence.declarationFingerprint).toBe(createIngredientDeclarationFingerprint(declaration))
  })

  it('copies mutable evidence before it becomes a stored calculation input', () => {
    const original = evidence()
    const copied = validateExplicitEstimationEvidence(original)
    original.compositions![0].source.reference = '後から変更'
    expect(copied.compositions![0].source.reference).toBe('合成計測記録')
  })
})
