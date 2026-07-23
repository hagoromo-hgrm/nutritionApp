import type { FoodUnit, Nutrients } from '../types'

export interface ExternalFoodPreview {
  name: string
  maker: string
  barcode: string
  quantity: string
  baseAmount: number
  baseUnit: FoodUnit
  nutrients: Nutrients
}

/** 外部データに商品名がない場合は、保存される実データと区別できる表示用ラベルにする。 */
export const EXTERNAL_UNNAMED_PRODUCT_LABEL = '名称未設定の商品'

export type ExternalFoodApiErrorKind = 'timeout' | 'rate-limit' | 'unavailable' | 'http' | 'invalid-response' | 'network' | 'aborted'

export class ExternalFoodApiError extends Error {
  constructor(public readonly kind: ExternalFoodApiErrorKind, message: string, public readonly status?: number) {
    super(message)
    this.name = 'ExternalFoodApiError'
  }
}

const REQUEST_TIMEOUT_MS = 10_000
const PRODUCT_FIELDS = 'code,product_name,brands,quantity,nutriments'
const APP_IDENTIFIER = 'nutrition-pwa/0.1.0 (https://github.com/hagoromo-hgrm/nutritionApp)'

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function quantityUnit(quantity: string): FoodUnit {
  return /(?:^|\s|\d)ml\b/i.test(quantity) ? 'ml' : 'g'
}

function nutrientValue(nutriments: Record<string, unknown>, key: string, targetUnit: 'g' | 'mg' | 'mcg'): number | null {
  const value = numberOrNull(nutriments[`${key}_100g`] ?? nutriments[key])
  if (value === null) return null
  if (targetUnit === 'g') return value

  const unit = typeof nutriments[`${key}_unit`] === 'string'
    ? String(nutriments[`${key}_unit`]).trim().toLowerCase()
    : 'g'
  const gramsPerUnit: Record<string, number> = {
    kg: 1_000,
    g: 1,
    mg: 0.001,
    mcg: 0.000001,
    'µg': 0.000001,
    'μg': 0.000001,
  }
  const grams = value * (gramsPerUnit[unit] ?? 1)
  return targetUnit === 'mg' ? grams * 1_000 : grams * 1_000_000
}

function buildProductUrl(endpoint: string, barcode: string): URL {
  let url: URL
  try {
    const base = endpoint.replace(/\/$/, '')
    url = new URL(`${base}/${encodeURIComponent(barcode)}.json`)
  } catch {
    throw new ExternalFoodApiError('invalid-response', '外部商品APIのURLが正しくありません。')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ExternalFoodApiError('invalid-response', '外部商品APIのURLが正しくありません。')
  }
  url.searchParams.set('fields', PRODUCT_FIELDS)
  return url
}

function parsePreview(payload: unknown, barcode: string): ExternalFoodPreview | null {
  if (!payload || typeof payload !== 'object') {
    throw new ExternalFoodApiError('invalid-response', '外部商品APIの応答形式が正しくありません。')
  }
  const data = payload as Record<string, unknown>
  const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : null
  const isNotFound = data.status === 0 || result?.id === 'product_not_found'
  if (isNotFound) return null

  const isFound = data.status === 1 || data.status === 'success' || result?.id === 'product_found'
  if (!isFound || !data.product || typeof data.product !== 'object') {
    throw new ExternalFoodApiError('invalid-response', '外部商品APIの応答形式が正しくありません。')
  }

  const product = data.product as Record<string, unknown>
  const quantity = typeof product.quantity === 'string' ? product.quantity : ''
  const nutriments = typeof product.nutriments === 'object' && product.nutriments !== null
    ? product.nutriments as Record<string, unknown>
    : {}
  return {
    name: typeof product.product_name === 'string' && product.product_name.trim() ? product.product_name.trim() : EXTERNAL_UNNAMED_PRODUCT_LABEL,
    maker: typeof product.brands === 'string' ? product.brands : '',
    barcode,
    quantity,
    // Open Food Factsの`*_100g`を使うため、商品の総内容量を栄養値の基準量にしない。
    baseAmount: 100,
    baseUnit: quantityUnit(quantity),
    nutrients: {
      energyKcal: numberOrNull(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal']),
      proteinG: nutrientValue(nutriments, 'proteins', 'g'),
      fatG: nutrientValue(nutriments, 'fat', 'g'),
      carbohydrateG: nutrientValue(nutriments, 'carbohydrates', 'g'),
      fiberG: nutrientValue(nutriments, 'fiber', 'g'),
      saltG: nutrientValue(nutriments, 'salt', 'g'),
      calciumMg: nutrientValue(nutriments, 'calcium', 'mg'),
      ironMg: nutrientValue(nutriments, 'iron', 'mg'),
      vitaminAMcg: nutrientValue(nutriments, 'vitamin-a', 'mcg'),
      vitaminEMg: nutrientValue(nutriments, 'vitamin-e', 'mg'),
      vitaminB1Mg: nutrientValue(nutriments, 'vitamin-b1', 'mg'),
      vitaminB2Mg: nutrientValue(nutriments, 'vitamin-b2', 'mg'),
      vitaminCMg: nutrientValue(nutriments, 'vitamin-c', 'mg'),
      saturatedFatG: nutrientValue(nutriments, 'saturated-fat', 'g'),
    },
  }
}

function httpError(status: number): ExternalFoodApiError {
  if (status === 429) return new ExternalFoodApiError('rate-limit', '外部商品APIの利用上限に達しました。', status)
  if (status >= 500) return new ExternalFoodApiError('unavailable', '外部商品APIが一時的に利用できません。', status)
  return new ExternalFoodApiError('http', `外部商品APIがHTTP ${status}を返しました。`, status)
}

export function externalFoodErrorMessage(error: unknown): string {
  if (!(error instanceof ExternalFoodApiError)) return '外部商品情報を取得できませんでした。'
  if (error.kind === 'timeout') return '外部商品情報の取得がタイムアウトしました。'
  if (error.kind === 'rate-limit') return '外部商品APIが混み合っています。時間をおいて再試行してください。'
  if (error.kind === 'unavailable') return '外部商品APIが一時的に利用できません。'
  if (error.kind === 'network') return '通信状態または外部商品APIへの接続を確認できませんでした。'
  if (error.kind === 'invalid-response') return '外部商品APIから正しい商品情報を取得できませんでした。'
  return '外部商品情報を取得できませんでした。'
}

export async function searchExternalFood(barcode: string, endpoint: string, signal?: AbortSignal): Promise<ExternalFoodPreview | null> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(buildProductUrl(endpoint, barcode), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-User-Agent': APP_IDENTIFIER,
      },
    })
    if (response.status === 404) return null
    if (!response.ok) throw httpError(response.status)
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ExternalFoodApiError('invalid-response', '外部商品APIの応答を読み取れませんでした。')
    }
    return parsePreview(payload, barcode)
  } catch (error) {
    if (error instanceof ExternalFoodApiError) throw error
    if (timedOut) throw new ExternalFoodApiError('timeout', '外部商品APIへの接続がタイムアウトしました。')
    if (signal?.aborted) throw new ExternalFoodApiError('aborted', '外部商品APIへの接続が中断されました。')
    throw new ExternalFoodApiError('network', '外部商品APIへ接続できませんでした。')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
