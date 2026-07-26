import type { NutrientKey } from '../types'

export type NutrientLabelValueKind = 'fixed' | 'declared_range' | 'estimated'

export interface NutrientLabelReference {
  kind: NutrientLabelValueKind
  value?: number
  min?: number
  max?: number
  decimalPlaces?: number
}

export interface NutrientLabelInterval {
  min: number
  max: number
  ruleVersion: string
}

export const NUTRIENT_LABEL_TOLERANCE_RULE_VERSION = 'caa-label-tolerance-2022-05-31-v1'

const UPPER_TOLERANCE: Partial<Record<NutrientKey, number>> = {
  calciumMg: 0.5,
  ironMg: 0.5,
  vitaminAMcg: 0.5,
  vitaminEMg: 0.5,
  vitaminB1Mg: 0.8,
  vitaminB2Mg: 0.8,
  vitaminCMg: 0.8,
}

function roundingHalfWidth(decimalPlaces: number): number {
  return 0.5 * 10 ** -Math.max(0, Math.min(decimalPlaces, 12))
}

/**
 * 表示値は真値の点ではなく、表示桁と制度上の基本許容差を含む区間として扱う。
 * 低含有量の個別絶対許容差は、教師データ取込時の版付きルールで追加する。
 */
export function nutrientLabelReferenceInterval(
  nutrientKey: NutrientKey,
  reference: NutrientLabelReference,
): NutrientLabelInterval {
  if (reference.kind === 'declared_range') {
    if (reference.min === undefined || reference.max === undefined || reference.min < 0 || reference.max < reference.min) {
      throw new Error('表示範囲の最小値と最大値を確認してください。')
    }
    return { min: reference.min, max: reference.max, ruleVersion: NUTRIENT_LABEL_TOLERANCE_RULE_VERSION }
  }
  if (reference.value === undefined || !Number.isFinite(reference.value) || reference.value < 0) {
    throw new Error('表示値は0以上の数値で指定してください。')
  }
  const roundedMin = Math.max(0, reference.value - roundingHalfWidth(reference.decimalPlaces ?? 0))
  const roundedMax = reference.value + roundingHalfWidth(reference.decimalPlaces ?? 0)
  const upper = UPPER_TOLERANCE[nutrientKey] ?? 0.2
  const estimatedMultiplier = reference.kind === 'estimated' ? 1.5 : 1
  return {
    min: Math.max(0, roundedMin * (1 - 0.2 * estimatedMultiplier)),
    max: roundedMax * (1 + upper * estimatedMultiplier),
    ruleVersion: NUTRIENT_LABEL_TOLERANCE_RULE_VERSION,
  }
}

export function intervalDistance(value: number, interval: Pick<NutrientLabelInterval, 'min' | 'max'>): number {
  if (value < interval.min) return interval.min - value
  if (value > interval.max) return value - interval.max
  return 0
}
