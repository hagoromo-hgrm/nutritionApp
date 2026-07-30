import { describe, expect, it } from 'vitest'
import { NUTRIENT_KEYS, type Nutrients } from '../src/types'
import {
  combineCandidateSets,
  type CandidateSelectionContext,
} from '../src/services/nutrientEstimator'
import { saturatedFatRatioPrior } from '../src/data/nutrientEstimatorGenreNutrientPriors'
import type { IngredientProfile } from '../src/services/nutrientEstimatorProfiles'

function candidate(setIndex: number, candidateIndex: number): IngredientProfile {
  const target = candidateIndex === 3
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [
    key,
    key === 'energyKcal'
      ? (target ? 400 : 100 + candidateIndex * 100)
      : key === 'fatG'
        ? 100
        : key === 'saturatedFatG'
          ? (target ? 50 : 200)
          : 0,
  ])) as Nutrients
  return {
    profileId: `set-${setIndex}-candidate-${candidateIndex}`,
    canonicalName: `候補${setIndex}-${candidateIndex}`,
    nutrients,
    sourceFoodIds: [`test-${setIndex}-${candidateIndex}`],
    priorProbability: target ? 0.01 : [0.4, 0.3, 0.29][candidateIndex],
  }
}

describe('nutrient estimator candidate selection', () => {
  const candidateSets = Array.from({ length: 4 }, (_value, setIndex) => (
    Array.from({ length: 4 }, (_candidate, candidateIndex) => candidate(setIndex, candidateIndex))
  ))
  const context: CandidateSelectionContext = {
    referenceMassG: 100,
    knownNutrients: { energyKcal: 400 },
  }

  it('組合せ上限を超えても低事前確率で栄養表示に整合する候補を残す', () => {
    const combinations = combineCandidateSets(candidateSets, 64, context)

    expect(combinations).toHaveLength(64)
    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(true)
  })

  it('同じ入力から候補集合と順序を決定的に再現する', () => {
    const first = combineCandidateSets(candidateSets, 64, context)
    const second = combineCandidateSets(candidateSets, 64, context)

    expect(second).toEqual(first)
  })

  it('組合せ上限を超えても比率分布に整合する低事前確率候補を残す', () => {
    const prior = saturatedFatRatioPrior('chocolate')
    if (!prior) throw new Error('比率事前分布がありません')
    const ratioContext: CandidateSelectionContext = {
      referenceMassG: 100,
      knownNutrients: { fatG: 100 },
      ratioFeedback: {
        parentValue: 100,
        feedbackWeight: 0.2,
        prior,
      },
    }
    const combinations = combineCandidateSets(candidateSets, 64, ratioContext)

    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(true)
  })

  it('栄養表示がなければ従来どおり事前確率順で枝刈りする', () => {
    const combinations = combineCandidateSets(candidateSets, 64)

    expect(combinations.some((combination) => (
      combination.profiles.every((profile) => profile.profileId.endsWith('candidate-3'))
    ))).toBe(false)
    expect(combinations.every((combination, index) => (
      index === 0 || combinations[index - 1].priorProbability >= combination.priorProbability
    ))).toBe(true)
  })
})
