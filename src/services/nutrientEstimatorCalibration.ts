import type {
  EstimationCalibrationMetadata,
  EstimationConfidence,
  EstimatorGenreId,
  NutrientKey,
} from '../types'

const CALIBRATION_VERSION = 'fallback-coverage-0.1.0'
export const ESTIMATOR_TARGET_COVERAGE = 0.9

const PROCESSING_SENSITIVE_GENRES = new Set<EstimatorGenreId>([
  'fried_food',
  'noodle_flour_dish',
  'prepared_meal',
])

const PROCESSING_SENSITIVE_NUTRIENTS = new Set<NutrientKey>([
  'vitaminAMcg',
  'vitaminEMg',
  'vitaminB1Mg',
  'vitaminB2Mg',
  'vitaminCMg',
])

const ABSOLUTE_FLOOR: Record<NutrientKey, number> = {
  energyKcal: 5,
  proteinG: 0.1,
  fatG: 0.1,
  carbohydrateG: 0.1,
  fiberG: 0.1,
  calciumMg: 2,
  ironMg: 0.1,
  vitaminAMcg: 5,
  vitaminEMg: 0.1,
  vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.01,
  vitaminCMg: 1,
  saturatedFatG: 0.1,
  saltG: 0.05,
}

export interface CalibratedEstimateRange {
  range: { min: number; max: number }
  confidence: Exclude<EstimationConfidence, 'unavailable'>
  calibration: EstimationCalibrationMetadata
  processingDeferred: boolean
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
}

/**
 * 教師・校正データが届くまでの明示的なフォールバック。
 * sampleSize=0とscope=fallbackを保存し、校正済み範囲に見せない。
 */
export function calibratedEstimateRange(input: {
  value: number
  nutrientKey: NutrientKey
  genreId?: EstimatorGenreId | null
  confidence: Exclude<EstimationConfidence, 'unavailable'>
}): CalibratedEstimateRange {
  const processingDeferred = Boolean(
    input.genreId
    && PROCESSING_SENSITIVE_GENRES.has(input.genreId)
    && PROCESSING_SENSITIVE_NUTRIENTS.has(input.nutrientKey),
  )
  const confidence = processingDeferred || input.confidence === 'low' ? 'low' : input.confidence
  const calibration: EstimationCalibrationMetadata = {
    calibrationVersion: CALIBRATION_VERSION,
    targetCoverage: ESTIMATOR_TARGET_COVERAGE,
    sampleSize: 0,
    scope: 'fallback',
  }
  // 参照元の全候補が明示的な0である場合は、欠損や表示上の丸め0とは別の「真の0」として維持する。
  if (input.value === 0) {
    return {
      range: { min: 0, max: 0 },
      confidence,
      calibration,
      processingDeferred,
    }
  }
  const [lowerRate, upperRate] = confidence === 'low' ? [0.5, 0.7] : [0.25, 0.3]
  const floor = ABSOLUTE_FLOOR[input.nutrientKey]
  const lowerWidth = Math.max(input.value * lowerRate, floor)
  const upperWidth = Math.max(input.value * upperRate, floor)
  return {
    range: {
      min: round(input.value - lowerWidth),
      max: round(input.value + upperWidth),
    },
    confidence,
    calibration,
    processingDeferred,
  }
}
