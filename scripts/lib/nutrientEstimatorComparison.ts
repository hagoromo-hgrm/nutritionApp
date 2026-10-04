import {
  ESTIMATABLE_NUTRIENT_KEYS,
  ESTIMATE_FIT_NUTRIENT_KEYS,
  GENRE_PRIOR_PARTIAL_METHOD,
  estimateNutrients,
  NUTRIENT_ESTIMATOR_MODEL_VERSION,
  type EstimateFitNutrientKey,
  type EstimatableNutrientKey,
  type NutrientEstimateRequest,
  type NutrientEstimatorRatioStrategy,
} from '../../src/services/nutrientEstimator'
import { ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH } from '../../src/data/nutrientEstimatorGenreNutrientPriors'
import {
  nutrientLabelReferenceInterval,
  NUTRIENT_LABEL_TOLERANCE_RULE_VERSION,
  type NutrientLabelReference,
} from '../../src/services/nutrientLabelInterval'
import type { EstimatorGenreId, NutrientKey } from '../../src/types'

type FitMode = 'legacy_point' | 'robust_interval'
type EstimateKind = 'full' | 'known_only' | 'genre_prior'
type ExclusionReason =
  | 'missing'
  | 'estimated'
  | 'invalid_format'
  | 'invalid_boolean'
  | 'invalid_nonfinite'
  | 'invalid_negative'
  | 'invalid_range_order'
  | 'invalid_value_kind'
  | 'invalid_reference_mass'

interface TrainingNutrient {
  value: number | null
  rangeMin: number | null
  rangeMax: number | null
  decimalPlaces: number
  valueKind: string
}

interface TrainingRecord {
  recordId: string
  genreId: EstimatorGenreId
  productName: string
  maker: string
  productFamily: string
  ingredientsText: string
  baseAmount: number
  baseUnit: string
  referenceMassG: number
  referenceMassSource: string
  nutrients: Partial<Record<NutrientKey, TrainingNutrient>>
  sourceReference: string
  verifiedAt: string
}

export interface TrainingDataset {
  format: 'nutrition-estimator-training-data'
  formatVersion: 1
  records: TrainingRecord[]
}

export interface TrainingManifest {
  format: 'nutrition-estimator-training-manifest'
  formatVersion: 1
  sourceFileSha256: string
  normalizedDatasetSha256: string
  recordCount: number
  records: Array<{
    recordId: string
    genreId: EstimatorGenreId
    groupKey: string
    split: 'train' | 'calibration' | 'test'
  }>
  publicTrainingOrAggregateRedistributionPermitted?: boolean
  seal?: unknown
  sealed?: unknown
}

interface AcceptedTarget {
  record: TrainingRecord
  groupKey: string
  makerKey: string
  label: TrainingNutrient
  reference: NutrientLabelReference
  referenceInterval: ReturnType<typeof nutrientLabelReferenceInterval>
}

interface InternalObservation {
  available: boolean
  estimateKind: EstimateKind | null
  point: number | null
  rangeMin: number | null
  rangeMax: number | null
  pointAbsoluteError: number | null
  pointSignedError: number | null
  intervalOutsideError: number | null
  intervalOverlap: boolean | null
  referenceWidth: number
  fixed: boolean
}

interface ModeMetric {
  referenceCount: number
  availableCount: number
  availabilityRate: number | null
  fixedPointMaePer100g: number | null
  fixedPointBiasPer100g: number | null
  intervalOutsideMaePer100g: number | null
  meanEstimatorRangeWidthPer100g: number | null
  meanReferenceIntervalWidthPer100g: number | null
  intervalOverlapRate: number | null
  byEstimateKind: Record<EstimateKind, {
    availableCount: number
    fixedPointMaePer100g: number | null
    intervalOutsideMaePer100g: number | null
    meanEstimatorRangeWidthPer100g: number | null
    intervalOverlapRate: number | null
  }>
}

interface SupportSummary {
  observedCount: number
  acceptedCount: number
  independentFamilyCount: number
  makerCount: number
  maximumMakerShare: number | null
  maximumFamilyShare: number | null
  missingCount: number
  estimatedCount: number
  invalidExcluded: Record<ExclusionReason, number>
}

interface PairedSummary {
  comparableAvailableCount: number
  robustFixedPointMaeDeltaPer100g: number | null
  robustIntervalOutsideMaeDeltaPer100g: number | null
  robustIntervalOverlapRateDelta: number | null
  nonRegression: boolean | null
}

interface ComparisonNutrientRow {
  nutrientKey: EstimatableNutrientKey
  support: SupportSummary
  evaluationFloor: {
    independentFamilyCount: number
    makerCount: number
    maximumMakerShare: number
    meets: boolean
    shortfalls: string[]
  }
  modes: Record<FitMode, ModeMetric>
  paired: PairedSummary
  recommendation: FitMode
}

interface ComparisonGenreRow {
  genreId: EstimatorGenreId
  targetReferenceCount: number
  nutrients: Array<{
    nutrientKey: EstimatableNutrientKey
    referenceCount: number
    modes: Record<FitMode, ModeMetric>
  }>
}

interface ComparisonReport {
  format: 'nutrient-estimator-fit-comparison'
  formatVersion: 1
  scope: 'calibration_split_only'
  calibrationRecordCount: number
  sourceHashes: {
    sourceFileSha256: string
    normalizedDatasetSha256: string
    manifestFileSha256: string
  }
  splitLeakageCheck: 'passed'
  fitModes: readonly FitMode[]
  estimatorModelVersion: string
  intervalRuleVersion: string
  evaluationFloor: typeof EVALUATION_FLOOR
  protocol: {
    targetRequestsAreIndividual: true
    matchedRequestIdAndTimestamp: true
    deterministicSeedInputsMatched: true
    ratioStrategyOverride: null
    modeSpecificScenarioBudget: false
  }
  definitions: Record<string, string>
  nutrients: ComparisonNutrientRow[]
  robustEligibleNutrientCount: number
  defaultFitModeRecommendation: FitMode
  defaultRecommendationRationale: string
  genreBreakdown: ComparisonGenreRow[]
}

const MODES: readonly FitMode[] = ['legacy_point', 'robust_interval']
const MODELS: readonly EstimateKind[] = ['full', 'known_only', 'genre_prior']
const ESTIMATOR_GENRES: readonly EstimatorGenreId[] = [
  'baked_sweets', 'cake_pastry', 'bread', 'chocolate', 'sugar_confectionery',
  'snack_rice_cracker', 'frozen_dessert', 'dairy', 'drink_jelly_pudding',
  'fried_food', 'noodle_flour_dish', 'prepared_meal', 'sauce_spread', 'other_unknown',
]
const EVALUATION_FLOOR = {
  minimumIndependentFamilies: 30,
  minimumMakers: 3,
  maximumMakerShare: 0.5,
} as const
const EPSILON = 1e-9

function assertDataset(value: unknown): asserts value is TrainingDataset {
  if (!value || typeof value !== 'object') throw new Error('教師データ形式が不正です。')
  const dataset = value as Partial<TrainingDataset>
  if (
    dataset.format !== 'nutrition-estimator-training-data'
    || dataset.formatVersion !== 1
    || !Array.isArray(dataset.records)
  ) {
    throw new Error('教師データ形式が不正です。')
  }
}

function assertManifest(value: unknown): asserts value is TrainingManifest {
  if (!value || typeof value !== 'object') throw new Error('マニフェスト形式が不正です。')
  const manifest = value as Partial<TrainingManifest>
  if (
    manifest.format !== 'nutrition-estimator-training-manifest'
    || manifest.formatVersion !== 1
    || typeof manifest.sourceFileSha256 !== 'string'
    || typeof manifest.normalizedDatasetSha256 !== 'string'
    || !Number.isSafeInteger(manifest.recordCount)
    || !Array.isArray(manifest.records)
    || 'seal' in manifest
    || 'sealed' in manifest
  ) {
    throw new Error('マニフェスト形式が不正です。')
  }
}

export function assertManifestBijection(
  dataset: { records: readonly { recordId: string; genreId: EstimatorGenreId }[] },
  manifest: TrainingManifest,
): Map<string, TrainingManifest['records'][number]> {
  if (manifest.records.length !== dataset.records.length || manifest.recordCount !== dataset.records.length) {
    throw new Error('教師データとマニフェストの件数が一致しません。')
  }
  const entries = new Map<string, TrainingManifest['records'][number]>()
  for (const item of manifest.records) {
    if (
      !item
      || typeof item.recordId !== 'string'
      || !item.recordId
      || typeof item.genreId !== 'string'
      || typeof item.groupKey !== 'string'
      || !item.groupKey
      || !['train', 'calibration', 'test'].includes(item.split)
      || entries.has(item.recordId)
    ) {
      throw new Error('マニフェストの識別情報に重複または不正値があります。')
    }
    entries.set(item.recordId, item)
  }
  const seen = new Set<string>()
  for (const record of dataset.records) {
    if (!record || typeof record.recordId !== 'string' || !record.recordId || seen.has(record.recordId)) {
      throw new Error('教師データの識別情報に重複または不正値があります。')
    }
    seen.add(record.recordId)
    const item = entries.get(record.recordId)
    if (!item || item.genreId !== record.genreId) {
      throw new Error('教師データとマニフェストのIDまたはジャンルが一致しません。')
    }
  }
  if (seen.size !== entries.size || [...entries.keys()].some((recordId) => !seen.has(recordId))) {
    throw new Error('教師データとマニフェストのIDが一対一に対応しません。')
  }
  return entries
}

export function assertApprovedPriorDataset(value: unknown): asserts value is TrainingManifest {
  assertManifest(value)
  const manifest = value
  if (manifest.publicTrainingOrAggregateRedistributionPermitted === false) {
    throw new Error('この教師データから公開比較レポートを生成できません。')
  }
  if (manifest.normalizedDatasetSha256 !== ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH) {
    throw new Error('比較対象は現在の既存prior教師データに限定されています。')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTargetReference(labelValue: unknown): { reference: NutrientLabelReference; fixed: boolean } | ExclusionReason {
  if (labelValue === undefined || labelValue === null) return 'missing'
  if (!isRecord(labelValue)) return 'invalid_format'
  const kind = labelValue.valueKind
  if (kind === 'estimated') return 'estimated'
  if (kind !== 'fixed' && kind !== 'declared_range') return 'invalid_value_kind'
  const decimalPlaces = labelValue.decimalPlaces
  if (typeof decimalPlaces !== 'number' || !Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0) {
    return 'invalid_format'
  }
  if (kind === 'fixed') {
    const value = labelValue.value
    if (typeof value === 'boolean') return 'invalid_boolean'
    if (typeof value !== 'number') return 'invalid_format'
    if (!Number.isFinite(value)) return 'invalid_nonfinite'
    if (value < 0) return 'invalid_negative'
    return { reference: { kind: 'fixed', value, decimalPlaces }, fixed: true }
  }
  const min = labelValue.rangeMin
  const max = labelValue.rangeMax
  if (typeof min === 'boolean' || typeof max === 'boolean') return 'invalid_boolean'
  if (typeof min !== 'number' || typeof max !== 'number') return 'invalid_format'
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'invalid_nonfinite'
  if (min < 0 || max < 0) return 'invalid_negative'
  if (max < min) return 'invalid_range_order'
  return { reference: { kind: 'declared_range', min, max, decimalPlaces }, fixed: false }
}

function knownLabelRepresentative(labelValue: unknown): number | null {
  const parsed = parseTargetReference(labelValue)
  if (typeof parsed === 'string') return null
  if (parsed.fixed) return parsed.reference.value ?? null
  const minimum = parsed.reference.min
  const maximum = parsed.reference.max
  if (minimum === undefined || maximum === undefined) return null
  return (minimum + maximum) / 2
}

function safeMean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((total, value) => total + value, 0) / values.length)
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function acceptedTargets(
  calibrationRecords: readonly TrainingRecord[],
  manifestById: ReadonlyMap<string, TrainingManifest['records'][number]>,
  nutrientKey: EstimatableNutrientKey,
): { accepted: AcceptedTarget[]; observedCount: number; exclusions: Record<ExclusionReason, number> } {
  const exclusions: Record<ExclusionReason, number> = {
    missing: 0,
    estimated: 0,
    invalid_format: 0,
    invalid_boolean: 0,
    invalid_nonfinite: 0,
    invalid_negative: 0,
    invalid_range_order: 0,
    invalid_value_kind: 0,
    invalid_reference_mass: 0,
  }
  const accepted: AcceptedTarget[] = []
  let observedCount = 0
  for (const record of calibrationRecords) {
    const labelValue = record.nutrients?.[nutrientKey]
    if (labelValue !== undefined && labelValue !== null) observedCount += 1
    const parsed = parseTargetReference(labelValue)
    if (typeof parsed === 'string') {
      exclusions[parsed] += 1
      continue
    }
    if (typeof record.referenceMassG !== 'number' || !Number.isFinite(record.referenceMassG) || record.referenceMassG <= 0) {
      exclusions.invalid_reference_mass += 1
      continue
    }
    let referenceInterval: ReturnType<typeof nutrientLabelReferenceInterval>
    try {
      referenceInterval = nutrientLabelReferenceInterval(
        nutrientKey,
        parsed.reference,
        { amount: record.referenceMassG, unit: 'g' },
      )
    } catch {
      exclusions.invalid_format += 1
      continue
    }
    const manifestEntry = manifestById.get(record.recordId)
    if (!manifestEntry) throw new Error('校正用データとマニフェストのID対応が不正です。')
    const familySeparator = manifestEntry.groupKey.indexOf('\u0000')
    if (familySeparator <= 0) throw new Error('マニフェストfamily key形式が不正です。')
    accepted.push({
      record,
      groupKey: manifestEntry.groupKey,
      makerKey: manifestEntry.groupKey.slice(0, familySeparator),
      label: labelValue as TrainingNutrient,
      reference: parsed.reference,
      referenceInterval,
    })
  }
  return { accepted, observedCount, exclusions }
}

function supportSummary(
  accepted: readonly AcceptedTarget[],
  observedCount: number,
  exclusions: Record<ExclusionReason, number>,
  calibrationCount: number,
): SupportSummary {
  const familyMaker = new Map<string, string>()
  const makerFamilies = new Map<string, Set<string>>()
  for (const item of accepted) {
    const priorMaker = familyMaker.get(item.groupKey)
    if (priorMaker !== undefined && priorMaker !== item.makerKey) {
      throw new Error('同一familyのメーカー識別が一致しません。')
    }
    familyMaker.set(item.groupKey, item.makerKey)
    const families = makerFamilies.get(item.makerKey) ?? new Set<string>()
    families.add(item.groupKey)
    makerFamilies.set(item.makerKey, families)
  }
  const familyCount = familyMaker.size
  const makerCount = makerFamilies.size
  const maximumMakerFamilies = Math.max(0, ...[...makerFamilies.values()].map((families) => families.size))
  const allReasons = { ...exclusions }
  const missing = calibrationCount - observedCount
  if (missing > 0) allReasons.missing = missing
  return {
    observedCount,
    acceptedCount: accepted.length,
    independentFamilyCount: familyCount,
    makerCount,
    maximumMakerShare: familyCount === 0 ? null : round(maximumMakerFamilies / familyCount),
    maximumFamilyShare: familyCount === 0 ? null : round(1 / familyCount),
    missingCount: Math.max(0, calibrationCount - observedCount),
    estimatedCount: exclusions.estimated,
    invalidExcluded: allReasons,
  }
}

export function meetsEvaluationFloor(support: SupportSummary): boolean {
  return support.independentFamilyCount >= EVALUATION_FLOOR.minimumIndependentFamilies
    && support.makerCount >= EVALUATION_FLOOR.minimumMakers
    && support.maximumMakerShare !== null
    && support.maximumMakerShare <= EVALUATION_FLOOR.maximumMakerShare
}

export function recommendDefaultFitMode(rows: readonly { recommendation: FitMode }[]): FitMode {
  return rows.length > 0 && rows.every((row) => row.recommendation === 'robust_interval')
    ? 'robust_interval'
    : 'legacy_point'
}

function estimateKind(method: string): EstimateKind {
  if (method === GENRE_PRIOR_PARTIAL_METHOD) return 'genre_prior'
  if (method === 'browser_ingredient_partial_rule') return 'known_only'
  return 'full'
}

export function buildRequest(record: TrainingRecord, target: EstimatableNutrientKey, mode: FitMode): NutrientEstimateRequest {
  const knownNutrients: Partial<Record<EstimateFitNutrientKey, number>> = {}
  const knownNutrientReferences: NonNullable<NutrientEstimateRequest['knownNutrientReferences']> = {}
  const knownNutrientEvidence: NonNullable<NutrientEstimateRequest['knownNutrientEvidence']> = {}
  for (const key of ESTIMATE_FIT_NUTRIENT_KEYS) {
    if (String(key) === String(target)) continue
    const label = record.nutrients[key]
    const value = knownLabelRepresentative(label)
    if (value === null) continue
    const parsed = parseTargetReference(label)
    if (typeof parsed === 'string') continue
    knownNutrients[key] = value
    knownNutrientEvidence[key] = { origin: 'manufacturer_label', verified: true, source: record.sourceReference, resolution: 'explicit_metadata' }
    knownNutrientReferences[key] = {
      origin: 'manufacturer_label',
      verified: true,
      sourceReference: record.sourceReference,
      reference: parsed.reference,
      basis: { amount: record.referenceMassG, unit: 'g' },
    }
  }
  // Request only this target and never pass its own target label as fit evidence.
  return {
    requestId: `fit-comparison-${record.recordId}-${target}`,
    productName: record.productName,
    estimatorGenreId: record.genreId,
    baseAmount: record.baseAmount,
    baseUnit: record.baseUnit,
    referenceMassG: record.referenceMassG,
    referenceMassSource: record.referenceMassSource,
    ingredientsText: record.ingredientsText,
    ingredientsSource: { provider: 'メーカー公式サイト', verified: true },
    knownNutrients,
    knownNutrientEvidence,
    knownNutrientReferences,
    knownNutrientReferenceBasis: { amount: record.referenceMassG, unit: 'g' },
    requestedNutrients: [target],
    requestedAt: record.verifiedAt,
    fitMode: mode,
  }
}

function intervalOverlaps(
  prediction: { min: number; max: number },
  reference: { min: number; max: number; minInclusive: boolean; maxInclusive: boolean },
): boolean {
  if (prediction.max < reference.min || prediction.min > reference.max) return false
  if (prediction.max === reference.min && !reference.minInclusive) return false
  if (prediction.min === reference.max && !reference.maxInclusive) return false
  return true
}

function observationFor(
  target: AcceptedTarget,
  targetKey: EstimatableNutrientKey,
  mode: FitMode,
  strategy?: NutrientEstimatorRatioStrategy,
): InternalObservation {
  const result = estimateNutrients(buildRequest(target.record, targetKey, mode), strategy)
  const estimate = result.estimates[targetKey]
  const scale = 100 / target.record.referenceMassG
  const referenceMin = target.referenceInterval.min * scale
  const referenceMax = target.referenceInterval.max * scale
  const referenceInterval = {
    min: referenceMin,
    max: referenceMax,
    minInclusive: target.referenceInterval.minInclusive,
    maxInclusive: target.referenceInterval.maxInclusive,
  }
  const referenceWidth = Math.max(0, referenceMax - referenceMin)
  if (estimate.status !== 'available') {
    return {
      available: false,
      estimateKind: null,
      point: null,
      rangeMin: null,
      rangeMax: null,
      pointAbsoluteError: null,
      pointSignedError: null,
      intervalOutsideError: null,
      intervalOverlap: null,
      referenceWidth,
      fixed: target.reference.kind === 'fixed',
    }
  }
  const point = estimate.value * scale
  const rangeMin = estimate.range.min * scale
  const rangeMax = estimate.range.max * scale
  const fixedTruth = target.reference.kind === 'fixed' ? (target.reference.value ?? 0) * scale : null
  const intervalOutsideError = point < referenceMin
    ? referenceMin - point
    : point > referenceMax
      ? point - referenceMax
      : 0
  return {
    available: true,
    estimateKind: estimateKind(estimate.method),
    point,
    rangeMin,
    rangeMax,
    pointAbsoluteError: fixedTruth === null ? null : Math.abs(point - fixedTruth),
    pointSignedError: fixedTruth === null ? null : point - fixedTruth,
    intervalOutsideError,
    intervalOverlap: intervalOverlaps({ min: rangeMin, max: rangeMax }, referenceInterval),
    referenceWidth,
    fixed: fixedTruth !== null,
  }
}

export function modeMetric(observations: readonly InternalObservation[]): ModeMetric {
  const available = observations.filter((item) => item.available)
  const fixed = available.filter((item) => item.fixed)
  const byEstimateKind = Object.fromEntries(MODELS.map((kind) => {
    const items = available.filter((item) => item.estimateKind === kind)
    return [kind, {
      availableCount: items.length,
      fixedPointMaePer100g: safeMean(items.flatMap((item) => item.pointAbsoluteError === null ? [] : [item.pointAbsoluteError])),
      intervalOutsideMaePer100g: safeMean(items.flatMap((item) => item.intervalOutsideError === null ? [] : [item.intervalOutsideError])),
      meanEstimatorRangeWidthPer100g: safeMean(items.flatMap((item) => (
        item.rangeMin === null || item.rangeMax === null ? [] : [item.rangeMax - item.rangeMin]
      ))),
      intervalOverlapRate: items.length === 0
        ? null
        : round(items.filter((item) => item.intervalOverlap === true).length / items.length),
    }]
  })) as ModeMetric['byEstimateKind']
  return {
    referenceCount: observations.length,
    availableCount: available.length,
    availabilityRate: observations.length === 0 ? null : round(available.length / observations.length),
    fixedPointMaePer100g: safeMean(fixed.flatMap((item) => item.pointAbsoluteError === null ? [] : [item.pointAbsoluteError])),
    fixedPointBiasPer100g: safeMean(fixed.flatMap((item) => item.pointSignedError === null ? [] : [item.pointSignedError])),
    intervalOutsideMaePer100g: safeMean(available.flatMap((item) => item.intervalOutsideError === null ? [] : [item.intervalOutsideError])),
    meanEstimatorRangeWidthPer100g: safeMean(available.flatMap((item) => (
      item.rangeMin === null || item.rangeMax === null ? [] : [item.rangeMax - item.rangeMin]
    ))),
    meanReferenceIntervalWidthPer100g: safeMean(available.map((item) => item.referenceWidth)),
    intervalOverlapRate: available.length === 0
      ? null
      : round(available.filter((item) => item.intervalOverlap === true).length / available.length),
    byEstimateKind,
  }
}

export function pairedSummary(
  legacy: readonly InternalObservation[],
  robust: readonly InternalObservation[],
): PairedSummary {
  const pairs = legacy.flatMap((before, index) => {
    const after = robust[index]
    return before.available && after?.available ? [{ before, after }] : []
  })
  const legacyFixed = pairs.flatMap(({ before, after }) => (
    before.pointAbsoluteError === null || after.pointAbsoluteError === null
      ? []
      : [{ before: before.pointAbsoluteError, after: after.pointAbsoluteError }]
  ))
  const legacyOutside = pairs.flatMap(({ before, after }) => (
    before.intervalOutsideError === null || after.intervalOutsideError === null
      ? []
      : [{ before: before.intervalOutsideError, after: after.intervalOutsideError }]
  ))
  const legacyOverlap = pairs.filter(({ before, after }) => before.intervalOverlap !== null && after.intervalOverlap !== null)
  const fixedDelta = legacyFixed.length === 0 ? null : round(
    safeMean(legacyFixed.map((pair) => pair.after))! - safeMean(legacyFixed.map((pair) => pair.before))!,
  )
  const outsideDelta = legacyOutside.length === 0 ? null : round(
    safeMean(legacyOutside.map((pair) => pair.after))! - safeMean(legacyOutside.map((pair) => pair.before))!,
  )
  const overlapDelta = legacyOverlap.length === 0 ? null : round(
    legacyOverlap.filter((pair) => pair.after.intervalOverlap === true).length / legacyOverlap.length
    - legacyOverlap.filter((pair) => pair.before.intervalOverlap === true).length / legacyOverlap.length,
  )
  const evidence = [fixedDelta, outsideDelta].filter((value): value is number => value !== null)
  return {
    comparableAvailableCount: pairs.length,
    robustFixedPointMaeDeltaPer100g: fixedDelta,
    robustIntervalOutsideMaeDeltaPer100g: outsideDelta,
    robustIntervalOverlapRateDelta: overlapDelta,
    nonRegression: evidence.length === 0 ? null : evidence.every((delta) => delta <= EPSILON),
  }
}

function shortfallReasons(support: SupportSummary): string[] {
  const reasons: string[] = []
  if (support.independentFamilyCount < EVALUATION_FLOOR.minimumIndependentFamilies) {
    reasons.push('独立family数が30未満')
  }
  if (support.makerCount < EVALUATION_FLOOR.minimumMakers) reasons.push('メーカー数が3未満')
  if (support.maximumMakerShare === null || support.maximumMakerShare > EVALUATION_FLOOR.maximumMakerShare) {
    reasons.push('最大メーカーshareが50%超')
  }
  return reasons
}

function metricForReport(metric: ModeMetric) {
  const { byEstimateKind, ...overall } = metric
  return { ...overall, byEstimateKind }
}

export function markdownReport(report: ComparisonReport): string {
  const supportRows = report.nutrients.map((item) => {
    const invalidCount = Object.entries(item.support.invalidExcluded)
      .filter(([reason]) => reason.startsWith('invalid_'))
      .reduce((total, [, count]) => total + count, 0)
    const paired = item.paired
    return `| ${item.nutrientKey} | ${item.support.observedCount} / ${item.support.acceptedCount} | ${item.support.missingCount} / ${item.support.estimatedCount} / ${invalidCount} | ${item.support.independentFamilyCount} / ${item.support.makerCount} / ${formatPercent(item.support.maximumMakerShare)} | ${paired.comparableAvailableCount} / ${paired.nonRegression === null ? '判定不可' : paired.nonRegression ? '非退行' : '退行あり'} | ${item.evaluationFloor.shortfalls.join('、') || 'なし'} | ${item.recommendation} |`
  }).join('\n')
  const metricRows = report.nutrients.flatMap((item) => MODES.map((mode) => {
    const metric = item.modes[mode]
    return `| ${item.nutrientKey} | ${mode} | ${metric.availableCount} / ${metric.referenceCount} (${formatPercent(metric.availabilityRate)}) | ${formatMetric(metric.fixedPointMaePer100g)} / ${formatMetric(metric.fixedPointBiasPer100g)} | ${formatMetric(metric.intervalOutsideMaePer100g)} | ${formatMetric(metric.meanEstimatorRangeWidthPer100g)} / ${formatMetric(metric.meanReferenceIntervalWidthPer100g)} | ${formatPercent(metric.intervalOverlapRate)} |`
  })).join('\n')
  const genreRows = report.genreBreakdown.flatMap((genre) => genre.nutrients.map((row) => {
    const legacy = row.modes.legacy_point
    const robust = row.modes.robust_interval
    return `| ${genre.genreId} | ${row.nutrientKey} | ${row.referenceCount} | ${formatPercent(legacy.availabilityRate)} | ${formatPercent(robust.availabilityRate)} |`
  })).join('\n')
  const hashes = report.sourceHashes
  return [
    '# 栄養推定 fit mode 校正split比較',
    '',
    'この比較は既存教師データのcalibration splitだけを使った補助評価です。商品ごとの情報、表示値、原材料、family名、record IDは掲載していません。',
    '',
    `全対象をまとめた既定方式の推奨: ${report.defaultFitModeRecommendation}（robust_interval適格な栄養素 ${report.robustEligibleNutrientCount}/${report.nutrients.length}）。ジャンル・栄養素別の推定種別内訳はJSONに記録しています。`,
    '',
    `対象校正レコード数: ${report.calibrationRecordCount}。対象は各行の栄養素について、fixedまたは有効なdeclared rangeラベルがあるレコードです。`,
    '',
    '固定表示値のMAEとbiasは、印刷された値そのものを点として計算しました。declared rangeの中点は正解値として扱わず、CAA区間または表示範囲からの点推定距離をintervalOutsideMAEに集計しています。推定範囲とのoverlapは区間の重なり率であり、真のcoverageを意味しません。誤差と範囲幅はすべて100gあたりへ換算しています。',
    '',
    `CAA interval rule: ${report.intervalRuleVersion}。Estimator: ${report.estimatorModelVersion}。`,
    '',
    '各栄養素は個別requestで推定し、両方式のrequest ID・verifiedAt・既定ratio strategy・候補由来の探索回数を揃えました。方式以外のrequest設定は共通です。',
    '',
    '## 栄養素別',
    '',
    '| 栄養素 | 観測 / 採用 | 欠損 / estimated / invalid | 独立family / maker / 最大maker share | paired n / 非退行 | 評価下限の不足 | 推奨 |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |',
    supportRows,
    '',
    '| 栄養素 | mode | 利用可能 / 採用数 (availability) | 固定値MAE / bias | intervalOutsideMAE | 推定range幅 / target区間幅 | interval overlap |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    metricRows,
    '',
    '独立family 30以上、メーカー3以上、最大メーカーshare 50%以下を各栄養素の評価下限としました。下限未達またはpaired非退行を確認できない場合はlegacy_pointを推奨します。',
    '',
    '## ジャンル別 availability',
    '',
    '| ジャンル | 栄養素 | 対象参照数 | legacy | robust |',
    '| --- | --- | ---: | ---: | ---: |',
    genreRows,
    '',
    '## 入力整合性',
    '',
    `- Calibration records: ${report.calibrationRecordCount}`,
    `- Source file SHA-256: \`${hashes.sourceFileSha256}\``,
    `- Normalized canonical SHA-256: \`${hashes.normalizedDatasetSha256}\``,
    `- Manifest SHA-256: \`${hashes.manifestFileSha256}\``,
    '- Source/manifest hashes and canonical normalized hash were checked by the Python dataset audit before evaluation; IDs were checked as a one-to-one mapping and split-family leakage was rejected.',
    '',
    'familyは正規化したメーカー名とproductFamilyを使う分割単位です。これは同一系列内の漏出を抑えるための代理単位で、各familyが別配合・別商品の独立な標本であることまでは保証しません。',
    '',
    'このcalibration標本は実商品精度の証明ではありません。推定方式の既定値変更や公式評価の代替には使わず、別途定義された正式評価条件と混同しません。',
    '',
  ].join('\n')
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function groupModeMetric(
  observations: readonly InternalObservation[],
): ModeMetric {
  return modeMetric(observations)
}

export function buildFitComparison(
  datasetValue: unknown,
  manifestValue: unknown,
  sourceHashes: Record<string, unknown>,
): ComparisonReport {
  assertManifest(manifestValue)
  assertApprovedPriorDataset(manifestValue)
  assertDataset(datasetValue)
  const dataset = datasetValue
  const manifest = manifestValue
  const manifestById = assertManifestBijection(dataset, manifest)
  const calibrationRecords = dataset.records.filter((record) => manifestById.get(record.recordId)?.split === 'calibration')
  if (calibrationRecords.length === 0) throw new Error('calibration split is empty')

  const targetRows: ComparisonNutrientRow[] = []
  const genreRows = new Map<EstimatorGenreId, Array<{ nutrientKey: EstimatableNutrientKey; mode: FitMode; observations: InternalObservation[] }>>()
  for (const genre of ESTIMATOR_GENRES) genreRows.set(genre, [])

  for (const nutrientKey of ESTIMATABLE_NUTRIENT_KEYS) {
    const prepared = acceptedTargets(calibrationRecords, manifestById, nutrientKey)
    const support = supportSummary(prepared.accepted, prepared.observedCount, prepared.exclusions, calibrationRecords.length)
    const observationsByMode: Record<FitMode, InternalObservation[]> = { legacy_point: [], robust_interval: [] }
    const genreObservations: Record<FitMode, Map<EstimatorGenreId, InternalObservation[]>> = {
      legacy_point: new Map(ESTIMATOR_GENRES.map((genre) => [genre, []])),
      robust_interval: new Map(ESTIMATOR_GENRES.map((genre) => [genre, []])),
    }
    for (const target of prepared.accepted) {
      for (const mode of MODES) {
        const observation = observationFor(target, nutrientKey, mode)
        observationsByMode[mode].push(observation)
        genreObservations[mode].get(target.record.genreId)?.push(observation)
      }
    }
    for (const genre of ESTIMATOR_GENRES) {
      for (const mode of MODES) {
        genreRows.get(genre)!.push({ nutrientKey, mode, observations: genreObservations[mode].get(genre) ?? [] })
      }
    }
    const modes = {
      legacy_point: metricForReport(modeMetric(observationsByMode.legacy_point)),
      robust_interval: metricForReport(modeMetric(observationsByMode.robust_interval)),
    }
    const paired = pairedSummary(observationsByMode.legacy_point, observationsByMode.robust_interval)
    const shortfalls = shortfallReasons(support)
    const robustEligible = shortfalls.length === 0 && paired.nonRegression === true
    targetRows.push({
      nutrientKey,
      support,
      evaluationFloor: {
        independentFamilyCount: EVALUATION_FLOOR.minimumIndependentFamilies,
        makerCount: EVALUATION_FLOOR.minimumMakers,
        maximumMakerShare: EVALUATION_FLOOR.maximumMakerShare,
        meets: shortfalls.length === 0,
        shortfalls,
      },
      modes,
      paired,
      recommendation: robustEligible ? 'robust_interval' : 'legacy_point',
    })
  }

  const genreBreakdown: ComparisonGenreRow[] = ESTIMATOR_GENRES.map((genreId) => {
    const rows = genreRows.get(genreId) ?? []
    const nutrients = ESTIMATABLE_NUTRIENT_KEYS.map((nutrientKey) => {
      const targetRows = rows.filter((row) => row.nutrientKey === nutrientKey)
      const modes = Object.fromEntries(MODES.map((mode) => {
        const observations = targetRows.flatMap((row) => row.mode === mode ? row.observations : [])
        return [mode, metricForReport(groupModeMetric(observations))]
      })) as Record<FitMode, ModeMetric>
      return {
        nutrientKey,
        referenceCount: targetRows.reduce((total, row) => total + (row.mode === 'legacy_point' ? row.observations.length : 0), 0),
        modes,
      }
    })
    return {
      genreId,
      targetReferenceCount: nutrients.reduce((total, item) => total + item.referenceCount, 0),
      nutrients,
    }
  })
  const robustEligibleNutrientCount = targetRows.filter((row) => row.recommendation === 'robust_interval').length
  const defaultFitModeRecommendation = recommendDefaultFitMode(targetRows)

  const hash = (key: string): string => {
    const value = sourceHashes[key]
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
      throw new Error('Python integrity audit did not return a valid source hash.')
    }
    return value
  }
  return {
    format: 'nutrient-estimator-fit-comparison',
    formatVersion: 1,
    scope: 'calibration_split_only',
    calibrationRecordCount: calibrationRecords.length,
    sourceHashes: {
      sourceFileSha256: hash('sourceFileSha256'),
      normalizedDatasetSha256: hash('normalizedDatasetSha256'),
      manifestFileSha256: hash('manifestFileSha256'),
    },
    splitLeakageCheck: 'passed',
    fitModes: MODES,
    estimatorModelVersion: NUTRIENT_ESTIMATOR_MODEL_VERSION,
    intervalRuleVersion: NUTRIENT_LABEL_TOLERANCE_RULE_VERSION,
    evaluationFloor: EVALUATION_FLOOR,
    protocol: {
      targetRequestsAreIndividual: true,
      matchedRequestIdAndTimestamp: true,
      deterministicSeedInputsMatched: true,
      ratioStrategyOverride: null,
      modeSpecificScenarioBudget: false,
    },
    definitions: {
      observedCount: 'calibration records with a label object for this target, including estimated and invalid labels',
      acceptedCount: 'fixed labels and valid declared ranges used for paired evaluation',
      availabilityRate: 'available estimates divided by accepted fixed/range target references',
      independentFamilyCount: 'distinct manifest groupKey among accepted target labels',
      makerCount: 'distinct normalized maker names among accepted independent families; maker names are not emitted',
      maximumMakerShare: 'maximum number of accepted independent families from one maker divided by all accepted independent families',
      fixedPointMaeAndBias: 'computed only for fixed printed target values, compared directly to the printed value; ranges are never replaced by their midpoint as truth',
      intervalOutsideMae: 'mean distance of the point prediction outside the CAA interval or declared target range',
      intervalOverlapRate: 'fraction whose predicted interval overlaps the reference interval; not empirical coverage',
      per100g: 'point values, errors, ranges, and widths are multiplied by 100 / referenceMassG',
      knownRangeRepresentative: 'a major nutrient declared-range midpoint is passed as the legacy point representative; robust fit loss uses its verified typed interval, and target accuracy never treats a declared-range midpoint as truth',
      pairedNonRegression: 'true only when robust paired fixed-point MAE and intervalOutsideMAE are both no worse than legacy on commonly available cases; unavailable comparisons are not treated as wins',
      familyIndependenceLimitation: 'manifest groupKey is normalized maker plus productFamily and does not prove that grouped product variants are independently formulated samples',
      sourceReferenceHandling: 'manufacturer source references are passed to the estimator as private verification provenance and are never included in this report',
    },
    nutrients: targetRows,
    robustEligibleNutrientCount,
    defaultFitModeRecommendation,
    defaultRecommendationRationale: defaultFitModeRecommendation === 'robust_interval'
      ? 'Every target nutrient met the independent-support floor and paired non-regression criteria.'
      : 'robust_interval remains an explicit opt-in because at least one target nutrient misses the independent-support floor or paired non-regression criteria.',
    genreBreakdown,
  }
}

export function buildRatioStrategyComparison(datasetValue: unknown, manifestValue: unknown, sourceHashes: Record<string, unknown>) {
  assertManifest(manifestValue)
  assertApprovedPriorDataset(manifestValue)
  assertDataset(datasetValue)
  const manifestById = assertManifestBijection(datasetValue, manifestValue)
  const calibration = datasetValue.records.filter((record) => manifestById.get(record.recordId)?.split === 'calibration')
  if (!calibration.length) throw new Error('calibration split is empty')
  const baseline = { feedbackWeight: 0, postBlendWeight: .75 }
  const targets = ESTIMATABLE_NUTRIENT_KEYS.map((nutrientKey) => {
    const prepared = acceptedTargets(calibration, manifestById, nutrientKey)
    return { nutrientKey, prepared, support: supportSummary(prepared.accepted, prepared.observedCount, prepared.exclusions, calibration.length),
      baseline: prepared.accepted.map((target) => observationFor(target, nutrientKey, 'legacy_point', baseline)) }
  })
  const candidates = [0, .02, .05, .1, .2, .4].flatMap((feedbackWeight) => [0, .25, .5, .75].map((postBlendWeight) => ({ feedbackWeight, postBlendWeight }))).map((strategy) => {
    const nutrients = targets.map(({ nutrientKey, prepared, support, baseline: before }) => {
      const after = strategy.feedbackWeight === 0 && strategy.postBlendWeight === .75 ? before : prepared.accepted.map((target) => observationFor(target, nutrientKey, 'legacy_point', strategy))
      const paired = pairedSummary(before, after)
      const metric = metricForReport(modeMetric(after))
      const byGenre = ESTIMATOR_GENRES.map((genreId) => {
        const indices = prepared.accepted.flatMap((target, i) => target.record.genreId === genreId ? [i] : [])
        return { genreId, metric: metricForReport(modeMetric(indices.map((i) => after[i]))), paired: pairedSummary(indices.map((i) => before[i]), indices.map((i) => after[i])) }
      })
      return { nutrientKey, support, metric, paired, shortfalls: shortfallReasons(support), byGenre: byGenre.filter((row) => row.metric.referenceCount > 0) }
    })
    const sat = nutrients.find((row) => row.nutrientKey === 'saturatedFatG')!
    return { strategy, nutrients, eligible: sat.shortfalls.length === 0 && nutrients.every((row) => row.paired.nonRegression === true && row.metric.availableCount >= targets.find((t) => t.nutrientKey === row.nutrientKey)!.baseline.filter((o) => o.available).length) }
  })
  return { format: 'nutrient-estimator-ratio-strategy-comparison', formatVersion: 1, scope: 'calibration_split_only', calibrationRecordCount: calibration.length,
    estimatorModelVersion: NUTRIENT_ESTIMATOR_MODEL_VERSION, sourceHashes, baseline, selected: baseline, candidates,
    decision: 'Keep the existing strategy. No eligible candidate establishes independent-family support and per-nutrient non-regression; partial/genre values are reported separately and cannot establish full-estimate accuracy.',
    protocol: { individualTargetRequests: true, nonEstimatedConfirmedInputsOnly: true, targetLabelExcluded: true, sealedDataRead: false, evaluationFloor: EVALUATION_FLOOR, aggregateAverageUsedForSelection: false },
  }
}
