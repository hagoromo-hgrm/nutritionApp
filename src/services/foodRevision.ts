import { NUTRIENT_KEYS, type Food } from '../types'

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

function canonicalize(value: unknown, ancestors = new WeakSet<object>()): CanonicalValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $hashValue: `number:${String(value)}` }
  if (typeof value === 'undefined') return { $hashValue: 'undefined' }
  if (typeof value === 'bigint') return { $hashValue: `bigint:${value.toString()}` }
  if (typeof value === 'symbol') return { $hashValue: `symbol:${String(value.description ?? '')}` }
  if (typeof value === 'function') return { $hashValue: `function:${value.name}` }
  if (typeof value !== 'object') return { $hashValue: typeof value }

  if (ancestors.has(value)) return { $hashValue: 'circular-reference' }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, ancestors))

    const entries: Array<[string, CanonicalValue]> = []
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      // Avoid invoking accessors while hashing legacy or future metadata fields.
      entries.push([key, descriptor && 'value' in descriptor
        ? canonicalize(descriptor.value, ancestors)
        : { $hashValue: 'accessor' }])
    }
    return Object.fromEntries(entries)
  } catch {
    return { $hashValue: 'uninspectable-object' }
  } finally {
    ancestors.delete(value)
  }
}

function hasLegacyExclusionHint(food: Food, key: 'estimatedNutrients' | 'externalSource'): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(food, key)
  } catch {
    // An unreadable legacy hint must conservatively block treating the food as an unmarked manual input.
    return true
  }
}

function canonicalNutrientMetadata(metadata: Food['nutrientMetadata'], key: (typeof NUTRIENT_KEYS)[number]): CanonicalValue {
  if (metadata === undefined) return { $hashValue: 'missing' }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key)
    if (descriptor === undefined) return { $hashValue: 'missing' }
    return 'value' in descriptor ? canonicalize(descriptor.value) : { $hashValue: 'accessor' }
  } catch {
    return { $hashValue: 'uninspectable-metadata' }
  }
}

/** 食品の栄養入力とその由来から作る、バージョン付きの競合検出stamp。 */
export function createEstimationInputHash(food: Food): string {
  const metadata = food.nutrientMetadata
  const payload = JSON.stringify({
    foodId: food.id,
    barcode: food.barcode,
    name: food.name,
    maker: food.maker,
    source: food.source,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: food.inputUnitConversions ?? [],
    nutrients: NUTRIENT_KEYS.map((key) => [key, food.nutrients[key]]),
    nutrientMetadata: NUTRIENT_KEYS.map((key) => [key, canonicalNutrientMetadata(metadata, key)]),
    legacyInputExclusionHints: {
      estimatedNutrients: hasLegacyExclusionHint(food, 'estimatedNutrients'),
      externalSource: hasLegacyExclusionHint(food, 'externalSource'),
    },
    ingredientsText: food.ingredientsText ?? null,
    ingredientsSource: food.ingredientsSource ?? null,
    estimationReferenceMassG: food.estimationReferenceMassG ?? null,
    estimationReferenceMassSource: food.estimationReferenceMassSource ?? null,
    estimatorGenreId: food.estimatorGenreId ?? null,
    estimatorGenreSource: food.estimatorGenreSource ?? null,
    updatedAt: food.updatedAt,
  })
  // Web Crypto is asynchronous; this deterministic synchronous stamp is used inside IndexedDB transactions.
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-v2:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
