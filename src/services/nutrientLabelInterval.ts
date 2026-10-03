import type { NutrientKey } from '../types'

export type NutrientLabelValueKind = 'fixed' | 'declared_range' | 'estimated'
export type NutrientLabelBasisUnit = 'g' | 'ml'
export type NutrientLabelBasisMode = 'caa_low_content' | 'relative_only' | 'declared_range'
export type NutrientLabelBasisStatus = 'explicit' | 'unknown' | 'not_applicable'

export interface NutrientLabelReference {
  kind: NutrientLabelValueKind
  value?: number
  min?: number
  max?: number
  decimalPlaces?: number
}

export interface NutrientLabelBasis {
  amount: number
  unit: NutrientLabelBasisUnit
}

export interface NutrientLabelInterval {
  min: number
  max: number
  minInclusive: boolean
  maxInclusive: boolean
  ruleVersion: string
  basisMode: NutrientLabelBasisMode
  basisStatus: NutrientLabelBasisStatus
}

export interface NumericInterval {
  min: number
  max: number
  minInclusive?: boolean
  maxInclusive?: boolean
}

export const NUTRIENT_LABEL_TOLERANCE_RULE_VERSION = 'caa-label-tolerance-2026-10-01-v1'

const UPPER_TOLERANCE: Partial<Record<NutrientKey, number>> = {
  calciumMg: 0.5,
  ironMg: 0.5,
  vitaminAMcg: 0.5,
  vitaminEMg: 0.5,
  vitaminB1Mg: 0.8,
  vitaminB2Mg: 0.8,
  vitaminCMg: 0.8,
}

interface LowContentRule {
  thresholdPer100: number
  absoluteAllowancePer100: number
  zeroUpperPer100: number
}

const LOW_CONTENT_RULES: Partial<Record<NutrientKey, LowContentRule>> = {
  proteinG: { thresholdPer100: 2.5, absoluteAllowancePer100: 0.5, zeroUpperPer100: 0.5 },
  fatG: { thresholdPer100: 2.5, absoluteAllowancePer100: 0.5, zeroUpperPer100: 0.5 },
  carbohydrateG: { thresholdPer100: 2.5, absoluteAllowancePer100: 0.5, zeroUpperPer100: 0.5 },
  fiberG: { thresholdPer100: 2.5, absoluteAllowancePer100: 0.5, zeroUpperPer100: 0.5 },
  saturatedFatG: { thresholdPer100: 0.5, absoluteAllowancePer100: 0.1, zeroUpperPer100: 0.1 },
  energyKcal: { thresholdPer100: 25, absoluteAllowancePer100: 5, zeroUpperPer100: 5 },
  // Sodium thresholds in Annex 9 are 25 mg / 5 mg. This app stores salt equivalent.
  saltG: { thresholdPer100: 0.0635, absoluteAllowancePer100: 0.0127, zeroUpperPer100: 0.0127 },
}

function validateDecimalPlaces(decimalPlaces: number | undefined): void {
  if (decimalPlaces !== undefined && (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0)) {
    throw new Error('表示桁数は0以上の整数で指定してください。')
  }
}

function validateBasis(basis: NutrientLabelBasis | null | undefined): NutrientLabelBasis | null {
  if (basis === undefined || basis === null) return null
  if (
    !Number.isFinite(basis.amount)
    || basis.amount <= 0
    || (basis.unit !== 'g' && basis.unit !== 'ml')
  ) {
    throw new Error('表示基準量は0より大きいgまたはmlで指定してください。')
  }
  return basis
}

function makeInterval(
  min: number,
  max: number,
  maxInclusive: boolean,
  basisMode: NutrientLabelBasisMode,
  basisStatus: NutrientLabelBasisStatus,
): NutrientLabelInterval {
  const normalizedMin = Number.isFinite(min) ? Number(min.toPrecision(15)) : min
  const normalizedMax = Number.isFinite(max) ? Number(max.toPrecision(15)) : max
  if (
    !Number.isFinite(normalizedMin)
    || !Number.isFinite(normalizedMax)
    || normalizedMin < 0
    || normalizedMax < normalizedMin
    || (normalizedMax === normalizedMin && !maxInclusive)
    || (min < max && normalizedMin === normalizedMax)
  ) {
    throw new Error('許容区間の端点が有効な有限範囲ではありません。')
  }
  return {
    min: normalizedMin,
    max: normalizedMax,
    minInclusive: true,
    maxInclusive,
    ruleVersion: NUTRIENT_LABEL_TOLERANCE_RULE_VERSION,
    basisMode,
    basisStatus,
  }
}

/**
 * CAA 2026年10月版の固定表示許容差を、表示値そのものから区間にする。
 * 低含有量の絶対幅は、表示基準が明示されたg/ml量だけへ100g/100ml比で縮尺する。
 */
export function nutrientLabelReferenceInterval(
  nutrientKey: NutrientKey,
  reference: NutrientLabelReference,
  requestedBasis?: NutrientLabelBasis | null,
): NutrientLabelInterval {
  validateDecimalPlaces(reference.decimalPlaces)
  const basis = validateBasis(requestedBasis)

  if (reference.kind === 'estimated') {
    throw new Error('推定表示値にはCAAの固定表示許容差を適用できません。')
  }
  if (reference.kind === 'declared_range') {
    if (
      reference.min === undefined
      || reference.max === undefined
      || !Number.isFinite(reference.min)
      || !Number.isFinite(reference.max)
      || reference.min < 0
      || reference.max < reference.min
    ) {
      throw new Error('表示範囲の最小値と最大値を確認してください。')
    }
    return {
      min: reference.min,
      max: reference.max,
      minInclusive: true,
      maxInclusive: true,
      ruleVersion: NUTRIENT_LABEL_TOLERANCE_RULE_VERSION,
      basisMode: 'declared_range',
      basisStatus: 'not_applicable',
    }
  }
  if (reference.kind !== 'fixed' || reference.value === undefined || !Number.isFinite(reference.value) || reference.value < 0) {
    throw new Error('表示値は0以上の数値で指定してください。')
  }

  const value = reference.value
  const lowRule = LOW_CONTENT_RULES[nutrientKey]
  if (lowRule && basis) {
    const scale = basis.amount / 100
    const threshold = lowRule.thresholdPer100 * scale
    const absoluteAllowance = lowRule.absoluteAllowancePer100 * scale
    const zeroUpper = lowRule.zeroUpperPer100 * scale
    if (
      !Number.isFinite(threshold)
      || !Number.isFinite(absoluteAllowance)
      || !Number.isFinite(zeroUpper)
      || threshold <= 0
      || absoluteAllowance <= 0
      || zeroUpper <= 0
    ) {
      throw new Error('表示基準量から許容区間を計算できません。')
    }
    if (value === 0) {
      return makeInterval(0, zeroUpper, false, 'caa_low_content', 'explicit')
    }

    // The low absolute tolerance applies below the threshold; the relative rule applies at and above it.
    const lowMin = Math.max(0, value - absoluteAllowance)
    const lowMax = Math.min(threshold, value + absoluteAllowance)
    const lowExists = lowMin < lowMax
    const relativeMin = Math.max(threshold, value * 0.8)
    const relativeMax = value * (1 + (UPPER_TOLERANCE[nutrientKey] ?? 0.2))
    const relativeExists = relativeMin <= relativeMax

    if (!lowExists && !relativeExists) {
      throw new Error('表示値に対応するCAA許容区間を計算できません。')
    }
    if (!lowExists) {
      return makeInterval(
        relativeMin,
        relativeMax,
        true,
        relativeMin > value * 0.8 ? 'caa_low_content' : 'relative_only',
        'explicit',
      )
    }
    if (!relativeExists) {
      return makeInterval(lowMin, lowMax, value + absoluteAllowance < threshold, 'caa_low_content', 'explicit')
    }

    // Both branches meet at the scaled threshold because the absolute allowance is 20% of it.
    return makeInterval(lowMin, Math.max(lowMax, relativeMax), true, 'caa_low_content', 'explicit')
  }

  const upper = UPPER_TOLERANCE[nutrientKey] ?? 0.2
  return makeInterval(
    Math.max(0, value * 0.8),
    value * (1 + upper),
    true,
    'relative_only',
    basis ? 'explicit' : 'unknown',
  )
}

export function intervalContains(value: number, interval: NumericInterval): boolean {
  if (!Number.isFinite(value)) return false
  const aboveMinimum = value > interval.min || (value === interval.min && interval.minInclusive !== false)
  const belowMaximum = value < interval.max || (value === interval.max && interval.maxInclusive !== false)
  return aboveMinimum && belowMaximum
}

/** Exact boundary contact has distance zero even for an excluded endpoint; containment remains separate. */
export function intervalDistance(value: number, interval: Pick<NumericInterval, 'min' | 'max'>): number {
  if (value < interval.min) return interval.min - value
  if (value > interval.max) return value - interval.max
  return 0
}

export function intervalSeparationDistance(left: NumericInterval, right: NumericInterval): number {
  if (left.max < right.min) return right.min - left.max
  if (right.max < left.min) return left.min - right.max
  return 0
}

export function normalizedIntervalHuberLoss(
  prediction: NumericInterval,
  reference: NumericInterval,
  normalizationScale: number,
): number {
  if (
    !Number.isFinite(prediction.min)
    || !Number.isFinite(prediction.max)
    || prediction.min < 0
    || prediction.max < prediction.min
    || !Number.isFinite(reference.min)
    || !Number.isFinite(reference.max)
    || reference.min < 0
    || reference.max < reference.min
    || !Number.isFinite(normalizationScale)
    || normalizationScale <= 0
  ) {
    throw new Error('区間損失の予測範囲・参照範囲・正規化尺度を確認してください。')
  }
  const z = intervalSeparationDistance(prediction, reference) / normalizationScale
  return Math.abs(z) <= 1 ? z * z : 2 * Math.abs(z) - 1
}

export function nutrientReferenceNormalizationScale(nutrientKey: NutrientKey, referenceValue: number): number {
  if (!Number.isFinite(referenceValue) || referenceValue < 0) {
    throw new Error('正規化尺度の基準値は0以上の数値で指定してください。')
  }
  const floor = nutrientKey === 'energyKcal' ? 0.5 : 0.05
  return Math.max(floor, referenceValue * 0.02)
}
