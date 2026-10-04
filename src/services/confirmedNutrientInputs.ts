import {
  NUTRIENT_KEYS,
  type FoodSource,
  type EstimatorGenreId,
  type EstimatorGenreSource,
  type FoodUnitConversion,
  type IngredientsSource,
  type KnownNutrientReferenceMap,
  type NutrientEvidence,
  type NutrientEvidenceMap,
  type NutrientMetadataMap,
  type NutrientReferenceBasis,
  type NutrientKey,
  type Nutrients,
  type NutrientEstimateFitMode,
  type NutritionEstimationInput,
} from '../types'

export interface NutrientEstimateInputFields {
  productName?: string | null
  estimatorCategoryId?: string | null
  estimatorGenreId?: EstimatorGenreId | null
  estimatorGenreSource?: EstimatorGenreSource | null
  baseAmount?: number
  baseUnit?: string
  referenceMassG?: number | null
  referenceMassSource?: string | null
  ingredientsText?: string | null
  ingredientsSource?: IngredientsSource | null
  inputUnitConversions?: FoodUnitConversion[]
  knownNutrients?: Partial<Nutrients>
  knownNutrientEvidence?: NutrientEvidenceMap
  knownNutrientReferences?: KnownNutrientReferenceMap
  knownNutrientReferenceBasis?: NutrientReferenceBasis | null
  fitMode?: NutrientEstimateFitMode
  requestedNutrients?: readonly NutrientKey[]
}

export interface ConfirmedNutrientInputs {
  knownNutrients: Partial<Nutrients>
  knownNutrientEvidence: NutrientEvidenceMap
  knownNutrientReferences: KnownNutrientReferenceMap
  knownNutrientReferenceBasis: NutrientReferenceBasis | null
  fitMode: NutrientEstimateFitMode
  requestedNutrients: NutrientKey[]
  excludedNutrientKeys: NutrientKey[]
}

const TRUSTED_ORIGINS = new Set(['manufacturer_label', 'user_input'])
const DEFAULT_REQUESTED_NUTRIENT_KEYS: readonly NutrientKey[] = [
  'saturatedFatG', 'fiberG', 'calciumMg', 'ironMg', 'vitaminAMcg',
  'vitaminEMg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminCMg',
]

function isTrustedEvidence(evidence: NutrientEvidence | undefined): evidence is NutrientEvidence {
  if (!evidence || evidence.verified !== true || !TRUSTED_ORIGINS.has(evidence.origin)) return false
  return evidence.resolution === 'explicit_metadata'
    || (evidence.resolution === 'legacy_source_user' && evidence.origin === 'user_input')
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function referenceHasSource(reference: NonNullable<KnownNutrientReferenceMap[NutrientKey]>): boolean {
  return nonEmpty(reference.sourceReference) || nonEmpty(reference.provider)
}

/**
 * Normalize the evidence-bearing fields used by both the estimator and the request fingerprint.
 * Bare numbers never become trusted evidence here.
 */
export function canonicalizeConfirmedNutrientInputs(
  input: NutrientEstimateInputFields,
): ConfirmedNutrientInputs {
  const targets = new Set(input.requestedNutrients ?? DEFAULT_REQUESTED_NUTRIENT_KEYS)
  const knownNutrients: Partial<Nutrients> = {}
  const knownNutrientEvidence: NutrientEvidenceMap = {}
  const knownNutrientReferences: KnownNutrientReferenceMap = {}
  const excludedNutrientKeys: NutrientKey[] = []

  for (const key of NUTRIENT_KEYS) {
    if (targets.has(key)) continue
    const value = input.knownNutrients?.[key]
    const evidence = input.knownNutrientEvidence?.[key]
    const reference = input.knownNutrientReferences?.[key]
    if (!isTrustedEvidence(evidence)) {
      if (reference) excludedNutrientKeys.push(key)
      continue
    }

    const validValue = value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    let validReference = false
    if (reference) {
      const sourceMatches = reference.origin === evidence.origin
        && reference.verified === true
        && referenceHasSource(reference)
      if (!sourceMatches) {
        // A typed but estimated or unprovenanced label value must not fall back to its point number.
        excludedNutrientKeys.push(key)
        continue
      }
      if (typeof reference.reference !== 'object' || reference.reference === null) {
        throw new Error(`${key}の表示参照形式を確認してください。`)
      }
      if (reference.reference.kind === 'estimated') {
        excludedNutrientKeys.push(key)
        continue
      }
      if (validValue && reference.reference.kind === 'fixed' && reference.reference.value !== value) {
        throw new Error(`${key}の表示値と固定参照値を一致させてください。`)
      }
      if (validValue && reference.reference.kind === 'declared_range'
        && (reference.reference.min === undefined || reference.reference.max === undefined
          || value < reference.reference.min || value > reference.reference.max)) {
        throw new Error(`${key}の数値と表示範囲を一致させてください。`)
      }
      knownNutrientReferences[key] = {
        ...reference,
        reference: { ...reference.reference },
        basis: reference.basis ? { ...reference.basis } : reference.basis,
      }
      validReference = true
    }

    if (validValue || validReference) {
      if (validValue) knownNutrients[key] = value
      knownNutrientEvidence[key] = { ...evidence }
    }
  }

  const requestedNutrients = NUTRIENT_KEYS.filter((key) => targets.has(key))
  return {
    knownNutrients,
    knownNutrientEvidence,
    knownNutrientReferences,
    knownNutrientReferenceBasis: input.knownNutrientReferenceBasis
      ? { ...input.knownNutrientReferenceBasis }
      : null,
    fitMode: input.fitMode ?? 'legacy_point',
    requestedNutrients,
    excludedNutrientKeys,
  }
}

/** Resolve only the documented legacy source=user case; do not mutate or infer Food metadata. */
export function confirmedNutrientInputsFromFood(input: {
  source: FoodSource
  nutrients: Partial<Nutrients>
  nutrientMetadata?: NutrientMetadataMap
  legacyFallbackBlocked?: boolean
}): Pick<ConfirmedNutrientInputs, 'knownNutrients' | 'knownNutrientEvidence'> {
  const knownNutrients: Partial<Nutrients> = {}
  const knownNutrientEvidence: NutrientEvidenceMap = {}

  for (const key of NUTRIENT_KEYS) {
    const value = input.nutrients[key]
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0) continue
    const metadataPresent = input.nutrientMetadata !== undefined
      && Object.prototype.hasOwnProperty.call(input.nutrientMetadata, key)
    const metadata = input.nutrientMetadata?.[key]
    if (metadataPresent) {
      knownNutrients[key] = value
      knownNutrientEvidence[key] = {
        origin: metadata?.origin ?? 'unknown',
        verified: metadata?.verified === true,
        ...(metadata?.source === undefined ? {} : { source: metadata.source }),
        resolution: 'explicit_metadata',
      }
    } else if (input.source === 'user' && input.legacyFallbackBlocked !== true) {
      knownNutrients[key] = value
      knownNutrientEvidence[key] = {
        origin: 'user_input',
        verified: true,
        source: 'legacy source=user compatibility',
        resolution: 'legacy_source_user',
      }
    }
  }
  return { knownNutrients, knownNutrientEvidence }
}

function fnv1a(payload: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** Fingerprint the canonical evaluated input, excluding request identity and timestamps. */
export function createNutrientEstimateRequestFingerprint(input: NutrientEstimateInputFields): string {
  const canonical = canonicalizeConfirmedNutrientInputs(input)
  const payload = JSON.stringify({
    schema: 'nutrient-estimate-request-v1',
    productName: input.productName ?? null,
    estimatorCategoryId: input.estimatorCategoryId ?? null,
    estimatorGenreId: input.estimatorGenreId ?? null,
    estimatorGenreSource: input.estimatorGenreSource ?? null,
    baseAmount: input.baseAmount ?? null,
    baseUnit: input.baseUnit ?? null,
    referenceMassG: input.referenceMassG ?? null,
    referenceMassSource: input.referenceMassSource ?? null,
    ingredientsText: input.ingredientsText ?? null,
    ingredientsSource: input.ingredientsSource
      ? [
          input.ingredientsSource.provider,
          input.ingredientsSource.retrievedAt ?? null,
          input.ingredientsSource.version ?? null,
          input.ingredientsSource.verified ?? null,
          input.ingredientsSource.note ?? null,
        ]
      : null,
    inputUnitConversions: (input.inputUnitConversions ?? []).map((conversion) => [conversion.unit, conversion.baseAmount]),
    knownNutrients: NUTRIENT_KEYS.map((key) => [key, canonical.knownNutrients[key] ?? null]),
    knownNutrientEvidence: NUTRIENT_KEYS.map((key) => {
      const evidence = canonical.knownNutrientEvidence[key]
      return [key, evidence ? [evidence.origin, evidence.verified, evidence.source ?? null, evidence.resolution] : null]
    }),
    knownNutrientReferences: NUTRIENT_KEYS.map((key) => {
      const reference = canonical.knownNutrientReferences[key]
      return [key, reference ? [
        reference.origin,
        reference.verified,
        reference.sourceReference ?? null,
        reference.provider ?? null,
        reference.reference.kind,
        reference.reference.value ?? null,
        reference.reference.min ?? null,
        reference.reference.max ?? null,
        reference.reference.decimalPlaces ?? null,
        reference.basis?.amount ?? null,
        reference.basis?.unit ?? null,
      ] : null]
    }),
    knownNutrientReferenceBasis: canonical.knownNutrientReferenceBasis
      ? [canonical.knownNutrientReferenceBasis.amount, canonical.knownNutrientReferenceBasis.unit]
      : null,
    fitMode: canonical.fitMode,
    requestedNutrients: canonical.requestedNutrients,
  })
  return fnv1a(payload)
}

/** Persisted snapshots call the product field `name`; adapt without rebuilding any evaluated inputs. */
export function createNutrientEstimateRequestFingerprintFromSnapshot(snapshot: NutritionEstimationInput): string {
  const productName = Object.prototype.hasOwnProperty.call(snapshot, 'productName')
    ? snapshot.productName
    : snapshot.name
  return createNutrientEstimateRequestFingerprint({
    productName,
    estimatorCategoryId: snapshot.estimatorCategoryId,
    estimatorGenreId: snapshot.estimatorGenreId,
    estimatorGenreSource: snapshot.estimatorGenreSource,
    baseAmount: snapshot.baseAmount,
    baseUnit: snapshot.baseUnit,
    referenceMassG: snapshot.referenceMassG ?? null,
    referenceMassSource: snapshot.referenceMassSource ?? null,
    inputUnitConversions: snapshot.inputUnitConversions,
    ingredientsText: snapshot.ingredientsText,
    ingredientsSource: snapshot.ingredientsSource,
    knownNutrients: snapshot.knownNutrients,
    knownNutrientEvidence: snapshot.knownNutrientEvidence,
    knownNutrientReferences: snapshot.knownNutrientReferences,
    knownNutrientReferenceBasis: snapshot.knownNutrientReferenceBasis,
    fitMode: snapshot.fitMode,
    requestedNutrients: snapshot.requestedNutrients,
  })
}
