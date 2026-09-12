import { NUTRIENT_KEYS, type Food } from '../types'

/** 送信・保存前のFoodから、推計に関係する値だけを安定した順序でハッシュ化する。 */
export function createEstimationInputHash(food: Food): string {
  const payload = JSON.stringify({
    foodId: food.id,
    barcode: food.barcode,
    name: food.name,
    maker: food.maker,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: food.inputUnitConversions ?? [],
    nutrients: NUTRIENT_KEYS.map((key) => [key, food.nutrients[key]]),
    ingredientsText: food.ingredientsText ?? null,
    ingredientsSource: food.ingredientsSource ?? null,
    estimationReferenceMassG: food.estimationReferenceMassG ?? null,
    estimationReferenceMassSource: food.estimationReferenceMassSource ?? null,
    estimatorGenreId: food.estimatorGenreId ?? null,
    estimatorGenreSource: food.estimatorGenreSource ?? null,
    updatedAt: food.updatedAt,
  })
  // Web Cryptoは非同期のため、IndexedDBトランザクション内でも使える決定的な軽量ハッシュを採用する。
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

