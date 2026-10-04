import { describe, expect, it } from 'vitest'
import {
  estimateNutrients,
  NUTRIENT_ESTIMATOR_MODEL_VERSION,
  type NutrientEstimateRequest,
} from '../src/services/nutrientEstimator'
import { createIngredientDeclarationFingerprint, validateExplicitEstimationEvidence } from '../src/services/explicitCompositionEvidence'
import { REVIEWED_COMPOSITION_STATES } from '../src/services/reviewedCompositionStates'
import type {
  ExplicitCompositionChildBinding,
  ExplicitCompositionGroup,
  ExplicitEstimationEvidence,
  NutrientEvidenceMap,
  Nutrients,
} from '../src/types'

const stateFor = (profileId: string) => REVIEWED_COMPOSITION_STATES[profileId]

function stateBinding(index: number, profileId: string, reference = `verified-batch-record:${profileId}`): ExplicitCompositionChildBinding {
  const state = stateFor(profileId)
  return {
    kind: 'profile',
    index,
    expectedProfileId: profileId,
    expectedProfileStateId: state.profileStateId,
    finishedIngredientStateId: state.finishedIngredientStateId,
    stateSource: {
      kind: 'manufacturer_recipe',
      reference,
      verified: true,
      checkedAt: '2026-10-04T00:00:00.000Z',
    },
  }
}

function compositionEvidence(
  ingredientsText: string,
  group: ExplicitCompositionGroup,
  additionalGroups: ExplicitCompositionGroup[] = [],
): ExplicitEstimationEvidence {
  return {
    schemaVersion: 1,
    declarationFingerprint: createIngredientDeclarationFingerprint(ingredientsText),
    compositions: [group, ...additionalGroups],
  }
}

function rootGroup(input: {
  id?: string
  names: string[]
  masses: Array<number | null>
  denominatorMassG?: number
  bindings?: ExplicitCompositionChildBinding[]
  weightStage?: 'raw' | 'finished'
}): ExplicitCompositionGroup {
  return {
    id: input.id ?? 'finished-root',
    parent: { section: 'ingredient', path: [] },
    expectedChildNames: input.names,
    denominator: 'product',
    weightStage: input.weightStage ?? 'finished',
    amounts: {
      kind: 'masses_g',
      denominatorMassG: input.denominatorMassG ?? input.masses.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      children: input.masses.map((value, index) => ({ index, value })),
    },
    ...(input.bindings ? { childBindings: input.bindings } : {}),
    source: {
      kind: 'manufacturer_recipe',
      reference: 'verified-manufacturer-recipe:finished-batch-1',
      verified: true,
      checkedAt: '2026-10-04T00:00:00.000Z',
      version: 'batch-1',
    },
  }
}

const simpleIngredients = '上白糖、脱脂粉乳、ピュアココア'
const simpleNames = ['上白糖', '脱脂粉乳', 'ピュアココア']
const simpleBindings = [
  stateBinding(0, 'mext_03003'),
  stateBinding(1, 'mext_13010'),
  stateBinding(2, 'mext_16048'),
]
const simpleGroup = rootGroup({ names: simpleNames, masses: [600, 300, 100], denominatorMassG: 1000, bindings: simpleBindings })

function request(input: {
  ingredientsText?: string
  evidence?: ExplicitEstimationEvidence
  knownNutrients?: Partial<Nutrients>
  knownNutrientEvidence?: NutrientEvidenceMap
  estimatorGenreId?: NutrientEstimateRequest['estimatorGenreId']
  requestedNutrients?: NutrientEstimateRequest['requestedNutrients']
} = {}): NutrientEstimateRequest {
  const ingredientsText = input.ingredientsText ?? simpleIngredients
  return {
    requestId: 'explicit-composition-test',
    productName: '固定配合テスト',
    estimatorGenreId: input.estimatorGenreId,
    baseAmount: 100,
    baseUnit: 'g',
    referenceMassG: 100,
    referenceMassSource: 'synthetic test basis',
    ingredientsText,
    ingredientsSource: { provider: 'synthetic declaration', verified: true },
    estimationEvidence: input.evidence ?? compositionEvidence(ingredientsText, simpleGroup),
    requestedAt: '2026-10-04T00:00:00.000Z',
    knownNutrients: input.knownNutrients,
    knownNutrientEvidence: input.knownNutrientEvidence,
    requestedNutrients: input.requestedNutrients,
  }
}

describe('explicit finished composition estimator', () => {
  it('uses verified 60/30/10 finished-batch ratios for a 100g request without fitting or label feedback', () => {
    const first = estimateNutrients(request({ estimatorGenreId: 'prepared_meal' }))
    const knownNutrients: Partial<Nutrients> = {
      energyKcal: 999,
      proteinG: 99,
      fatG: 77,
      carbohydrateG: 66,
      saltG: 5,
    }
    const evidence: NutrientEvidenceMap = Object.fromEntries(Object.keys(knownNutrients).map((key) => [key, {
      origin: 'manufacturer_label', verified: true, source: 'synthetic label', resolution: 'explicit_metadata',
    }])) as NutrientEvidenceMap
    const changedLabelAndGenre = estimateNutrients(request({
      estimatorGenreId: 'noodle_flour_dish', knownNutrients, knownNutrientEvidence: evidence,
    }))

    expect(first.optimization?.trace?.ingredientRatios).toEqual([0.6, 0.3, 0.1])
    expect(first.optimization?.trace?.candidateCombinationCount).toBe(0)
    expect(first.optimization?.trace?.explicitCompositionEvidence?.status).toBe('applied')
    expect(first.estimates.fiberG).toMatchObject({ status: 'available', value: 2.39, method: 'browser_explicit_composition_rule', confidence: 'low' })
    expect(first.estimates.calciumMg).toMatchObject({ status: 'available', value: 344.6 })
    expect(changedLabelAndGenre.optimization?.trace?.ingredientRatios).toEqual([0.6, 0.3, 0.1])
    expect(changedLabelAndGenre.estimates.fiberG).toMatchObject({ value: 2.39, method: 'browser_explicit_composition_rule' })
    expect(first.modelVersion).toBe(NUTRIENT_ESTIMATOR_MODEL_VERSION)
    expect(first.modelVersion).toBe('browser-rule-0.28.0')
  })

  it('accepts reversed listing order and gives the same fixed mix', () => {
    const reverseGroup = rootGroup({
      names: [...simpleNames].reverse(),
      masses: [100, 300, 600],
      denominatorMassG: 1000,
      bindings: [stateBinding(0, 'mext_16048'), stateBinding(1, 'mext_13010'), stateBinding(2, 'mext_03003')],
    })
    const reversed = estimateNutrients(request({
      ingredientsText: [...simpleNames].reverse().join('、'),
      evidence: compositionEvidence([...simpleNames].reverse().join('、'), reverseGroup),
    }))
    const forward = estimateNutrients(request())
    expect(reversed.optimization?.trace?.ingredientRatios).toEqual([0.1, 0.3, 0.6])
    expect(reversed.estimates.calciumMg.status === 'available' && reversed.estimates.calciumMg.value)
      .toBe(forward.estimates.calciumMg.status === 'available' ? forward.estimates.calciumMg.value : null)
  })

  it('supports normalized fraction weights and keeps source-zero calcium/vitamin C uncertain', () => {
    const ingredientsText = '上白糖'
    const group: ExplicitCompositionGroup = {
      id: 'single-sugar',
      parent: { section: 'ingredient', path: [] },
      expectedChildNames: ['上白糖'],
      denominator: 'product',
      weightStage: 'finished',
      amounts: { kind: 'fractions', children: [{ index: 0, value: 1 }] },
      childBindings: [stateBinding(0, 'mext_03003')],
      source: {
        kind: 'user_measurement', reference: 'verified-sugar-measurement', verified: true,
        checkedAt: '2026-10-04T00:00:00.000Z',
      },
    }
    const result = estimateNutrients(request({
      ingredientsText,
      evidence: compositionEvidence(ingredientsText, group),
    }))
    expect(result.optimization?.trace?.ingredientRatios).toEqual([1])
    expect(result.estimates.vitaminCMg).toMatchObject({ status: 'available', value: 0, zeroEvidence: 'uncertain' })
    expect(result.estimates.vitaminCMg.status === 'available' && result.estimates.vitaminCMg.range.max).toBeGreaterThan(0)
    expect(result.estimates.vitaminAMcg).toMatchObject({ status: 'available', value: 0, zeroEvidence: 'uncertain' })
    expect(result.estimates.vitaminAMcg.status === 'available' && result.estimates.vitaminAMcg.range.max).toBeGreaterThan(0)

    const halfBasis = estimateNutrients({
      ...request({ ingredientsText, evidence: compositionEvidence(ingredientsText, group) }),
      baseAmount: 50,
      referenceMassG: 50,
    })
    expect(halfBasis.estimates.calciumMg.status === 'available' && halfBasis.estimates.calciumMg.value).toBe(0.5)
  })

  it('keeps positive-branch MEXT nulls partial and completely skips an unknown zero-weight branch', () => {
    const ingredientsText = '上白糖、脱脂粉乳、ピュアココア、未知ゼロ材料'
    const group = rootGroup({
      names: ['上白糖', '脱脂粉乳', 'ピュアココア', '未知ゼロ材料'],
      masses: [600, 300, 100, 0],
      denominatorMassG: 1000,
      bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010'), stateBinding(2, 'mext_16048')],
    })
    const result = estimateNutrients(request({
      ingredientsText,
      evidence: compositionEvidence(ingredientsText, group),
    }))

    expect(result.estimates.ironMg).toMatchObject({ status: 'available', value: 1.55, method: 'browser_ingredient_partial_rule' })
    expect(result.estimates.vitaminEMg).toMatchObject({ status: 'available', value: 0.03, method: 'browser_ingredient_partial_rule' })
    expect(result.estimates.ironMg.status === 'available' && result.estimates.ironMg.sourceFoodIds).not.toContain('unknown-zero')
    expect(result.unresolvedIngredients).not.toContain('未知ゼロ材料')
    expect(result.optimization?.trace?.explicitCompositionEvidence?.groups[0]).toMatchObject({
      status: 'applied', zeroWeightChildIndices: [3], selectedProfileIds: ['mext_03003', 'mext_13010', 'mext_16048', null],
    })
    expect(result.optimization?.trace?.explicitCompositionEvidence?.groups[0].missingMassFractionByNutrient).toMatchObject({
      ironMg: 0.6,
      vitaminEMg: 0.3,
    })
  })

  it('resolves nested fixed compositions and validates parent batch mass through three levels', () => {
    const ingredientsText = '外側ミックス（中間ミックス（上白糖、脱脂粉乳）、脱脂粉乳）、ピュアココア'
    const outer = rootGroup({
      names: ['外側ミックス', 'ピュアココア'],
      masses: [500, 100],
      denominatorMassG: 600,
      bindings: [
        { kind: 'composition', index: 0, compositionId: 'middle' },
        stateBinding(1, 'mext_16048'),
      ],
    })
    const middle: ExplicitCompositionGroup = {
      ...rootGroup({
        id: 'middle', names: ['中間ミックス', '脱脂粉乳'], masses: [300, 200], denominatorMassG: 500,
        bindings: [{ kind: 'composition', index: 0, compositionId: 'inner' }, stateBinding(1, 'mext_13010')],
      }),
      parent: { section: 'ingredient', path: [0] }, denominator: 'parent',
      amounts: { kind: 'fractions', children: [{ index: 0, value: 0.6 }, { index: 1, value: 0.4 }] },
    }
    const inner: ExplicitCompositionGroup = {
      ...rootGroup({
        id: 'inner', names: ['上白糖', '脱脂粉乳'], masses: [200, 100], denominatorMassG: 300,
        bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010')],
      }),
      parent: { section: 'ingredient', path: [0, 0] }, denominator: 'parent',
    }
    const result = estimateNutrients(request({
      ingredientsText,
      evidence: compositionEvidence(ingredientsText, outer, [middle, inner]),
    }))
    expect(result.optimization?.trace?.ingredientRatios).toEqual([5 / 6, 1 / 6])
    expect(result.optimization?.trace?.explicitCompositionEvidence?.status).toBe('applied')

    const badInner = { ...inner, amounts: { kind: 'masses_g' as const, denominatorMassG: 299, children: [{ index: 0, value: 199 }, { index: 1, value: 100 }] } }
    const mismatch = estimateNutrients(request({
      ingredientsText,
      evidence: compositionEvidence(ingredientsText, outer, [middle, badInner]),
    }))
    expect(mismatch.optimization?.trace?.explicitCompositionEvidence?.status).toBe('deferred')
    expect(mismatch.optimization?.trace?.explicitCompositionEvidence?.groups.find((item) => item.compositionId === 'inner')?.reason)
      .toBe('batch_mass_mismatch')
  })

  it('requires reviewed state names and non-MEXT state evidence; similar aliases and official pages cannot verify processing state', () => {
    const wrongSugarProfileGroup = rootGroup({
      names: ['グラニュー糖', '脱脂粉乳', 'ピュアココア'], masses: [600, 300, 100], denominatorMassG: 1000,
      bindings: [stateBinding(0, 'mext_03003'), ...simpleBindings.slice(1)],
    })
    const wrongNameText = 'グラニュー糖、脱脂粉乳、ピュアココア'
    const wrongName = estimateNutrients(request({
      ingredientsText: wrongNameText,
      evidence: compositionEvidence(wrongNameText, wrongSugarProfileGroup),
    }))
    expect(wrongName.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('profile_state_mismatch')

    const officialPageGroup = rootGroup({
      names: simpleNames,
      masses: [600, 300, 100],
      denominatorMassG: 1000,
      bindings: [stateBinding(0, 'mext_03003', stateFor('mext_03003').officialSourceUrl), ...simpleBindings.slice(1)],
    })
    const officialPage = estimateNutrients(request({ evidence: compositionEvidence(simpleIngredients, officialPageGroup) }))
    expect(officialPage.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('profile_state_unconfirmed')
  })

  it('defers stale, raw-stage, additive, incomplete, unknown-state and mismatched nested evidence without ordinary fallback', () => {
    const stale = estimateNutrients(request({
      evidence: { ...compositionEvidence(simpleIngredients, simpleGroup), declarationFingerprint: 'stale-fingerprint' },
    }))
    expect(stale.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('declaration_stale')

    const rawGroup = rootGroup({ names: simpleNames, masses: [600, 300, 100], denominatorMassG: 1000, bindings: simpleBindings, weightStage: 'raw' })
    const raw = estimateNutrients(request({ evidence: compositionEvidence(simpleIngredients, rawGroup) }))
    expect(raw.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('raw_stage')

    const incompleteGroup = rootGroup({ names: simpleNames, masses: [600, 299, 100], denominatorMassG: 1000, bindings: simpleBindings })
    const incomplete = estimateNutrients(request({ evidence: compositionEvidence(simpleIngredients, incompleteGroup) }))
    expect(incomplete.estimates.fiberG.status).toBe('unavailable')
    expect(incomplete.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('partial_group')

    const unknownState = rootGroup({
      names: ['薄力粉', '脱脂粉乳', 'ピュアココア'], masses: [600, 300, 100], denominatorMassG: 1000,
      bindings: [stateBinding(0, 'mext_03003'), ...simpleBindings.slice(1)],
    })
    const unknownName = '薄力粉、脱脂粉乳、ピュアココア'
    const unknown = estimateNutrients(request({
      ingredientsText: unknownName,
      evidence: compositionEvidence(unknownName, unknownState),
    }))
    expect(unknown.optimization?.trace?.explicitCompositionEvidence?.status).toBe('deferred')
    expect(unknown.estimates.calciumMg.status).toBe('unavailable')
  })

  it('keeps same-name nested groups path-specific and fingerprints exact ratios without three-decimal collisions', () => {
    const ingredientsText = '糖乳ミックス（上白糖、脱脂粉乳）、糖乳ミックス（上白糖、脱脂粉乳)'
    const outer = rootGroup({
      names: ['糖乳ミックス', '糖乳ミックス'], masses: [500, 500], denominatorMassG: 1000,
      bindings: [
        { kind: 'composition', index: 0, compositionId: 'left' },
        { kind: 'composition', index: 1, compositionId: 'right' },
      ],
    })
    const makeNested = (id: string, path: number[], masses: [number, number]): ExplicitCompositionGroup => ({
      ...rootGroup({
        id, names: ['上白糖', '脱脂粉乳'], masses, denominatorMassG: masses[0] + masses[1],
        bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010')],
      }),
      parent: { section: 'ingredient', path }, denominator: 'parent',
    })
    const left = makeNested('left', [0], [250, 250])
    const right = makeNested('right', [1], [250, 250])
    const nested = estimateNutrients(request({
      ingredientsText,
      evidence: compositionEvidence(ingredientsText, outer, [left, right]),
    }))
    expect(nested.optimization?.trace?.explicitCompositionEvidence?.status).toBe('applied')
    expect(nested.optimization?.trace?.explicitCompositionEvidence?.groups.map((group) => group.parentPath))
      .toEqual([[], [0], [1]])

    const firstIdentity = estimateNutrients(request({
      ingredientsText: '上白糖、脱脂粉乳',
      evidence: compositionEvidence('上白糖、脱脂粉乳', rootGroup({
        names: ['上白糖', '脱脂粉乳'], masses: [500, 500], denominatorMassG: 1000,
        bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010')],
      })),
    })).optimization?.trace?.explicitCompositionEvidence?.groups[0].compositionProfileId
    const secondIdentity = estimateNutrients(request({
      ingredientsText: '上白糖、脱脂粉乳',
      evidence: compositionEvidence('上白糖、脱脂粉乳', rootGroup({
        names: ['上白糖', '脱脂粉乳'], masses: [500.1, 499.9], denominatorMassG: 1000,
        bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010')],
      })),
    })).optimization?.trace?.explicitCompositionEvidence?.groups[0].compositionProfileId
    expect(firstIdentity).not.toBe(secondIdentity)
  })

  it('rejects negative, duplicate and all-zero amounts and defers small real sum discrepancies', () => {
    const base = compositionEvidence(simpleIngredients, simpleGroup)
    const invalidAmounts = [
      { ...simpleGroup, amounts: { kind: 'masses_g' as const, denominatorMassG: 1000, children: [{ index: 0, value: -1 }, { index: 1, value: 900 }, { index: 2, value: 101 }] } },
      { ...simpleGroup, amounts: { kind: 'masses_g' as const, denominatorMassG: 1000, children: [{ index: 0, value: 500 }, { index: 0, value: 300 }, { index: 2, value: 200 }] } },
      { ...simpleGroup, amounts: { kind: 'masses_g' as const, denominatorMassG: 1000, children: [{ index: 0, value: 0 }, { index: 1, value: 0 }, { index: 2, value: 0 }] } },
    ]
    for (const invalid of invalidAmounts) {
      expect(() => validateExplicitEstimationEvidence({ ...base, compositions: [invalid] })).toThrow()
    }

    const slightlyShort = rootGroup({
      names: simpleNames,
      masses: [600, 300, 99.99999999],
      denominatorMassG: 1000,
      bindings: simpleBindings,
    })
    const deferred = estimateNutrients(request({ evidence: compositionEvidence(simpleIngredients, slightlyShort) }))
    expect(deferred.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('partial_group')

    const withUnknownAmount = rootGroup({ names: simpleNames, masses: [600, 300, null], denominatorMassG: 1000, bindings: simpleBindings })
    const unknownAmount = estimateNutrients(request({ evidence: compositionEvidence(simpleIngredients, withUnknownAmount) }))
    expect(unknownAmount.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('unknown_amount')
  })

  it('does not infer a source batch mass from output basis when root fractions contain nested absolute masses', () => {
    const ingredientsText = '外側ミックス（上白糖、脱脂粉乳）'
    const outer: ExplicitCompositionGroup = {
      ...rootGroup({
        names: ['外側ミックス'], masses: [100], denominatorMassG: 100,
        bindings: [{ kind: 'composition', index: 0, compositionId: 'inner' }],
      }),
      amounts: { kind: 'fractions', children: [{ index: 0, value: 1 }] },
    }
    const inner: ExplicitCompositionGroup = {
      ...rootGroup({
        id: 'inner', names: ['上白糖', '脱脂粉乳'], masses: [60, 40], denominatorMassG: 100,
        bindings: [stateBinding(0, 'mext_03003'), stateBinding(1, 'mext_13010')],
      }),
      parent: { section: 'ingredient', path: [0] }, denominator: 'parent',
    }
    const evaluateBasis = (basis: number) => estimateNutrients({
      ...request({ ingredientsText, evidence: compositionEvidence(ingredientsText, outer, [inner]) }),
      baseAmount: basis,
      referenceMassG: basis,
    })
    for (const basis of [100, 500]) {
      const result = evaluateBasis(basis)
      expect(result.optimization?.trace?.explicitCompositionEvidence?.groups[0].reason).toBe('parent_mass_unconfirmed')
      expect(result.estimates.calciumMg.status).toBe('unavailable')
    }
  })

  it('fingerprints raw declaration state notes, not only normalized ingredient names', () => {
    expect(createIngredientDeclarationFingerprint('上白糖')).not.toBe(
      createIngredientDeclarationFingerprint('上白糖（北海道産）'),
    )
  })

  it('leaves ordinary exploration available when no explicit composition is supplied', () => {
    const ordinary = estimateNutrients({
      ...request({ ingredientsText: '上白糖、脱脂粉乳、ココアパウダー' }),
      estimationEvidence: undefined,
    })
    expect(ordinary.optimization?.trace?.explicitCompositionEvidence).toBeUndefined()
    expect(ordinary.optimization?.trace?.candidateCombinationCount).toBeGreaterThan(0)
  })
})
