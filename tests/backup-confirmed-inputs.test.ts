import { describe, expect, it } from 'vitest'
import { backupToJson, parseBackupText, validateBackup } from '../src/services/backup'
import { createNutrientEstimateRequestFingerprintFromSnapshot } from '../src/services/confirmedNutrientInputs'
import { createEstimationRequest } from '../src/services/nutrientEstimationStore'
import { DEFAULT_ESTIMATION_SETTINGS, EMPTY_NUTRIENTS, NUTRIENT_KEYS, type BackupData, type Food, type NutrientEvidenceMap, type NutritionEstimationInput } from '../src/types'

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
      foodId: food.id,
      barcode: food.barcode,
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

describe('estimation backup confirmed-input validation', () => {
  it('continues accepting old JSON snapshots without the new evidence contract', () => {
    const oldBackup = makeBackup()
    expect(validateBackup(oldBackup).estimationRequests?.[0].inputSnapshot.knownNutrientEvidence).toBeUndefined()
    expect(parseBackupText(backupToJson(oldBackup)).estimationRequests?.[0].inputHash).toBe('fnv1a:12345678')
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
