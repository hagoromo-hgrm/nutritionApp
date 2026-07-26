import type { EstimatorGenreId } from '../types'

/**
 * 教師データ導入前の版付き初期事前分布。
 * OFF由来の生成物とは混在させず、教師・校正データが届いたら生成済み分布へ置き換える。
 */
export const ESTIMATOR_GENRE_PRIOR_VERSION = 'curated-genre-prior-0.1.0'

export const ESTIMATOR_GENRE_PROFILE_MULTIPLIERS: Partial<Record<
  EstimatorGenreId,
  Readonly<Record<string, number>>
>> = {
  baked_sweets: {
    mext_01015: 4,
    mext_14017: 2,
    mext_14009: 1.8,
    mext_12004: 1.5,
  },
  cake_pastry: {
    mext_01015: 3,
    mext_14017: 2.5,
    mext_12004: 2,
    mext_13014: 2,
  },
  bread: {
    mext_01020: 6,
    mext_01018: 0.5,
    mext_01015: 0.6,
    mext_17083: 3,
    mext_17082: 2,
  },
  chocolate: {
    proxy_cacao_mass_mext_15187: 4,
    fdc_cocoa_butter: 4,
    mext_14009: 2,
    mext_14008: 0.35,
    mext_14005: 0.5,
    mext_13009: 2,
  },
  snack_rice_cracker: {
    mext_14008: 3,
    mext_14005: 2,
    mext_14009: 1.5,
  },
  frozen_dessert: {
    mext_13014: 3,
    mext_13016: 2,
    mext_13009: 2,
    mext_14009: 2,
  },
  dairy: {
    mext_13003: 4,
    mext_13009: 3,
    mext_13010: 2,
    mext_13014: 2,
  },
  fried_food: {
    mext_14008: 4,
    mext_14005: 2,
    mext_14009: 0.7,
  },
  noodle_flour_dish: {
    mext_01018: 4,
    mext_01020: 1.5,
    mext_01015: 0.7,
  },
  sauce_spread: {
    mext_14008: 2.5,
    mext_14005: 2,
    mext_14009: 0.5,
  },
}

export function genreProfileMultiplier(genreId: EstimatorGenreId | null | undefined, profileId: string): number {
  return genreId ? ESTIMATOR_GENRE_PROFILE_MULTIPLIERS[genreId]?.[profileId] ?? 1 : 1
}
