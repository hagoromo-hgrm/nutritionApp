import { db, saveFoodWithMetadata, type FoodMetadataUpdate } from '../db/db'
import type { EstimationRequest, EstimationResult, Food, NutrientKey } from '../types'
import { adoptEstimatedNutrients, rejectEstimatedNutrients, saveEstimationRequest, saveEstimationResult } from './nutrientEstimationStore'

interface FoodEstimationDecision {
  request: EstimationRequest
  result: EstimationResult
  adoptedKeys: NutrientKey[]
  rejectedKeys: NutrientKey[]
}

/** 食品編集も含めた保存単位。履歴の書き込み失敗時に先行する食品更新を残さない。 */
export async function saveFoodAndEstimation(food: Food, metadata: FoodMetadataUpdate, decision: FoodEstimationDecision, expectedInputHash: string | null): Promise<Food> {
  return db.transaction('rw', [
    db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms,
    db.menus, db.generalMenus, db.menuSets,
    db.estimationRequests, db.estimationResults, db.estimationDecisions,
  ], async () => {
    await saveFoodWithMetadata(food, metadata, expectedInputHash)
    await saveEstimationRequest(decision.request)
    await saveEstimationResult(decision.result)
    if (decision.rejectedKeys.length > 0) await rejectEstimatedNutrients(decision.request.requestId, decision.rejectedKeys)
    if (decision.adoptedKeys.length > 0) await adoptEstimatedNutrients(decision.request.requestId, decision.adoptedKeys)
    return (await db.foods.get(food.id))!
  })
}
