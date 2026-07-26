import { parseIngredientDeclaration, type ParsedIngredient } from './ingredientParser'
import { resolveIngredientCandidates, type IngredientProfile } from './nutrientEstimatorProfiles'
import {
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  type EstimationResult,
  type FoodUnit,
  type IngredientsSource,
  type NutrientKey,
  type Nutrients,
} from '../types'

export const ESTIMATABLE_NUTRIENT_KEYS = [
  'saturatedFatG',
  'fiberG',
  'calciumMg',
  'ironMg',
  'vitaminAMcg',
  'vitaminEMg',
  'vitaminB1Mg',
  'vitaminB2Mg',
  'vitaminCMg',
] as const satisfies readonly NutrientKey[]

export type EstimatableNutrientKey = (typeof ESTIMATABLE_NUTRIENT_KEYS)[number]
export const ESTIMATE_FIT_NUTRIENT_KEYS = [
  'energyKcal',
  'proteinG',
  'fatG',
  'carbohydrateG',
  'saltG',
] as const satisfies readonly NutrientKey[]
export type EstimateFitNutrientKey = (typeof ESTIMATE_FIT_NUTRIENT_KEYS)[number]
export type EstimateConfidence = 'high' | 'medium' | 'low' | 'unavailable'

export interface NutrientEstimateBasis {
  baseAmount: number
  baseUnit: string
}

export interface NutrientEstimateRequest {
  requestId: string
  productName?: string | null
  baseAmount: number
  baseUnit: string
  referenceMassG: number | null
  referenceMassSource: string | null
  ingredientsText: string | null
  ingredientsSource: IngredientsSource | null
  knownNutrients?: Partial<Pick<Nutrients, EstimateFitNutrientKey>>
  requestedNutrients?: readonly EstimatableNutrientKey[]
  requestedAt: string
}

interface EstimateDetails {
  method: 'browser_ingredient_rule' | 'browser_ingredient_macro_fit'
  source: '文部科学省 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
  sourceFoodIds: string[]
  warnings: string[]
}

export interface AvailableNutrientEstimate extends EstimateDetails {
  status: 'available'
  value: number
  range: {
    min: number
    max: number
  }
  confidence: Exclude<EstimateConfidence, 'unavailable'>
}

export interface UnavailableNutrientEstimate extends EstimateDetails {
  status: 'unavailable'
  value: null
  range: null
  confidence: 'unavailable'
  reason: string
  nextAction: string
}

export type NutrientEstimate = AvailableNutrientEstimate | UnavailableNutrientEstimate

export interface NutrientEstimateResult {
  requestId: string
  status: 'completed' | 'partial' | 'failed'
  basis: NutrientEstimateBasis
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>
  globalWarnings: string[]
  modelVersion: 'browser-rule-0.4.0'
  estimatedAt: string
}

/** 0は入力済みの値なので、nullの場合だけ参考推計を採用候補にできる。 */
export function isEstimateAdoptable(currentValue: number | null, estimate: NutrientEstimate): estimate is AvailableNutrientEstimate {
  return currentValue === null && estimate.status === 'available'
}

const FALLBACK_METHOD: EstimateDetails['method'] = 'browser_ingredient_rule'
const FIT_METHOD: EstimateDetails['method'] = 'browser_ingredient_macro_fit'
const SOURCE: EstimateDetails['source'] = '文部科学省 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
const MODEL_VERSION = 'browser-rule-0.4.0' as const
const MAX_PROFILE_COMBINATIONS = 64
const MAX_COMPOUND_CANDIDATES = 24

interface CandidateCombination {
  profiles: IngredientProfile[]
  priorProbability: number
}

interface MacroFit {
  profiles: IngredientProfile[]
  ratios: number[]
  normalizedError: number | null
  usedMacroFit: boolean
  score: number
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
}

function normalizePriors(candidates: readonly IngredientProfile[]): IngredientProfile[] {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.priorProbability), 0)
  return candidates
    .map((candidate) => ({
      ...candidate,
      priorProbability: total > 0 ? Math.max(0, candidate.priorProbability) / total : 1 / candidates.length,
    }))
    .sort((left, right) => (
      right.priorProbability - left.priorProbability
      || left.profileId.localeCompare(right.profileId)
    ))
}

function compoundRatioTemplates(count: number): Array<{ ratios: number[]; prior: number }> {
  const normalize = (values: number[]) => {
    const total = values.reduce((sum, value) => sum + value, 0)
    return values.map((value) => value / total)
  }
  if (count === 1) return [{ ratios: [1], prior: 1 }]
  return [
    { ratios: normalize(Array.from({ length: count }, (_value, index) => count - index)), prior: 0.4 },
    { ratios: normalize(Array.from({ length: count }, (_value, index) => 0.7 ** index)), prior: 0.25 },
    { ratios: normalize(Array.from({ length: count }, (_value, index) => 0.45 ** index)), prior: 0.2 },
    { ratios: Array.from({ length: count }, () => 1 / count), prior: 0.15 },
  ]
}

function combineCandidateSets(
  candidateSets: readonly (readonly IngredientProfile[])[],
  limit: number,
): CandidateCombination[] {
  let combinations: CandidateCombination[] = [{ profiles: [], priorProbability: 1 }]
  for (const candidates of candidateSets) {
    combinations = combinations
      .flatMap((combination) => candidates.map((candidate) => ({
        profiles: [...combination.profiles, candidate],
        priorProbability: combination.priorProbability * candidate.priorProbability,
      })))
      .sort((left, right) => (
        right.priorProbability - left.priorProbability
        || left.profiles.map((profile) => profile.profileId).join('|')
          .localeCompare(right.profiles.map((profile) => profile.profileId).join('|'))
      ))
      .slice(0, limit)
  }
  const total = combinations.reduce((sum, combination) => sum + combination.priorProbability, 0)
  return combinations.map((combination) => ({
    ...combination,
    priorProbability: total > 0 ? combination.priorProbability / total : 1 / combinations.length,
  }))
}

function makeCompoundProfile(
  ingredient: ParsedIngredient,
  profiles: readonly IngredientProfile[],
  ratios: readonly number[],
  priorProbability: number,
): IngredientProfile {
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    const values = profiles.map((profile) => profile.nutrients[key])
    if (values.some((value) => value === null)) return [key, null]
    return [key, values.reduce<number>((sum, value, index) => sum + value! * ratios[index], 0)]
  })) as Nutrients
  const profileIds = profiles.map((profile) => profile.profileId)
  return {
    profileId: `compound:${ingredient.normalizedName}:${profileIds.join('+')}:${ratios.map((ratio) => ratio.toFixed(3)).join('-')}`,
    canonicalName: ingredient.normalizedName,
    nutrients,
    sourceFoodIds: [...new Set(profiles.flatMap((profile) => profile.sourceFoodIds))],
    priorProbability,
    ambiguous: true,
    derivationWarnings: [
      `複合原材料「${ingredient.normalizedName}」の括弧内は、表示順を保った複数の配合候補として推計しています。`,
      ...profiles.flatMap((profile) => profile.derivationWarnings ?? []),
    ],
  }
}

function candidatesForIngredient(
  ingredient: ParsedIngredient,
  productName: string | null | undefined,
): IngredientProfile[] {
  const direct = resolveIngredientCandidates(ingredient.normalizedName, productName)
  if (ingredient.components.length === 0) return direct

  const componentCandidates = ingredient.components.map((component) => candidatesForIngredient(component, productName))
  if (componentCandidates.some((candidates) => candidates.length === 0)) {
    return normalizePriors(direct.map((candidate) => ({
      ...candidate,
      ambiguous: true,
      derivationWarnings: [
        ...(candidate.derivationWarnings ?? []),
        `複合原材料「${ingredient.normalizedName}」の括弧内に未対応原材料があるため、外側の名称だけを参照しました。`,
      ],
    })))
  }

  const componentCombinations = combineCandidateSets(componentCandidates, MAX_COMPOUND_CANDIDATES)
  const compoundCandidates = componentCombinations.flatMap((combination) => (
    compoundRatioTemplates(combination.profiles.length).map((template) => makeCompoundProfile(
      ingredient,
      combination.profiles,
      template.ratios,
      combination.priorProbability * template.prior,
    ))
  ))
  // 外側の名称に直接対応する参照がある場合も候補として残すが、括弧内表示をより強い根拠にする。
  const directCandidates = direct.map((candidate) => ({
    ...candidate,
    priorProbability: candidate.priorProbability * 0.15,
    ambiguous: true,
    derivationWarnings: [
      ...(candidate.derivationWarnings ?? []),
      `複合原材料「${ingredient.normalizedName}」は外側名称による代替候補も比較しました。`,
    ],
  }))
  return normalizePriors([...compoundCandidates, ...directCandidates])
    .slice(0, MAX_COMPOUND_CANDIDATES)
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function createRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * qを順序付き単体へ変換する。どの候補も原材料表示順、非負、合計1を満たす。
 * w[i] = Σ(j=i..n-1) q[j] / (j+1)
 */
function orderedRatiosFromQ(q: readonly number[]): number[] {
  return q.map((_value, index) => q
    .slice(index)
    .reduce((sum, value, offset) => sum + value / (index + offset + 1), 0))
}

function fallbackRatios(count: number): number[] {
  const denominator = count * (count + 1) / 2
  return Array.from({ length: count }, (_value, index) => (count - index) / denominator)
}

function fitIngredientRatios(
  combination: CandidateCombination,
  referenceMassG: number,
  knownNutrients: NutrientEstimateRequest['knownNutrients'],
  seedInput: string,
  scenarioCount: number,
): MacroFit {
  const profiles = combination.profiles
  const fitKeys = ESTIMATE_FIT_NUTRIENT_KEYS.filter((key) => {
    const value = knownNutrients?.[key]
    return value !== null
      && value !== undefined
      && Number.isFinite(value)
      && value >= 0
      && profiles.every((profile) => profile.nutrients[key] !== null)
  })
  const predict = (ratios: readonly number[], key: EstimateFitNutrientKey) => (
    profiles.reduce((sum, profile, index) => sum + profile.nutrients[key]! * ratios[index], 0)
    * referenceMassG / 100
  )
  const objectiveForRatios = (ratios: readonly number[]) => {
    if (fitKeys.length === 0) return null
    return fitKeys.reduce((sum, key) => {
      const observed = knownNutrients![key]!
      // 公表値の丸めと食品差を考慮し、微小値だけが目的関数を支配しない尺度にする。
      const roundingWidth = key === 'energyKcal' ? 0.5 : 0.05
      const scale = Math.max(roundingWidth, observed * 0.02)
      const error = (predict(ratios, key) - observed) / scale
      return sum + error * error
    }, 0) / fitKeys.length
  }

  const count = profiles.length
  let ratios = fallbackRatios(count)
  let normalizedError = objectiveForRatios(ratios)
  const usedMacroFit = count >= 2 && fitKeys.length >= 2

  if (usedMacroFit) {
    const denominator = count * (count + 1) / 2
    let bestQ = Array.from({ length: count }, (_value, index) => (index + 1) / denominator)
    let bestError = objectiveForRatios(orderedRatiosFromQ(bestQ))!
    const random = createRandom(fnv1a(seedInput))

    for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
      const exponential = Array.from({ length: count }, () => -Math.log(Math.max(random(), Number.EPSILON)))
      const total = exponential.reduce((sum, value) => sum + value, 0)
      const q = exponential.map((value) => value / total)
      const error = objectiveForRatios(orderedRatiosFromQ(q))!
      if (error < bestError) {
        bestQ = q
        bestError = error
      }
    }

    for (const step of [0.1, 0.03, 0.01, 0.003, 0.001, 0.0003, 0.0001]) {
      let improved = true
      let iteration = 0
      while (improved && iteration < 32) {
        improved = false
        iteration += 1
        for (let from = 0; from < count; from += 1) {
          const amount = Math.min(step, bestQ[from])
          if (amount <= 0) continue
          for (let to = 0; to < count; to += 1) {
            if (to === from) continue
            const candidate = [...bestQ]
            candidate[from] -= amount
            candidate[to] += amount
            const error = objectiveForRatios(orderedRatiosFromQ(candidate))!
            if (error + 1e-12 < bestError) {
              bestQ = candidate
              bestError = error
              improved = true
            }
          }
        }
      }
    }
    ratios = orderedRatiosFromQ(bestQ)
    normalizedError = bestError
  }

  // 商品名等の事前確率は、主要栄養値との整合を覆さない弱いペナルティとしてだけ使う。
  const priorPenalty = -Math.log(Math.max(combination.priorProbability, 1e-9)) * 0.08
  return {
    profiles,
    ratios,
    normalizedError,
    usedMacroFit,
    score: (normalizedError ?? 0) + priorPenalty,
  }
}

function unavailable(reason: string, nextAction: string, warnings: string[] = []): UnavailableNutrientEstimate {
  return {
    status: 'unavailable',
    value: null,
    range: null,
    confidence: 'unavailable',
    method: FALLBACK_METHOD,
    source: SOURCE,
    sourceFoodIds: [],
    warnings,
    reason,
    nextAction,
  }
}

function mapEstimatableNutrients<T>(
  mapper: (key: EstimatableNutrientKey) => T,
): Record<EstimatableNutrientKey, T> {
  return Object.fromEntries(ESTIMATABLE_NUTRIENT_KEYS.map((key) => [key, mapper(key)])) as Record<EstimatableNutrientKey, T>
}

function unavailableAll(
  reason: string,
  nextAction: string,
  warnings: string[] = [],
): Record<EstimatableNutrientKey, UnavailableNutrientEstimate> {
  return mapEstimatableNutrients(() => unavailable(reason, nextAction, warnings))
}

function resultStatus(
  estimates: Record<EstimatableNutrientKey, NutrientEstimate>,
  requested: ReadonlySet<EstimatableNutrientKey>,
): NutrientEstimateResult['status'] {
  const requestedKeys = ESTIMATABLE_NUTRIENT_KEYS.filter((key) => requested.has(key))
  if (requestedKeys.length === 0) return 'failed'
  const availableCount = requestedKeys.filter((key) => estimates[key].status === 'available').length
  if (availableCount === requestedKeys.length) return 'completed'
  return availableCount === 0 ? 'failed' : 'partial'
}

/**
 * 原材料表示順、商品名の弱い事前確率、入力済み主要栄養値を使う、外部通信を行わない決定的な参考推計。
 * referenceMassG は request の baseAmount/baseUnit に対応する明示的な内容物重量でなければならない。
 */
export function estimateNutrients(request: NutrientEstimateRequest): NutrientEstimateResult {
  const requested = new Set(request.requestedNutrients ?? ESTIMATABLE_NUTRIENT_KEYS)
  let estimates: Record<EstimatableNutrientKey, NutrientEstimate>

  if (!Number.isFinite(request.baseAmount) || request.baseAmount <= 0 || request.baseUnit.trim() === '') {
    estimates = unavailableAll(
      '推計の基準量または基準単位が正しくありません。',
      '食品の基準量と単位を確認するか、推計せず食品登録を続けてください。',
    )
  } else if (request.referenceMassG === null || !Number.isFinite(request.referenceMassG) || request.referenceMassG <= 0) {
    estimates = unavailableAll(
      '基準量に対応する内容物重量が確認できないため推計できません。',
      'パッケージで内容物重量を確認してg単位で入力するか、推計せず食品登録を続けてください。',
    )
  } else if (!request.referenceMassSource?.trim()) {
    estimates = unavailableAll(
      '基準重量の根拠が入力されていないため推計できません。',
      '「パッケージ表示」など重量を確認した根拠を入力するか、推計せず食品登録を続けてください。',
    )
  } else if (!request.ingredientsText?.trim()) {
    estimates = unavailableAll(
      '原材料情報が存在しないため推計できません。',
      'パッケージの原材料表示を確認して手入力するか、推計せず食品登録を続けてください。',
    )
  } else if (!request.ingredientsSource?.provider.trim() || request.ingredientsSource.verified !== true) {
    estimates = unavailableAll(
      '原材料表示の取得元が確認されていないため推計できません。',
      '原材料の取得元を選び、内容を確認済みにしてから再実行してください。',
    )
  } else {
    const declaration = parseIngredientDeclaration(request.ingredientsText)
    const resolved = declaration.ingredients.map((ingredient) => ({
      ingredient,
      candidates: candidatesForIngredient(ingredient, request.productName),
    }))
    const unknown = resolved.filter((item) => item.candidates.length === 0)

    if (declaration.ingredients.length === 0) {
      estimates = unavailableAll(
        '食品として扱える原材料を確認できないため推計できません。',
        '原材料表示を見直して栄養値を手入力するか、推計せず食品登録を続けてください。',
      )
    } else if (unknown.length > 0) {
      const unknownNames = unknown.map((item) => item.ingredient.normalizedName)
      estimates = unavailableAll(
        `参照データにない原材料（${unknownNames.join('、')}）の寄与を0とみなせないため推計できません。`,
        '原材料表示を見直して栄養値を手入力するか、未対応原材料が追加されるまで推計せず食品登録を続けてください。',
        [`未対応原材料: ${unknownNames.join('、')}`],
      )
    } else {
      const combinations = combineCandidateSets(
        resolved.map((item) => item.candidates),
        MAX_PROFILE_COMBINATIONS,
      )
      const scenarioCount = Math.max(512, Math.floor(4_096 / Math.max(1, combinations.length)))
      const fits = combinations.map((combination) => fitIngredientRatios(
        combination,
        request.referenceMassG!,
        request.knownNutrients,
        JSON.stringify({
          productName: request.productName?.normalize('NFKC') ?? null,
          ingredients: declaration.ingredients.map((ingredient) => ingredient.normalizedName),
          profiles: combination.profiles.map((profile) => profile.profileId),
          referenceMassG: request.referenceMassG,
          knownNutrients: ESTIMATE_FIT_NUTRIENT_KEYS.map((key) => [key, request.knownNutrients?.[key] ?? null]),
          modelVersion: MODEL_VERSION,
        }),
        scenarioCount,
      ))
      const selected = fits.sort((left, right) => (
        left.score - right.score
        || left.profiles.map((profile) => profile.profileId).join('|')
          .localeCompare(right.profiles.map((profile) => profile.profileId).join('|'))
      ))[0]
      const hasCandidateAmbiguity = resolved.some((item) => item.candidates.length > 1)
        || selected.profiles.some((profile) => profile.ambiguous)
      const hasCompound = declaration.ingredients.some((ingredient) => ingredient.components.length > 0)
      const hasAdditives = declaration.additives.length > 0
      const warnings = [
        selected.usedMacroFit
          ? '原材料の配合比は、表示順の制約内で入力済み主要栄養値との整合が高い候補を推定しています。'
          : '原材料の配合比は表示順から推定しており、実際の配合比ではありません。',
        ...(hasCandidateAmbiguity
          ? ['同じ原材料名に複数の参照食品候補があるため、候補ごとの事前確率と主要栄養値の整合を比較しています。']
          : []),
        ...(hasCandidateAmbiguity && request.productName?.trim()
          ? [`商品名「${request.productName.trim()}」は候補選択の弱い事前確率にだけ使用し、原材料の明示語と主要栄養値を優先しています。`]
          : []),
        ...(hasCompound
          ? ['括弧付きの複合原材料は、外側の表示順と括弧内の表示順を別々に保って解析しています。']
          : []),
        ...(hasAdditives
          ? [`添加物区画（${declaration.additives.map((item) => item.normalizedName).join('、')}）は主原材料の配合比から分離しています。栄養寄与を0とはみなさず、この参考推計の対象外として不確実性を広げています。`]
          : []),
        ...(declaration.inferredAdditiveBoundary
          ? ['「／」がないため、既知の添加物名から添加物区画の開始位置を推定しました。']
          : []),
        ...selected.profiles.flatMap((profile) => profile.derivationWarnings ?? []),
      ]
      const confidence: AvailableNutrientEstimate['confidence'] = (
        hasCandidateAmbiguity
        || hasCompound
        || hasAdditives
        || !selected.usedMacroFit
        || (selected.normalizedError ?? Number.POSITIVE_INFINITY) > 4
      ) ? 'low' : 'medium'
      const [minFactor, maxFactor] = confidence === 'low' ? [0.5, 1.7] : [0.75, 1.3]

      const makeEstimate = (key: EstimatableNutrientKey): NutrientEstimate => {
        const missingProfiles = selected.profiles.filter((profile) => profile.nutrients[key] === null)
        if (missingProfiles.length > 0) {
          const missingSourceFoodIds = [...new Set(missingProfiles.flatMap((profile) => profile.sourceFoodIds))]
          return unavailable(
            `参照食品の${NUTRIENT_LABELS[key]}が欠損しているため、この栄養素は推計できません。`,
            'パッケージの栄養成分表示を確認して手入力するか、この栄養素を採用せず食品登録を続けてください。',
            [`MEXT参照値が欠損しています（食品ID: ${missingSourceFoodIds.join('、')}）。`],
          )
        }
        const per100g = selected.profiles.reduce((total, profile, index) => (
          total + profile.nutrients[key]! * selected.ratios[index]
        ), 0)
        const value = round(per100g * request.referenceMassG! / 100)
        return {
          status: 'available',
          value,
          range: {
            min: round(value * minFactor),
            max: round(value * maxFactor),
          },
          confidence,
          method: selected.usedMacroFit ? FIT_METHOD : FALLBACK_METHOD,
          source: SOURCE,
          sourceFoodIds: [...new Set(selected.profiles.flatMap((profile) => profile.sourceFoodIds))],
          warnings: [...new Set(warnings)],
        }
      }

      estimates = mapEstimatableNutrients((key) => requested.has(key)
        ? makeEstimate(key)
        : unavailable('この栄養素は今回の推計対象に選ばれていません。', '必要な場合は推計対象に含めて再実行してください。'))
    }
  }

  return {
    requestId: request.requestId,
    status: resultStatus(estimates, requested),
    basis: { baseAmount: request.baseAmount, baseUnit: request.baseUnit },
    estimates,
    globalWarnings: ['参考推計であり、実測値やパッケージ表示と同等の正確性を保証しません。'],
    modelVersion: MODEL_VERSION,
    estimatedAt: request.requestedAt,
  }
}

/** ブラウザ内推計の結果を、IndexedDBへ保存する共通結果形式へ変換する。 */
export function toStoredNutrientEstimateResult(
  result: NutrientEstimateResult,
  input: { foodId: string; inputHash: string; baseAmount: number; baseUnit: FoodUnit },
): EstimationResult {
  const estimates: EstimationResult['estimates'] = {}
  for (const key of ESTIMATABLE_NUTRIENT_KEYS) {
    const estimate = result.estimates[key]
    if (estimate.status !== 'available') continue
    estimates[key] = {
      value: estimate.value,
      range: { ...estimate.range },
      confidence: estimate.confidence,
      method: estimate.method,
      source: estimate.source,
      sourceFoodIds: [...estimate.sourceFoodIds],
      warnings: [...estimate.warnings],
    }
  }
  const unavailableEstimate = Object.values(result.estimates).find((estimate) => estimate.status === 'unavailable')
  return {
    requestId: result.requestId,
    foodId: input.foodId,
    inputHash: input.inputHash,
    status: result.status,
    basis: { baseAmount: input.baseAmount, baseUnit: input.baseUnit },
    estimates,
    globalWarnings: [...result.globalWarnings],
    ...(result.status === 'failed' && unavailableEstimate?.status === 'unavailable'
      ? { error: { code: 'ESTIMATE_UNAVAILABLE', message: unavailableEstimate.reason, nextAction: unavailableEstimate.nextAction } }
      : {}),
    modelVersion: result.modelVersion,
    estimatedAt: result.estimatedAt,
  }
}
