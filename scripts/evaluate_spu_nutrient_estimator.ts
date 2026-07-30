import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  ESTIMATABLE_NUTRIENT_KEYS,
  ESTIMATION_LIMITATION_LABELS,
  ESTIMATE_FIT_NUTRIENT_KEYS,
  GENRE_PRIOR_PARTIAL_METHOD,
  SATURATED_FAT_RATIO_BLEND_WEIGHT,
  estimateNutrients,
  NUTRIENT_ESTIMATOR_MODEL_VERSION,
  type EstimatableNutrientKey,
  type EstimateFitNutrientKey,
} from '../src/services/nutrientEstimator'
import {
  ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH,
  ESTIMATOR_GENRE_NUTRIENT_PRIOR_VERSION,
} from '../src/data/nutrientEstimatorGenreNutrientPriors'
import {
  intervalDistance,
  nutrientLabelReferenceInterval,
  type NutrientLabelReference,
} from '../src/services/nutrientLabelInterval'
import type { EstimationLimitationReason, EstimatorGenreId, NutrientKey } from '../src/types'

type SplitId = 'train' | 'calibration' | 'test'
type ValueKind = 'fixed' | 'declared_range' | 'estimated'
type EstimateKind = 'full' | 'known_only' | 'genre_prior'

interface TrainingNutrient {
  displayText: string
  value: number | null
  rangeMin: number | null
  rangeMax: number | null
  unit: string
  basis: string
  decimalPlaces: number
  valueKind: ValueKind
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

interface TrainingDataset {
  format: 'nutrition-estimator-training-data'
  formatVersion: 1
  records: TrainingRecord[]
}

interface TrainingManifest {
  normalizedDatasetSha256: string
  warnings?: string[]
  records: Array<{
    recordId: string
    genreId: EstimatorGenreId
    groupKey: string
    split: SplitId
  }>
}

interface Observation {
  recordId: string
  split: SplitId
  genreId: EstimatorGenreId
  nutrientKey: EstimatableNutrientKey
  available: boolean
  estimateKind: EstimateKind | null
  limitationReasons: EstimationLimitationReason[]
  pointError: number | null
  percentageError: number | null
  pointInsideReference: boolean | null
  rangeOverlapsReference: boolean | null
  predictedValue: number | null
  predictedMin: number | null
  predictedMax: number | null
  referenceMin: number
  referenceMax: number
  ratioAdjustment?: {
    parentValue: number
    blendWeight: number
    unadjustedValue: number
    unadjustedMin: number
    unadjustedMax: number
    priorMedian: number
  }
}

interface MetricSummary {
  referenceCount: number
  availableCount: number
  availabilityPercent: number
  pointInsideReferencePercent: number | null
  pointAtOrBelowReferenceMinPercent: number | null
  pointAtOrBelowReferenceMaxPercent: number | null
  rangeCoveragePercent: number | null
  maeOutsideReference: number | null
  mapeOutsideReferencePercent: number | null
}

interface LimitationReasonSummary {
  code: EstimationLimitationReason
  label: string
  count: number
  partialAvailableCount: number
  genrePriorAvailableCount: number
  unavailableCount: number
}

function parseArgs(args: string[]): {
  training: string
  manifest: string
  output: string
  summaryOutput?: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error('引数は --training、--manifest、--output と任意の --summary-output を指定してください。')
    }
    values.set(key, value)
  }
  const training = values.get('--training')
  const manifest = values.get('--manifest')
  const output = values.get('--output')
  if (!training || !manifest || !output) throw new Error('引数は --training、--manifest、--output を指定してください。')
  return {
    training,
    manifest,
    output,
    ...(values.has('--summary-output') ? { summaryOutput: values.get('--summary-output') } : {}),
  }
}

function assertDataset(value: unknown): asserts value is TrainingDataset {
  if (!value || typeof value !== 'object') throw new Error('教師データがオブジェクトではありません。')
  const payload = value as Partial<TrainingDataset>
  if (payload.format !== 'nutrition-estimator-training-data' || payload.formatVersion !== 1 || !Array.isArray(payload.records)) {
    throw new Error('教師データの形式が不正です。')
  }
}

function assertManifest(value: unknown): asserts value is TrainingManifest {
  if (!value || typeof value !== 'object') throw new Error('マニフェストがオブジェクトではありません。')
  const payload = value as Partial<TrainingManifest>
  if (typeof payload.normalizedDatasetSha256 !== 'string' || !Array.isArray(payload.records)) {
    throw new Error('マニフェストの形式が不正です。')
  }
}

function nutrientReference(label: TrainingNutrient): NutrientLabelReference {
  return {
    kind: label.valueKind,
    ...(label.value === null ? {} : { value: label.value }),
    ...(label.rangeMin === null ? {} : { min: label.rangeMin }),
    ...(label.rangeMax === null ? {} : { max: label.rangeMax }),
    decimalPlaces: label.decimalPlaces,
  }
}

function knownNutrientValue(label: TrainingNutrient | undefined): number | null {
  if (!label) return null
  if (label.value !== null) return label.value
  if (label.rangeMin !== null && label.rangeMax !== null) return (label.rangeMin + label.rangeMax) / 2
  return null
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator * 100)
}

function summarize(observations: readonly Observation[]): MetricSummary {
  const available = observations.filter((item) => item.available)
  const pointInside = available.filter((item) => item.pointInsideReference === true).length
  const pointAtOrBelowReferenceMin = available.filter((item) => (
    item.predictedValue !== null && item.predictedValue <= item.referenceMin
  )).length
  const pointAtOrBelowReferenceMax = available.filter((item) => (
    item.predictedValue !== null && item.predictedValue <= item.referenceMax
  )).length
  const rangeCovered = available.filter((item) => item.rangeOverlapsReference === true).length
  const pointErrors = available.flatMap((item) => item.pointError === null ? [] : [item.pointError])
  const percentageErrors = available.flatMap((item) => item.percentageError === null ? [] : [item.percentageError])
  return {
    referenceCount: observations.length,
    availableCount: available.length,
    availabilityPercent: percent(available.length, observations.length) ?? 0,
    pointInsideReferencePercent: percent(pointInside, available.length),
    pointAtOrBelowReferenceMinPercent: percent(pointAtOrBelowReferenceMin, available.length),
    pointAtOrBelowReferenceMaxPercent: percent(pointAtOrBelowReferenceMax, available.length),
    rangeCoveragePercent: percent(rangeCovered, available.length),
    maeOutsideReference: pointErrors.length === 0 ? null : round(pointErrors.reduce((sum, value) => sum + value, 0) / pointErrors.length),
    mapeOutsideReferencePercent: percentageErrors.length === 0
      ? null
      : round(percentageErrors.reduce((sum, value) => sum + value, 0) / percentageErrors.length * 100),
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = (sorted.length - 1) / 2
  const lower = Math.floor(middle)
  const upper = Math.ceil(middle)
  return round((sorted[lower] + sorted[upper]) / 2)
}

function summarizeRatioAdjustments(observations: readonly Observation[]) {
  const saturatedFatReferences = observations.filter((item) => item.nutrientKey === 'saturatedFatG')
  const adjusted = saturatedFatReferences.filter((item) => item.ratioAdjustment !== undefined)
  const absoluteChanges = adjusted.map((item) => (
    Math.abs(item.predictedValue! - item.ratioAdjustment!.unadjustedValue)
  ))
  const relativeChanges = adjusted.map((item) => (
    Math.abs(item.predictedValue! - item.ratioAdjustment!.unadjustedValue)
    / Math.max(item.ratioAdjustment!.unadjustedValue, 0.01)
  ))
  return {
    saturatedFatReferenceCount: saturatedFatReferences.length,
    appliedCount: adjusted.length,
    appliedPercent: percent(adjusted.length, saturatedFatReferences.length),
    blendWeight: adjusted[0]?.ratioAdjustment?.blendWeight ?? null,
    medianAbsoluteChangeG: median(absoluteChanges),
    medianRelativeChangePercent: median(relativeChanges.map((value) => value * 100)),
    changedOver10PercentCount: relativeChanges.filter((value) => value > 0.1).length,
    changedOver25PercentCount: relativeChanges.filter((value) => value > 0.25).length,
    unadjustedPointEqualsFatCount: adjusted.filter((item) => (
      Math.abs(item.ratioAdjustment!.unadjustedValue - item.ratioAdjustment!.parentValue) <= 0.000001
    )).length,
    unadjustedPointExceedsFatCount: adjusted.filter((item) => (
      item.ratioAdjustment!.unadjustedValue > item.ratioAdjustment!.parentValue
    )).length,
    adjustedPointEqualsFatCount: adjusted.filter((item) => (
      Math.abs(item.predictedValue! - item.ratioAdjustment!.parentValue) <= 0.000001
    )).length,
  }
}

function summarizeRatioWeight(
  observations: readonly Observation[],
  blendWeight: number,
) {
  const adjusted = observations.filter((item) => (
    item.nutrientKey === 'saturatedFatG'
    && item.ratioAdjustment !== undefined
  ))
  let pointInsideCount = 0
  let percentageErrorTotal = 0
  for (const item of adjusted) {
    const adjustment = item.ratioAdjustment!
    const ingredientValue = Math.min(adjustment.unadjustedValue, adjustment.parentValue)
    const ratioValue = adjustment.parentValue * adjustment.priorMedian
    const predictedValue = (
      ingredientValue * (1 - blendWeight)
      + ratioValue * blendWeight
    )
    const center = (item.referenceMin + item.referenceMax) / 2
    const error = predictedValue < item.referenceMin
      ? item.referenceMin - predictedValue
      : predictedValue > item.referenceMax
        ? predictedValue - item.referenceMax
        : 0
    if (error === 0) pointInsideCount += 1
    if (center > 0) percentageErrorTotal += error / center
  }
  return {
    blendWeight,
    referenceCount: adjusted.length,
    pointInsideReferencePercent: percent(pointInsideCount, adjusted.length),
    mapeOutsideReferencePercent: adjusted.length === 0
      ? null
      : round(percentageErrorTotal / adjusted.length * 100),
  }
}

function groupedSummaries(
  observations: readonly Observation[],
  key: (observation: Observation) => string,
): Record<string, MetricSummary> {
  const groups = new Map<string, Observation[]>()
  for (const observation of observations) {
    const groupKey = key(observation)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), observation])
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, values]) => [groupKey, summarize(values)]),
  )
}

function summarizeLimitationReasons(
  observations: readonly Observation[],
): LimitationReasonSummary[] {
  const counts = new Map<EstimationLimitationReason, {
    count: number
    partialAvailableCount: number
    genrePriorAvailableCount: number
    unavailableCount: number
  }>()
  for (const observation of observations) {
    for (const code of new Set(observation.limitationReasons)) {
      const current = counts.get(code) ?? {
        count: 0,
        partialAvailableCount: 0,
        genrePriorAvailableCount: 0,
        unavailableCount: 0,
      }
      current.count += 1
      if (observation.available && observation.estimateKind === 'known_only') current.partialAvailableCount += 1
      if (observation.available && observation.estimateKind === 'genre_prior') current.genrePriorAvailableCount += 1
      if (!observation.available) current.unavailableCount += 1
      counts.set(code, current)
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({
      code,
      label: ESTIMATION_LIMITATION_LABELS[code],
      ...count,
    }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

function groupedLimitationReasons(
  observations: readonly Observation[],
  key: (observation: Observation) => string,
): Record<string, LimitationReasonSummary[]> {
  const groups = new Map<string, Observation[]>()
  for (const observation of observations) {
    const groupKey = key(observation)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), observation])
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, values]) => [groupKey, summarizeLimitationReasons(values)]),
  )
}

function observationsForEstimateKind(
  observations: readonly Observation[],
  estimateKind: EstimateKind,
): Observation[] {
  return observations.map((observation) => (
    observation.available && observation.estimateKind !== estimateKind
      ? {
          ...observation,
          available: false,
          pointError: null,
          percentageError: null,
          pointInsideReference: null,
          rangeOverlapsReference: null,
          predictedValue: null,
          predictedMin: null,
          predictedMax: null,
        }
      : observation
  ))
}

function summarizeEstimateKind(
  observations: readonly Observation[],
  estimateKind: EstimateKind,
): MetricSummary {
  return summarize(observationsForEstimateKind(observations, estimateKind))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const dataset = JSON.parse(await readFile(args.training, 'utf8')) as unknown
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8')) as unknown
  assertDataset(dataset)
  assertManifest(manifest)
  if (ESTIMATOR_GENRE_NUTRIENT_PRIOR_DATASET_HASH !== manifest.normalizedDatasetSha256) {
    throw new Error(
      'ジャンル・比率事前分布のデータセットハッシュが評価データと一致しません。'
      + ' train分割から事前分布を再生成してください。',
    )
  }
  const splitByRecord = new Map(manifest.records.map((record) => [record.recordId, record.split]))
  const unresolved = new Map<string, { count: number; genres: Set<EstimatorGenreId> }>()
  const observations: Observation[] = []
  let evaluatedRecords = 0
  let failedRecords = 0

  for (const record of dataset.records) {
    const split = splitByRecord.get(record.recordId)
    if (!split) throw new Error(`分割が見つかりません: ${record.recordId}`)
    const requestedNutrients = ESTIMATABLE_NUTRIENT_KEYS.filter((key) => (
      record.nutrients[key]?.valueKind !== undefined
      && record.nutrients[key]?.valueKind !== 'estimated'
    ))
    if (requestedNutrients.length === 0) continue
    const knownNutrients = Object.fromEntries(ESTIMATE_FIT_NUTRIENT_KEYS.map((key) => [
      key,
      knownNutrientValue(record.nutrients[key]),
    ])) as Record<EstimateFitNutrientKey, number | null>
    const result = estimateNutrients({
      requestId: `spu-${record.recordId}`,
      productName: record.productName,
      estimatorGenreId: record.genreId,
      baseAmount: record.baseAmount,
      baseUnit: record.baseUnit,
      referenceMassG: record.referenceMassG,
      referenceMassSource: record.referenceMassSource,
      ingredientsText: record.ingredientsText,
      ingredientsSource: { provider: 'メーカー公式サイト', verified: true },
      knownNutrients,
      requestedNutrients,
      requestedAt: record.verifiedAt,
    })
    evaluatedRecords += 1
    if (result.status === 'failed') failedRecords += 1
    for (const ingredientName of result.unresolvedIngredients) {
      const current = unresolved.get(ingredientName) ?? { count: 0, genres: new Set<EstimatorGenreId>() }
      current.count += 1
      current.genres.add(record.genreId)
      unresolved.set(ingredientName, current)
    }
    for (const nutrientKey of requestedNutrients) {
      const label = record.nutrients[nutrientKey]
      if (!label || label.valueKind === 'estimated') continue
      const reference = nutrientLabelReferenceInterval(nutrientKey, nutrientReference(label))
      const estimate = result.estimates[nutrientKey]
      if (estimate.status !== 'available') {
        observations.push({
          recordId: record.recordId,
          split,
          genreId: record.genreId,
          nutrientKey,
          available: false,
          estimateKind: null,
          limitationReasons: [...estimate.limitationReasons],
          pointError: null,
          percentageError: null,
          pointInsideReference: null,
          rangeOverlapsReference: null,
          predictedValue: null,
          predictedMin: null,
          predictedMax: null,
          referenceMin: reference.min,
          referenceMax: reference.max,
        })
        continue
      }
      const center = (reference.min + reference.max) / 2
      const pointError = intervalDistance(estimate.value, reference)
      observations.push({
        recordId: record.recordId,
        split,
        genreId: record.genreId,
        nutrientKey,
        available: true,
        estimateKind: estimate.method === GENRE_PRIOR_PARTIAL_METHOD
          ? 'genre_prior'
          : estimate.method === 'browser_ingredient_partial_rule'
            ? 'known_only'
            : 'full',
        limitationReasons: [...estimate.limitationReasons],
        pointError,
        percentageError: center <= 0 ? null : pointError / center,
        pointInsideReference: pointError === 0,
        rangeOverlapsReference: estimate.range.max >= reference.min && estimate.range.min <= reference.max,
        predictedValue: estimate.value,
        predictedMin: estimate.range.min,
        predictedMax: estimate.range.max,
        referenceMin: reference.min,
        referenceMax: reference.max,
        ...(estimate.ratioAdjustment
          ? {
              ratioAdjustment: {
                parentValue: estimate.ratioAdjustment.parentValue,
                blendWeight: estimate.ratioAdjustment.blendWeight,
                unadjustedValue: estimate.ratioAdjustment.unadjustedValue,
                unadjustedMin: estimate.ratioAdjustment.unadjustedRange.min,
                unadjustedMax: estimate.ratioAdjustment.unadjustedRange.max,
                priorMedian: estimate.ratioAdjustment.median,
              },
            }
          : {}),
      })
    }
  }

  const output = {
    format: 'nutrition-estimator-spu-evaluation',
    formatVersion: 1,
    modelVersion: NUTRIENT_ESTIMATOR_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    datasetHash: manifest.normalizedDatasetSha256,
    evaluationHash: createHash('sha256')
      .update(JSON.stringify(observations))
      .digest('hex'),
    evaluatedRecords,
    failedRecords,
    unresolvedIngredients: [...unresolved.entries()]
      .map(([name, value]) => ({ name, count: value.count, genres: [...value.genres].sort() }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ja'))
      .slice(0, 500),
    overall: summarize(observations),
    byEstimateKind: {
      full: summarizeEstimateKind(observations, 'full'),
      knownOnly: summarizeEstimateKind(observations, 'known_only'),
      genrePrior: summarizeEstimateKind(observations, 'genre_prior'),
    },
    limitationReasons: {
      overall: summarizeLimitationReasons(observations),
      byNutrient: groupedLimitationReasons(observations, (item) => item.nutrientKey),
      byGenre: groupedLimitationReasons(observations, (item) => item.genreId),
    },
    bySplitEstimateKind: {
      full: groupedSummaries(observationsForEstimateKind(observations, 'full'), (item) => item.split),
      knownOnly: groupedSummaries(observationsForEstimateKind(observations, 'known_only'), (item) => item.split),
      genrePrior: groupedSummaries(observationsForEstimateKind(observations, 'genre_prior'), (item) => item.split),
    },
    bySplit: groupedSummaries(observations, (item) => item.split),
    byNutrient: groupedSummaries(observations, (item) => item.nutrientKey),
    byGenre: groupedSummaries(observations, (item) => item.genreId),
    bySplitNutrient: groupedSummaries(observations, (item) => `${item.split}:${item.nutrientKey}`),
    ratioAdjustment: {
      priorVersion: ESTIMATOR_GENRE_NUTRIENT_PRIOR_VERSION,
      weightSelection: {
        selectedOn: 'calibration',
        selectedWeight: SATURATED_FAT_RATIO_BLEND_WEIGHT,
        candidates: [0, 0.25, 0.5, 0.75, 1].map((weight) => summarizeRatioWeight(
          observations.filter((item) => item.split === 'calibration'),
          weight,
        )),
      },
      overall: summarizeRatioAdjustments(observations),
      bySplit: Object.fromEntries(
        (['train', 'calibration', 'test'] as const).map((split) => [
          split,
          summarizeRatioAdjustments(observations.filter((item) => item.split === split)),
        ]),
      ),
    },
    observations,
  }
  const bestCalibrationWeight = [...output.ratioAdjustment.weightSelection.candidates]
    .sort((left, right) => (
      (left.mapeOutsideReferencePercent ?? Number.POSITIVE_INFINITY)
      - (right.mapeOutsideReferencePercent ?? Number.POSITIVE_INFINITY)
      || (right.pointInsideReferencePercent ?? 0) - (left.pointInsideReferencePercent ?? 0)
      || left.blendWeight - right.blendWeight
    ))[0]?.blendWeight
  if (bestCalibrationWeight !== SATURATED_FAT_RATIO_BLEND_WEIGHT) {
    throw new Error(
      `飽和脂肪酸比率の統合重み${SATURATED_FAT_RATIO_BLEND_WEIGHT}は`
      + `校正区分の最良候補${bestCalibrationWeight}と一致しません。`,
    )
  }
  await mkdir(dirname(args.output), { recursive: true })
  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  const fullEstimateObservations = observationsForEstimateKind(observations, 'full')
  const calibrationMetrics = Object.fromEntries(
    Object.entries(groupedSummaries(fullEstimateObservations, (item) => `${item.split}:${item.nutrientKey}`))
      .filter(([key]) => key.startsWith('calibration:'))
      .map(([key, value]) => [key.replace('calibration:', ''), value]),
  )
  const minimumCalibrationSampleSize = 30
  const calibrationEligibleNutrients = Object.entries(calibrationMetrics)
    .filter(([, value]) => value.availableCount >= minimumCalibrationSampleSize)
    .map(([key]) => key)
  const summary = {
    format: 'nutrition-estimator-spu-evaluation-summary',
    formatVersion: 1,
    modelVersion: output.modelVersion,
    generatedAt: output.generatedAt,
    datasetHash: output.datasetHash,
    evaluationHash: output.evaluationHash,
    recordCount: dataset.records.length,
    evaluatedRecords: output.evaluatedRecords,
    failedRecords: output.failedRecords,
    methodology: {
      split: 'maker + productFamily deterministic 70/15/15',
      estimatedLabelsExcluded: true,
      labelValuesEvaluatedAsIntervals: true,
      unavailableValuesExcludedFromErrorAndCoverage: true,
      availabilityReportedSeparately: true,
      knownOnlyPartialValuesReportedSeparately: true,
      knownOnlyPartialValuesExcludedFromCalibration: true,
      genrePriorValuesReportedSeparately: true,
      genrePriorBuiltFromTrainingSplitOnly: true,
      genrePriorValuesExcludedFromCalibration: true,
      saturatedFatRatioPriorBuiltFromTrainingSplitOnly: true,
      saturatedFatRatioBlendWeightSelectedOnCalibrationSplit: true,
    },
    numericAvailabilityGate: {
      targetPercent: 80,
      actualPercent: output.overall.availabilityPercent,
      passed: output.overall.availabilityPercent >= 80,
    },
    calibrationDecision: {
      minimumSampleSizePerNutrient: minimumCalibrationSampleSize,
      eligibleNutrients: calibrationEligibleNutrients,
      adopted: calibrationEligibleNutrients.length > 0,
      reason: calibrationEligibleNutrients.length > 0
        ? '十分な校正標本がある栄養素だけを個別に採用できます。'
        : '推計可能な校正標本が栄養素ごとに30件未満のため、実測校正は採用しません。',
    },
    dataWarnings: manifest.warnings ?? [],
    overall: output.overall,
    byEstimateKind: output.byEstimateKind,
    limitationReasons: output.limitationReasons,
    bySplitEstimateKind: output.bySplitEstimateKind,
    bySplit: output.bySplit,
    byNutrient: output.byNutrient,
    byGenre: output.byGenre,
    ratioAdjustment: output.ratioAdjustment,
    calibrationByNutrient: calibrationMetrics,
  }
  if (args.summaryOutput) {
    await mkdir(dirname(args.summaryOutput), { recursive: true })
    await writeFile(args.summaryOutput, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify({
    evaluatedRecords: output.evaluatedRecords,
    failedRecords: output.failedRecords,
    overall: output.overall,
    byEstimateKind: output.byEstimateKind,
    limitationReasons: output.limitationReasons,
    bySplitEstimateKind: output.bySplitEstimateKind,
    bySplit: output.bySplit,
    byNutrient: output.byNutrient,
    ratioAdjustment: output.ratioAdjustment,
    topUnresolvedIngredients: output.unresolvedIngredients.slice(0, 30),
  }, null, 2)}\n`)
}

await main()
