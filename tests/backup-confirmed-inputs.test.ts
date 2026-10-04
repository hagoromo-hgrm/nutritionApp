import { describe, expect, it } from 'vitest'
import { backupToJson, parseBackupText, validateBackup } from '../src/services/backup'
import { createNutrientEstimateRequestFingerprintFromSnapshot } from '../src/services/confirmedNutrientInputs'
import { createEstimationRequest } from '../src/services/nutrientEstimationStore'
import { estimateNutrients, toStoredNutrientEstimateResult, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import { createIngredientDeclarationFingerprint } from '../src/services/explicitCompositionEvidence'
import { REVIEWED_COMPOSITION_STATES } from '../src/services/reviewedCompositionStates'
import { DEFAULT_ESTIMATION_SETTINGS, EMPTY_NUTRIENTS, NUTRIENT_KEYS, type BackupData, type ExplicitCompositionChildBinding, type ExplicitCompositionGroup, type ExplicitEstimationEvidence, type Food, type NutrientEvidenceMap, type NutritionEstimationInput } from '../src/types'

const now = '2026-10-04T00:00:00.000Z'
const food: Food = {
  id: 'backup_food',
  name: '手入力食品',
  maker: '',
  barcode: '',
  source: 'user',
  sourceVersion: 'test',
  baseAmount: 100,
  baseUnit: 'g',
  servingAmount: null,
  servingUnit: null,
  nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 123 },
  nutrientMetadata: { energyKcal: { origin: 'user_input', verified: true } },
  createdAt: now,
  updatedAt: now,
}

function makeBackup(inputSnapshot?: NutritionEstimationInput, inputHash = 'fnv1a:12345678'): BackupData {
  const requestId = inputSnapshot?.requestId ?? 'old_request'
  const snapshot = inputSnapshot ?? {
    requestId,
    foodId: food.id,
    barcode: food.barcode,
    name: food.name,
    maker: food.maker,
    estimatorCategoryId: null,
    estimatorGenreId: null,
    estimatorGenreSource: null,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: [],
    referenceMassG: 100,
    referenceMassSource: '基準単位がg',
    knownNutrients: { energyKcal: 123 },
    missingNutrients: NUTRIENT_KEYS.filter((key) => key !== 'energyKcal'),
    ingredientsText: null,
    ingredientsSource: null,
    requestedAt: now,
    foodUpdatedAt: now,
    inputHash,
  }
  return {
    format: 'nutrition-pwa-backup',
    dataFormatVersion: 2,
    exportedAt: now,
    foods: [],
    mealEntries: [],
    favorites: [],
    settings: {
      id: 'app',
      goals: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])) as unknown as BackupData['settings']['goals'],
      displayUnit: 'default',
      lastBackupAt: null,
      dataFormatVersion: 2,
      externalApiEnabled: false,
      externalApiEndpoint: 'https://world.openfoodfacts.org/api/v3/product',
    },
    estimationDataFormatVersion: 1,
    estimationSettings: { ...DEFAULT_ESTIMATION_SETTINGS, updatedAt: now },
    estimationRequests: [{
      requestId,
      foodId: snapshot.foodId,
      barcode: snapshot.barcode,
      inputSnapshot: snapshot,
      status: 'pending',
      inputHash: snapshot.inputHash,
      createdAt: now,
      updatedAt: now,
    }],
    estimationResults: [],
    estimationDecisions: [],
  }
}

function makeConfirmedSnapshot(): NutritionEstimationInput {
  const input = createEstimationRequest(food, { requestId: 'confirmed_request', now }).inputSnapshot
  const knownNutrientEvidence: NutrientEvidenceMap = {
    energyKcal: { origin: 'user_input', verified: true, source: 'manual entry', resolution: 'explicit_metadata' },
  }
  const extended = {
    ...input,
    knownNutrients: { energyKcal: 123 },
    knownNutrientEvidence,
    knownNutrientReferences: {
      energyKcal: {
        origin: 'user_input' as const,
        verified: true,
        sourceReference: 'label record',
        reference: { kind: 'fixed' as const, value: 123, decimalPlaces: 0 },
        basis: { amount: 100, unit: 'g' as const },
      },
    },
    knownNutrientReferenceBasis: { amount: 100, unit: 'g' as const },
    fitMode: 'robust_interval' as const,
    requestedNutrients: ['fiberG' as const],
  }
  const snapshot = extended as NutritionEstimationInput
  return { ...snapshot, requestFingerprint: createNutrientEstimateRequestFingerprintFromSnapshot(snapshot) }
}

function withInput(inputSnapshot: NutritionEstimationInput): BackupData {
  return makeBackup(inputSnapshot)
}

function makeExplicitEvidence() {
  return {
    schemaVersion: 1 as const,
    declarationFingerprint: 'ingredient-declaration:backup',
    compositions: [{
      id: 'grain-blend', parent: { section: 'ingredient' as const, path: [0] }, expectedChildNames: ['米粉', '水'],
      denominator: 'product' as const, weightStage: 'finished' as const,
      amounts: { kind: 'fractions' as const, children: [{ index: 0, value: 0.6 }, { index: 1, value: 0.4 }] },
      source: { kind: 'user_measurement' as const, reference: '計量記録', verified: true as const, checkedAt: now },
    }],
  }
}

function profileBinding(index: number, profileId: string): ExplicitCompositionChildBinding {
  const state = REVIEWED_COMPOSITION_STATES[profileId]
  return {
    kind: 'profile', index, expectedProfileId: profileId,
    expectedProfileStateId: state.profileStateId,
    finishedIngredientStateId: state.finishedIngredientStateId,
    stateSource: {
      kind: 'manufacturer_recipe', reference: `synthetic-batch:${profileId}`, verified: true,
      checkedAt: now,
    },
  }
}

function traceCompositionGroup(input: {
  id?: string
  names: string[]
  masses: Array<number | null>
  bindings?: ExplicitCompositionChildBinding[]
  weightStage?: 'raw' | 'finished'
}): ExplicitCompositionGroup {
  return {
    id: input.id ?? 'trace-root',
    parent: { section: 'ingredient', path: [] },
    expectedChildNames: input.names,
    denominator: 'product',
    weightStage: input.weightStage ?? 'finished',
    amounts: {
      kind: 'masses_g',
      denominatorMassG: input.masses.reduce<number>((total, mass) => total + (mass ?? 0), 0),
      children: input.masses.map((value, index) => ({ index, value })),
    },
    ...(input.bindings === undefined ? {} : { childBindings: input.bindings }),
    source: { kind: 'manufacturer_recipe', reference: 'synthetic-recipe', verified: true, checkedAt: now },
  }
}

function makeActualTraceBackup(input: {
  requestId: string
  ingredientsText: string
  evidence: ExplicitEstimationEvidence
}): { backup: BackupData; storedTrace: NonNullable<NonNullable<ReturnType<typeof estimateNutrients>['optimization']>['trace']> } {
  const request: NutrientEstimateRequest = {
    requestId: input.requestId,
    productName: 'synthetic composition product',
    baseAmount: 100,
    baseUnit: 'g',
    referenceMassG: 100,
    referenceMassSource: 'synthetic 100g basis',
    ingredientsText: input.ingredientsText,
    ingredientsSource: { provider: 'synthetic', verified: true },
    estimationEvidence: input.evidence,
    knownNutrients: {},
    requestedNutrients: ['fiberG'],
    requestedAt: now,
  }
  const foodWithEvidence: Food = {
    ...food,
    id: `food_${input.requestId}`,
    name: 'synthetic composition product',
    baseAmount: 100,
    baseUnit: 'g',
    ingredientsText: input.ingredientsText,
    ingredientsSource: request.ingredientsSource,
    estimationEvidence: input.evidence,
  }
  const estimationRequest = createEstimationRequest(foodWithEvidence, {
    requestId: input.requestId,
    now,
    evaluatedRequest: request,
  })
  const calculated = estimateNutrients(request)
  const stored = toStoredNutrientEstimateResult(calculated, {
    foodId: foodWithEvidence.id,
    inputHash: estimationRequest.inputHash,
    baseAmount: request.baseAmount,
    baseUnit: 'g',
  })
  const backup = {
    ...makeBackup(estimationRequest.inputSnapshot),
    foods: [foodWithEvidence],
    estimationResults: [stored],
  }
  const trace = calculated.optimization?.trace
  if (!trace) throw new Error('synthetic estimate did not produce a trace')
  return { backup, storedTrace: trace }
}

function traceEvidence(ingredientsText: string, ...groups: ExplicitCompositionGroup[]): ExplicitEstimationEvidence {
  return {
    schemaVersion: 1,
    declarationFingerprint: createIngredientDeclarationFingerprint(ingredientsText),
    compositions: groups,
  }
}

describe('estimation backup confirmed-input validation', () => {
  it('validates and restores actual additive bounds, materials and dose evidence', () => {
    const text = '上白糖／合成製剤'
    const source = { kind: 'user_measurement' as const, reference: 'synthetic batch', verified: true as const, checkedAt: now }
    const evidence: ExplicitEstimationEvidence = {
      schemaVersion: 3, declarationFingerprint: createIngredientDeclarationFingerprint(text),
      compositions: [{ ...traceCompositionGroup({ names: ['上白糖'], masses: [99], bindings: [profileBinding(0, 'mext_03003')] }), massScope: 'food_remainder_after_additives', wholeParentMassG: 100 }],
      additives: [{ id: 'dose', declaration: { section: 'additive', path: [0], expectedName: '合成製剤' }, materialId: 'synthetic', grade: 'confirmed',
        dose: { kind: 'preparation_mass_g', value: 1, stage: 'finished' }, contentsPerG: { calciumMg: { kind: 'minimum', minPerG: 200 } }, doseSource: source, contentSource: source }],
    }
    const { backup, storedTrace } = makeActualTraceBackup({ requestId: 'additive_backup', ingredientsText: text, evidence })
    const restored = parseBackupText(backupToJson(validateBackup(backup)))
    expect(restored.foods[0].estimationEvidence).toEqual(evidence)
    expect(restored.estimationResults![0].optimization!.trace!.explicitCompositionEvidence).toEqual(storedTrace.explicitCompositionEvidence)
    expect(storedTrace.explicitCompositionEvidence!.additives![0].boundsPer100g.calciumMg).toEqual({ min: 200, max: null })
    evidence.compositions![0].wholeParentMassG = 101
    const deferred = makeActualTraceBackup({ requestId: 'additive_deferred', ingredientsText: text, evidence })
    expect(validateBackup(deferred.backup).estimationResults![0].optimization!.trace!.explicitCompositionEvidence!.groups[0].reason).toBe('additive_mass_conflict')
    const invalid = structuredClone(backup)
    invalid.estimationResults![0].optimization!.trace!.explicitCompositionEvidence!.additives![0].boundsPer100g.calciumMg = { min: 200, max: 100 }
    expect(() => validateBackup(invalid)).toThrow()
  })

  it('preserves processing proof, source fingerprints and applied retention trace through backup', () => {
    const ingredientsText = '牛乳'
    const source = { kind: 'user_measurement' as const, reference: '合成の追加10分加熱記録', verified: true as const, checkedAt: now }
    const evidence: ExplicitEstimationEvidence = {
      schemaVersion: 2, declarationFingerprint: createIngredientDeclarationFingerprint(ingredientsText),
      compositions: [{
        ...traceCompositionGroup({ names: ['牛乳'], masses: [80] }),
        childBindings: [{ kind: 'processing', index: 0, processingId: 'synthetic-heat' }],
      }],
      processing: [{
        id: 'synthetic-heat', ingredientPath: [0], expectedName: '牛乳',
        inputProfileId: 'processing_mext_13003_v1', inputStateId: 'mext_13003:listed-state-v1',
        outputStateId: 'mext_13003:additional-heat-approx-10min:finished-v1',
        processId: 'milk_additional_heat_approx_10min_v1', rawMassG: 100, finishedMassG: 80,
        retention: { kind: 'usda_rf6', code: '2151', source: { kind: 'official_retention_table', reference: 'https://ndownloader.figshare.com/files/44488754', version: 'USDA RF6 (2007)', verified: true, checkedAt: now, sourceSha256: 'b863e891989020edf3a429af8060523e5dee275699ae08893a5f91ff9a84b1e5' } }, sodiumTransfer: 'none_confirmed', source,
      }],
    }
    const { backup, storedTrace } = makeActualTraceBackup({ requestId: 'actual_processing_trace', ingredientsText, evidence })
    const restored = parseBackupText(backupToJson(validateBackup(backup)))
    expect(restored.foods[0].estimationEvidence).toEqual(evidence)
    expect(restored.estimationRequests?.[0].inputSnapshot.estimationEvidence).toEqual(evidence)
    expect(storedTrace.explicitCompositionEvidence?.processing?.[0].status).toBe('applied')
    expect(restored.estimationResults?.[0].optimization?.trace?.explicitCompositionEvidence).toEqual(storedTrace.explicitCompositionEvidence)
    const invalid = structuredClone(backup)
    invalid.estimationResults![0].optimization!.trace!.explicitCompositionEvidence!.processing![0].retentionFactors.vitaminB1Mg = 1.01
    expect(() => validateBackup(invalid)).toThrow('推計要求、結果または採用履歴')
    const snapshot = restored.estimationRequests![0].inputSnapshot
    const changed = structuredClone(snapshot)
    const changedEvidence = changed.estimationEvidence
    if (!changedEvidence || changedEvidence.schemaVersion !== 2) throw new Error('processing evidence missing')
    changedEvidence.processing![0].source.reference = '変更後の確認記録'
    expect(createNutrientEstimateRequestFingerprintFromSnapshot(changed)).not.toBe(snapshot.requestFingerprint)
  })

  it('accepts real explicit-estimator applied and deferred traces through stored-result backup validation', () => {
    const simpleText = '上白糖、脱脂粉乳、ピュアココア'
    const simpleNames = ['上白糖', '脱脂粉乳', 'ピュアココア']
    const directBindings = [profileBinding(0, 'mext_03003'), profileBinding(1, 'mext_13010'), profileBinding(2, 'mext_16048')]
    const validRoot = traceCompositionGroup({ names: simpleNames, masses: [600, 300, 100], bindings: directBindings })
    const nestedText = '外側ミックス、ピュアココア'
    const nestedMissing = traceCompositionGroup({
      names: ['外側ミックス', 'ピュアココア'], masses: [500, 100],
      bindings: [{ kind: 'composition', index: 0, compositionId: 'missing-child' }, profileBinding(1, 'mext_16048')],
    })
    const scenarios = [
      {
        name: 'applied', ingredientsText: simpleText, evidence: traceEvidence(simpleText, validRoot),
        status: 'applied', reason: undefined,
      },
      {
        name: 'deferred', ingredientsText: simpleText,
        evidence: traceEvidence(simpleText, traceCompositionGroup({ names: simpleNames, masses: [600, 300, 100] })),
        status: 'deferred', reason: 'profile_binding_missing',
      },
      {
        name: 'raw', ingredientsText: simpleText,
        evidence: traceEvidence(simpleText, traceCompositionGroup({ names: simpleNames, masses: [600, 300, 100], bindings: directBindings, weightStage: 'raw' })),
        status: 'deferred', reason: 'raw_stage',
      },
      {
        name: 'stale', ingredientsText: `${simpleText}、水`, evidence: traceEvidence(simpleText, validRoot),
        status: 'deferred', reason: 'declaration_stale',
      },
      {
        name: 'nested-missing', ingredientsText: nestedText, evidence: traceEvidence(nestedText, nestedMissing),
        status: 'deferred', reason: 'nested_binding_missing',
      },
    ] as const

    for (const scenario of scenarios) {
      const { backup, storedTrace } = makeActualTraceBackup({
        requestId: `actual_trace_${scenario.name}`,
        ingredientsText: scenario.ingredientsText,
        evidence: scenario.evidence,
      })
      const explicitTrace = storedTrace.explicitCompositionEvidence
      expect(explicitTrace?.status, scenario.name).toBe(scenario.status)
      expect(explicitTrace?.groups[0]?.reason, scenario.name).toBe(scenario.reason)
      const validated = validateBackup(backup)
      const restoredTrace = validated.estimationResults?.[0].optimization?.trace
      expect(restoredTrace?.explicitCompositionEvidence, scenario.name).toEqual(explicitTrace)
      if (scenario.name === 'applied') {
        expect(restoredTrace?.plausibleScenarioCount).toBe(1)
        expect(restoredTrace?.explicitCompositionEvidence?.groups[0].compositionProfileId).toMatch(/^explicit-composition:/)
      }
    }
  })

  it('continues accepting old JSON snapshots without the new evidence contract', () => {
    const oldBackup = makeBackup()
    expect(validateBackup(oldBackup).estimationRequests?.[0].inputSnapshot.knownNutrientEvidence).toBeUndefined()
    expect(parseBackupText(backupToJson(oldBackup)).estimationRequests?.[0].inputHash).toBe('fnv1a:12345678')
  })

  it('round-trips Food and request evidence as independent deep copies', () => {
    const evidence = makeExplicitEvidence()
    const evidenceFood = { ...food, estimationEvidence: evidence }
    const snapshot = createEstimationRequest(evidenceFood, { requestId: 'evidence_backup_request', now }).inputSnapshot
    const sourceBackup = { ...withInput(snapshot), foods: [evidenceFood] }
    const restored = validateBackup(sourceBackup)

    expect(restored.foods[0].estimationEvidence).toEqual(evidence)
    expect(restored.estimationRequests?.[0].inputSnapshot.estimationEvidence).toEqual(evidence)
    expect(restored.foods[0].estimationEvidence).not.toBe(evidence)
    expect(restored.foods[0].estimationEvidence?.compositions).not.toBe(evidence.compositions)
    expect(restored.estimationRequests?.[0].inputSnapshot.estimationEvidence?.compositions)
      .not.toBe(evidence.compositions)

    evidence.compositions[0].amounts.children[0].value = 0.2
    expect(restored.foods[0].estimationEvidence?.compositions?.[0].amounts)
      .toEqual({ kind: 'fractions', children: [{ index: 0, value: 0.6 }, { index: 1, value: 0.4 }] })
    expect(restored.estimationRequests?.[0].inputSnapshot.estimationEvidence?.compositions?.[0].amounts)
      .toEqual({ kind: 'fractions', children: [{ index: 0, value: 0.6 }, { index: 1, value: 0.4 }] })

    const roundTripped = parseBackupText(backupToJson(restored))
    expect(roundTripped.foods[0].estimationEvidence).toEqual(restored.foods[0].estimationEvidence)
    expect(roundTripped.estimationRequests?.[0].inputSnapshot.estimationEvidence)
      .toEqual(restored.estimationRequests?.[0].inputSnapshot.estimationEvidence)
  })

  it('rejects unknown evidence schema and fields in both Food and request snapshots', () => {
    const unknownSchema = { ...makeExplicitEvidence(), schemaVersion: 99 }
    const unknownField = { ...makeExplicitEvidence(), additives: [] }
    expect(() => validateBackup({ ...makeBackup(), foods: [{ ...food, estimationEvidence: unknownSchema }] })).toThrow('食品または食事記録')
    expect(() => validateBackup({ ...makeBackup(), foods: [{ ...food, estimationEvidence: unknownField }] })).toThrow('食品または食事記録')

    const snapshot = makeConfirmedSnapshot()
    expect(() => validateBackup(withInput({ ...snapshot, estimationEvidence: unknownSchema as never }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({ ...snapshot, estimationEvidence: unknownField as never }))).toThrow('推計要求、結果または採用履歴')
  })

  it('round-trips the validated evidence, references, fit mode, targets, and fingerprint', () => {
    const snapshot = makeConfirmedSnapshot()
    const roundTripped = parseBackupText(backupToJson(withInput(snapshot)))
    expect(roundTripped.estimationRequests?.[0].inputSnapshot).toMatchObject({
      knownNutrients: { energyKcal: 123 },
      knownNutrientEvidence: snapshot.knownNutrientEvidence,
      knownNutrientReferences: snapshot.knownNutrientReferences,
      knownNutrientReferenceBasis: { amount: 100, unit: 'g' },
      fitMode: 'robust_interval',
      requestedNutrients: ['fiberG'],
      requestFingerprint: snapshot.requestFingerprint,
    })
  })

  it('keeps an explicitly null evaluated product name separate from the stored food name', () => {
    const snapshot = { ...makeConfirmedSnapshot(), productName: null }
    snapshot.requestFingerprint = createNutrientEstimateRequestFingerprintFromSnapshot(snapshot)
    const restored = parseBackupText(backupToJson(withInput(snapshot))).estimationRequests![0].inputSnapshot
    expect(restored.productName).toBeNull()
    expect(restored.name).toBe(food.name)
    expect(restored.requestFingerprint).toBe(snapshot.requestFingerprint)
  })

  it('rejects untrusted evidence and evidence that does not describe the known values', () => {
    const snapshot = makeConfirmedSnapshot()
    const invalidEvidence = [
      { origin: 'external_source', verified: true, source: 'external', resolution: 'explicit_metadata' },
      { origin: 'user_input', verified: false, source: 'manual entry', resolution: 'explicit_metadata' },
      { origin: 'manufacturer_label', verified: true, source: 'old user fallback', resolution: 'legacy_source_user' },
    ] as const
    for (const evidence of invalidEvidence) {
      const candidate = { ...snapshot, knownNutrientEvidence: { energyKcal: evidence } } as NutritionEstimationInput
      expect(() => validateBackup(withInput({
        ...candidate,
        requestFingerprint: createNutrientEstimateRequestFingerprintFromSnapshot(candidate),
      }))).toThrow('推計要求、結果または採用履歴')
    }
    expect(() => validateBackup(withInput({
      ...snapshot,
      knownNutrients: { energyKcal: null },
    }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({
      ...snapshot,
      knownNutrients: { energyKcal: 124 },
    }))).toThrow('推計要求、結果または採用履歴')
  })

  it('rejects malformed modes, duplicate targets, missing fingerprints, and stale fingerprints', () => {
    const snapshot = makeConfirmedSnapshot()
    expect(() => validateBackup(withInput({ ...snapshot, fitMode: 'unknown' as never }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({ ...snapshot, requestedNutrients: ['fiberG', 'fiberG'] }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({ ...snapshot, requestFingerprint: undefined }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({ ...snapshot, requestFingerprint: 'fnv1a:00000000' }))).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup(withInput({ ...snapshot, productName: 123 } as unknown as NutritionEstimationInput))).toThrow('推計要求、結果または採用履歴')
  })

  it('rejects estimated references, mismatched evidence origins, and invalid or mismatched bases', () => {
    const snapshot = makeConfirmedSnapshot()
    const invalidSnapshots = [
      {
        ...snapshot,
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, basis: undefined } },
      },
      {
        ...snapshot,
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, reference: { kind: 'estimated' as const, value: 123 } } },
      },
      {
        ...snapshot,
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, origin: 'manufacturer_label' as const } },
      },
      { ...snapshot, knownNutrientReferenceBasis: { amount: Number.POSITIVE_INFINITY, unit: 'g' as const } },
      {
        ...snapshot,
        knownNutrientReferenceBasis: { amount: 50, unit: 'g' as const },
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, basis: { amount: 50, unit: 'g' as const } } },
      },
      {
        ...snapshot,
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, basis: { amount: 50, unit: 'g' as const } } },
      },
      {
        ...snapshot,
        knownNutrientReferences: { energyKcal: { ...snapshot.knownNutrientReferences!.energyKcal!, reference: { kind: 'declared_range' as const, min: 2, max: 1 } } },
      },
    ]
    for (const candidate of invalidSnapshots) {
      const requestFingerprint = snapshot.requestFingerprint
      expect(() => validateBackup(withInput({ ...candidate, requestFingerprint }))).toThrow('推計要求、結果または採用履歴')
    }
  })
})
