import Dexie from 'dexie'
import { db } from '../db/db'
import {
  DEFAULT_ESTIMATION_SETTINGS,
  NUTRIENT_KEYS,
  type EstimationDecision,
  type EstimationRequest,
  type EstimationRequestStatus,
  type EstimationResult,
  type EstimationSettings,
  type Food,
  type NutrientKey,
  type NutrientMetadata,
  type NutritionEstimationInput,
} from '../types'
import { createId } from '../utils/id'

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

export function createEstimationInput(
  food: Food,
  options: { requestId?: string; estimatorCategoryId?: string | null; requestedAt?: string } = {},
): NutritionEstimationInput {
  const requestId = options.requestId ?? createId('estimate')
  const requestedAt = options.requestedAt ?? new Date().toISOString()
  const hasExplicitReferenceMass = food.estimationReferenceMassG !== null && food.estimationReferenceMassG !== undefined
  const referenceMassG = food.baseUnit === 'g'
    ? food.baseAmount
    : (hasExplicitReferenceMass ? food.estimationReferenceMassG ?? null : null)
  const referenceMassSource = food.baseUnit === 'g'
    ? '基準単位がg'
    : (hasExplicitReferenceMass ? food.estimationReferenceMassSource ?? null : null)
  const knownNutrients = Object.fromEntries(NUTRIENT_KEYS
    .filter((key) => food.nutrients[key] !== null)
    .map((key) => [key, food.nutrients[key]]))
  const missingNutrients = NUTRIENT_KEYS.filter((key) => food.nutrients[key] === null)
  return {
    requestId,
    foodId: food.id,
    barcode: food.barcode,
    name: food.name,
    maker: food.maker,
    estimatorCategoryId: options.estimatorCategoryId ?? null,
    estimatorGenreId: food.estimatorGenreId ?? null,
    estimatorGenreSource: food.estimatorGenreSource ?? null,
    baseAmount: food.baseAmount,
    baseUnit: food.baseUnit,
    inputUnitConversions: (food.inputUnitConversions ?? []).map((conversion) => ({ ...conversion })),
    referenceMassG,
    referenceMassSource,
    knownNutrients,
    missingNutrients,
    ingredientsText: food.ingredientsText ?? null,
    ingredientsSource: food.ingredientsSource ? { ...food.ingredientsSource } : null,
    requestedAt,
    foodUpdatedAt: food.updatedAt,
    inputHash: createEstimationInputHash(food),
  }
}

export function createEstimationRequest(
  food: Food,
  options: { requestId?: string; estimatorCategoryId?: string | null; status?: EstimationRequestStatus; now?: string } = {},
): EstimationRequest {
  const now = options.now ?? new Date().toISOString()
  const inputSnapshot = createEstimationInput(food, {
    requestId: options.requestId,
    estimatorCategoryId: options.estimatorCategoryId,
    requestedAt: now,
  })
  return {
    requestId: inputSnapshot.requestId,
    foodId: food.id,
    barcode: food.barcode,
    inputSnapshot,
    status: options.status ?? 'pending',
    inputHash: inputSnapshot.inputHash,
    createdAt: now,
    updatedAt: now,
  }
}

export async function saveEstimationRequest(request: EstimationRequest): Promise<void> {
  if (request.inputSnapshot.requestId !== request.requestId || request.inputSnapshot.foodId !== request.foodId || request.inputSnapshot.inputHash !== request.inputHash) {
    throw new Error('推計要求の入力情報が一致しません。食品を読み直して再試行してください。')
  }
  await db.estimationRequests.put(request)
}

export async function updateEstimationRequestStatus(requestId: string, status: EstimationRequestStatus): Promise<void> {
  const request = await db.estimationRequests.get(requestId)
  if (!request) throw new Error('推計要求が見つかりません。食品を読み直して再試行してください。')
  await db.estimationRequests.put({ ...request, status, updatedAt: new Date().toISOString() })
}

export async function saveEstimationResult(result: EstimationResult): Promise<void> {
  await db.transaction('rw', [db.estimationRequests, db.estimationResults], async () => {
    const request = await db.estimationRequests.get(result.requestId)
    if (!request || request.foodId !== result.foodId || request.inputHash !== result.inputHash) {
      throw new Error('推計結果が要求時の食品情報と一致しません。再推計してください。')
    }
    await db.estimationResults.put(result)
    await db.estimationRequests.put({ ...request, status: result.status, updatedAt: result.estimatedAt })
  })
}

export async function getEstimationSettings(): Promise<EstimationSettings> {
  const settings = await db.estimationSettings.get('default')
  if (settings) return settings
  await db.estimationSettings.put({ ...DEFAULT_ESTIMATION_SETTINGS })
  return { ...DEFAULT_ESTIMATION_SETTINGS }
}

export async function saveEstimationSettings(settings: Omit<EstimationSettings, 'id' | 'updatedAt'>): Promise<void> {
  if (settings.applyMode !== 'manual') throw new Error('推計値の自動採用は利用できません。結果を確認してから採用してください。')
  await db.estimationSettings.put({ id: 'default', ...settings, updatedAt: new Date().toISOString() })
}

export interface EstimationHistoryPage<T> {
  items: T[]
  nextCursor: string | null
}

export async function getEstimationRequestsForFood(foodId: string, options: { limit?: number; before?: string } = {}): Promise<EstimationHistoryPage<EstimationRequest>> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  let collection = db.estimationRequests.where('[foodId+createdAt]').between([foodId, Dexie.minKey], [foodId, Dexie.maxKey])
  const before = options.before
  if (before) collection = collection.filter((request) => request.createdAt < before)
  const items = await collection.reverse().limit(limit + 1).toArray()
  const hasNext = items.length > limit
  const page = items.slice(0, limit)
  return { items: page, nextCursor: hasNext ? page.at(-1)?.createdAt ?? null : null }
}

export async function getEstimationResultsForFood(foodId: string, options: { limit?: number; before?: string } = {}): Promise<EstimationHistoryPage<EstimationResult>> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  let collection = db.estimationResults.where('[foodId+estimatedAt]').between([foodId, Dexie.minKey], [foodId, Dexie.maxKey])
  const before = options.before
  if (before) collection = collection.filter((result) => result.estimatedAt < before)
  const items = await collection.reverse().limit(limit + 1).toArray()
  const hasNext = items.length > limit
  const page = items.slice(0, limit)
  return { items: page, nextCursor: hasNext ? page.at(-1)?.estimatedAt ?? null : null }
}

export async function getEstimationDecisionsForFood(foodId: string, options: { limit?: number; before?: string } = {}): Promise<EstimationHistoryPage<EstimationDecision>> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  let collection = db.estimationDecisions.where('[foodId+decidedAt]').between([foodId, Dexie.minKey], [foodId, Dexie.maxKey])
  const before = options.before
  if (before) collection = collection.filter((decision) => decision.decidedAt < before)
  const items = await collection.reverse().limit(limit + 1).toArray()
  const hasNext = items.length > limit
  const page = items.slice(0, limit)
  return { items: page, nextCursor: hasNext ? page.at(-1)?.decidedAt ?? null : null }
}

function estimatedMetadata(requestId: string, estimate: NonNullable<EstimationResult['estimates'][NutrientKey]>, modelVersion: string, adoptedAt: string): NutrientMetadata {
  return {
    origin: 'estimated', source: estimate.source ?? 'nutrition_estimator', confidence: estimate.confidence,
    ...(estimate.range ? { estimatedRange: { ...estimate.range } } : {}),
    ...(estimate.sourceFoodIds ? { sourceFoodIds: [...estimate.sourceFoodIds] } : {}),
    method: estimate.method, modelVersion, requestId, adoptedAt,
    ...(estimate.calibration ? { calibration: { ...estimate.calibration } } : {}),
  }
}

/**
 * 欠損値だけを採用する。食品、由来メタデータ、判断履歴を必ず同一トランザクションで更新する。
 */
export async function adoptEstimatedNutrients(requestId: string, nutrientKeys: NutrientKey[]): Promise<EstimationDecision[]> {
  const selected = [...new Set(nutrientKeys)]
  if (selected.length === 0) throw new Error('採用する栄養素を選択してください。')
  const now = new Date().toISOString()
  return db.transaction('rw', [db.foods, db.estimationRequests, db.estimationResults, db.estimationDecisions], async () => {
    const request = await db.estimationRequests.get(requestId)
    const result = await db.estimationResults.get(requestId)
    if (!request || !result) throw new Error('推計結果が見つかりません。再推計してください。')
    const food = await db.foods.get(request.foodId)
    if (!food) throw new Error('対象食品が見つかりません。食品を読み直してください。')
    if (request.inputHash !== result.inputHash || request.inputSnapshot.foodUpdatedAt !== food.updatedAt || createEstimationInputHash(food) !== request.inputHash) {
      throw new Error('食品情報が推計後に変更されています。再推計してから採用してください。')
    }
    const decisions: EstimationDecision[] = []
    for (const nutrientKey of selected) {
      const estimate = result.estimates[nutrientKey]
      if (!estimate || !Number.isFinite(estimate.value) || estimate.value < 0) throw new Error('選択した栄養素には採用できる推計値がありません。')
      if (!request.inputSnapshot.missingNutrients.includes(nutrientKey) || food.nutrients[nutrientKey] !== null) {
        throw new Error('既に値がある栄養素は推計値で上書きできません。パッケージ表示または入力値を確認してください。')
      }
      const metadata = estimatedMetadata(requestId, estimate, result.modelVersion, now)
      decisions.push({
        decisionId: createId('estimate-decision'), requestId, foodId: food.id, nutrientKey, decision: 'adopted',
        previousValue: null, previousMetadata: food.nutrientMetadata?.[nutrientKey], adoptedValue: estimate.value,
        adoptedMetadata: metadata, foodUpdatedAtBeforeDecision: food.updatedAt, foodUpdatedAtAfterDecision: now, decidedAt: now,
      })
    }
    const nutrients = { ...food.nutrients }
    const nutrientMetadata = { ...food.nutrientMetadata }
    for (const decision of decisions) {
      nutrients[decision.nutrientKey] = decision.adoptedValue ?? null
      nutrientMetadata[decision.nutrientKey] = decision.adoptedMetadata
    }
    await db.foods.put({ ...food, nutrients, nutrientMetadata, updatedAt: now })
    await db.estimationDecisions.bulkAdd(decisions)
    return decisions
  })
}

export async function rejectEstimatedNutrients(requestId: string, nutrientKeys: NutrientKey[]): Promise<EstimationDecision[]> {
  const selected = [...new Set(nutrientKeys)]
  if (selected.length === 0) throw new Error('不採用にする栄養素を選択してください。')
  const now = new Date().toISOString()
  return db.transaction('rw', [db.foods, db.estimationRequests, db.estimationResults, db.estimationDecisions], async () => {
    const request = await db.estimationRequests.get(requestId)
    const result = await db.estimationResults.get(requestId)
    const food = request ? await db.foods.get(request.foodId) : undefined
    if (!request || !result || !food || request.inputHash !== result.inputHash) throw new Error('推計結果が見つかりません。再推計してください。')
    const decisions = selected.map((nutrientKey): EstimationDecision => ({
      decisionId: createId('estimate-decision'), requestId, foodId: food.id, nutrientKey, decision: 'rejected',
      previousValue: food.nutrients[nutrientKey], previousMetadata: food.nutrientMetadata?.[nutrientKey],
      foodUpdatedAtBeforeDecision: food.updatedAt, decidedAt: now,
    }))
    await db.estimationDecisions.bulkAdd(decisions)
    return decisions
  })
}

/** 採用直後の食品更新日時と値・メタデータが一致する場合だけ、直前値へ戻す。 */
export async function revertEstimatedNutrient(decisionId: string): Promise<EstimationDecision> {
  const now = new Date().toISOString()
  return db.transaction('rw', [db.foods, db.estimationDecisions], async () => {
    const adopted = await db.estimationDecisions.get(decisionId)
    if (!adopted || adopted.decision !== 'adopted' || adopted.adoptedValue === undefined || !adopted.foodUpdatedAtAfterDecision) {
      throw new Error('取り消せる採用履歴が見つかりません。')
    }
    const food = await db.foods.get(adopted.foodId)
    if (!food || food.updatedAt !== adopted.foodUpdatedAtAfterDecision || food.nutrients[adopted.nutrientKey] !== adopted.adoptedValue
      || JSON.stringify(food.nutrientMetadata?.[adopted.nutrientKey]) !== JSON.stringify(adopted.adoptedMetadata)) {
      throw new Error('採用後に食品が変更されています。自動では取り消せないため、食品の値を確認してください。')
    }
    const nutrients = { ...food.nutrients, [adopted.nutrientKey]: adopted.previousValue }
    const nutrientMetadata = { ...food.nutrientMetadata }
    if (adopted.previousMetadata) nutrientMetadata[adopted.nutrientKey] = adopted.previousMetadata
    else delete nutrientMetadata[adopted.nutrientKey]
    const reverted: EstimationDecision = {
      decisionId: createId('estimate-decision'), requestId: adopted.requestId, foodId: adopted.foodId,
      nutrientKey: adopted.nutrientKey, decision: 'reverted', previousValue: adopted.adoptedValue,
      previousMetadata: adopted.adoptedMetadata, adoptedValue: adopted.previousValue ?? undefined,
      adoptedMetadata: adopted.previousMetadata, foodUpdatedAtBeforeDecision: food.updatedAt,
      foodUpdatedAtAfterDecision: now, decidedAt: now,
    }
    await db.foods.put({ ...food, nutrients, nutrientMetadata, updatedAt: now })
    await db.estimationDecisions.add(reverted)
    return reverted
  })
}
