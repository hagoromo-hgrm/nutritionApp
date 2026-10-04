import {
  ESTIMATABLE_NUTRIENT_KEYS,
  type EstimatableNutrientKey,
} from './nutrientEstimator'
import { createNutrientEstimateRequestFingerprint } from './confirmedNutrientInputs'
import type {
  EstimatorGenreId,
  EstimatorGenreSource,
  FoodUnitConversion,
  IngredientsSource,
  KnownNutrientReferenceMap,
  NutrientEvidenceMap,
  NutrientReferenceBasis,
  Nutrients,
  ExplicitEstimationEvidence,
} from '../types'

export interface NutrientEstimateRequestKeyInput {
  basis: { baseAmount: number; baseUnit: string }
  productName: string | null
  estimatorGenreId: EstimatorGenreId
  estimatorGenreSource?: EstimatorGenreSource | null
  estimatorCategoryId?: string | null
  ingredientsText: string | null
  referenceMassG: number | null
  referenceMassSource: string | null
  ingredientsSource: IngredientsSource | null
  currentNutrients: Pick<Nutrients, EstimatableNutrientKey>
  currentEvaluationRequestedNutrients?: readonly EstimatableNutrientKey[]
  knownNutrients?: Partial<Nutrients>
  knownNutrientEvidence: NutrientEvidenceMap
  knownNutrientReferences?: KnownNutrientReferenceMap
  knownNutrientReferenceBasis?: NutrientReferenceBasis | null
  fitMode?: 'legacy_point' | 'robust_interval'
  inputUnitConversions?: FoodUnitConversion[]
  estimationEvidence?: ExplicitEstimationEvidence
}

/** Keep an evaluated request current through staged adoption, until an input change clears it. */
export function nutrientEstimatePanelRequestKey(input: NutrientEstimateRequestKeyInput): string {
  const requestedNutrients = input.currentEvaluationRequestedNutrients
    ?? ESTIMATABLE_NUTRIENT_KEYS.filter((key) => input.currentNutrients[key] === null)
  return createNutrientEstimateRequestFingerprint({
    productName: input.productName,
    estimatorCategoryId: input.estimatorCategoryId,
    estimatorGenreId: input.estimatorGenreId,
    estimatorGenreSource: input.estimatorGenreSource,
    baseAmount: input.basis.baseAmount,
    baseUnit: input.basis.baseUnit,
    inputUnitConversions: input.inputUnitConversions,
    estimationEvidence: input.estimationEvidence,
    referenceMassG: input.referenceMassG,
    referenceMassSource: input.referenceMassSource,
    ingredientsText: input.ingredientsText,
    ingredientsSource: input.ingredientsSource,
    knownNutrients: input.knownNutrients,
    knownNutrientEvidence: input.knownNutrientEvidence,
    knownNutrientReferences: input.knownNutrientReferences,
    knownNutrientReferenceBasis: input.knownNutrientReferenceBasis,
    fitMode: input.fitMode,
    requestedNutrients,
  })
}
