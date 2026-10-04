import type {
  ExplicitCompositionDeferredReason,
  ExplicitProcessingEvidenceSource,
  ExplicitProcessingProof,
  ExplicitProcessingRetention,
  ExplicitProcessingRetentionNutrientKey,
  ExplicitProcessingTrace,
  NutrientKey,
} from '../types'
import { NUTRIENT_KEYS } from '../types'
import generalProfilesArtifact from '../../data/estimator/general_ingredient_profiles.json'
import processingProfilesArtifact from '../../data/estimator/reviewed_processing_profiles.json'
import retentionFactorsArtifact from '../../data/estimator/usda_retention_factors.json'

export const EXPLICIT_PROCESSING_DEFERRED_REASONS: readonly ExplicitCompositionDeferredReason[] = Object.freeze([
  'declaration_stale',
  'processing_path_mismatch',
  'processing_name_mismatch',
  'processing_state_unconfirmed',
  'processing_state_mismatch',
  'processing_profile_stale',
  'processing_mass_unconfirmed',
  'processing_overlap',
  'processing_unbound',
  'processing_not_supported',
  'processing_retention_missing',
  'processing_sodium_transfer_unknown',
  'processing_root_deferred',
])
export const USDA_RF6_SOURCE = Object.freeze({
  reference: 'https://ndownloader.figshare.com/files/44488754',
  version: 'USDA RF6 (2007)',
  sourceSha256: 'b863e891989020edf3a429af8060523e5dee275699ae08893a5f91ff9a84b1e5',
})
export const REVIEWED_PROCESSING_REGISTRY_VERSION = 'mext-rf6-processing-2026-10-04-v1'
export const REVIEWED_PROCESSING_MEXT_SOURCE_VERSION = '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
export const REVIEWED_PROCESSING_MEXT_SOURCE_URL = 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html'
export const REVIEWED_PROCESSING_MEXT_SOURCE_SHA256 = 'af5d1e9c623c3a23bdf29f471df65d2e324988dce3f9c8cf62e9795f15c819ea'

export interface ReviewedProcessingProfile {
  profileId: string
  canonicalName: string
  nutrients: Record<NutrientKey, number | null>
  sourceFoodIds: string[]
  stateId: string
  sourceFoodId: string
  officialSourceUrl: string
  nutrientFingerprint: string
}

interface ProcessingProfileRegistryEntry {
  profileId: string
  canonicalName: string
  sourceFoodId: string
  stateId: string
  officialSourceUrl: string
  nutrientFingerprint: string
  declaredNames: readonly string[]
}

const PROCESSING_PROFILE_REGISTRY: readonly ProcessingProfileRegistryEntry[] = Object.freeze([
  {
    profileId: 'processing_mext_13003_v1',
    canonicalName: '＜牛乳及び乳製品＞　（液状乳類）　普通牛乳',
    sourceFoodId: 'mext_13003',
    stateId: 'mext_13003:listed-state-v1',
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=13_13003_7',
    nutrientFingerprint: 'fnv1a64:c74c215e839337b0',
    declaredNames: ['牛乳', '普通牛乳'],
  },
  {
    profileId: 'processing_mext_12004_v1',
    canonicalName: '鶏卵　全卵　生',
    sourceFoodId: 'mext_12004',
    stateId: 'mext_12004:listed-raw-state-v1',
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=12_12004_7',
    nutrientFingerprint: 'fnv1a64:ab496648be4df3e0',
    declaredNames: ['卵', '鶏卵', '全卵'],
  },
  {
    profileId: 'processing_mext_12005_v1',
    canonicalName: '鶏卵　全卵　ゆで',
    sourceFoodId: 'mext_12005',
    stateId: 'mext_12005:listed-boiled-state-v1',
    officialSourceUrl: 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=12_12005_7',
    nutrientFingerprint: 'fnv1a64:a8827be0a7a31903',
    declaredNames: ['卵', '鶏卵', '全卵'],
  },
])

export interface ReviewedProcessingMethod {
  processId: string
  inputProfileId: string
  inputStateId: string
  outputStateId: string
  rf6Code: string
  finishedProfileId?: string
}

export const REVIEWED_PROCESSING_METHODS: Readonly<Record<string, ReviewedProcessingMethod>> = Object.freeze({
  milk_additional_heat_approx_10min_v1: Object.freeze({
    processId: 'milk_additional_heat_approx_10min_v1',
    inputProfileId: 'processing_mext_13003_v1',
    inputStateId: 'mext_13003:listed-state-v1',
    outputStateId: 'mext_13003:additional-heat-approx-10min:finished-v1',
    rf6Code: '2151',
  }),
  egg_whole_hard_cooked_v1: Object.freeze({
    processId: 'egg_whole_hard_cooked_v1',
    inputProfileId: 'processing_mext_12004_v1',
    inputStateId: 'mext_12004:listed-raw-state-v1',
    outputStateId: 'mext_12005:listed-boiled-state-v1',
    rf6Code: '0105',
    finishedProfileId: 'processing_mext_12005_v1',
  }),
})

const EXPECTED_RF6_PERCENTAGES: Readonly<Record<string, Readonly<Record<ExplicitProcessingRetentionNutrientKey, number>>>> = Object.freeze({
  '0105': Object.freeze({ calciumMg: 100, ironMg: 100, saltG: 100, vitaminCMg: 80, vitaminB1Mg: 85, vitaminB2Mg: 95 }),
  '2151': Object.freeze({ calciumMg: 100, ironMg: 100, saltG: 100, vitaminCMg: 85, vitaminB1Mg: 90, vitaminB2Mg: 100 }),
})
const EXPECTED_RF6_NUTRIENT_NUMBERS: Readonly<Record<ExplicitProcessingRetentionNutrientKey, string>> = Object.freeze({
  calciumMg: '301', ironMg: '303', saltG: '307', vitaminCMg: '401', vitaminB1Mg: '404', vitaminB2Mg: '405',
})

function fingerprintProcessingProfile(profile: Pick<ReviewedProcessingProfile, 'profileId' | 'sourceFoodIds' | 'nutrients'>): string {
  const payload = JSON.stringify({
    profileId: profile.profileId,
    sourceFoodIds: [...profile.sourceFoodIds],
    nutrients: NUTRIENT_KEYS.map((key) => [key, profile.nutrients[key]]),
  })
  let hash = 0xcbf29ce484222325n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= BigInt(payload.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & mask
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function reviewedProcessingProfile(profileId: string): ReviewedProcessingProfile | null {
  const registry = PROCESSING_PROFILE_REGISTRY.find((entry) => entry.profileId === profileId)
  const artifactSource = processingProfilesArtifact.source
  const generalSource = generalProfilesArtifact.source
  if (!registry
    || processingProfilesArtifact.schemaVersion !== 1
    || artifactSource.version !== REVIEWED_PROCESSING_MEXT_SOURCE_VERSION
    || artifactSource.officialSourceUrl !== REVIEWED_PROCESSING_MEXT_SOURCE_URL
    || artifactSource.sourceDataSha256 !== REVIEWED_PROCESSING_MEXT_SOURCE_SHA256
    || artifactSource.processedSourceSha256 !== REVIEWED_PROCESSING_MEXT_SOURCE_SHA256
    || generalSource.version !== REVIEWED_PROCESSING_MEXT_SOURCE_VERSION
    || generalSource.url !== REVIEWED_PROCESSING_MEXT_SOURCE_URL
    || generalSource.sourceDataSha256 !== REVIEWED_PROCESSING_MEXT_SOURCE_SHA256) return null
  const rawProfile = processingProfilesArtifact.profiles.find((item) => item.profileId === profileId)
  if (!rawProfile || rawProfile.canonicalName !== registry.canonicalName
    || rawProfile.sourceFoodId !== registry.sourceFoodId
    || rawProfile.stateId !== registry.stateId
    || rawProfile.sourceVersion !== REVIEWED_PROCESSING_MEXT_SOURCE_VERSION
    || rawProfile.officialSourceUrl !== registry.officialSourceUrl
    || rawProfile.sourceDataSha256 !== REVIEWED_PROCESSING_MEXT_SOURCE_SHA256
    || JSON.stringify(rawProfile.sourceFoodIds) !== JSON.stringify([registry.sourceFoodId])) return null
  const nutrients = {} as Record<NutrientKey, number | null>
  for (const key of NUTRIENT_KEYS) {
    const value = rawProfile.nutrients[key]
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null
    nutrients[key] = value
  }
  const profile: ReviewedProcessingProfile = {
    profileId,
    canonicalName: rawProfile.canonicalName,
    nutrients,
    sourceFoodIds: [...rawProfile.sourceFoodIds],
    stateId: rawProfile.stateId,
    sourceFoodId: rawProfile.sourceFoodId,
    officialSourceUrl: rawProfile.officialSourceUrl,
    nutrientFingerprint: rawProfile.nutrientFingerprint,
  }
  if (fingerprintProcessingProfile(profile) !== registry.nutrientFingerprint
    || rawProfile.nutrientFingerprint !== registry.nutrientFingerprint) return null
  if (profileId === 'processing_mext_13003_v1') {
    const override = rawProfile.reviewedOverrides?.ironMg
    if (!override || override.fromValue !== 0.02 || override.toValue !== 0
      || override.sourceUrl !== registry.officialSourceUrl
      || override.pageSha256 !== '2dbcff6a49011deddace66c46f58c4e5c32c3bbebe29266a42140d4d028cdf90') return null
  } else if (rawProfile.reviewedOverrides !== undefined) return null
  return profile
}

export function reviewedProcessingMethod(processId: string): ReviewedProcessingMethod | null {
  return REVIEWED_PROCESSING_METHODS[processId] ?? null
}

export function processingDeclaredNameMatches(profileId: string, name: string): boolean {
  const registry = PROCESSING_PROFILE_REGISTRY.find((entry) => entry.profileId === profileId)
  if (!registry) return false
  const normalized = name.normalize('NFKC').trim()
  return registry.declaredNames.some((candidate) => candidate.normalize('NFKC').trim() === normalized)
}

export function processingRetentionFactors(
  proof: ExplicitProcessingProof,
  method: ReviewedProcessingMethod,
): Partial<Record<ExplicitProcessingRetentionNutrientKey, number>> | null {
  if (proof.retention.kind === 'usda_rf6') {
    if (proof.retention.code !== method.rf6Code) return null
    const source = retentionFactorsArtifact.source
    if (retentionFactorsArtifact.schemaVersion !== 1
      || source.version !== USDA_RF6_SOURCE.version
      || source.csvSourceUrl !== USDA_RF6_SOURCE.reference
      || source.sourceDataSha256 !== USDA_RF6_SOURCE.sourceSha256
      || source.factorConversion !== 'retentionPercent / 100 exactly once') return null
    const code = proof.retention.code
    const expected = EXPECTED_RF6_PERCENTAGES[code]
    const process = retentionFactorsArtifact.processes.find((entry) => entry.code === code)
    if (!expected || !process) return null
    const factors: Partial<Record<ExplicitProcessingRetentionNutrientKey, number>> = {}
    for (const key of RETENTION_KEYS) {
      const rows = process.factors.filter((factor) => factor.nutrientKey === key)
      if (rows.length !== 1) return null
      const row = rows[0]
      const expectedPercent = expected[key]
      if (row.nutrientNo !== EXPECTED_RF6_NUTRIENT_NUMBERS[key]
        || row.retentionPercent !== expectedPercent
        || !Number.isFinite(row.factor)
        || row.factor < 0 || row.factor > 1
        || row.factor !== row.retentionPercent / 100) return null
      factors[key] = row.factor
    }
    if (process.factors.length !== RETENTION_KEYS.length) return null
    return factors
  }
  return { ...proof.retention.factors }
}

const MAX_PROOFS = 64
const MAX_PATH_DEPTH = 16
const MAX_INDEX = 255
const MAX_MASS_G = 1_000_000_000
const MAX_TEXT = 1024
const RETENTION_KEYS: readonly ExplicitProcessingRetentionNutrientKey[] = Object.freeze([
  'calciumMg', 'ironMg', 'saltG', 'vitaminCMg', 'vitaminB1Mg', 'vitaminB2Mg',
])
const TRACE_NUTRIENT_KEYS: readonly NutrientKey[] = Object.freeze([
  'energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'fiberG', 'calciumMg', 'ironMg',
  'vitaminAMcg', 'vitaminEMg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminCMg', 'saturatedFatG', 'saltG',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label}の字段を確認してください。`)
  }
}

function boundedString(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label}は1〜${max}文字で指定してください。`)
  }
  return value
}

function validatePath(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_PATH_DEPTH) throw new Error('加工根拠の原材料pathを確認してください。')
  return value.map((index) => {
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) > MAX_INDEX) {
      throw new Error('加工根拠の原材料pathを確認してください。')
    }
    return Number(index)
  })
}

function validDateTime(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value))
}

function validateSource(value: unknown, label: string): ExplicitProcessingEvidenceSource {
  if (!isRecord(value)) throw new Error(`${label}の出典を確認してください。`)
  assertKeys(value, ['kind', 'reference', 'verified', 'checkedAt'], ['version', 'sourceSha256'], label)
  const kinds = ['manufacturer_recipe', 'user_measurement', 'official_retention_table', 'material_specification']
  if (!kinds.includes(String(value.kind))) throw new Error(`${label}の出典種別を確認してください。`)
  if (value.verified !== true) throw new Error(`${label}は確認済みの出典を指定してください。`)
  const reference = boundedString(value.reference, `${label}の参照`, MAX_TEXT)
  if (!validDateTime(value.checkedAt)) throw new Error(`${label}の確認日時をISO 8601形式で指定してください。`)
  const version = value.version === undefined ? undefined : boundedString(value.version, `${label}の版`, 128)
  const sourceSha256 = value.sourceSha256
  if (sourceSha256 !== undefined && (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(sourceSha256))) {
    throw new Error(`${label}のSHA-256を確認してください。`)
  }
  return {
    kind: value.kind as ExplicitProcessingEvidenceSource['kind'],
    reference,
    verified: true,
    checkedAt: value.checkedAt,
    ...(version === undefined ? {} : { version }),
    ...(sourceSha256 === undefined ? {} : { sourceSha256 }),
  }
}

function validateRetention(value: unknown): ExplicitProcessingRetention {
  if (!isRecord(value)) throw new Error('加工保持率の根拠を確認してください。')
  if (value.kind === 'usda_rf6') {
    assertKeys(value, ['kind', 'code', 'source'], [], 'USDA RF6保持率')
    const code = boundedString(value.code, 'USDA RF6コード', 4)
    if (!/^\d{4}$/u.test(code)) throw new Error('USDA RF6コードは先頭0を含む4桁文字列で指定してください。')
    const source = validateSource(value.source, 'USDA RF6保持率')
    if (source.kind !== 'official_retention_table'
      || source.reference !== USDA_RF6_SOURCE.reference
      || source.version !== USDA_RF6_SOURCE.version
      || source.sourceSha256 !== USDA_RF6_SOURCE.sourceSha256) {
      throw new Error('USDA RF6保持率には検証済み公式表の出典情報が必要です。')
    }
    return { kind: 'usda_rf6', code, source }
  }
  if (value.kind === 'user_supplied') {
    assertKeys(value, ['kind', 'factors', 'source'], [], '手動保持率')
    if (!isRecord(value.factors)) throw new Error('手動保持率の係数を確認してください。')
    const factors: Partial<Record<ExplicitProcessingRetentionNutrientKey, number>> = {}
    for (const [key, factor] of Object.entries(value.factors)) {
      if (!(RETENTION_KEYS as readonly string[]).includes(key)
        || typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0 || factor > 1) {
        throw new Error('手動保持率は対応栄養素ごとに0〜1の有限値で指定してください。')
      }
      factors[key as ExplicitProcessingRetentionNutrientKey] = factor
    }
    if (Object.keys(factors).length === 0) throw new Error('手動保持率の係数を1項目以上指定してください。')
    const source = validateSource(value.source, '手動保持率')
    if (source.kind !== 'material_specification' && source.kind !== 'user_measurement') {
      throw new Error('手動保持率には材料規格書または実測の出典が必要です。')
    }
    return { kind: 'user_supplied', factors, source }
  }
  throw new Error('加工保持率の種別を確認してください。')
}

function validateMass(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MASS_G) {
    throw new Error(`${label}は0以上の有限重量またはnullで指定してください。`)
  }
  return value
}

export function validateExplicitProcessingProof(value: unknown): ExplicitProcessingProof {
  if (!isRecord(value)) throw new Error('加工根拠を確認してください。')
  assertKeys(value,
    ['id', 'ingredientPath', 'expectedName', 'inputProfileId', 'inputStateId', 'outputStateId', 'processId', 'rawMassG', 'finishedMassG', 'retention', 'source'],
    ['finishedProfileId', 'sodiumTransfer'],
    '加工根拠')
  if (value.sodiumTransfer !== undefined && value.sodiumTransfer !== 'none_confirmed' && value.sodiumTransfer !== 'unknown') {
    throw new Error('ナトリウム移行状態を確認してください。')
  }
  const source = validateSource(value.source, '加工状態根拠')
  if (source.kind !== 'manufacturer_recipe' && source.kind !== 'user_measurement') {
    throw new Error('加工状態の根拠には製造者配合表またはユーザー実測を指定してください。')
  }
  const finishedProfileId = value.finishedProfileId === undefined
    ? undefined
    : boundedString(value.finishedProfileId, '加工後直接profile ID', 128)
  return {
    id: boundedString(value.id, '加工根拠ID', 128),
    ingredientPath: validatePath(value.ingredientPath),
    expectedName: boundedString(value.expectedName, '期待原材料名', 256),
    inputProfileId: boundedString(value.inputProfileId, '加工前profile ID', 128),
    inputStateId: boundedString(value.inputStateId, '加工前状態ID', 128),
    outputStateId: boundedString(value.outputStateId, '加工後状態ID', 128),
    processId: boundedString(value.processId, '工程ID', 128),
    rawMassG: validateMass(value.rawMassG, '加工前重量'),
    finishedMassG: validateMass(value.finishedMassG, '加工後重量'),
    ...(finishedProfileId === undefined ? {} : { finishedProfileId }),
    retention: validateRetention(value.retention),
    ...(value.sodiumTransfer === undefined ? {} : { sodiumTransfer: value.sodiumTransfer }),
    source,
  }
}

export function validateExplicitProcessingProofs(value: unknown): ExplicitProcessingProof[] {
  if (!Array.isArray(value) || value.length > MAX_PROOFS) throw new Error('加工根拠は64件以下で指定してください。')
  const proofs = value.map(validateExplicitProcessingProof)
  const ids = new Set<string>()
  for (const proof of proofs) {
    if (ids.has(proof.id)) throw new Error('加工根拠IDが重複しています。')
    ids.add(proof.id)
  }
  return proofs
}

export function isExplicitProcessingDeferredReason(value: unknown): value is ExplicitCompositionDeferredReason {
  return typeof value === 'string'
    && EXPLICIT_PROCESSING_DEFERRED_REASONS.includes(value as ExplicitCompositionDeferredReason)
}

function traceSource(value: unknown): boolean {
  if (!isRecord(value)) return false
  const allowedKinds = ['manufacturer_recipe', 'user_measurement', 'official_retention_table', 'material_specification']
  return allowedKinds.includes(String(value.kind))
    && typeof value.reference === 'string' && value.reference.length > 0 && value.reference.length <= MAX_TEXT
    && (value.version === undefined || (typeof value.version === 'string' && value.version.length <= 128))
    && (value.sourceSha256 === undefined || (typeof value.sourceSha256 === 'string' && /^[0-9a-f]{64}$/iu.test(value.sourceSha256)))
}

function isProcessingTrace(value: unknown): value is ExplicitProcessingTrace {
  if (!isRecord(value)) return false
  const required = [
    'processingId', 'ingredientPath', 'status', 'inputProfileId', 'inputStateId', 'outputStateId', 'processId',
    'finishedProfileId', 'rawMassG', 'finishedMassG', 'rawToFinishedRatio', 'resolution', 'retentionCode',
    'retentionFactors', 'sodiumTransfer', 'missingNutrients',
  ]
  const optional = ['reason', 'retentionSource', 'source']
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) return false
  if (typeof value.processingId !== 'string' || value.processingId.length === 0 || value.processingId.length > 128) return false
  if (!Array.isArray(value.ingredientPath) || value.ingredientPath.length > MAX_PATH_DEPTH
    || value.ingredientPath.some((index) => !Number.isInteger(index) || Number(index) < 0 || Number(index) > MAX_INDEX)) return false
  if (value.status !== 'applied' && value.status !== 'deferred') return false
  if (value.status === 'deferred' && !isExplicitProcessingDeferredReason(value.reason)) return false
  if (value.status === 'applied' && value.reason !== undefined) return false
  for (const key of ['inputProfileId', 'inputStateId', 'outputStateId', 'processId', 'finishedProfileId', 'retentionCode'] as const) {
    if (value[key] !== null && (typeof value[key] !== 'string' || value[key].length > 256)) return false
  }
  for (const key of ['rawMassG', 'finishedMassG', 'rawToFinishedRatio'] as const) {
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) return false
  }
  if (value.resolution !== null && value.resolution !== 'direct_finished_profile' && value.resolution !== 'retention_factors') return false
  if (value.status === 'applied'
    && (value.resolution === null || typeof value.rawMassG !== 'number' || value.rawMassG <= 0
      || typeof value.finishedMassG !== 'number' || value.finishedMassG <= 0
      || typeof value.rawToFinishedRatio !== 'number' || value.rawToFinishedRatio <= 0)) return false
  if (value.sodiumTransfer !== 'none_confirmed' && value.sodiumTransfer !== 'unknown') return false
  if (!isRecord(value.retentionFactors)) return false
  for (const [key, factor] of Object.entries(value.retentionFactors)) {
    if (!(RETENTION_KEYS as readonly string[]).includes(key)
      || typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0 || factor > 1) return false
  }
  if (value.retentionSource !== undefined && !traceSource(value.retentionSource)) return false
  if (value.source !== undefined && !traceSource(value.source)) return false
  if (!Array.isArray(value.missingNutrients) || value.missingNutrients.some((key) => !(TRACE_NUTRIENT_KEYS as readonly string[]).includes(String(key)))) return false
  return new Set(value.missingNutrients).size === value.missingNutrients.length
}

/** Shared backup boundary for the versioned processing trace embedded in an estimation trace. */
export function isExplicitProcessingTraceArray(value: unknown): value is ExplicitProcessingTrace[] {
  if (!Array.isArray(value) || value.length > MAX_PROOFS || !value.every(isProcessingTrace)) return false
  const ids = value.map((entry) => (entry as ExplicitProcessingTrace).processingId)
  return new Set(ids).size === ids.length
}
