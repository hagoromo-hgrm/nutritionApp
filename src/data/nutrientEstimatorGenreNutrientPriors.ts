import priorArtifact from '../../data/estimator/spu_genre_nutrient_priors.json'
import type { EstimationCalibrationMetadata, EstimatorGenreId, NutrientKey } from '../types'

export const ESTIMATOR_GENRE_NUTRIENT_PRIOR_VERSION = priorArtifact.transformVersion
export const ESTIMATOR_GENRE_NUTRIENT_PRIOR_SOURCE = priorArtifact.source.provider

interface ArtifactPrior {
  sampleSize: number
  pooledSampleSize?: number
  scope: EstimationCalibrationMetadata['scope']
  genreObservationWeight: number
  p05: number
  median: number
  p95: number
}

export interface GenreNutrientPrior extends ArtifactPrior {
  datasetHash: string
  priorVersion: string
}

interface PriorArtifact {
  transformVersion: string
  source: {
    provider: string
    datasetSha256: string
  }
  global: {
    nutrients: Partial<Record<NutrientKey, ArtifactPrior>>
  }
  genres: Partial<Record<EstimatorGenreId, {
    nutrients: Partial<Record<NutrientKey, ArtifactPrior>>
  }>>
}

const artifact = priorArtifact as PriorArtifact

/**
 * 少数ジャンルとその他・不明は生成時に栄養素全体へ縮約済み。
 * 未収載ジャンルも同じ全体分布へフォールバックし、存在しない局所分布を捏造しない。
 */
export function genreNutrientPrior(
  genreId: EstimatorGenreId | null | undefined,
  nutrientKey: NutrientKey,
): GenreNutrientPrior | null {
  const prior = (genreId ? artifact.genres[genreId]?.nutrients[nutrientKey] : undefined)
    ?? artifact.global.nutrients[nutrientKey]
  return prior
    ? {
        ...prior,
        datasetHash: artifact.source.datasetSha256,
        priorVersion: artifact.transformVersion,
      }
    : null
}
