import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { buildRequest, parseTargetReference, type TrainingDataset } from './lib/nutrientEstimatorComparison'
import { ESTIMATABLE_NUTRIENT_KEYS, estimateNutrients, type EstimatableNutrientKey } from '../src/services/nutrientEstimator'
import { nutrientLabelReferenceInterval } from '../src/services/nutrientLabelInterval'

import { evaluationMetrics, pairedEvaluationMetrics, type EvaluationObservation } from './lib/nutrientEstimatorHeldoutMetrics'

type Estimator = typeof estimateNutrients
const LARGE_ERROR_FLOORS: Record<EstimatableNutrientKey, number> = { saturatedFatG: 2, fiberG: 2, calciumMg: 100, ironMg: 1, vitaminAMcg: 100, vitaminEMg: 1, vitaminB1Mg: .1, vitaminB2Mg: .1, vitaminCMg: 10 }
function observe(record: TrainingDataset['records'][number], key: EstimatableNutrientKey, estimator: Estimator): EvaluationObservation | null {
  const parsed = parseTargetReference(record.nutrients[key])
  if (typeof parsed === 'string') return null
  const interval = nutrientLabelReferenceInterval(key, parsed.reference, { amount: record.referenceMassG, unit: 'g' })
  const estimate = estimator(buildRequest(record, key, 'legacy_point')).estimates[key]
  const truth = parsed.reference.kind === 'fixed' ? parsed.reference.value! : null
  const scale = 100 / record.referenceMassG
  if (estimate.status !== 'available') return { available: false, kind: null, point: null, truth, absoluteError: null, signedError: null, outsideError: null, rangeWidth: null, pointInside: null, overlap: null, scale, largeError: null }
  const point = estimate.value
  const absoluteError = truth === null ? null : Math.abs(point - truth)
  const kind = estimate.method.includes('genre') ? 'genre_prior' : estimate.method.includes('partial') ? 'known_only' : 'full'
  const pointInside = (point > interval.min || (point === interval.min && interval.minInclusive)) && (point < interval.max || (point === interval.max && interval.maxInclusive))
  const overlap = estimate.range.max > interval.min && estimate.range.min < interval.max
    || (estimate.range.max === interval.min && interval.minInclusive) || (estimate.range.min === interval.max && interval.maxInclusive)
  return { available: true, kind, point, truth, absoluteError, signedError: truth === null ? null : point - truth,
    outsideError: point < interval.min ? interval.min - point : point > interval.max ? point - interval.max : 0,
    rangeWidth: estimate.range.max - estimate.range.min, pointInside, overlap, scale,
    largeError: absoluteError === null ? null : absoluteError * scale > Math.max(LARGE_ERROR_FLOORS[key], Math.abs(truth!) * scale * 2) }
}
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
export async function runFrozenEvaluation(protocolPath: string, baseline: Estimator) {
  const protocol = JSON.parse(await readFile(protocolPath, 'utf8'))
  if (protocol.format !== 'nutrient-estimator-evaluation-freeze' || protocol.fitMode !== 'legacy_point' || protocol.baselineGitSha !== '2e904ffdd1508c7a63e4e87d13603b5a6ba30716') throw new Error('evaluation freeze protocol mismatch')
  const baselineVersion = baseline({ requestId: 'version', baseAmount: 100, baseUnit: 'g', ingredientsText: null, referenceMassG: null, referenceMassSource: null, ingredientsSource: null, knownNutrients: {}, requestedAt: protocol.frozenAt }).modelVersion
  if (baselineVersion !== protocol.baselineModelVersion) throw new Error('baseline version differs from freeze')
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (gitSha !== protocol.finalGitSha) throw new Error('model git SHA differs from freeze')
  for (const [path, expected] of Object.entries(protocol.sourceHashes)) if (hash(await readFile(path)) !== expected) throw new Error('frozen model or evaluator bytes changed')
  for (const [path, expected] of Object.entries(protocol.baselineSourceHashes)) if (hash(await readFile(protocol.baselineRoot + '/' + path)) !== expected) throw new Error('baseline source bytes changed')
  // Guard all model/evaluator bytes before the first held-out label read.
  const dataBytes = await readFile(protocol.datasetPath)
  if (hash(dataBytes) !== protocol.sealedSourceFileSha256) throw new Error('sealed source bytes differ')
  const manifestBytes = await readFile(protocol.manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (!manifest.sealed || !manifest.seal || manifest.sourceFileSha256 !== protocol.sealedSourceFileSha256 || manifest.normalizedDatasetSha256 !== protocol.sealedNormalizedDatasetSha256) throw new Error('sealed manifest hashes differ')
  // Same Python canonical normalization as sealing; training provenance is audited separately.
  execFileSync('python3', ['scripts/audit_frozen_nutrient_evaluation.py', protocolPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  const dataset: TrainingDataset = JSON.parse(dataBytes.toString('utf8'))
  const observations = new Map<string, { row: EvaluationObservation; genre: string; maker: string }[]>()
  const reportModels = []
  for (const [name, estimator] of [['baseline', baseline], ['final', estimateNutrients]] as const) {
    const nutrients = ESTIMATABLE_NUTRIENT_KEYS.map((key) => {
      const paired = dataset.records.flatMap((record) => { const row = observe(record, key, estimator); return row ? [{ row, genre: record.genreId, maker: record.maker }] : [] })
      observations.set(name + ':' + key, paired)
      const rows = paired.map((item) => item.row)
      const byMethod = (['full', 'known_only', 'genre_prior'] as const).map((kind) => ({ kind, populationReferenceCount: rows.length, availableShare: rows.length ? rows.filter((row) => row.kind === kind).length / rows.length : null, per100g: evaluationMetrics(rows.filter((row) => row.kind === kind), true), printedBasis: evaluationMetrics(rows.filter((row) => row.kind === kind), false) }))
      const byGenre = [...new Set(paired.map((item) => item.genre))].map((genreId) => ({ genreId, per100g: evaluationMetrics(paired.filter((item) => item.genre === genreId).map((item) => item.row), true) }))
      const makers = new Set(paired.map((item) => item.maker))
      const maximumMakerShare = rows.length ? Math.max(...[...makers].map((maker) => paired.filter((item) => item.maker === maker).length)) / rows.length : null
      return { nutrientKey: key, independentFamilyCount: rows.length, makerCount: makers.size, maximumMakerShare, formalAdequacy: rows.length >= 30 && makers.size >= 3 && maximumMakerShare !== null && maximumMakerShare <= .5,
        per100g: evaluationMetrics(rows, true), printedBasis: evaluationMetrics(rows, false), byMethod, byGenre }
    })
    reportModels.push({ model: name, modelVersion: estimator({ requestId: 'version', baseAmount: 100, baseUnit: 'g', ingredientsText: null, referenceMassG: null, referenceMassSource: null, ingredientsSource: null, knownNutrients: {}, requestedAt: protocol.frozenAt }).modelVersion, nutrients })
  }
  const report = { format: 'nutrient-estimator-frozen-heldout-comparison', formatVersion: 1, protocolSha256: hash(await readFile(protocolPath)), sourceFileSha256: protocol.sealedSourceFileSha256,
    normalizedDatasetSha256: protocol.sealedNormalizedDatasetSha256, manifestFileSha256: hash(manifestBytes), baselineGitSha: protocol.baselineGitSha, finalGitSha: protocol.finalGitSha,
    recordCount: dataset.records.length, models: reportModels,
    pairedComparison: ESTIMATABLE_NUTRIENT_KEYS.map((key) => ({ nutrientKey: key, per100g: pairedEvaluationMetrics(observations.get('baseline:' + key)!.map((item) => item.row), observations.get('final:' + key)!.map((item) => item.row), true), printedBasis: pairedEvaluationMetrics(observations.get('baseline:' + key)!.map((item) => item.row), observations.get('final:' + key)!.map((item) => item.row), false) })),
    limitations: ['All target nutrients have fewer than 30 independent families; formal accuracy adequacy is unmet.', 'Manufacturer labels are not laboratory truth. MAPE excludes zero and range labels; ranges are not midpoint truth.', 'Interval overlap and point-inside-reference rates are not true-value coverage.', 'Full, known-only and genre-prior results must not be merged into a full-estimate accuracy claim.', 'Training priors remain legacy_unreviewed; source byte integrity is distinct from human review.', 'No model changes are made after held-out evaluation.'] }
  await writeFile('docs/analysis/nutrient_estimator_frozen_evaluation.json', JSON.stringify(report, null, 2) + '\n')
  process.stdout.write('Frozen held-out aggregate comparison written; records=' + dataset.records.length + '\n')
}
