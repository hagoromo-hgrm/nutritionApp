import { NUTRIENT_LABELS, type EstimationResult, type FoodUnit, type IngredientsSource, type NutrientKey } from '../types'

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
export type EstimateConfidence = 'high' | 'medium' | 'low' | 'unavailable'

export interface NutrientEstimateBasis {
  baseAmount: number
  baseUnit: string
}

export interface NutrientEstimateRequest {
  requestId: string
  baseAmount: number
  baseUnit: string
  referenceMassG: number | null
  referenceMassSource: string | null
  ingredientsText: string | null
  ingredientsSource: IngredientsSource | null
  requestedNutrients?: readonly EstimatableNutrientKey[]
  requestedAt: string
}

interface EstimateDetails {
  method: 'browser_ingredient_rule'
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
  modelVersion: 'browser-rule-0.2.0'
  estimatedAt: string
}

/** 0は入力済みの値なので、nullの場合だけ参考推計を採用候補にできる。 */
export function isEstimateAdoptable(currentValue: number | null, estimate: NutrientEstimate): estimate is AvailableNutrientEstimate {
  return currentValue === null && estimate.status === 'available'
}

interface IngredientProfile {
  terms: readonly string[]
  saturatedFatG: number | null
  fiberG: number | null
  calciumMg: number | null
  ironMg: number | null
  vitaminAMcg: number | null
  vitaminEMg: number | null
  vitaminB1Mg: number | null
  vitaminB2Mg: number | null
  vitaminCMg: number | null
  sourceFoodIds: readonly string[]
  ambiguous?: boolean
}

/*
 * `data/mext/processed/mext_foods.json` の検証済み100g値から選んだ参照プロファイル。
 * 曖昧な工業原材料は候補食品の中央寄りの値を使い、必ず低信頼度と広い範囲を返す。
 */
const INGREDIENT_PROFILES: readonly IngredientProfile[] = [
  {
    terms: ['小麦全粒粉', '全粒粉'],
    saturatedFatG: 0.53,
    fiberG: 11.2,
    calciumMg: 26,
    ironMg: 3.1,
    vitaminAMcg: 0,
    vitaminEMg: 1,
    vitaminB1Mg: 0.34,
    vitaminB2Mg: 0.09,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_01023'],
  },
  {
    terms: ['オートミール', 'オーツ麦'],
    saturatedFatG: 1.01,
    fiberG: 9.4,
    calciumMg: 47,
    ironMg: 3.9,
    vitaminAMcg: 0,
    vitaminEMg: 0.6,
    vitaminB1Mg: 0.2,
    vitaminB2Mg: 0.08,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_01004'],
  },
  {
    terms: ['ショートニング'],
    saturatedFatG: 51.13,
    fiberG: 0,
    calciumMg: 0,
    ironMg: 0,
    vitaminAMcg: 0,
    vitaminEMg: 9.5,
    vitaminB1Mg: 0,
    vitaminB2Mg: 0,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_14030'],
    ambiguous: true,
  },
  {
    terms: ['マーガリン'],
    saturatedFatG: 39,
    fiberG: 0,
    calciumMg: 14,
    ironMg: null,
    vitaminAMcg: 24,
    vitaminEMg: 15,
    vitaminB1Mg: 0.01,
    vitaminB2Mg: 0.03,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_14029'],
    ambiguous: true,
  },
  {
    terms: ['植物油脂', '植物油'],
    saturatedFatG: 23.003333,
    fiberG: 0,
    calciumMg: null,
    ironMg: 0,
    vitaminAMcg: 0,
    vitaminEMg: 11.2,
    vitaminB1Mg: 0,
    vitaminB2Mg: 0,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_14008', 'mext_14005', 'mext_14009'],
    ambiguous: true,
  },
  {
    terms: ['バター'],
    saturatedFatG: 50.45,
    fiberG: 0,
    calciumMg: 15,
    ironMg: 0.1,
    vitaminAMcg: 520,
    vitaminEMg: 1.5,
    vitaminB1Mg: 0.01,
    vitaminB2Mg: 0.03,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_14017'],
    ambiguous: true,
  },
  {
    terms: ['チョコレート', 'チョコ'],
    saturatedFatG: 19.88,
    fiberG: 3.9,
    calciumMg: 240,
    ironMg: 2.4,
    vitaminAMcg: 66,
    vitaminEMg: 0.7,
    vitaminB1Mg: 0.19,
    vitaminB2Mg: 0.41,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_15116'],
    ambiguous: true,
  },
  {
    terms: ['ココアパウダー', 'ココア'],
    saturatedFatG: 12.4,
    fiberG: 23.9,
    calciumMg: 140,
    ironMg: 14,
    vitaminAMcg: 3,
    vitaminEMg: 0.3,
    vitaminB1Mg: 0.16,
    vitaminB2Mg: 0.22,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_16048'],
  },
  {
    terms: ['アーモンド'],
    saturatedFatG: 3.95,
    fiberG: 10.1,
    calciumMg: 250,
    ironMg: 3.6,
    vitaminAMcg: 1,
    vitaminEMg: 30,
    vitaminB1Mg: 0.2,
    vitaminB2Mg: 1.06,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_05001'],
  },
  {
    terms: ['ごま'],
    saturatedFatG: 7.8,
    fiberG: 10.8,
    calciumMg: 1200,
    ironMg: 9.6,
    vitaminAMcg: 1,
    vitaminEMg: 0.1,
    vitaminB1Mg: 0.95,
    vitaminB2Mg: 0.25,
    vitaminCMg: null,
    sourceFoodIds: ['mext_05017'],
    ambiguous: true,
  },
  {
    terms: ['大豆粉', 'きな粉'],
    saturatedFatG: 3.59,
    fiberG: 18.1,
    calciumMg: 190,
    ironMg: 8,
    vitaminAMcg: null,
    vitaminEMg: 1.7,
    vitaminB1Mg: 0.07,
    vitaminB2Mg: 0.24,
    vitaminCMg: 1,
    sourceFoodIds: ['mext_04029'],
    ambiguous: true,
  },
  {
    terms: ['小麦粉'],
    saturatedFatG: 0.34,
    fiberG: 2.5,
    calciumMg: 20,
    ironMg: 0.5,
    vitaminAMcg: 0,
    vitaminEMg: 0.3,
    vitaminB1Mg: 0.11,
    vitaminB2Mg: 0.03,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_01015'],
    ambiguous: true,
  },
  {
    terms: ['脱脂粉乳'],
    saturatedFatG: 0.44,
    fiberG: 0,
    calciumMg: 1100,
    ironMg: 0.5,
    vitaminAMcg: 6,
    vitaminEMg: null,
    vitaminB1Mg: 0.3,
    vitaminB2Mg: 1.6,
    vitaminCMg: 5,
    sourceFoodIds: ['mext_13010'],
  },
  {
    terms: ['全粉乳', '牛乳', '乳等を主要原料とする食品'],
    saturatedFatG: 16.28,
    fiberG: 0,
    calciumMg: 890,
    ironMg: 0.4,
    vitaminAMcg: 180,
    vitaminEMg: 0.6,
    vitaminB1Mg: 0.25,
    vitaminB2Mg: 1.1,
    vitaminCMg: 5,
    sourceFoodIds: ['mext_13009'],
    ambiguous: true,
  },
  {
    terms: ['卵', '液卵'],
    saturatedFatG: 3.12,
    fiberG: 0,
    calciumMg: 46,
    ironMg: 1.5,
    vitaminAMcg: 210,
    vitaminEMg: 1.3,
    vitaminB1Mg: 0.06,
    vitaminB2Mg: 0.37,
    vitaminCMg: 0,
    sourceFoodIds: ['mext_12004'],
    ambiguous: true,
  },
] as const

const METHOD: EstimateDetails['method'] = 'browser_ingredient_rule'
const SOURCE: EstimateDetails['source'] = '文部科学省 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
const MODEL_VERSION = 'browser-rule-0.2.0' as const

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
}

function splitIngredients(text: string): string[] {
  const withoutHeading = text
    .normalize('NFKC')
    .replace(/^\s*原材料(?:名)?\s*[:：]\s*/u, '')

  const ingredients: string[] = []
  let current = ''
  let depth = 0

  for (const character of withoutHeading) {
    if (character === '(' || character === '（') depth += 1
    if (character === ')' || character === '）') depth = Math.max(0, depth - 1)

    if (depth === 0 && /[、,，;；/\n]/u.test(character)) {
      const value = current.trim()
      if (value) ingredients.push(value)
      current = ''
    } else {
      current += character
    }
  }

  const value = current.trim()
  if (value) ingredients.push(value)
  return ingredients
}

function findProfile(ingredient: string): IngredientProfile | null {
  return INGREDIENT_PROFILES.find((profile) => profile.terms.some((term) => ingredient.includes(term))) ?? null
}

function unavailable(reason: string, nextAction: string, warnings: string[] = []): UnavailableNutrientEstimate {
  return {
    status: 'unavailable',
    value: null,
    range: null,
    confidence: 'unavailable',
    method: METHOD,
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

function unavailableAll(reason: string, nextAction: string): Record<EstimatableNutrientKey, UnavailableNutrientEstimate> {
  return mapEstimatableNutrients(() => unavailable(reason, nextAction))
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
 * 原材料の表示順だけを使う、外部通信を行わない決定的な参考推計。
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
    const ingredients = splitIngredients(request.ingredientsText)
    const matches = ingredients.map((ingredient) => ({ ingredient, profile: findProfile(ingredient) }))
    const recognized = matches.filter((match): match is { ingredient: string; profile: IngredientProfile } => match.profile !== null)

    if (ingredients.length === 0 || recognized.length === 0) {
      estimates = unavailableAll(
        '対応できる原材料を確認できないため推計できません。',
        '原材料表示を見直して栄養値を手入力するか、推計せず食品登録を続けてください。',
      )
    } else {
      const denominator = ingredients.reduce((total, _ingredient, index) => total + ingredients.length - index, 0)
      const unknown = matches.filter((match) => match.profile === null)
      const ambiguous = recognized.filter((match) => match.profile.ambiguous)
      const unknownWeight = unknown.reduce((total, match) => {
        const index = matches.indexOf(match)
        return total + (ingredients.length - index) / denominator
      }, 0)
      const warnings = [
        '原材料の配合比は表示順から推定しています。',
        '加工係数が未定義です。',
        ...(unknown.length > 0 ? [`参照データにない原材料があります（${unknown.map((match) => match.ingredient).join('、')}）。`] : []),
        ...(ambiguous.length > 0 ? [`参照食品の種類に幅がある原材料があります（${ambiguous.map((match) => match.ingredient).join('、')}）。`] : []),
      ]
      const confidence: AvailableNutrientEstimate['confidence'] =
        unknown.length === 0 && ambiguous.length === 0 ? 'medium' : 'low'
      const minFactor = unknownWeight > 0 || ambiguous.length > 0 ? 0.5 : 0.75
      const maxFactor = unknownWeight > 0 || ambiguous.length > 0 ? 1.7 : 1.3

      const makeEstimate = (key: EstimatableNutrientKey): NutrientEstimate => {
        const missing = recognized.filter((match) => match.profile[key] === null)
        if (missing.length > 0) {
          const missingSourceFoodIds = [...new Set(missing.flatMap((match) => match.profile.sourceFoodIds))]
          return unavailable(
            `参照食品の${NUTRIENT_LABELS[key]}が欠損しているため、この栄養素は推計できません。`,
            'パッケージの栄養成分表示を確認して手入力するか、この栄養素を採用せず食品登録を続けてください。',
            [`MEXT参照値が欠損しています（食品ID: ${missingSourceFoodIds.join('、')}）。`],
          )
        }
        const per100g = recognized.reduce((total, match) => {
          const index = matches.indexOf(match)
          const assumedRatio = (ingredients.length - index) / denominator
          return total + match.profile[key]! * assumedRatio
        }, 0)
        const value = round(per100g * request.referenceMassG! / 100)
        return {
          status: 'available',
          value,
          range: {
            min: round(value * minFactor),
            max: round(value * maxFactor),
          },
          confidence,
          method: METHOD,
          source: SOURCE,
          sourceFoodIds: [...new Set(recognized.flatMap((match) => match.profile.sourceFoodIds))],
          warnings,
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
  const unavailable = Object.values(result.estimates).find((estimate) => estimate.status === 'unavailable')
  return {
    requestId: result.requestId,
    foodId: input.foodId,
    inputHash: input.inputHash,
    status: result.status,
    basis: { baseAmount: input.baseAmount, baseUnit: input.baseUnit },
    estimates,
    globalWarnings: [...result.globalWarnings],
    ...(result.status === 'failed' && unavailable?.status === 'unavailable'
      ? { error: { code: 'ESTIMATE_UNAVAILABLE', message: unavailable.reason, nextAction: unavailable.nextAction } }
      : {}),
    modelVersion: result.modelVersion,
    estimatedAt: result.estimatedAt,
  }
}
