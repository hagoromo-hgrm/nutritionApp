export interface EvaluationObservation {
  available: boolean; kind: 'full' | 'known_only' | 'genre_prior' | null
  point: number | null; truth: number | null; absoluteError: number | null; signedError: number | null
  outsideError: number | null; rangeWidth: number | null; pointInside: boolean | null; overlap: boolean | null
  scale: number; largeError: boolean | null
}
const mean = (values: number[]) => values.length ? values.reduce((s, n) => s + n, 0) / values.length : null
const quantile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1] : null
export function evaluationMetrics(rows: EvaluationObservation[], per100g: boolean) {
  const available = rows.filter((row) => row.available)
  const scale = (row: EvaluationObservation) => per100g ? row.scale : 1
  const errors = available.flatMap((row) => row.absoluteError === null ? [] : [row.absoluteError * scale(row)])
  const signed = available.flatMap((row) => row.signedError === null ? [] : [row.signedError * scale(row)])
  const positive = available.filter((row) => row.truth !== null && row.truth > 0 && row.absoluteError !== null)
  return { referenceCount: rows.length, availableCount: available.length, availability: rows.length ? available.length / rows.length : null,
    fixedPointCount: errors.length, fixedPointMae: mean(errors), fixedPointBias: mean(signed), p90AbsoluteError: quantile(errors, .9), p95AbsoluteError: quantile(errors, .95),
    positiveMapeCount: positive.length, positiveMapePercent: mean(positive.map((row) => row.absoluteError! / row.truth! * 100)),
    zeroLabelCount: rows.filter((row) => row.truth === 0).length,
    intervalOutsideMae: mean(available.flatMap((row) => row.outsideError === null ? [] : [row.outsideError * scale(row)])),
    meanRangeWidth: mean(available.flatMap((row) => row.rangeWidth === null ? [] : [row.rangeWidth * scale(row)])),
    pointInsideReferenceIntervalRate: mean(available.flatMap((row) => row.pointInside === null ? [] : [Number(row.pointInside)])),
    intervalOverlapRate: mean(available.flatMap((row) => row.overlap === null ? [] : [Number(row.overlap)])),
    largeErrorCount: available.filter((row) => row.largeError).length }
}

export function pairedEvaluationMetrics(baseline: EvaluationObservation[], final: EvaluationObservation[], per100g: boolean) {
  if (baseline.length !== final.length) throw new Error('paired population differs')
  const common = baseline.flatMap((row, index) => row.available && final[index].available ? [{ baseline: row, final: final[index] }] : [])
  const before = evaluationMetrics(common.map((row) => row.baseline), per100g)
  const after = evaluationMetrics(common.map((row) => row.final), per100g)
  const delta = (a: number | null, b: number | null) => a === null || b === null ? null : b - a
  return { populationReferenceCount: baseline.length, commonAvailableCount: common.length,
    becameAvailableCount: baseline.filter((row, index) => !row.available && final[index].available).length,
    becameUnavailableCount: baseline.filter((row, index) => row.available && !final[index].available).length,
    methodChangedCount: common.filter((row) => row.baseline.kind !== row.final.kind).length,
    baseline: before, final: after, fixedPointMaeDelta: delta(before.fixedPointMae, after.fixedPointMae),
    intervalOutsideMaeDelta: delta(before.intervalOutsideMae, after.intervalOutsideMae),
    meanRangeWidthDelta: delta(before.meanRangeWidth, after.meanRangeWidth) }
}
