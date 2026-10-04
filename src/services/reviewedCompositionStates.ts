import { NUTRIENT_KEYS } from '../types'
import generalProfilesArtifact from '../../data/estimator/general_ingredient_profiles.json'
import { exactIngredientProfileById, type IngredientProfile } from './nutrientEstimatorProfiles'

export const REVIEWED_COMPOSITION_STATE_REGISTRY_VERSION = 'mext-direct-states-2026-10-04-v1'
export const MEXT_COMPOSITION_SOURCE_VERSION = '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
export const REVIEWED_COMPOSITION_SOURCE_DATA_SHA256 = 'af5d1e9c623c3a23bdf29f471df65d2e324988dce3f9c8cf62e9795f15c819ea'

export interface ReviewedCompositionState {
  registryId: string
  profileId: string
  sourceFoodIds: readonly string[]
  sourceVersion: string
  officialSourceUrl: string
  nutrientFingerprint: string
  declaredNameAllowlist: readonly string[]
  profileStateId: string
  finishedIngredientStateId: string
  /** This describes preservation relative to the cited entry, not the ingredient's manufacturing history. */
  stateMeaning: string
}

const reviewedEntries: readonly ReviewedCompositionState[] = [
  {
    registryId: 'mext-03003-as-listed-v1',
    profileId: 'mext_03003',
    sourceFoodIds: ['mext_03003'],
    sourceVersion: MEXT_COMPOSITION_SOURCE_VERSION,
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=3_03003_7',
    nutrientFingerprint: 'fnv1a64:829626972eb4168c',
    declaredNameAllowlist: ['上白糖'],
    profileStateId: 'mext_03003:listed-state-v1',
    finishedIngredientStateId: 'mext_03003:listed-state-v1',
    stateMeaning: 'MEXT上白糖の掲載状態から、配合後に材料状態が変わっていないこと。上白糖の製造工程が非加熱であることは示さない。',
  },
  {
    registryId: 'mext-13010-as-listed-v1',
    profileId: 'mext_13010',
    sourceFoodIds: ['mext_13010'],
    sourceVersion: MEXT_COMPOSITION_SOURCE_VERSION,
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=13_13010_7',
    nutrientFingerprint: 'fnv1a64:9cc27d6dc51c21e7',
    declaredNameAllowlist: ['脱脂粉乳'],
    profileStateId: 'mext_13010:listed-state-v1',
    finishedIngredientStateId: 'mext_13010:listed-state-v1',
    stateMeaning: 'MEXT脱脂粉乳の掲載状態から、配合後に材料状態が変わっていないこと。粉乳の製造工程が非加熱であることは示さない。',
  },
  {
    registryId: 'mext-16048-as-listed-v1',
    profileId: 'mext_16048',
    sourceFoodIds: ['mext_16048'],
    sourceVersion: MEXT_COMPOSITION_SOURCE_VERSION,
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=16_16048_7',
    nutrientFingerprint: 'fnv1a64:9f58747390a1a880',
    declaredNameAllowlist: ['ピュアココア', 'ココアパウダー'],
    profileStateId: 'mext_16048:listed-state-v1',
    finishedIngredientStateId: 'mext_16048:listed-state-v1',
    stateMeaning: 'MEXTピュアココアの掲載状態から、配合後に材料状態が変わっていないこと。原料の製造工程が非加熱であることは示さない。',
  },
]

export const REVIEWED_COMPOSITION_STATES: Readonly<Record<string, ReviewedCompositionState>> = Object.freeze(
  Object.fromEntries(reviewedEntries.map((entry) => [entry.profileId, Object.freeze({
    ...entry,
    sourceFoodIds: Object.freeze([...entry.sourceFoodIds]),
    declaredNameAllowlist: Object.freeze([...entry.declaredNameAllowlist]),
  })])),
)

function stableFingerprint(profile: IngredientProfile): string {
  const canonical = JSON.stringify({
    profileId: profile.profileId,
    sourceFoodIds: [...profile.sourceFoodIds],
    nutrients: NUTRIENT_KEYS.map((key) => [key, profile.nutrients[key]]),
  })
  let hash = 0xcbf29ce484222325n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & mask
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function reviewedCompositionProfile(profileId: string): {
  state: ReviewedCompositionState
  profile: IngredientProfile
} | null {
  const state = REVIEWED_COMPOSITION_STATES[profileId]
  const sourceMetadata = generalProfilesArtifact.source
  if (
    !state
    || state.sourceVersion !== MEXT_COMPOSITION_SOURCE_VERSION
    || sourceMetadata.version !== state.sourceVersion
    || sourceMetadata.sourceDataSha256 !== REVIEWED_COMPOSITION_SOURCE_DATA_SHA256
  ) return null
  const profile = exactIngredientProfileById(profileId)
  if (
    !profile
    || profile.profileId !== state.profileId
    || profile.ambiguous === true
    || profile.sourceFoodIds.length !== state.sourceFoodIds.length
    || profile.sourceFoodIds.some((id, index) => id !== state.sourceFoodIds[index])
    || stableFingerprint(profile) !== state.nutrientFingerprint
  ) return null
  return { state, profile }
}

export function compositionProfileNutrientFingerprint(profile: IngredientProfile): string {
  return stableFingerprint(profile)
}

export function reviewedCompositionDeclaredNameMatches(profileId: string, declaredName: string): boolean {
  const state = REVIEWED_COMPOSITION_STATES[profileId]
  if (!state) return false
  const normalized = declaredName.normalize('NFKC').trim()
  return state.declaredNameAllowlist.some((name) => name.normalize('NFKC').trim() === normalized)
}
