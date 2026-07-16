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

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseQuantity(quantity: string): { amount: number; unit: FoodUnit } {
  const match = quantity.match(/(\d+(?:\.\d+)?)\s*(g|ml|個|袋|本|枚)?/i)
  if (!match) return { amount: 100, unit: 'g' }
  const unit = match[2]?.toLowerCase() === 'ml' ? 'ml' : match[2] === '個' ? '個' : 'g'
  return { amount: Number(match[1]), unit }
}

export async function searchExternalFood(barcode: string, endpoint: string, signal?: AbortSignal): Promise<ExternalFoodPreview | null> {
  const base = endpoint.replace(/\/$/, '')
  const response = await fetch(`${base}/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,quantity,nutriments`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`外部商品APIがHTTP ${response.status}を返しました。`)
  const payload = await response.json() as { status?: number; product?: Record<string, unknown> }
  if (payload.status !== 1 || !payload.product) return null
  const product = payload.product
  const quantity = typeof product.quantity === 'string' ? product.quantity : ''
  const parsed = parseQuantity(quantity)
  const nutriments = typeof product.nutriments === 'object' && product.nutriments !== null
    ? product.nutriments as Record<string, unknown> : {}
  return {
    name: typeof product.product_name === 'string' && product.product_name.trim() ? product.product_name : '名称未設定の商品',
    maker: typeof product.brands === 'string' ? product.brands : '',
    barcode,
    quantity,
    baseAmount: parsed.amount,
    baseUnit: parsed.unit,
    nutrients: {
      energyKcal: numberOrNull(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal']),
      proteinG: numberOrNull(nutriments['proteins_100g'] ?? nutriments.proteins),
      fatG: numberOrNull(nutriments['fat_100g'] ?? nutriments.fat),
      carbohydrateG: numberOrNull(nutriments['carbohydrates_100g'] ?? nutriments.carbohydrates),
      fiberG: numberOrNull(nutriments['fiber_100g'] ?? nutriments.fiber),
      saltG: numberOrNull(nutriments['salt_100g'] ?? nutriments.salt),
      calciumMg: numberOrNull(nutriments['calcium_100g'] ?? nutriments.calcium),
      ironMg: numberOrNull(nutriments['iron_100g'] ?? nutriments.iron),
      vitaminAMcg: numberOrNull(nutriments['vitamin-a_100g'] ?? nutriments['vitamin-a']),
      vitaminEMg: numberOrNull(nutriments['vitamin-e_100g'] ?? nutriments['vitamin-e']),
      vitaminB1Mg: numberOrNull(nutriments['vitamin-b1_100g'] ?? nutriments['vitamin-b1']),
      vitaminB2Mg: numberOrNull(nutriments['vitamin-b2_100g'] ?? nutriments['vitamin-b2']),
      vitaminCMg: numberOrNull(nutriments['vitamin-c_100g'] ?? nutriments['vitamin-c']),
      saturatedFatG: numberOrNull(nutriments['saturated-fat_100g'] ?? nutriments['saturated-fat']),
    },
  }
}
