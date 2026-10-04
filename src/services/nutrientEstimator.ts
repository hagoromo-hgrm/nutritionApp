import {
  parseIngredientDeclaration,
  type ParsedIngredient,
  type ParsedIngredientDeclaration,
} from './ingredientParser'
import {
  resolveIngredientCandidates,
  sourceFoodIdsForNutrient,
  type IngredientProfile,
} from './nutrientEstimatorProfiles'
import { calibratedEstimateRange } from './nutrientEstimatorCalibration'
import { canonicalizeConfirmedNutrientInputs } from './confirmedNutrientInputs'
import {
  prepareExplicitCompositionEvidence,
  validateExplicitEstimationEvidence,
  type PreparedExplicitCompositionEvidence,
} from './explicitCompositionEvidence'
import {
  REVIEWED_COMPOSITION_STATE_REGISTRY_VERSION,
  reviewedCompositionDeclaredNameMatches,
  reviewedCompositionProfile,
} from './reviewedCompositionStates'
import { ESTIMATOR_GENRE_PRIOR_VERSION } from '../data/nutrientEstimatorGenrePriors'
import {
  normalizedIntervalHuberLoss,
  nutrientLabelReferenceInterval,
  nutrientReferenceNormalizationScale,
  type NutrientLabelInterval,
} from './nutrientLabelInterval'
import {
  ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE,
  genreNutrientPrior,
  saturatedFatRatioPrior,
  type GenreNutrientPrior,
  type SaturatedFatRatioPrior,
} from '../data/nutrientEstimatorGenreNutrientPriors'
import {
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  type EstimationResult,
  type EstimationAdoptionClass,
  type EstimationCalibrationMetadata,
  type EstimationLimitationReason,
  type EstimationOptimization,
  type EstimationRatioAdjustment,
  type EstimationRatioFeedback,
  type EstimationFitReferenceInterval,
  type EstimationTrace,
  type EstimationZeroEvidence,
  type KnownNutrientReference,
  type KnownNutrientReferenceMap,
  type EstimatorGenreId,
  type EstimatorGenreSource,
  type ExplicitEstimationEvidence,
  type ExplicitCompositionDeferredReason,
  type ExplicitCompositionEvidenceTrace,
  type ExplicitCompositionGroup,
  type ExplicitCompositionTraceGroup,
  type FoodUnit,
  type FoodUnitConversion,
  type IngredientsSource,
  type NutrientEvidenceMap,
  type NutrientEstimateFitMode,
  type NutrientReferenceBasis,
  type NutrientKey,
  type Nutrients,
} from '../types'
export type { KnownNutrientReference, NutrientEstimateFitMode } from '../types'

export const ESTIMATABLE_NUTRIENT_KEYS = [
  'saturatedFatG',
  'fiberG',
  'calciumMg',
  'ironMg',
  'vitaminAMcg',
  'vitaminEMg',
  'vitaminB1Mg',
  'vitaminB2Mg',
  'vitaminCMg',
] as const satisfies readonly NutrientKey[]

export type EstimatableNutrientKey = (typeof ESTIMATABLE_NUTRIENT_KEYS)[number]

export function requestedEstimatableNutrientKeys(
  requestedNutrients: readonly EstimatableNutrientKey[] | undefined,
): EstimatableNutrientKey[] {
  const requested = new Set(requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS)
  return ESTIMATABLE_NUTRIENT_KEYS.filter((key) => requested.has(key))
}

export const ESTIMATE_FIT_NUTRIENT_KEYS = NUTRIENT_KEYS
export type EstimateFitNutrientKey = NutrientKey
const LEGACY_SEED_NUTRIENT_KEYS = [
  'energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'saltG',
] as const satisfies readonly NutrientKey[]
export type EstimateConfidence = 'high' | 'medium' | 'low' | 'unavailable'
export type EstimateAdoptability = EstimationAdoptionClass | 'unavailable'
export const NUTRIENT_ESTIMATOR_MODEL_VERSION = 'browser-rule-0.27.0' as const
const MEXT_SOURCE = '文部科学省 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）' as const
const FDC_SOURCE = 'USDA FoodData Central SR Legacy 04/2018' as const
const INGREDIENT_SPEC_SOURCE = '原料メーカー・業界団体公式仕様' as const

export interface NutrientEstimateBasis {
  baseAmount: number
  baseUnit: string
}

export interface NutrientEstimateRequest {
  requestId: string
  productName?: string | null
  estimatorCategoryId?: string | null
  estimatorGenreId?: EstimatorGenreId | null
  estimatorGenreSource?: EstimatorGenreSource | null
  baseAmount: number
  baseUnit: string
  inputUnitConversions?: FoodUnitConversion[]
  referenceMassG: number | null
  referenceMassSource: string | null
  ingredientsText: string | null
  ingredientsSource: IngredientsSource | null
  estimationEvidence?: ExplicitEstimationEvidence
  knownNutrients?: Partial<Nutrients>
  knownNutrientEvidence?: NutrientEvidenceMap
  fitMode?: NutrientEstimateFitMode
  knownNutrientReferences?: KnownNutrientReferenceMap
  knownNutrientReferenceBasis?: NutrientReferenceBasis | null
  requestedNutrients?: readonly EstimatableNutrientKey[]
  requestedAt: string
}

interface EstimateDetails {
  method:
    | 'browser_ingredient_rule'
    | 'browser_ingredient_macro_fit'
    | 'browser_explicit_composition_rule'
    | 'browser_ingredient_partial_rule'
    | 'browser_genre_prior_partial_rule'
  source: string
  sourceFoodIds: string[]
  warnings: string[]
  limitationReasons: EstimationLimitationReason[]
}

export interface AvailableNutrientEstimate extends EstimateDetails {
  status: 'available'
  value: number
  range: {
    min: number
    max: number
  }
  confidence: Exclude<EstimateConfidence, 'unavailable'>
  calibration: EstimationCalibrationMetadata
  zeroEvidence?: EstimationZeroEvidence
  adoptionClass: EstimationAdoptionClass
  ratioAdjustment?: EstimationRatioAdjustment
}

export interface UnavailableNutrientEstimate extends EstimateDetails {
  status: 'unavailable'
  value: null
  range: null
  confidence: 'unavailable'
  reason: string
  nextAction: string
}

export type NutrientEstimate = AvailableNutrientEstimate | UnavailableNutrientEstimate

export const ESTIMATION_LIMITATION_LABELS: Record<EstimationLimitationReason, string> = {
  invalid_basis: '基準量・単位不正',
  reference_mass_missing: '基準重量不明',
  reference_mass_source_missing: '重量根拠不明',
  ingredients_missing: '原材料表示なし',
  ingredients_unverified: '原材料取得元未確認',
  ingredient_parse_failed: '原材料解析不可',
  ingredient_unresolved: '原材料未解決',
  reference_value_missing: '参照値欠損',
  additive_contribution_unknown: '添加物寄与割合不明',
  not_requested: '今回の対象外',
}

export interface NutrientEstimateResult {
  requestId: string
  status: 'completed' | 'partial' | 'failed'
  basis: NutrientEstimateBasis
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>
  globalWarnings: string[]
  unresolvedIngredients: string[]
  optimization?: EstimationOptimization
  modelVersion: typeof NUTRIENT_ESTIMATOR_MODEL_VERSION
  estimatedAt: string
}

/** 既存値の非上書きを守りつつ、参考値の根拠に応じた確認段階を返す。 */
export function estimateAdoptability(
  currentValue: number | null,
  estimate: NutrientEstimate,
): EstimateAdoptability {
  return currentValue === null && estimate.status === 'available'
    ? estimate.adoptionClass
    : 'unavailable'
}

const FALLBACK_METHOD: EstimateDetails['method'] = 'browser_ingredient_rule'
const FIT_METHOD: EstimateDetails['method'] = 'browser_ingredient_macro_fit'
export const EXPLICIT_COMPOSITION_METHOD: EstimateDetails['method'] = 'browser_explicit_composition_rule'
export const PARTIAL_METHOD: EstimateDetails['method'] = 'browser_ingredient_partial_rule'
export const GENRE_PRIOR_PARTIAL_METHOD: EstimateDetails['method'] = 'browser_genre_prior_partial_rule'
const SOURCE = MEXT_SOURCE
const MODEL_VERSION = NUTRIENT_ESTIMATOR_MODEL_VERSION
const MAX_PROFILE_COMBINATIONS = 64
const MAX_COMPOUND_CANDIDATES = 24
const RATIO_FIT_SEED_MODEL_VERSION = 'browser-rule-0.12.0'
const CANDIDATE_SCENARIO_SCORE_TOLERANCE = 4
const CANDIDATE_SCENARIO_TEMPERATURE = 2

function estimateSource(sourceFoodIds: readonly string[]): string {
  const sources = [
    ...(sourceFoodIds.some((id) => !id.startsWith('fdc:') && !id.startsWith('spec:'))
      ? [MEXT_SOURCE]
      : []),
    ...(sourceFoodIds.some((id) => id.startsWith('fdc:')) ? [FDC_SOURCE] : []),
    ...(sourceFoodIds.some((id) => id.startsWith('spec:')) ? [INGREDIENT_SPEC_SOURCE] : []),
  ]
  return sources.length > 0 ? sources.join(' / ') : MEXT_SOURCE
}

const UNMODELED_ADDITIVE_NUTRIENT_TERMS: Partial<Record<EstimatableNutrientKey, readonly string[]>> = {
  fiberG: ['セルロース', 'グルコマンナン', 'ペクチン', '増粘多糖類', '難消化性デキストリン'],
  calciumMg: ['炭酸ca', '乳酸ca', 'クエン酸ca', 'リン酸ca', '焼成ca', '卵殻ca', '貝ca', 'カルシウム'],
  ironMg: ['鉄', 'fe'],
  vitaminAMcg: ['v.a', 'ビタミンa', 'レチノール', 'カロテン'],
  vitaminEMg: ['v.e', 'ビタミンe', 'トコフェロール'],
  vitaminB1Mg: ['v.b1', 'ビタミンb1', 'チアミン'],
  vitaminB2Mg: ['v.b2', 'ビタミンb2', 'リボフラビン'],
  vitaminCMg: ['v.c', 'ビタミンc', 'アスコルビン'],
}

export interface CandidateCombination {
  profiles: IngredientProfile[]
  priorProbability: number
}

interface SaturatedFatRatioFitContext {
  parentValue: number
  feedbackWeight: number
  prior: SaturatedFatRatioPrior
}

export interface CandidateSelectionContext {
  referenceMassG: number
  knownNutrients: NutrientEstimateRequest['knownNutrients']
  fitMode?: NutrientEstimateFitMode
  knownNutrientReferences?: NutrientEstimateRequest['knownNutrientReferences']
  knownNutrientReferenceBasis?: NutrientEstimateRequest['knownNutrientReferenceBasis']
  requestedNutrients?: NutrientEstimateRequest['requestedNutrients']
  ratioFeedback?: SaturatedFatRatioFitContext
}

interface ResolvedIngredient {
  ingredient: ParsedIngredient
  candidates: IngredientProfile[]
}

interface MacroFit {
  profiles: IngredientProfile[]
  ratios: number[]
  priorProbability: number
  normalizedError: number | null
  fitObjective: number
  ratioFeedbackPenalty: number | null
  usedRatioFeedbackFit: boolean
  usedMacroFit: boolean
  score: number
}

interface CandidateScenarioRange {
  range: { min: number; max: number }
  plausibleScenarioCount: number
}

interface FitObservation {
  interval: { min: number; max: number; minInclusive?: boolean; maxInclusive?: boolean }
  labelInterval?: NutrientLabelInterval
  normalizationValue: number
}

function hasReferenceSource(reference: KnownNutrientReference): boolean {
  return (typeof reference.sourceReference === 'string' && reference.sourceReference.trim().length > 0)
    || (typeof reference.provider === 'string' && reference.provider.trim().length > 0)
}

function validateKnownNutrientReferences(request: NutrientEstimateRequest): void {
  if (request.fitMode !== undefined && request.fitMode !== 'legacy_point' && request.fitMode !== 'robust_interval') {
    throw new Error('栄養表示フィット方式を確認してください。')
  }
  const references = request.knownNutrientReferences
  if (!references) return
  if (typeof references !== 'object' || Array.isArray(references)) {
    throw new Error('栄養表示参照の一覧を確認してください。')
  }
  const expectedBasis = request.knownNutrientReferenceBasis
  if (expectedBasis !== undefined && expectedBasis !== null) {
    if (
      !Number.isFinite(expectedBasis.amount)
      || expectedBasis.amount <= 0
      || (expectedBasis.unit !== 'g' && expectedBasis.unit !== 'ml')
    ) {
      throw new Error('栄養表示フィットの要求基準量は0より大きいgまたはmlで指定してください。')
    }
    if (expectedBasis.unit === 'g' && expectedBasis.amount !== request.referenceMassG) {
      throw new Error('栄養表示のg基準量は明示された内容物重量と一致させてください。')
    }
    if (expectedBasis.unit === 'ml' && (request.baseUnit !== 'ml' || expectedBasis.amount !== request.baseAmount)) {
      throw new Error('栄養表示のml基準量は要求のml基準量と一致させてください。')
    }
  }

  for (const [rawKey, rawReference] of Object.entries(references)) {
    if (!ESTIMATE_FIT_NUTRIENT_KEYS.includes(rawKey as EstimateFitNutrientKey)) {
      throw new Error(`栄養表示フィットで扱えない栄養素です: ${rawKey}`)
    }
    if (
      !rawReference
      || rawReference.verified !== true
      || (rawReference.origin !== 'user_input' && rawReference.origin !== 'manufacturer_label')
      || !hasReferenceSource(rawReference)
      || typeof rawReference.reference !== 'object'
      || rawReference.reference === null
    ) {
      throw new Error(`${rawKey}の表示参照は確認済みで出典を持つ場合だけ使用できます。`)
    }
    const evidence = request.knownNutrientEvidence?.[rawKey as NutrientKey]
    if (!evidence || evidence.origin !== rawReference.origin || evidence.verified !== true) {
      throw new Error(`${rawKey}の表示参照には一致する確認済み栄養値の根拠が必要です。`)
    }
    const basis = rawReference.basis
    if (
      !basis
      || !expectedBasis
      || basis.amount !== expectedBasis.amount
      || basis.unit !== expectedBasis.unit
    ) throw new Error(`${rawKey}の表示基準量は明示し、要求基準量と一致させてください。`)
    if (expectedBasis.unit === 'g' && expectedBasis.amount !== request.referenceMassG) {
      throw new Error(`${rawKey}のg表示基準量は内容物重量と一致させてください。`)
    }
    if (expectedBasis.unit === 'ml' && (request.baseUnit !== 'ml' || expectedBasis.amount !== request.baseAmount)) {
      throw new Error(`${rawKey}のml表示基準量は要求のml基準量と一致させてください。`)
    }
    nutrientLabelReferenceInterval(rawKey as EstimateFitNutrientKey, rawReference.reference, basis)
  }
}

function fitTargetExcluded(context: CandidateSelectionContext, key: EstimateFitNutrientKey): boolean {
  const targets = context.requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS
  return targets.includes(key as EstimatableNutrientKey)
}

function fitObservationForKey(
  key: EstimateFitNutrientKey,
  context: CandidateSelectionContext,
): FitObservation | null {
  if (fitTargetExcluded(context, key)) return null
  if (context.fitMode === 'robust_interval') {
    const typedReference = context.knownNutrientReferences?.[key]
    if (typedReference) {
      if (typedReference.verified !== true || !hasReferenceSource(typedReference)) {
        throw new Error(`${key}の表示参照は確認済みで出典を持つ場合だけ使用できます。`)
      }
      const interval = nutrientLabelReferenceInterval(key, typedReference.reference, typedReference.basis)
      if (typedReference.basis) {
        const expectedBasis = context.knownNutrientReferenceBasis
        if (!expectedBasis || typedReference.basis.amount !== expectedBasis.amount || typedReference.basis.unit !== expectedBasis.unit) {
          throw new Error(`${key}の表示基準量は要求基準量と一致させてください。`)
        }
        if (expectedBasis.unit === 'g' && expectedBasis.amount !== context.referenceMassG) {
          throw new Error('栄養表示のg基準量は明示された内容物重量と一致させてください。')
        }
      }
      const normalizationValue = typedReference.reference.kind === 'fixed'
        ? typedReference.reference.value!
        : typedReference.reference.max!
      return { interval, labelInterval: interval, normalizationValue }
    }
  }

  const value = context.knownNutrients?.[key]
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  return {
    interval: { min: value, max: value, minInclusive: true, maxInclusive: true },
    normalizationValue: value,
  }
}

function fitObservationScale(key: EstimateFitNutrientKey, observation: FitObservation): number {
  return nutrientReferenceNormalizationScale(key, observation.normalizationValue)
}

function knownNutrientsForEstimatePostprocessing(
  request: NutrientEstimateRequest,
): NutrientEstimateRequest['knownNutrients'] {
  const knownNutrients = { ...request.knownNutrients }
  const requested = new Set(request.requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS)
  for (const key of ESTIMATE_FIT_NUTRIENT_KEYS) {
    if (requested.has(key as EstimatableNutrientKey)) {
      knownNutrients[key] = null
      continue
    }
    const reference = request.knownNutrientReferences?.[key]
    if (
      reference?.verified === true
      && hasReferenceSource(reference)
      && knownNutrients[key] === 0
    ) {
      try {
        if (typeof reference.reference !== 'object' || reference.reference === null) continue
        const zeroFixedReference = reference.reference.kind === 'fixed' && reference.reference.value === 0
        const positiveRangeReference = reference.reference.kind === 'declared_range'
          && reference.reference.max !== undefined
          && reference.reference.max > 0
        if (!zeroFixedReference && !positiveRangeReference) continue
        if (reference.basis) {
          const expectedBasis = request.knownNutrientReferenceBasis
          const basisMatchesRequest = expectedBasis !== undefined
            && expectedBasis !== null
            && reference.basis.amount === expectedBasis.amount
            && reference.basis.unit === expectedBasis.unit
            && (expectedBasis.unit === 'g'
              ? expectedBasis.amount === request.referenceMassG
              : request.baseUnit === 'ml' && expectedBasis.amount === request.baseAmount)
          if (!basisMatchesRequest) continue
        }
        const interval = nutrientLabelReferenceInterval(key, reference.reference, reference.basis)
        if (interval.max > 0) knownNutrients[key] = null
      } catch {
        // Legacy point calls ignore malformed optional reference metadata for post-processing.
      }
    }
  }
  return knownNutrients
}

function saturatedFatRatioFitContext(
  knownNutrients: NutrientEstimateRequest['knownNutrients'],
  genreId: EstimatorGenreId | null | undefined,
  feedbackWeight: number,
): SaturatedFatRatioFitContext | null {
  const parentValue = knownNutrients?.fatG
  if (
    !Number.isFinite(feedbackWeight)
    || feedbackWeight <= 0
    || parentValue === null
    || parentValue === undefined
    || !Number.isFinite(parentValue)
    || parentValue <= 0
  ) return null
  const prior = saturatedFatRatioPrior(genreId)
  return prior ? { parentValue, feedbackWeight, prior } : null
}

function saturatedFatRatioIntervalPenalty(
  predictedMin: number,
  predictedMax: number,
  prior: SaturatedFatRatioPrior,
  parentValue: number,
): number {
  const standardizedDistance = predictedMax < prior.p05
    ? (prior.p05 - predictedMax) / Math.max(0.05, prior.median - prior.p05)
    : predictedMin > prior.p95
      ? (predictedMin - prior.p95) / Math.max(0.05, prior.p95 - prior.median)
      : 0
  const cappedDistance = Math.min(4, standardizedDistance)
  const robustPenalty = cappedDistance <= 1
    ? 0.5 * cappedDistance * cappedDistance
    : cappedDistance - 0.5
  // 脂質が表示丸め幅に近い商品では比率が不安定になるため、フィードバックを連続的に弱める。
  return robustPenalty * parentValue / (parentValue + 0.05)
}

function estimationRatioFeedback(
  context: SaturatedFatRatioFitContext,
  fit: MacroFit,
  referenceMassG: number,
): EstimationRatioFeedback | null {
  if (
    fit.ratioFeedbackPenalty === null
    || fit.profiles.some((profile) => profile.nutrients.saturatedFatG === null)
  ) return null
  const saturatedFat = fit.profiles.reduce((sum, profile, index) => (
    sum + profile.nutrients.saturatedFatG! * fit.ratios[index]
  ), 0) * referenceMassG / 100
  return {
    ratioKey: 'saturatedFatToFat',
    parentNutrient: 'fatG',
    parentValue: context.parentValue,
    feedbackWeight: context.feedbackWeight,
    p05: context.prior.p05,
    median: context.prior.median,
    p95: context.prior.p95,
    sampleSize: context.prior.sampleSize,
    ...(context.prior.pooledSampleSize === undefined
      ? {}
      : { pooledSampleSize: context.prior.pooledSampleSize }),
    scope: context.prior.scope,
    priorVersion: context.prior.priorVersion,
    datasetHash: context.prior.datasetHash,
    predictedRatio: round(saturatedFat / context.parentValue),
    penalty: round(fit.ratioFeedbackPenalty),
    optimizedIngredientRatios: fit.usedRatioFeedbackFit,
  }
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
}

const COMPOSITION_PARENT_NUTRIENTS: Partial<Record<EstimatableNutrientKey, EstimateFitNutrientKey>> = {
  saturatedFatG: 'fatG',
  fiberG: 'carbohydrateG',
}

/**
 * 同じ表示基準の総量が入力済みなら、内訳の点推計と範囲を総量以下に保つ。
 * 公表値の丸めを逆算せず、利用者が確認した値を保存候補の上限として優先する。
 */
function applyCompositionUpperBounds(
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>,
  knownNutrients: NutrientEstimateRequest['knownNutrients'],
): Record<EstimatableNutrientKey, NutrientEstimate> {
  return mapEstimatableNutrients((key) => {
    const estimate = estimates[key]
    if (estimate.status !== 'available') return estimate
    const parentKey = COMPOSITION_PARENT_NUTRIENTS[key]
    if (!parentKey) return estimate
    const upperBound = knownNutrients?.[parentKey]
    if (upperBound === null || upperBound === undefined || !Number.isFinite(upperBound) || upperBound < 0) {
      return estimate
    }

    const value = Math.min(upperBound, round(Math.min(estimate.value, upperBound)))
    const range = {
      min: Math.min(upperBound, round(Math.min(estimate.range.min, upperBound))),
      max: Math.min(upperBound, round(Math.min(estimate.range.max, upperBound))),
    }
    if (value === estimate.value && range.min === estimate.range.min && range.max === estimate.range.max) {
      return estimate
    }
    return {
      ...estimate,
      value,
      range,
      ...(upperBound === 0 && value === 0 ? { zeroEvidence: 'known_parent_zero' as const } : {}),
      warnings: [...new Set([
        ...estimate.warnings,
        `${NUTRIENT_LABELS[key]}は${NUTRIENT_LABELS[parentKey]}の内訳であるため、入力済みの${NUTRIENT_LABELS[parentKey]}（${round(upperBound)}g）を上限として推計値と推定範囲を補正しました。`,
      ])],
    }
  })
}

function priorCalibration(
  prior: GenreNutrientPrior | SaturatedFatRatioPrior,
): EstimationCalibrationMetadata {
  return {
    calibrationVersion: prior.priorVersion,
    targetCoverage: 0.9,
    sampleSize: prior.scope === 'pooled_nutrient'
      ? prior.pooledSampleSize ?? prior.sampleSize
      : prior.sampleSize,
    datasetHash: prior.datasetHash,
    scope: prior.scope,
  }
}

export interface NutrientEstimatorRatioStrategy {
  feedbackWeight: number
  postBlendWeight: number
}

// 評価スクリプトは校正区分だけでこの組合せが候補中の最良であることを検証する。
export const SATURATED_FAT_RATIO_FEEDBACK_WEIGHT = 0
export const SATURATED_FAT_RATIO_BLEND_WEIGHT = 0.75
export const DEFAULT_NUTRIENT_ESTIMATOR_RATIO_STRATEGY: NutrientEstimatorRatioStrategy = {
  feedbackWeight: SATURATED_FAT_RATIO_FEEDBACK_WEIGHT,
  postBlendWeight: SATURATED_FAT_RATIO_BLEND_WEIGHT,
}

function validatedRatioStrategy(
  strategy: NutrientEstimatorRatioStrategy | undefined,
): NutrientEstimatorRatioStrategy {
  const value = strategy ?? DEFAULT_NUTRIENT_ESTIMATOR_RATIO_STRATEGY
  if (
    !Number.isFinite(value.feedbackWeight)
    || value.feedbackWeight < 0
    || !Number.isFinite(value.postBlendWeight)
    || value.postBlendWeight < 0
    || value.postBlendWeight > 1
  ) {
    throw new RangeError('比率フィードバックは0以上、後段混合重みは0〜1で指定してください。')
  }
  return value
}

function applySaturatedFatRatioPrior(
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>,
  knownNutrients: NutrientEstimateRequest['knownNutrients'],
  genreId: EstimatorGenreId | null | undefined,
  blendWeight: number,
): Record<EstimatableNutrientKey, NutrientEstimate> {
  const estimate = estimates.saturatedFatG
  const fatG = knownNutrients?.fatG
  if (
    estimate.status !== 'available'
    || fatG === null
    || fatG === undefined
    || !Number.isFinite(fatG)
    || fatG <= 0
    || !Number.isFinite(blendWeight)
    || blendWeight <= 0
  ) return estimates
  const prior = saturatedFatRatioPrior(genreId)
  if (!prior) return estimates

  const boundedIngredientValue = Math.min(estimate.value, fatG)
  const ratioPoint = fatG * prior.median
  const value = round(
    boundedIngredientValue * (1 - blendWeight)
    + ratioPoint * blendWeight,
  )
  const range = {
    min: round(Math.min(value, Math.min(estimate.range.min, fatG), fatG * prior.p05)),
    max: round(Math.max(value, Math.min(estimate.range.max, fatG), fatG * prior.p95)),
  }
  const ratioAdjustment: EstimationRatioAdjustment = {
    ratioKey: 'saturatedFatToFat',
    parentNutrient: 'fatG',
    parentValue: fatG,
    blendWeight,
    p05: prior.p05,
    median: prior.median,
    p95: prior.p95,
    sampleSize: prior.sampleSize,
    ...(prior.pooledSampleSize === undefined
      ? {}
      : { pooledSampleSize: prior.pooledSampleSize }),
    scope: prior.scope,
    priorVersion: prior.priorVersion,
    datasetHash: prior.datasetHash,
    unadjustedValue: estimate.value,
    unadjustedRange: { ...estimate.range },
  }
  const percent = (ratio: number) => Math.round(ratio * 1_000) / 10
  return {
    ...estimates,
    saturatedFatG: {
      ...estimate,
      value,
      range,
      calibration: priorCalibration(prior),
      ratioAdjustment,
      ...(value === 0 ? { zeroEvidence: 'uncertain' as const } : { zeroEvidence: undefined }),
      source: [...new Set([
        ...estimate.source.split(' / '),
        `${ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE}（飽和脂肪酸／脂質比率）`,
      ])].join(' / '),
      warnings: [...new Set([
        ...estimate.warnings,
        `入力済み脂質とtrain標本${prior.pooledSampleSize ?? prior.sampleSize}件の飽和脂肪酸／脂質比率を使い、比率中央値を${percent(blendWeight)}%、原材料推計を${percent(1 - blendWeight)}%の重みで統合しました。`,
        `比率分布の5〜95%点（${percent(prior.p05)}〜${percent(prior.p95)}%）を、原材料推計の暫定範囲の外側へ統合しています。`,
        ...(estimate.value > fatG || estimate.range.max > fatG
          ? [`飽和脂肪酸は脂質の内訳であるため、入力済みの脂質（${round(fatG)}g）を上限として原材料推計を比率統合前に補正しました。`]
          : []),
      ])],
    },
  }
}

function applyGenrePriorToUnmodeledMass(input: {
  knownPer100g: number
  unmodeledMassFraction: number
  nutrientKey: EstimatableNutrientKey
  genreId: EstimatorGenreId | null | undefined
  referenceMassG: number
  usePriorMedianAsPoint: boolean
}): {
  value: number
  range: { min: number; max: number }
  calibration: EstimationCalibrationMetadata
  prior: GenreNutrientPrior
} | null {
  if (input.unmodeledMassFraction <= 0) return null
  const prior = genreNutrientPrior(input.genreId, input.nutrientKey)
  if (!prior) return null
  const pointPer100g = input.usePriorMedianAsPoint
    ? input.knownPer100g + prior.median * input.unmodeledMassFraction
    : input.knownPer100g
  const empiricalRange = {
    min: round((input.knownPer100g + prior.p05 * input.unmodeledMassFraction) * input.referenceMassG / 100),
    max: round((input.knownPer100g + prior.p95 * input.unmodeledMassFraction) * input.referenceMassG / 100),
  }
  const value = round(pointPer100g * input.referenceMassG / 100)
  const fallback = calibratedEstimateRange({
    value,
    nutrientKey: input.nutrientKey,
    genreId: input.genreId,
    confidence: 'low',
    zeroEvidence: 'uncertain',
  })
  return {
    value,
    range: {
      min: Math.min(empiricalRange.min, fallback.range.min),
      max: Math.max(empiricalRange.max, fallback.range.max),
    },
    calibration: priorCalibration(prior),
    prior,
  }
}

function genrePriorWarnings(
  prior: GenreNutrientPrior,
  unmodeledMassFraction: number,
  priorMedianUsedAsPoint: boolean,
): string[] {
  const percent = Math.round(unmodeledMassFraction * 1_000) / 10
  return [
    `参照値を直接確認できない重量枠（暫定${percent}%）には、メーカー公式表示のジャンル別5〜95パーセンタイルを適用しています。`,
    prior.scope === 'genre_nutrient'
      ? `ジャンル別標本${prior.sampleSize}件を全体分布へ縮約した低信頼度の事前分布です。`
      : `ジャンル別標本が不足または分類が「その他・不明」のため、栄養素全体の広い分布へ縮約しています。`,
    priorMedianUsedAsPoint
      ? '数値を直接確認できる原材料がないため、表示値にも事前分布の中央値を使用しています。'
      : '表示値は数値を確認できる原材料分だけを維持し、事前分布は未確認部分を含む推定範囲にだけ使用しています。',
    '分離重量や複合原料自体の成分値を確認したものではなく、同ジャンル商品の栄養密度で未確認部分を補った参考値です。',
  ]
}

function unmodeledAdditivesForNutrient(
  additives: readonly ParsedIngredient[],
  nutrientKey: EstimatableNutrientKey,
): string[] {
  const terms = UNMODELED_ADDITIVE_NUTRIENT_TERMS[nutrientKey] ?? []
  return additives
    .filter((additive) => {
      const normalized = additive.normalizedName.normalize('NFKC').toLocaleLowerCase('ja-JP')
      return terms.some((term) => normalized.includes(term))
    })
    .map((additive) => additive.normalizedName)
}

function normalizePriors(candidates: readonly IngredientProfile[]): IngredientProfile[] {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.priorProbability), 0)
  return candidates
    .map((candidate) => ({
      ...candidate,
      priorProbability: total > 0 ? Math.max(0, candidate.priorProbability) / total : 1 / candidates.length,
    }))
    .sort((left, right) => (
      right.priorProbability - left.priorProbability
      || left.profileId.localeCompare(right.profileId)
    ))
}

function compoundRatioTemplates(count: number): Array<{ ratios: number[]; prior: number }> {
  const normalize = (values: number[]) => {
    const total = values.reduce((sum, value) => sum + value, 0)
    return values.map((value) => value / total)
  }
  if (count === 1) return [{ ratios: [1], prior: 1 }]
  return [
    { ratios: normalize(Array.from({ length: count }, (_value, index) => count - index)), prior: 0.4 },
    { ratios: normalize(Array.from({ length: count }, (_value, index) => 0.7 ** index)), prior: 0.25 },
    { ratios: normalize(Array.from({ length: count }, (_value, index) => 0.45 ** index)), prior: 0.2 },
    { ratios: Array.from({ length: count }, () => 1 / count), prior: 0.15 },
  ]
}

function quickCandidateFitError(
  combination: CandidateCombination,
  candidateSets: readonly (readonly IngredientProfile[])[],
  context: CandidateSelectionContext | undefined,
): number | null {
  if (!context || !Number.isFinite(context.referenceMassG) || context.referenceMassG <= 0) return null
  const ratios = fallbackRatios(candidateSets.length)
  const observations = new Map<EstimateFitNutrientKey, FitObservation>()
  for (const key of ESTIMATE_FIT_NUTRIENT_KEYS) {
    const observation = fitObservationForKey(key, context)
    if (observation) observations.set(key, observation)
  }
  const fitKeys = [...observations.keys()]
  const errors = fitKeys.flatMap((key) => {
    let minPer100g = 0
    let maxPer100g = 0
    for (let index = 0; index < candidateSets.length; index += 1) {
      const profiles = index < combination.profiles.length
        ? [combination.profiles[index]]
        : candidateSets[index]
      const values = profiles.flatMap((profile) => {
        const value = profile.nutrients[key]
        return value === null ? [] : [value]
      })
      if (values.length !== profiles.length) return []
      minPer100g += Math.min(...values) * ratios[index]
      maxPer100g += Math.max(...values) * ratios[index]
    }
    const predictedMin = minPer100g * context.referenceMassG / 100
    const predictedMax = maxPer100g * context.referenceMassG / 100
    const observation = observations.get(key)!
    if (context.fitMode === 'robust_interval') {
      return [normalizedIntervalHuberLoss(
        { min: predictedMin, max: predictedMax },
        observation.interval,
        fitObservationScale(key, observation),
      )]
    }
    const observed = context.knownNutrients![key]!
    const distance = observed < predictedMin
      ? predictedMin - observed
      : observed > predictedMax
        ? observed - predictedMax
        : 0
    const roundingWidth = key === 'energyKcal' ? 0.5 : 0.05
    const scale = Math.max(roundingWidth, observed * 0.02)
    return [(distance / scale) ** 2]
  })
  const macroError = errors.length > 0
    ? errors.reduce((sum, error) => sum + error, 0) / errors.length
    : null
  const ratioFeedback = context.ratioFeedback
  let ratioPenalty: number | null = null
  if (ratioFeedback) {
    let minimum = 0
    let maximum = 0
    let complete = true
    for (let index = 0; index < candidateSets.length; index += 1) {
      const profiles = index < combination.profiles.length
        ? [combination.profiles[index]]
        : candidateSets[index]
      const values = profiles.flatMap((profile) => {
        const value = profile.nutrients.saturatedFatG
        return value === null ? [] : [value]
      })
      if (values.length !== profiles.length) {
        complete = false
        break
      }
      minimum += Math.min(...values) * ratios[index] * context.referenceMassG / 100
      maximum += Math.max(...values) * ratios[index] * context.referenceMassG / 100
    }
    if (complete) {
      ratioPenalty = saturatedFatRatioIntervalPenalty(
        minimum / ratioFeedback.parentValue,
        maximum / ratioFeedback.parentValue,
        ratioFeedback.prior,
        ratioFeedback.parentValue,
      )
    }
  }
  if (macroError === null && ratioPenalty === null) return null
  return (macroError ?? 0) + (ratioPenalty ?? 0) * (ratioFeedback?.feedbackWeight ?? 0)
}

function combinationId(combination: CandidateCombination): string {
  return combination.profiles.map((profile) => profile.profileId).join('|')
}

function selectCandidateBeam(
  pool: CandidateCombination[],
  candidateSets: readonly (readonly IngredientProfile[])[],
  limit: number,
  context: CandidateSelectionContext | undefined,
): CandidateCombination[] {
  const byPrior = (left: CandidateCombination, right: CandidateCombination) => (
    right.priorProbability - left.priorProbability
    || combinationId(left).localeCompare(combinationId(right))
  )
  const hasFitEvidence = context !== undefined
    && Number.isFinite(context.referenceMassG)
    && context.referenceMassG > 0
    && ESTIMATE_FIT_NUTRIENT_KEYS.some((key) => fitObservationForKey(key, context) !== null)
  // 栄養表示がない場面では従来の事前確率順を維持し、根拠のない候補順変更を避ける。
  if (pool.length <= limit || !hasFitEvidence) return pool.sort(byPrior).slice(0, limit)
  const scored = pool.map((combination) => {
    const fitError = quickCandidateFitError(combination, candidateSets, context)
    const priorPenalty = -Math.log(Math.max(combination.priorProbability, 1e-12))
    return {
      combination,
      fitError,
      priorPenalty,
      hybridScore: (fitError ?? 0) + priorPenalty * 0.08,
      id: combinationId(combination),
    }
  })
  const selected = new Map<string, CandidateCombination>()
  const select = (item: (typeof scored)[number]) => {
    if (selected.size < limit) selected.set(item.id, item.combination)
  }
  const priorSlots = Math.min(limit, Math.floor(limit / 2))
  for (const item of [...scored]
    .sort((left, right) => left.priorPenalty - right.priorPenalty || left.id.localeCompare(right.id))
    .slice(0, priorSlots)) {
    select(item)
  }
  const fitSlots = Math.min(limit - selected.size, Math.floor(limit * 3 / 8))
  let addedFit = 0
  for (const item of [...scored]
    .filter((candidate) => candidate.fitError !== null)
    .sort((left, right) => (
      left.fitError! - right.fitError!
      || left.priorPenalty - right.priorPenalty
      || left.id.localeCompare(right.id)
    ))) {
    if (selected.has(item.id)) continue
    select(item)
    addedFit += 1
    if (addedFit >= fitSlots) break
  }

  const represented = new Set<string>()
  for (const combination of selected.values()) {
    combination.profiles.forEach((profile, index) => represented.add(`${index}:${profile.profileId}`))
  }
  while (selected.size < limit) {
    const remaining = scored.filter((item) => !selected.has(item.id))
    if (remaining.length === 0) break
    const next = remaining.sort((left, right) => {
      const leftNovelty = left.combination.profiles.filter((profile, index) => !represented.has(`${index}:${profile.profileId}`)).length
      const rightNovelty = right.combination.profiles.filter((profile, index) => !represented.has(`${index}:${profile.profileId}`)).length
      return rightNovelty - leftNovelty
        || left.hybridScore - right.hybridScore
        || left.id.localeCompare(right.id)
    })[0]
    select(next)
    next.combination.profiles.forEach((profile, index) => represented.add(`${index}:${profile.profileId}`))
  }
  return [...selected.values()]
}

export function combineCandidateSets(
  candidateSets: readonly (readonly IngredientProfile[])[],
  limit: number,
  context?: CandidateSelectionContext,
): CandidateCombination[] {
  let combinations: CandidateCombination[] = [{ profiles: [], priorProbability: 1 }]
  for (const candidates of candidateSets) {
    const pool = combinations.flatMap((combination) => candidates.map((candidate) => ({
      profiles: [...combination.profiles, candidate],
      priorProbability: combination.priorProbability * candidate.priorProbability,
    })))
    combinations = selectCandidateBeam(pool, candidateSets, limit, context)
  }
  const total = combinations.reduce((sum, combination) => sum + combination.priorProbability, 0)
  return combinations.map((combination) => ({
    ...combination,
    priorProbability: total > 0 ? combination.priorProbability / total : 1 / combinations.length,
  }))
}

function cartesianCandidateCombinationCount(
  candidateSets: readonly (readonly IngredientProfile[])[],
): number {
  return candidateSets.reduce((count, candidates) => (
    Math.min(Number.MAX_SAFE_INTEGER, count * candidates.length)
  ), 1)
}

function makeCompoundProfile(
  ingredient: ParsedIngredient,
  profiles: readonly IngredientProfile[],
  ratios: readonly number[],
  priorProbability: number,
): IngredientProfile {
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const values = profiles.map((profile) => profile.nutrients[key])
    if (values.some((value) => value === null)) return [key, null]
    return [key, values.reduce<number>((sum, value, index) => sum + value! * ratios[index], 0)]
  })) as Nutrients
  const profileIds = profiles.map((profile) => profile.profileId)
  return {
    profileId: `compound:${ingredient.normalizedName}:${profileIds.join('+')}:${ratios.map((ratio) => ratio.toFixed(3)).join('-')}`,
    canonicalName: ingredient.normalizedName,
    nutrients,
    sourceFoodIds: [...new Set(profiles.flatMap((profile) => profile.sourceFoodIds))],
    nutrientSourceFoodIds: Object.fromEntries(NUTRIENT_KEYS.map((key) => [
      key,
      [...new Set(profiles.flatMap((profile) => sourceFoodIdsForNutrient(profile, key)))],
    ])),
    priorProbability,
    ambiguous: true,
    derivationWarnings: [
      `複合原材料「${ingredient.normalizedName}」の括弧内は、表示順を保った複数の配合候補として推計しています。`,
      ...profiles.flatMap((profile) => profile.derivationWarnings ?? []),
    ],
  }
}

function candidatesForIngredient(
  ingredient: ParsedIngredient,
  productName: string | null | undefined,
  genreId: EstimatorGenreId | null | undefined,
): IngredientProfile[] {
  const direct = resolveIngredientCandidates(ingredient.normalizedName, productName, genreId)
  if (ingredient.components.length === 0) return direct

  const componentCandidates = ingredient.components.map((component) => candidatesForIngredient(component, productName, genreId))
  if (componentCandidates.some((candidates) => candidates.length === 0)) {
    return normalizePriors(direct.map((candidate) => ({
      ...candidate,
      ambiguous: true,
      derivationWarnings: [
        ...(candidate.derivationWarnings ?? []),
        `複合原材料「${ingredient.normalizedName}」の括弧内に未対応原材料があるため、外側の名称だけを参照しました。`,
      ],
    })))
  }

  const componentCombinations = combineCandidateSets(componentCandidates, MAX_COMPOUND_CANDIDATES)
  const compoundCandidates = componentCombinations.flatMap((combination) => (
    compoundRatioTemplates(combination.profiles.length).map((template) => makeCompoundProfile(
      ingredient,
      combination.profiles,
      template.ratios,
      combination.priorProbability * template.prior,
    ))
  ))
  // 外側の名称に直接対応する参照がある場合も候補として残すが、括弧内表示をより強い根拠にする。
  const directCandidates = direct.map((candidate) => ({
    ...candidate,
    priorProbability: candidate.priorProbability * 0.15,
    ambiguous: true,
    derivationWarnings: [
      ...(candidate.derivationWarnings ?? []),
      `複合原材料「${ingredient.normalizedName}」は外側名称による代替候補も比較しました。`,
    ],
  }))
  return normalizePriors([...compoundCandidates, ...directCandidates])
    .slice(0, MAX_COMPOUND_CANDIDATES)
}

export function unresolvedIngredientNames(
  ingredientsText: string,
  productName?: string | null,
  genreId?: EstimatorGenreId | null,
): string[] {
  return parseIngredientDeclaration(ingredientsText).ingredients
    .filter((ingredient) => candidatesForIngredient(ingredient, productName, genreId).length === 0)
    .map((ingredient) => ingredient.normalizedName)
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function createRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * qを順序付き単体へ変換する。どの候補も原材料表示順、非負、合計1を満たす。
 * w[i] = Σ(j=i..n-1) q[j] / (j+1)
 */
function orderedRatiosFromQ(q: readonly number[]): number[] {
  return q.map((_value, index) => q
    .slice(index)
    .reduce((sum, value, offset) => sum + value / (index + offset + 1), 0))
}

function fallbackRatios(count: number): number[] {
  const denominator = count * (count + 1) / 2
  return Array.from({ length: count }, (_value, index) => (count - index) / denominator)
}

function zeroEvidenceFromResolvedCandidates(
  resolved: readonly ResolvedIngredient[],
  nutrientKey: EstimatableNutrientKey,
  hasUnmodeledAdditive: boolean,
): EstimationZeroEvidence {
  if (hasUnmodeledAdditive) return 'uncertain'
  const parentKey = COMPOSITION_PARENT_NUTRIENTS[nutrientKey]
  if (!parentKey) return 'uncertain'
  const allCandidateParentsAreZero = resolved.every((item) => (
    item.candidates.length > 0
    && item.candidates.every((candidate) => candidate.nutrients[parentKey] === 0)
  ))
  return allCandidateParentsAreZero ? 'derived_from_parent_zero' : 'uncertain'
}

function uncertainZeroWarning(value: number, zeroEvidence: EstimationZeroEvidence): string[] {
  return value === 0 && zeroEvidence === 'uncertain'
    ? ['推計値は0ですが、参照食品の0だけでは真の0と断定できないため、推定範囲に栄養素別の絶対幅を持たせています。']
    : []
}

function fitIngredientRatios(
  combination: CandidateCombination,
  referenceMassG: number,
  fitContext: CandidateSelectionContext,
  ratioFeedback: SaturatedFatRatioFitContext | null,
  seedInput: string,
  scenarioCount: number,
): MacroFit {
  const profiles = combination.profiles
  const observations = new Map<EstimateFitNutrientKey, FitObservation>()
  for (const key of ESTIMATE_FIT_NUTRIENT_KEYS) {
    const observation = fitObservationForKey(key, fitContext)
    if (observation && profiles.every((profile) => profile.nutrients[key] !== null)) {
      observations.set(key, observation)
    }
  }
  const fitKeys = [...observations.keys()]
  const predict = (ratios: readonly number[], key: EstimateFitNutrientKey) => (
    profiles.reduce((sum, profile, index) => sum + profile.nutrients[key]! * ratios[index], 0)
    * referenceMassG / 100
  )
  const macroObjectiveForRatios = (ratios: readonly number[]) => {
    if (fitKeys.length === 0) return null
    return fitKeys.reduce((sum, key) => {
      const observation = observations.get(key)!
      const predicted = predict(ratios, key)
      if (fitContext.fitMode === 'robust_interval') {
        return sum + normalizedIntervalHuberLoss(
          { min: predicted, max: predicted },
          observation.interval,
          fitObservationScale(key, observation),
        )
      }
      // legacy_point preserves the previous normalized squared point error.
      const error = (predicted - fitContext.knownNutrients![key]!) / fitObservationScale(key, observation)
      return sum + error * error
    }, 0) / fitKeys.length
  }
  const ratioPenaltyForRatios = (ratios: readonly number[]): number | null => {
    if (
      !ratioFeedback
      || profiles.some((profile) => profile.nutrients.saturatedFatG === null)
    ) return null
    const saturatedFat = profiles.reduce((sum, profile, index) => (
      sum + profile.nutrients.saturatedFatG! * ratios[index]
    ), 0) * referenceMassG / 100
    const predictedRatio = saturatedFat / ratioFeedback.parentValue
    return saturatedFatRatioIntervalPenalty(
      predictedRatio,
      predictedRatio,
      ratioFeedback.prior,
      ratioFeedback.parentValue,
    )
  }
  const fitObjectiveForRatios = (ratios: readonly number[]): number | null => {
    const macroError = macroObjectiveForRatios(ratios)
    const ratioPenalty = ratioPenaltyForRatios(ratios)
    if (macroError === null && ratioPenalty === null) return null
    return (macroError ?? 0) + (ratioPenalty ?? 0) * (ratioFeedback?.feedbackWeight ?? 0)
  }

  const count = profiles.length
  let ratios = fallbackRatios(count)
  let normalizedError = macroObjectiveForRatios(ratios)
  let fitObjective = fitObjectiveForRatios(ratios) ?? 0
  const usedMacroFit = count >= 2 && fitKeys.length >= 2
  const usedRatioFeedbackFit = count >= 2
    && ratioFeedback !== null
    && profiles.every((profile) => profile.nutrients.saturatedFatG !== null)
  const shouldOptimize = usedMacroFit || usedRatioFeedbackFit

  if (shouldOptimize) {
    const denominator = count * (count + 1) / 2
    let bestQ = Array.from({ length: count }, (_value, index) => (index + 1) / denominator)
    let bestError = fitObjectiveForRatios(orderedRatiosFromQ(bestQ))!
    const random = createRandom(fnv1a(seedInput))

    for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
      const exponential = Array.from({ length: count }, () => -Math.log(Math.max(random(), Number.EPSILON)))
      const total = exponential.reduce((sum, value) => sum + value, 0)
      const q = exponential.map((value) => value / total)
      const error = fitObjectiveForRatios(orderedRatiosFromQ(q))!
      if (error < bestError) {
        bestQ = q
        bestError = error
      }
    }

    for (const step of [0.1, 0.03, 0.01, 0.003, 0.001, 0.0003, 0.0001]) {
      let improved = true
      let iteration = 0
      while (improved && iteration < 32) {
        improved = false
        iteration += 1
        for (let from = 0; from < count; from += 1) {
          for (let to = 0; to < count; to += 1) {
            if (to === from) continue
            // 直前の採用でbestQ[from]が減るため、移動ごとに残量を取り直す。
            const amount = Math.min(step, bestQ[from])
            if (amount <= 0) continue
            const candidate = [...bestQ]
            candidate[from] -= amount
            candidate[to] += amount
            const error = fitObjectiveForRatios(orderedRatiosFromQ(candidate))!
            if (error + 1e-12 < bestError) {
              bestQ = candidate
              bestError = error
              improved = true
            }
          }
        }
      }
    }
    ratios = orderedRatiosFromQ(bestQ)
    normalizedError = macroObjectiveForRatios(ratios)
    fitObjective = bestError
  }

  // 商品名等の事前確率は、主要栄養値との整合を覆さない弱いペナルティとしてだけ使う。
  const priorPenalty = -Math.log(Math.max(combination.priorProbability, 1e-9)) * 0.08
  const ratioFeedbackPenalty = ratioPenaltyForRatios(ratios)
  return {
    profiles,
    ratios,
    priorProbability: combination.priorProbability,
    normalizedError,
    fitObjective,
    ratioFeedbackPenalty,
    usedRatioFeedbackFit,
    usedMacroFit,
    score: fitObjective + priorPenalty,
  }
}

function weightedQuantile(
  values: readonly { value: number; weight: number }[],
  quantile: number,
): number {
  const sorted = [...values]
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((left, right) => left.value - right.value)
  if (sorted.length === 0) return 0
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0)
  const targetWeight = Math.min(1, Math.max(0, quantile)) * totalWeight
  let cumulativeWeight = 0
  for (const item of sorted) {
    cumulativeWeight += item.weight
    if (cumulativeWeight >= targetWeight) return item.value
  }
  return sorted[sorted.length - 1].value
}

function plausibleFits(fits: readonly MacroFit[], selected: MacroFit): MacroFit[] {
  return fits.filter((fit) => fit.score <= selected.score + CANDIDATE_SCENARIO_SCORE_TOLERANCE)
}

function candidateScenarioRange(
  fits: readonly MacroFit[],
  selected: MacroFit,
  nutrientKey: EstimatableNutrientKey,
  referenceMassG: number,
): CandidateScenarioRange | null {
  const plausible = plausibleFits(fits, selected)
  const minimumFitError = plausible.reduce((minimum, fit) => (
    Math.min(minimum, fit.fitObjective)
  ), Number.POSITIVE_INFINITY)
  const scenarios = plausible.flatMap((fit) => {
    if (fit.profiles.some((profile) => profile.nutrients[nutrientKey] === null)) return []
    const value = round(fit.profiles.reduce((sum, profile, index) => (
      sum + profile.nutrients[nutrientKey]! * fit.ratios[index]
    ), 0) * referenceMassG / 100)
    const fitErrorDelta = Math.max(0, fit.fitObjective - minimumFitError)
    return [{
      value,
      weight: Math.exp(-fitErrorDelta / CANDIDATE_SCENARIO_TEMPERATURE)
        * Math.max(fit.priorProbability, 1e-12),
    }]
  })
  if (scenarios.length < 2 || new Set(scenarios.map((scenario) => scenario.value)).size < 2) return null
  return {
    range: {
      min: round(weightedQuantile(scenarios, 0.05)),
      max: round(weightedQuantile(scenarios, 0.95)),
    },
    plausibleScenarioCount: scenarios.length,
  }
}

function mergeEstimateRanges(
  value: number,
  ...ranges: Array<{ min: number; max: number } | null | undefined>
): { min: number; max: number } {
  return {
    min: round(Math.min(value, ...ranges.flatMap((range) => range ? [range.min] : []))),
    max: round(Math.max(value, ...ranges.flatMap((range) => range ? [range.max] : []))),
  }
}

function unavailable(
  reason: string,
  nextAction: string,
  warnings: string[] = [],
  limitationReasons: EstimationLimitationReason[] = [],
): UnavailableNutrientEstimate {
  return {
    status: 'unavailable',
    value: null,
    range: null,
    confidence: 'unavailable',
    method: FALLBACK_METHOD,
    source: SOURCE,
    sourceFoodIds: [],
    warnings,
    limitationReasons,
    reason,
    nextAction,
  }
}

function mapEstimatableNutrients<T>(
  mapper: (key: EstimatableNutrientKey) => T,
): Record<EstimatableNutrientKey, T> {
  return Object.fromEntries(ESTIMATABLE_NUTRIENT_KEYS.map((key) => [key, mapper(key)])) as Record<EstimatableNutrientKey, T>
}

function unavailableAll(
  reason: string,
  nextAction: string,
  warnings: string[] = [],
  limitationReasons: EstimationLimitationReason[] = [],
): Record<EstimatableNutrientKey, UnavailableNutrientEstimate> {
  return mapEstimatableNutrients(() => unavailable(reason, nextAction, warnings, limitationReasons))
}

interface PartialEstimateOutput {
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>
  trace: EstimationTrace
}

/**
 * 未対応原材料の重量枠を残し、参照できる原材料の寄与だけを表示順の暫定配合比で計算する。
 * 未対応分を0gと置いた商品の下限ではなく、既知分だけを可視化する部分参考値である。
 */
function partialKnownIngredientEstimates(
  resolved: readonly ResolvedIngredient[],
  declaration: ParsedIngredientDeclaration,
  request: NutrientEstimateRequest,
): PartialEstimateOutput {
  const known = resolved.filter((item) => item.candidates.length > 0)
  const unknownNames = resolved
    .filter((item) => item.candidates.length === 0)
    .map((item) => item.ingredient.normalizedName)
  const ratios = fallbackRatios(resolved.length)
  const genrePriorContributionRatios: Partial<Record<NutrientKey, number>> = {}
  if (known.length === 0) {
    const estimates = mapEstimatableNutrients<NutrientEstimate>((key) => {
      if (!(request.requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS).includes(key)) {
        return unavailable(
          'この栄養素は今回の推計対象に選ばれていません。',
          '必要な場合は推計対象に含めて再実行してください。',
          [],
          ['not_requested'],
        )
      }
      const genrePrior = applyGenrePriorToUnmodeledMass({
        knownPer100g: 0,
        unmodeledMassFraction: 1,
        nutrientKey: key,
        genreId: request.estimatorGenreId,
        referenceMassG: request.referenceMassG!,
        usePriorMedianAsPoint: true,
      })
      if (!genrePrior) {
        return unavailable(
          `参照できる原材料がありません（${unknownNames.join('、')}）。`,
          'パッケージの栄養成分表示を確認して手入力するか、未対応原材料が追加されるまで推計せず食品登録を続けてください。',
          [`未対応原材料: ${unknownNames.join('、')}`],
          ['ingredient_unresolved'],
        )
      }
      genrePriorContributionRatios[key] = 1
      const unmodeledAdditives = unmodeledAdditivesForNutrient(declaration.additives, key)
      return {
        status: 'available',
        value: genrePrior.value,
        range: genrePrior.range,
        confidence: 'low',
        calibration: genrePrior.calibration,
        adoptionClass: 'genre_prior_confirmation',
        method: GENRE_PRIOR_PARTIAL_METHOD,
        sourceFoodIds: [],
        source: ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE,
        limitationReasons: [
          'ingredient_unresolved',
          ...(unmodeledAdditives.length > 0 ? ['additive_contribution_unknown' as const] : []),
        ],
        warnings: [
          `未対応原材料（${unknownNames.join('、')}）に直接対応する参照食品はありません。`,
          ...genrePriorWarnings(genrePrior.prior, 1, true),
          ...(unmodeledAdditives.length > 0
            ? [`${NUTRIENT_LABELS[key]}へ寄与し得る添加物（${unmodeledAdditives.join('、')}）の配合量は不明なため、添加物分は加算していません。`]
            : []),
        ],
      }
    })
    return {
      estimates,
      trace: {
        ingredientNames: resolved.map((item) => item.ingredient.normalizedName),
        selectedProfileIds: resolved.map(() => null),
        ingredientRatios: ratios,
        fitScore: null,
        normalizedFitError: null,
        candidateCombinationCount: 0,
        retainedCandidateCombinationCount: 0,
        plausibleScenarioCount: 0,
        unresolvedMassRatio: 1,
        genrePriorContributionRatios,
      },
    }
  }

  const candidateSets = known.map((item) => item.candidates)
  const combinations = combineCandidateSets(
    candidateSets,
    MAX_PROFILE_COMBINATIONS,
  )
  const selected = combinations[0]
  let profileIndex = 0
  const positioned = resolved.flatMap((item, ingredientIndex) => {
    if (item.candidates.length === 0) return []
    const profile = selected.profiles[profileIndex]
    profileIndex += 1
    return [{ ingredient: item.ingredient, ingredientIndex, profile }]
  })
  const hasCandidateAmbiguity = known.some((item) => item.candidates.length > 1)
    || selected.profiles.some((profile) => profile.ambiguous)
  const sharedWarnings = [
    `未対応原材料（${unknownNames.join('、')}）は表示順に対応する重量枠を残しています。`,
    '原材料量は表示順から仮定しているため、実際の商品の保証された下限ではありません。',
    '未対応原材料を除いて既知原材料だけを100%へ再配分していません。',
    ...(hasCandidateAmbiguity
      ? ['同じ原材料名に複数の参照食品候補があるため、商品名と食品ジャンルによる事前確率が最も高い候補を使用しました。']
      : []),
    ...(declaration.additives.length > 0
      ? [`添加物区画（${declaration.additives.map((item) => item.normalizedName).join('、')}）の栄養寄与も加算していません。`]
      : []),
    ...selected.profiles.flatMap((profile) => profile.derivationWarnings ?? []),
  ]

  const estimates = mapEstimatableNutrients<NutrientEstimate>((key) => {
    if (!(request.requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS).includes(key)) {
      return unavailable(
        'この栄養素は今回の推計対象に選ばれていません。',
        '必要な場合は推計対象に含めて再実行してください。',
        [],
        ['not_requested'],
      )
    }
    const numeric = positioned.filter((item) => item.profile.nutrients[key] !== null)
    const omittedKnown = positioned
      .filter((item) => item.profile.nutrients[key] === null)
      .map((item) => item.ingredient.normalizedName)
    const unmodeledAdditives = unmodeledAdditivesForNutrient(declaration.additives, key)
    const per100g = numeric.reduce((total, item) => (
      total + item.profile.nutrients[key]! * ratios[item.ingredientIndex]
    ), 0)
    const modeledMassFraction = numeric.reduce((total, item) => total + ratios[item.ingredientIndex], 0)
    const unmodeledMassFraction = Math.max(0, 1 - modeledMassFraction)
    const genrePrior = applyGenrePriorToUnmodeledMass({
      knownPer100g: per100g,
      unmodeledMassFraction,
      nutrientKey: key,
      genreId: request.estimatorGenreId,
      referenceMassG: request.referenceMassG!,
      usePriorMedianAsPoint: numeric.length === 0,
    })
    if (genrePrior) genrePriorContributionRatios[key] = unmodeledMassFraction
    if (numeric.length === 0 && !genrePrior) {
      return unavailable(
        `参照できる原材料にも${NUTRIENT_LABELS[key]}の数値がないため、部分参考値を計算できません。`,
        'パッケージの栄養成分表示を確認して手入力するか、この栄養素を採用せず食品登録を続けてください。',
        [`既知原材料の${NUTRIENT_LABELS[key]}がすべて欠損しています。`],
        ['ingredient_unresolved', 'reference_value_missing'],
      )
    }
    const value = genrePrior?.value ?? round(per100g * request.referenceMassG! / 100)
    const zeroEvidence: EstimationZeroEvidence = 'uncertain'
    const calibrated = calibratedEstimateRange({
      value,
      nutrientKey: key,
      genreId: request.estimatorGenreId,
      confidence: 'low',
      zeroEvidence,
    })
    const sourceFoodIds = [...new Set(numeric.flatMap((item) => sourceFoodIdsForNutrient(item.profile, key)))]
    return {
      status: 'available',
      value,
      range: genrePrior?.range ?? calibrated.range,
      confidence: 'low',
      calibration: genrePrior?.calibration ?? calibrated.calibration,
      adoptionClass: genrePrior ? 'genre_prior_confirmation' : 'limited_confirmation',
      ...(value === 0 ? { zeroEvidence } : {}),
      method: genrePrior ? GENRE_PRIOR_PARTIAL_METHOD : PARTIAL_METHOD,
      sourceFoodIds,
      source: [
        ...(sourceFoodIds.length > 0 ? [estimateSource(sourceFoodIds)] : []),
        ...(genrePrior ? [ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE] : []),
      ].join(' / '),
      limitationReasons: [
        'ingredient_unresolved',
        ...(omittedKnown.length > 0 ? ['reference_value_missing' as const] : []),
        ...(unmodeledAdditives.length > 0 ? ['additive_contribution_unknown' as const] : []),
      ],
      warnings: [...new Set([
        ...sharedWarnings,
        ...(genrePrior
          ? genrePriorWarnings(genrePrior.prior, unmodeledMassFraction, numeric.length === 0)
          : ['未対応原材料の栄養寄与は加算していません。']),
        ...(omittedKnown.length > 0
          ? [genrePrior
              ? `参照食品側で${NUTRIENT_LABELS[key]}が欠損する既知原材料（${omittedKnown.join('、')}）もジャンル事前分布の対象に含めています。`
              : `参照食品側で${NUTRIENT_LABELS[key]}が欠損する既知原材料（${omittedKnown.join('、')}）も加算していません。`]
          : []),
        ...(unmodeledAdditives.length > 0
          ? [`${NUTRIENT_LABELS[key]}へ寄与し得る添加物（${unmodeledAdditives.join('、')}）の配合量は不明なため加算していません。`]
          : []),
        ...(genrePrior
          ? ['推定範囲はジャンル内のばらつきを含みますが、この商品の栄養値全体を保証する上下限ではありません。']
          : ['部分参考値の範囲は既知原材料分だけの不確実性を表し、商品の栄養値全体の上限を表しません。']),
        ...uncertainZeroWarning(value, zeroEvidence),
      ])],
    }
  })
  let selectedProfileIndex = 0
  const selectedProfileIds = resolved.map((item) => {
    if (item.candidates.length === 0) return null
    const profileId = selected.profiles[selectedProfileIndex].profileId
    selectedProfileIndex += 1
    return profileId
  })
  return {
    estimates,
    trace: {
      ingredientNames: resolved.map((item) => item.ingredient.normalizedName),
      selectedProfileIds,
      ingredientRatios: ratios,
      fitScore: null,
      normalizedFitError: null,
      candidateCombinationCount: cartesianCandidateCombinationCount(candidateSets),
      retainedCandidateCombinationCount: combinations.length,
      plausibleScenarioCount: 1,
      unresolvedMassRatio: round(resolved.reduce((total, item, index) => (
        total + (item.candidates.length === 0 ? ratios[index] : 0)
      ), 0)),
      genrePriorContributionRatios,
    },
  }
}

function resultStatus(
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>,
  requested: ReadonlySet<EstimatableNutrientKey>,
): NutrientEstimateResult['status'] {
  const requestedKeys = ESTIMATABLE_NUTRIENT_KEYS.filter((key) => requested.has(key))
  if (requestedKeys.length === 0) return 'failed'
  const availableCount = requestedKeys.filter((key) => estimates[key].status === 'available').length
  const hasPartialEstimate = requestedKeys.some((key) => (
    estimates[key].status === 'available'
    && [PARTIAL_METHOD, GENRE_PRIOR_PARTIAL_METHOD].includes(estimates[key].method)
  ))
  if (availableCount === 0) return 'failed'
  if (hasPartialEstimate) return 'partial'
  return availableCount === requestedKeys.length ? 'completed' : 'partial'
}

function unavailableEstimatesForInvalidRequest(
  request: NutrientEstimateRequest,
): Record<EstimatableNutrientKey, NutrientEstimate> | null {
  if (!Number.isFinite(request.baseAmount) || request.baseAmount <= 0 || request.baseUnit.trim() === '') {
    return unavailableAll(
      '推計の基準量または基準単位が正しくありません。',
      '食品の基準量と単位を確認するか、推計せず食品登録を続けてください。',
      [],
      ['invalid_basis'],
    )
  } else if (request.referenceMassG === null || !Number.isFinite(request.referenceMassG) || request.referenceMassG <= 0) {
    return unavailableAll(
      '基準量に対応する内容物重量が確認できないため推計できません。',
      'パッケージで内容物重量を確認してg単位で入力するか、推計せず食品登録を続けてください。',
      [],
      ['reference_mass_missing'],
    )
  } else if (!request.referenceMassSource?.trim()) {
    return unavailableAll(
      '基準重量の根拠が入力されていないため推計できません。',
      '「パッケージ表示」など重量を確認した根拠を入力するか、推計せず食品登録を続けてください。',
      [],
      ['reference_mass_source_missing'],
    )
  } else if (!request.ingredientsText?.trim()) {
    return unavailableAll(
      '原材料情報が存在しないため推計できません。',
      'パッケージの原材料表示を確認して手入力するか、推計せず食品登録を続けてください。',
      [],
      ['ingredients_missing'],
    )
  } else if (!request.ingredientsSource?.provider.trim() || request.ingredientsSource.verified !== true) {
    return unavailableAll(
      '原材料表示の取得元が確認されていないため推計できません。',
      '原材料の取得元を選び、内容を確認済みにしてから再実行してください。',
      [],
      ['ingredients_unverified'],
    )
  }
  return null
}

interface ExplicitNutrientContribution {
  knownPer100g: number
  missingMassFraction: number
  sourceFoodIds: string[]
}

interface ResolvedExplicitComposition {
  group: ExplicitCompositionGroup
  fixedChildRatios: number[]
  zeroWeightChildIndices: number[]
  selectedProfileIds: Array<string | null>
  stateRegistryIds: Array<string | null>
  nutrients: Record<NutrientKey, ExplicitNutrientContribution>
  identity: string
}

interface ExplicitCompositionOutput {
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>
  trace: ExplicitCompositionEvidenceTrace
  unresolvedIngredients: string[]
}

function fnv1aCompositionIdentity(value: string): string {
  let hash = 0xcbf29ce484222325n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function explicitCompositionReason(reason: ExplicitCompositionDeferredReason): string {
  const messages: Record<ExplicitCompositionDeferredReason, string> = {
    declaration_stale: '原材料宣言が確認時から変わっています。',
    parent_path_mismatch: '配合根拠の対象位置が原材料宣言と一致しません。',
    child_names_mismatch: '配合根拠の材料名が原材料宣言と一致しません。',
    partial_group: '固定配合の量がそろっていないか合計が不足しています。',
    raw_stage: '加熱前など製造途中の配合量は完成品へ適用できません。',
    unknown_amount: '配合量が不明な材料があります。',
    profile_binding_missing: '正量の材料に確認済み参照profileが結び付いていません。',
    profile_state_unconfirmed: '材料状態を確認した製造者配合表または実測根拠がありません。',
    profile_state_mismatch: '材料の種類または掲載状態が参照profileと一致しません。',
    profile_registry_stale: '確認済み参照profileの版または栄養値が変わっています。',
    zero_weight_branch: '配合量0のため、この材料枝は計算対象から除外しました。',
    root_group_missing: '完成品全体の固定配合根拠がありません。',
    nested_binding_missing: '括弧内の複合材料に適用済みの子配合根拠がありません。',
    nested_parent_mismatch: '子配合根拠の親位置が一致しません。',
    parent_mass_unconfirmed: '親材料の完成重量を確認できないため子配合を適用できません。',
    product_denominator_not_supported: '内側配合の製品全体分母は今回の直接計算に適用できません。',
    batch_mass_mismatch: '配合重量の分母または親子重量が一致しません。',
    additives_present: '添加物を含む表示には固定原材料配合を適用できません。',
  }
  return messages[reason]
}

function parsedChildrenAtPath(
  declaration: ParsedIngredientDeclaration,
  path: readonly number[],
): ParsedIngredient[] | null {
  if (path.length === 0) return declaration.ingredients
  let parent = declaration.ingredients[path[0]]
  if (!parent) return null
  for (const index of path.slice(1)) {
    parent = parent.components[index]
    if (!parent) return null
  }
  return parent.components
}

function compositionAmountAtIndex(group: ExplicitCompositionGroup, index: number): number | null | undefined {
  return group.amounts.children.find((amount) => amount.index === index)?.value
}

function compositionWeightTotal(group: ExplicitCompositionGroup): number | null {
  return group.amounts.kind === 'masses_g' ? group.amounts.denominatorMassG : null
}

function nearCompositionMass(left: number, right: number, itemCount: number): boolean {
  const tolerance = Math.max(1, Math.abs(left), Math.abs(right)) * Number.EPSILON * Math.max(1, itemCount) * 8
  return Math.abs(left - right) <= tolerance
}

function unresolvedExplicitNames(prepared: PreparedExplicitCompositionEvidence): string[] {
  const root = prepared.groups.find((item) => item.group.parent.path.length === 0)
  const rootZeros = new Set(root?.zeroWeightChildIndices ?? [])
  return prepared.declaration.ingredients
    .flatMap((item, index) => rootZeros.has(index) ? [] : [item.normalizedName])
}

function explicitCompositionOutput(
  prepared: PreparedExplicitCompositionEvidence,
  request: NutrientEstimateRequest,
  requested: ReadonlySet<EstimatableNutrientKey>,
): ExplicitCompositionOutput {
  const groupsById = new Map(prepared.evidence.compositions?.map((group) => [group.id, group]) ?? [])
  const preparedById = new Map(prepared.groups.map((entry) => [entry.group.id, entry]))
  const root = prepared.groups.find((entry) => entry.group.parent.path.length === 0)
  const resolvedGroups = new Map<string, ResolvedExplicitComposition>()
  const reasons = new Map<string, ExplicitCompositionDeferredReason>()
  const ignoredZeroPathPrefixes: number[][] = []
  const activeIds = new Set<string>()

  const defer = (groupId: string, reason: ExplicitCompositionDeferredReason): null => {
    reasons.set(groupId, reason)
    return null
  }

  const resolveGroup = (
    groupId: string,
    expectedParentMassG: number | null,
    productBatchMassG: number | null,
  ): ResolvedExplicitComposition | null => {
    const item = preparedById.get(groupId)
    const group = groupsById.get(groupId)
    if (!item || !group) return defer(groupId, 'nested_binding_missing')
    if (activeIds.has(groupId)) return defer(groupId, 'nested_parent_mismatch')
    if (item.status === 'deferred') return defer(groupId, item.reason ?? 'partial_group')
    if (group.parent.path.length > 0 && group.denominator === 'product') {
      return defer(groupId, 'product_denominator_not_supported')
    }
    if (group.parent.path.length === 0 && group.denominator !== 'product') {
      return defer(groupId, 'parent_mass_unconfirmed')
    }

    const denominatorMassG = compositionWeightTotal(group)
    if (denominatorMassG !== null) {
      const expectedMass = group.parent.path.length === 0
        ? denominatorMassG
        : group.denominator === 'parent'
          ? expectedParentMassG
          : productBatchMassG
      if (expectedMass === null || expectedMass === undefined) return defer(groupId, 'parent_mass_unconfirmed')
      if (!nearCompositionMass(denominatorMassG, expectedMass, group.expectedChildNames.length)) {
        return defer(groupId, 'batch_mass_mismatch')
      }
    }

    const children = parsedChildrenAtPath(prepared.declaration, group.parent.path)
    if (!children || children.length !== group.expectedChildNames.length) return defer(groupId, 'parent_path_mismatch')
    const preparedRatios = item.fixedChildRatios
    if (preparedRatios.length !== children.length) return defer(groupId, item.reason ?? 'partial_group')
    const bindings = new Map((group.childBindings ?? []).map((binding) => [binding.index, binding]))
    const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, {
      knownPer100g: 0,
      missingMassFraction: 0,
      sourceFoodIds: [] as string[],
    }])) as Record<NutrientKey, ExplicitNutrientContribution>
    const selectedProfileIds: Array<string | null> = children.map(() => null)
    const stateRegistryIds: Array<string | null> = children.map(() => null)
    const nestedIdentities: Array<string | null> = children.map(() => null)
    activeIds.add(groupId)

    for (let index = 0; index < children.length; index += 1) {
      const ratio = preparedRatios[index]
      if (ratio === 0) {
        ignoredZeroPathPrefixes.push([...group.parent.path, index])
        continue
      }
      const binding = bindings.get(index)
      if (!binding) {
        activeIds.delete(groupId)
        return defer(groupId, 'profile_binding_missing')
      }
      const branchAmount = compositionAmountAtIndex(group, index)
      const branchMass = branchAmount !== undefined && branchAmount !== null && group.amounts.kind === 'masses_g'
        ? branchAmount
        : expectedParentMassG === null
          ? null
          : ratio * expectedParentMassG

      let branchNutrients: Record<NutrientKey, ExplicitNutrientContribution>
      if (binding.kind === 'profile') {
        if (children[index].components.length > 0) {
          activeIds.delete(groupId)
          return defer(groupId, 'nested_binding_missing')
        }
        const reviewed = reviewedCompositionProfile(binding.expectedProfileId)
        if (!reviewed) {
          activeIds.delete(groupId)
          return defer(groupId, 'profile_registry_stale')
        }
        if (binding.stateSource.reference.trim() === reviewed.state.officialSourceUrl) {
          activeIds.delete(groupId)
          return defer(groupId, 'profile_state_unconfirmed')
        }
        if (!reviewedCompositionDeclaredNameMatches(binding.expectedProfileId, children[index].normalizedName)) {
          activeIds.delete(groupId)
          return defer(groupId, 'profile_state_mismatch')
        }
        if (
          reviewed.state.profileStateId !== binding.expectedProfileStateId
          || reviewed.state.finishedIngredientStateId !== binding.finishedIngredientStateId
        ) {
          activeIds.delete(groupId)
          return defer(groupId, 'profile_state_mismatch')
        }
        selectedProfileIds[index] = reviewed.profile.profileId
        stateRegistryIds[index] = reviewed.state.registryId
        branchNutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => {
          const value = reviewed.profile.nutrients[key]
          return [key, value === null
            ? { knownPer100g: 0, missingMassFraction: 1, sourceFoodIds: [] }
            : {
                knownPer100g: value,
                missingMassFraction: 0,
                sourceFoodIds: [...sourceFoodIdsForNutrient(reviewed.profile, key)],
              }]
        })) as Record<NutrientKey, ExplicitNutrientContribution>
      } else {
        if (!groupsById.has(binding.compositionId)) {
          activeIds.delete(groupId)
          return defer(groupId, 'nested_binding_missing')
        }
        if (JSON.stringify(groupsById.get(binding.compositionId)?.parent.path) !== JSON.stringify([...group.parent.path, index])) {
          activeIds.delete(groupId)
          return defer(groupId, 'nested_parent_mismatch')
        }
        const nested = resolveGroup(binding.compositionId, branchMass, productBatchMassG)
        if (!nested) {
          activeIds.delete(groupId)
          return defer(groupId, reasons.get(binding.compositionId) ?? 'nested_binding_missing')
        }
        branchNutrients = nested.nutrients
        selectedProfileIds[index] = nested.identity
        nestedIdentities[index] = nested.identity
      }

      for (const key of NUTRIENT_KEYS) {
        nutrients[key].knownPer100g += branchNutrients[key].knownPer100g * ratio
        nutrients[key].missingMassFraction += branchNutrients[key].missingMassFraction * ratio
        nutrients[key].sourceFoodIds.push(...branchNutrients[key].sourceFoodIds)
      }
    }
    activeIds.delete(groupId)

    for (const key of NUTRIENT_KEYS) {
      nutrients[key].missingMassFraction = Math.min(1, Math.max(0, nutrients[key].missingMassFraction))
      nutrients[key].sourceFoodIds = [...new Set(nutrients[key].sourceFoodIds)]
    }
    const identityPayload = JSON.stringify({
      groupId,
      ratios: preparedRatios,
      selectedProfileIds,
      nestedIdentities,
      registryIds: stateRegistryIds,
    })
    const resolved: ResolvedExplicitComposition = {
      group,
      fixedChildRatios: [...preparedRatios],
      zeroWeightChildIndices: [...item.zeroWeightChildIndices],
      selectedProfileIds,
      stateRegistryIds,
      nutrients,
      identity: `explicit-composition:${fnv1aCompositionIdentity(identityPayload)}`,
    }
    resolvedGroups.set(groupId, resolved)
    return resolved
  }

  let rootResolved: ResolvedExplicitComposition | null = null
  let rootFailure: ExplicitCompositionDeferredReason | undefined
  if (!root) {
    rootFailure = 'root_group_missing'
  } else {
    const rootBatchMassG = compositionWeightTotal(root.group)
    rootResolved = resolveGroup(root.group.id, null, rootBatchMassG)
    rootFailure = rootResolved ? undefined : reasons.get(root.group.id) ?? root.reason ?? 'partial_group'
  }

  if (root && rootResolved) {
    const used = new Set(resolvedGroups.keys())
    const unusedRelevant = prepared.groups.find((item) => {
      if (used.has(item.group.id)) return false
      if (ignoredZeroPathPrefixes.some((prefix) => (
        item.group.parent.path.length >= prefix.length
        && prefix.every((index, at) => item.group.parent.path[at] === index)
      ))) return false
      return true
    })
    if (unusedRelevant) {
      rootFailure = reasons.get(unusedRelevant.group.id) ?? unusedRelevant.reason ?? 'nested_binding_missing'
      reasons.set(unusedRelevant.group.id, rootFailure)
      reasons.set(root.group.id, rootFailure)
      for (const groupId of resolvedGroups.keys()) reasons.set(groupId, rootFailure)
      rootResolved = null
    }
  }

  const reasonForGroup = (item: PreparedExplicitCompositionEvidence['groups'][number]): ExplicitCompositionDeferredReason | undefined => {
    if (reasons.has(item.group.id)) return reasons.get(item.group.id)
    if (ignoredZeroPathPrefixes.some((prefix) => (
      item.group.parent.path.length >= prefix.length
      && prefix.every((index, at) => item.group.parent.path[at] === index)
    ))) return 'zero_weight_branch'
    return item.reason ?? rootFailure
  }

  const traceGroups: ExplicitCompositionTraceGroup[] = prepared.groups.map((item) => {
    const resolved = resolvedGroups.get(item.group.id)
    const reason = reasonForGroup(item)
    const zeroSubtree = reason === 'zero_weight_branch'
    const ratios = zeroSubtree ? [] : resolved?.fixedChildRatios ?? item.fixedChildRatios
    const selectedProfileIds = zeroSubtree
      ? []
      : resolved?.selectedProfileIds ?? (ratios.length > 0 ? ratios.map(() => null) : [])
    const stateRegistryIds = zeroSubtree
      ? []
      : resolved?.stateRegistryIds ?? (ratios.length > 0 ? ratios.map(() => null) : [])
    const missingMassFractionByNutrient: Partial<Record<NutrientKey, number>> = {}
    if (resolved) {
      for (const key of NUTRIENT_KEYS) {
        const missing = resolved.nutrients[key].missingMassFraction
        if (missing > 0) missingMassFractionByNutrient[key] = missing
      }
    }
    return {
      compositionId: item.group.id,
      ...(resolved ? { compositionProfileId: resolved.identity } : {}),
      parentPath: [...item.group.parent.path],
      status: resolved && !rootFailure ? 'applied' : 'deferred',
      ...(reason ? { reason } : {}),
      fixedChildRatios: [...ratios],
      selectedProfileIds: [...selectedProfileIds],
      stateRegistryIds: [...stateRegistryIds],
      zeroWeightChildIndices: zeroSubtree ? [] : [...(resolved?.zeroWeightChildIndices ?? item.zeroWeightChildIndices)],
      missingMassFractionByNutrient,
    }
  })

  const deferred = !rootResolved || Boolean(rootFailure)
  const trace: ExplicitCompositionEvidenceTrace = {
    declarationFingerprint: prepared.currentDeclarationFingerprint,
    stateRegistryVersion: REVIEWED_COMPOSITION_STATE_REGISTRY_VERSION,
    status: deferred ? 'deferred' : 'applied',
    groups: traceGroups,
  }
  const estimates = mapEstimatableNutrients<NutrientEstimate>((key) => {
    if (!requested.has(key)) {
      return unavailable(
        'この栄養素は今回の推計対象に選ばれていません。',
        '必要な場合は推計対象に含めて再実行してください。',
        [],
        ['not_requested'],
      )
    }
    if (deferred || !rootResolved) {
      const reason = rootFailure ?? 'root_group_missing'
      return unavailable(
        `確認済み固定配合を適用できないため、${NUTRIENT_LABELS[key]}は推計できません。`,
        '完成品の固定配合と材料状態を確認した根拠を更新するか、この栄養素を手入力してください。',
        [`明示配合根拠を保留しました: ${explicitCompositionReason(reason)}`],
        ['ingredient_unresolved'],
      )
    }
    const nutrient = rootResolved.nutrients[key]
    const point = round(nutrient.knownPer100g * request.referenceMassG! / 100)
    const missing = nutrient.missingMassFraction > 0
    if (missing && nutrient.sourceFoodIds.length === 0) {
      return unavailable(
        `参照食品の${NUTRIENT_LABELS[key]}がすべて欠損しているため、この栄養素は推計できません。`,
        'パッケージの栄養成分表示を確認して手入力するか、この栄養素を採用せず食品登録を続けてください。',
        ['正量材料のMEXT栄養値が欠損しています。欠損値は0として扱っていません。'],
        ['reference_value_missing'],
      )
    }
    const parentKey = COMPOSITION_PARENT_NUTRIENTS[key]
    const zeroEvidence: EstimationZeroEvidence = !missing
      && parentKey !== undefined
      && rootResolved.nutrients[parentKey].missingMassFraction === 0
      && rootResolved.nutrients[parentKey].knownPer100g === 0
      ? 'derived_from_parent_zero'
      : 'uncertain'
    const calibrated = calibratedEstimateRange({
      value: point,
      nutrientKey: key,
      genreId: null,
      confidence: 'low',
      zeroEvidence,
    })
    return {
      status: 'available',
      value: point,
      range: calibrated.range,
      confidence: 'low',
      method: missing ? PARTIAL_METHOD : EXPLICIT_COMPOSITION_METHOD,
      source: estimateSource(nutrient.sourceFoodIds),
      sourceFoodIds: [...nutrient.sourceFoodIds],
      warnings: [
        '完成品の固定配合を、確認済み材料状態に一致する直接MEXTプロファイルだけで計算しました。',
        '固定配合は候補選択・比率探索・ジャンル事前分布・比率校正で変更していません。',
        ...(missing ? [
          `正量材料の${NUTRIENT_LABELS[key]}に欠損があります。表示値は確認できる材料分だけの部分参考値で、製品全体の下限や上限ではありません。`,
        ] : []),
      ],
      limitationReasons: missing ? ['reference_value_missing'] : [],
      calibration: calibrated.calibration,
      adoptionClass: 'limited_confirmation',
      ...(point === 0 ? { zeroEvidence: missing ? 'uncertain' as const : zeroEvidence } : {}),
    }
  })
  const unresolvedIngredients = deferred ? unresolvedExplicitNames(prepared) : []
  return { estimates, trace, unresolvedIngredients }
}

/**
 * 原材料表示順、商品名の弱い事前確率、入力済み主要栄養値を使う、外部通信を行わない決定的な参考推計。
 * referenceMassG は request の baseAmount/baseUnit に対応する明示的な内容物重量でなければならない。
 */
export function estimateNutrients(
  requestInput: NutrientEstimateRequest,
  ratioStrategyOverride?: NutrientEstimatorRatioStrategy,
): NutrientEstimateResult {
  const ratioStrategy = validatedRatioStrategy(ratioStrategyOverride)
  const requestedKeys = requestedEstimatableNutrientKeys(requestInput.requestedNutrients)
  const canonicalInputs = canonicalizeConfirmedNutrientInputs({
    ...requestInput,
    requestedNutrients: requestedKeys,
  })
  const request: NutrientEstimateRequest = {
    ...requestInput,
    knownNutrients: canonicalInputs.knownNutrients,
    knownNutrientEvidence: canonicalInputs.knownNutrientEvidence,
    knownNutrientReferences: canonicalInputs.knownNutrientReferences,
    ...(requestInput.estimationEvidence === undefined
      ? {}
      : { estimationEvidence: validateExplicitEstimationEvidence(requestInput.estimationEvidence) }),
  }
  validateKnownNutrientReferences(request)
  const requested = new Set(requestedKeys)
  const postprocessingKnownNutrients = knownNutrientsForEstimatePostprocessing(request)
  let estimates: Record<EstimatableNutrientKey, NutrientEstimate>
  let optimization: EstimationOptimization | undefined
  let explicitOutput: ExplicitCompositionOutput | undefined

  const invalidRequestEstimates = unavailableEstimatesForInvalidRequest(request)
  if (invalidRequestEstimates) {
    estimates = invalidRequestEstimates
  } else {
    if (request.estimationEvidence?.compositions && request.estimationEvidence.compositions.length > 0) {
      const prepared = prepareExplicitCompositionEvidence(request.estimationEvidence, request.ingredientsText!)
      explicitOutput = explicitCompositionOutput(prepared, request, requested)
      estimates = explicitOutput.estimates
      const rootGroup = explicitOutput.trace.groups.find((group) => group.parentPath.length === 0)
      const rootHasAlignedRows = Boolean(rootGroup
        && rootGroup.fixedChildRatios.length === prepared.declaration.ingredients.length
        && rootGroup.selectedProfileIds.length === prepared.declaration.ingredients.length
        && rootGroup.stateRegistryIds.length === prepared.declaration.ingredients.length)
      optimization = {
        converged: explicitOutput.trace.status === 'applied',
        ...(explicitOutput.trace.status === 'applied' ? { scenarioCount: 1 } : {}),
        trace: {
          ingredientNames: rootHasAlignedRows
            ? prepared.declaration.ingredients.map((ingredient) => ingredient.normalizedName)
            : [],
          selectedProfileIds: rootHasAlignedRows ? [...(rootGroup?.selectedProfileIds ?? [])] : [],
          ingredientRatios: rootHasAlignedRows ? [...(rootGroup?.fixedChildRatios ?? [])] : [],
          fitScore: null,
          normalizedFitError: null,
          candidateCombinationCount: 0,
          retainedCandidateCombinationCount: 0,
          plausibleScenarioCount: explicitOutput.trace.status === 'applied' ? 1 : 0,
          unresolvedMassRatio: explicitOutput.trace.status === 'applied' ? 0 : 1,
          genrePriorContributionRatios: {},
          explicitCompositionEvidence: explicitOutput.trace,
        },
      }
    } else {
    const declaration = parseIngredientDeclaration(request.ingredientsText!)
    const resolved: ResolvedIngredient[] = declaration.ingredients.map((ingredient) => ({
      ingredient,
      candidates: candidatesForIngredient(ingredient, request.productName, request.estimatorGenreId),
    }))
    const unknown = resolved.filter((item) => item.candidates.length === 0)

    if (declaration.ingredients.length === 0) {
      estimates = unavailableAll(
        '食品として扱える原材料を確認できないため推計できません。',
        '原材料表示を見直して栄養値を手入力するか、推計せず食品登録を続けてください。',
        [],
        ['ingredient_parse_failed'],
      )
    } else if (unknown.length > 0) {
      const partial = partialKnownIngredientEstimates(resolved, declaration, request)
      estimates = partial.estimates
      optimization = {
        converged: false,
        scenarioCount: partial.trace.plausibleScenarioCount,
        trace: partial.trace,
      }
    } else {
      const ratioFeedbackContext = saturatedFatRatioFitContext(
        postprocessingKnownNutrients,
        request.estimatorGenreId,
        ratioStrategy.feedbackWeight,
      )
      const fitContext: CandidateSelectionContext = {
        referenceMassG: request.referenceMassG!,
        knownNutrients: request.knownNutrients,
        fitMode: request.fitMode,
        knownNutrientReferences: request.knownNutrientReferences,
        knownNutrientReferenceBasis: request.knownNutrientReferenceBasis,
        requestedNutrients: request.requestedNutrients,
        ...(ratioFeedbackContext ? { ratioFeedback: ratioFeedbackContext } : {}),
      }
      const combinations = combineCandidateSets(
        resolved.map((item) => item.candidates),
        MAX_PROFILE_COMBINATIONS,
        fitContext,
      )
      const scenarioCount = Math.max(512, Math.floor(4_096 / Math.max(1, combinations.length)))
      const fits = combinations.map((combination) => fitIngredientRatios(
        combination,
        request.referenceMassG!,
        fitContext,
        ratioFeedbackContext,
        JSON.stringify({
          productName: request.productName?.normalize('NFKC') ?? null,
          ...(request.estimatorGenreId && request.estimatorGenreId !== 'other_unknown'
            ? { estimatorGenreId: request.estimatorGenreId }
            : {}),
          ingredients: declaration.ingredients.map((ingredient) => ingredient.normalizedName),
          profiles: combination.profiles.map((profile) => profile.profileId),
          referenceMassG: request.referenceMassG,
          knownNutrients: [
            ...LEGACY_SEED_NUTRIENT_KEYS.map((key) => [key, request.knownNutrients?.[key] ?? null]),
            ...ESTIMATE_FIT_NUTRIENT_KEYS
              .filter((key) => !LEGACY_SEED_NUTRIENT_KEYS.includes(key as typeof LEGACY_SEED_NUTRIENT_KEYS[number]))
              .filter((key) => request.knownNutrients?.[key] !== null && request.knownNutrients?.[key] !== undefined)
              .filter((key) => combination.profiles.every((profile) => profile.nutrients[key] !== null))
              .map((key) => [key, request.knownNutrients?.[key] ?? null]),
          ],
          modelVersion: RATIO_FIT_SEED_MODEL_VERSION,
        }),
        scenarioCount,
      ))
      const selected = fits.sort((left, right) => (
        left.score - right.score
        || left.profiles.map((profile) => profile.profileId).join('|')
          .localeCompare(right.profiles.map((profile) => profile.profileId).join('|'))
      ))[0]
      const fitReferenceIntervals: Partial<Record<NutrientKey, EstimationFitReferenceInterval>> = {}
      if (request.fitMode === 'robust_interval') {
        for (const key of ESTIMATE_FIT_NUTRIENT_KEYS) {
          const observation = fitObservationForKey(key, fitContext)
          if (
            observation?.labelInterval
            && selected.profiles.every((profile) => profile.nutrients[key] !== null)
          ) {
            fitReferenceIntervals[key] = observation.labelInterval
          }
        }
      }
      const hasCandidateAmbiguity = resolved.some((item) => item.candidates.length > 1)
        || selected.profiles.some((profile) => profile.ambiguous)
      const hasCompound = declaration.ingredients.some((ingredient) => ingredient.components.length > 0)
      const hasAdditives = declaration.additives.length > 0
      const selectedRatioFeedback = ratioFeedbackContext
        ? estimationRatioFeedback(ratioFeedbackContext, selected, request.referenceMassG!)
        : null
      const warnings = [
        selected.usedMacroFit
          ? '原材料の配合比は、表示順の制約内で入力済み主要栄養値との整合が高い候補を推定しています。'
          : '原材料の配合比は表示順から推定しており、実際の配合比ではありません。',
        ...(hasCandidateAmbiguity
          ? ['同じ原材料名に複数の参照食品候補があるため、候補ごとの事前確率と主要栄養値の整合を比較しています。']
          : []),
        ...(hasCandidateAmbiguity && request.productName?.trim()
          ? [`商品名「${request.productName.trim()}」は候補選択の弱い事前確率にだけ使用し、原材料の明示語と主要栄養値を優先しています。`]
          : []),
        ...(request.estimatorGenreId && request.estimatorGenreId !== 'other_unknown'
          ? [`食品ジャンルは候補選択の事前分布（${ESTIMATOR_GENRE_PRIOR_VERSION}）にだけ使用しています。`]
          : []),
        ...(selectedRatioFeedback
          ? [`入力済み脂質と飽和脂肪酸／脂質比率の5〜95%分布を、候補食品・配合比探索の弱い制約（重み${round(selectedRatioFeedback.feedbackWeight)}）として使用しました。`]
          : []),
        ...(hasCompound
          ? ['括弧付きの複合原材料は、外側の表示順と括弧内の表示順を別々に保って解析しています。']
          : []),
        ...(hasAdditives
          ? [`添加物区画（${declaration.additives.map((item) => item.normalizedName).join('、')}）は主原材料の配合比から分離しています。栄養寄与を0とはみなさず、この参考推計の対象外として不確実性を広げています。`]
          : []),
        ...(declaration.inferredAdditiveBoundary
          ? ['「／」がないため、既知の添加物名から添加物区画の開始位置を推定しました。']
          : []),
        ...selected.profiles.flatMap((profile) => profile.derivationWarnings ?? []),
      ]
      const confidence: AvailableNutrientEstimate['confidence'] = (
        hasCandidateAmbiguity
        || hasCompound
        || hasAdditives
        || !selected.usedMacroFit
        || (selected.normalizedError ?? Number.POSITIVE_INFINITY) > 4
      ) ? 'low' : 'medium'
      const genrePriorContributionRatios: Partial<Record<NutrientKey, number>> = {}
      const makeEstimate = (key: EstimatableNutrientKey): NutrientEstimate => {
        const unmodeledAdditives = unmodeledAdditivesForNutrient(declaration.additives, key)
        const missingProfiles = selected.profiles.filter((profile) => profile.nutrients[key] === null)
        const numericProfileIndexes = selected.profiles.flatMap((profile, index) => (
          profile.nutrients[key] === null ? [] : [index]
        ))
        const knownPer100g = numericProfileIndexes.reduce((total, index) => (
          total + selected.profiles[index].nutrients[key]! * selected.ratios[index]
        ), 0)
        const missingMassFraction = missingProfiles.length > 0
          ? selected.profiles.reduce((total, profile, index) => (
              total + (profile.nutrients[key] === null ? selected.ratios[index] : 0)
            ), 0)
          : 0
        const genrePrior = applyGenrePriorToUnmodeledMass({
          knownPer100g,
          unmodeledMassFraction: missingMassFraction,
          nutrientKey: key,
          genreId: request.estimatorGenreId,
          referenceMassG: request.referenceMassG!,
          usePriorMedianAsPoint: numericProfileIndexes.length === 0,
        })
        if (genrePrior) genrePriorContributionRatios[key] = missingMassFraction
        if (numericProfileIndexes.length === 0 && !genrePrior) {
          const missingSourceFoodIds = [...new Set(missingProfiles.flatMap((profile) => sourceFoodIdsForNutrient(profile, key)))]
          return unavailable(
            `参照食品の${NUTRIENT_LABELS[key]}がすべて欠損しているため、この栄養素は推計できません。`,
            'パッケージの栄養成分表示を確認して手入力するか、この栄養素を採用せず食品登録を続けてください。',
            [`MEXT参照値が欠損しています（食品ID: ${missingSourceFoodIds.join('、')}）。`],
            [
              'reference_value_missing',
              ...(unmodeledAdditives.length > 0 ? ['additive_contribution_unknown' as const] : []),
            ],
          )
        }
        const limitationReasons: EstimationLimitationReason[] = [
          ...(missingProfiles.length > 0 ? ['reference_value_missing' as const] : []),
          ...(unmodeledAdditives.length > 0 ? ['additive_contribution_unknown' as const] : []),
        ]
        const isPartial = limitationReasons.length > 0
        const value = genrePrior?.value ?? round(knownPer100g * request.referenceMassG! / 100)
        const zeroEvidence = isPartial || genrePrior
          ? 'uncertain' as const
          : zeroEvidenceFromResolvedCandidates(resolved, key, unmodeledAdditives.length > 0)
        const calibrated = calibratedEstimateRange({
          value,
          nutrientKey: key,
          genreId: request.estimatorGenreId,
          confidence: isPartial ? 'low' : confidence,
          zeroEvidence,
        })
        const candidateScenarios = candidateScenarioRange(
          fits,
          selected,
          key,
          request.referenceMassG!,
        )
        const baseRange = genrePrior?.range ?? calibrated.range
        const contributingProfiles = numericProfileIndexes.map((index) => selected.profiles[index])
        const sourceFoodIds = [...new Set(contributingProfiles.flatMap((profile) => sourceFoodIdsForNutrient(profile, key)))]
        return {
          status: 'available',
          value,
          range: candidateScenarios
            ? mergeEstimateRanges(value, baseRange, candidateScenarios.range)
            : baseRange,
          confidence: isPartial ? 'low' : calibrated.confidence,
          calibration: genrePrior?.calibration ?? calibrated.calibration,
          adoptionClass: genrePrior
            ? 'genre_prior_confirmation'
            : isPartial || calibrated.confidence === 'low'
              ? 'limited_confirmation'
              : 'standard_confirmation',
          ...(value === 0 ? { zeroEvidence } : {}),
          method: genrePrior
            ? GENRE_PRIOR_PARTIAL_METHOD
            : isPartial
              ? PARTIAL_METHOD
              : selected.usedMacroFit
                ? FIT_METHOD
                : FALLBACK_METHOD,
          sourceFoodIds,
          source: [
            ...(sourceFoodIds.length > 0 ? [estimateSource(sourceFoodIds)] : []),
            ...(genrePrior ? [ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE] : []),
          ].join(' / '),
          limitationReasons,
          warnings: [...new Set([
            ...warnings,
            ...(genrePrior
              ? genrePriorWarnings(genrePrior.prior, missingMassFraction, numericProfileIndexes.length === 0)
              : []),
            ...(missingProfiles.length > 0
              ? [genrePrior
                  ? `参照食品側で${NUTRIENT_LABELS[key]}が欠損する原材料の重量枠をジャンル事前分布で補っています。`
                  : `参照食品側で${NUTRIENT_LABELS[key]}が欠損する原材料の寄与は加算していません。`]
              : []),
            ...(unmodeledAdditives.length > 0
              ? [`${NUTRIENT_LABELS[key]}へ寄与し得る添加物（${unmodeledAdditives.join('、')}）の配合量は不明なため加算していません。`]
              : []),
            ...(isPartial && !genrePrior
              ? [
                  'この値は数値を確認できる原材料分だけの部分参考値であり、実際の商品の保証された下限ではありません。',
                  '部分参考値の範囲は商品の栄養値全体の上限を表しません。',
                ]
              : []),
            ...(genrePrior
              ? ['ジャンル補完参考値と推定範囲は、この商品の栄養値を保証する下限または上限ではありません。']
              : []),
            ...(candidateScenarios
              ? [`栄養表示への適合度が近い候補食品・配合比${candidateScenarios.plausibleScenarioCount}通りの5〜95%加重分位点を、暫定推定範囲の外側へ統合しています。`]
              : []),
            ...(calibrated.processingDeferred
              ? ['加工・調理係数を後回しにしているジャンル・栄養素のため、信頼度を低にしています。']
              : []),
            ...uncertainZeroWarning(value, zeroEvidence),
            '教師データによる校正前のため、推定範囲は90%被覆率を目標とする暫定フォールバックです。',
          ])],
        }
      }

      estimates = mapEstimatableNutrients((key) => requested.has(key)
        ? makeEstimate(key)
        : unavailable(
            'この栄養素は今回の推計対象に選ばれていません。',
            '必要な場合は推計対象に含めて再実行してください。',
            [],
            ['not_requested'],
          ))
      optimization = {
        converged: selected.usedMacroFit,
        ...(selected.normalizedError === null ? {} : { objectiveError: selected.normalizedError }),
        scenarioCount: scenarioCount * combinations.length,
        trace: {
          ingredientNames: declaration.ingredients.map((ingredient) => ingredient.normalizedName),
          selectedProfileIds: selected.profiles.map((profile) => profile.profileId),
          ingredientRatios: [...selected.ratios],
          fitScore: round(selected.score),
          normalizedFitError: selected.normalizedError === null ? null : round(selected.normalizedError),
          candidateCombinationCount: cartesianCandidateCombinationCount(
            resolved.map((item) => item.candidates),
          ),
          retainedCandidateCombinationCount: combinations.length,
          plausibleScenarioCount: plausibleFits(fits, selected).length,
          unresolvedMassRatio: 0,
          genrePriorContributionRatios,
          ...(request.fitMode === 'robust_interval'
            ? { fitMode: 'robust_interval' as const, fitReferenceIntervals }
            : {}),
          ...(selectedRatioFeedback ? { ratioFeedback: selectedRatioFeedback } : {}),
        },
      }
    }
    }
  }

  if (!explicitOutput) {
    estimates = applySaturatedFatRatioPrior(
      estimates,
      postprocessingKnownNutrients,
      request.estimatorGenreId,
      ratioStrategy.postBlendWeight,
    )
    estimates = applyCompositionUpperBounds(estimates, postprocessingKnownNutrients)
  } else {
    estimates = applyCompositionUpperBounds(estimates, postprocessingKnownNutrients)
  }
  const unresolvedIngredients = explicitOutput?.unresolvedIngredients
    ?? (request.ingredientsText?.trim()
      ? unresolvedIngredientNames(request.ingredientsText, request.productName, request.estimatorGenreId)
      : [])
  const hasPartialEstimate = Object.values(estimates).some((estimate) => (
    estimate.status === 'available' && estimate.method === PARTIAL_METHOD
  ))
  const hasGenrePriorPartialEstimate = Object.values(estimates).some((estimate) => (
    estimate.status === 'available' && estimate.method === GENRE_PRIOR_PARTIAL_METHOD
  ))
  return {
    requestId: request.requestId,
    status: resultStatus(estimates, requested),
    basis: { baseAmount: request.baseAmount, baseUnit: request.baseUnit },
    estimates,
    globalWarnings: [
      '参考推計であり、実測値やパッケージ表示と同等の正確性を保証しません。',
      ...(hasPartialEstimate
        ? ['部分参考値は理由分類に該当する原材料または添加物の寄与を含みません。商品の栄養値全体の下限または上限としては使用できません。']
        : []),
      ...(hasGenrePriorPartialEstimate
        ? ['ジャンル補完参考値は、直接参照できない重量枠をメーカー公式表示の階層型事前分布で補っています。分離重量や商品の栄養値を保証するものではありません。']
        : []),
    ],
    unresolvedIngredients,
    ...(optimization ? { optimization } : {}),
    modelVersion: MODEL_VERSION,
    estimatedAt: request.requestedAt,
  }
}

/** ブラウザ内推計の結果を、IndexedDBへ保存する共通結果形式へ変換する。 */
export function toStoredNutrientEstimateResult(
  result: NutrientEstimateResult,
  input: { foodId: string; inputHash: string; baseAmount: number; baseUnit: FoodUnit },
): EstimationResult {
  const estimates: EstimationResult['estimates'] = {}
  for (const key of ESTIMATABLE_NUTRIENT_KEYS) {
    const estimate = result.estimates[key]
    if (estimate.status !== 'available') continue
    estimates[key] = {
      value: estimate.value,
      range: { ...estimate.range },
      confidence: estimate.confidence,
      method: estimate.method,
      source: estimate.source,
      sourceFoodIds: [...estimate.sourceFoodIds],
      warnings: [...estimate.warnings],
      ...(estimate.limitationReasons.length > 0
        ? { limitationReasons: [...estimate.limitationReasons] }
        : {}),
      calibration: { ...estimate.calibration },
      ...(estimate.zeroEvidence ? { zeroEvidence: estimate.zeroEvidence } : {}),
      adoptionClass: estimate.adoptionClass,
      ...(estimate.ratioAdjustment
        ? {
            ratioAdjustment: {
              ...estimate.ratioAdjustment,
              unadjustedRange: { ...estimate.ratioAdjustment.unadjustedRange },
            },
          }
        : {}),
    }
  }
  const unavailableEstimate = Object.values(result.estimates).find((estimate) => estimate.status === 'unavailable')
  const limitationReasons = [...new Set(
    Object.values(result.estimates).flatMap((estimate) => estimate.limitationReasons),
  )]
  const primaryLimitationReason = limitationReasons[0]
  return {
    requestId: result.requestId,
    foodId: input.foodId,
    inputHash: input.inputHash,
    status: result.status,
    basis: { baseAmount: input.baseAmount, baseUnit: input.baseUnit },
    estimates,
    globalWarnings: [...result.globalWarnings],
    unresolvedIngredients: [...result.unresolvedIngredients],
    ...(result.optimization
      ? {
          optimization: {
            ...result.optimization,
            ...(result.optimization.trace
              ? {
                  trace: {
                    ...result.optimization.trace,
                    ingredientNames: [...result.optimization.trace.ingredientNames],
                    selectedProfileIds: [...result.optimization.trace.selectedProfileIds],
                    ingredientRatios: [...result.optimization.trace.ingredientRatios],
                    genrePriorContributionRatios: {
                      ...result.optimization.trace.genrePriorContributionRatios,
                    },
                    ...(result.optimization.trace.fitReferenceIntervals
                      ? {
                          fitReferenceIntervals: Object.fromEntries(
                            Object.entries(result.optimization.trace.fitReferenceIntervals).map(([key, interval]) => (
                              [key, interval ? { ...interval } : interval]
                            )),
                          ) as EstimationTrace['fitReferenceIntervals'],
                        }
                      : {}),
                    ...(result.optimization.trace.ratioFeedback
                      ? { ratioFeedback: { ...result.optimization.trace.ratioFeedback } }
                      : {}),
                    ...(result.optimization.trace.explicitCompositionEvidence
                      ? {
                          explicitCompositionEvidence: {
                            ...result.optimization.trace.explicitCompositionEvidence,
                            groups: result.optimization.trace.explicitCompositionEvidence.groups.map((group) => ({
                              ...group,
                              parentPath: [...group.parentPath],
                              fixedChildRatios: [...group.fixedChildRatios],
                              selectedProfileIds: [...group.selectedProfileIds],
                              stateRegistryIds: [...group.stateRegistryIds],
                              zeroWeightChildIndices: [...group.zeroWeightChildIndices],
                              missingMassFractionByNutrient: { ...group.missingMassFractionByNutrient },
                            })),
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(limitationReasons.length > 0 ? { limitationReasons } : {}),
    ...(result.status === 'failed' && unavailableEstimate?.status === 'unavailable'
      ? {
          error: {
            code: primaryLimitationReason
              ? `ESTIMATE_${primaryLimitationReason.toUpperCase()}`
              : 'ESTIMATE_UNAVAILABLE',
            message: unavailableEstimate.reason,
            nextAction: unavailableEstimate.nextAction,
          },
        }
      : {}),
    modelVersion: result.modelVersion,
    estimatedAt: result.estimatedAt,
  }
}
