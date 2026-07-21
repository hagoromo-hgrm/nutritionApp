import type { FoodAttributePreference, FoodAttributePreferenceMode } from '../types'
import type { MextFoodGroupAttribute } from './mextFoodData'

export type FoodAttributePreferences = Record<string, FoodAttributePreference>

export interface AppliedMextFoodAttributePreferences {
  selection: Record<string, string>
  autoHiddenAttributeIds: Set<string>
  invalidAttributeIds: Set<string>
}

export function isFoodAttributePreferenceMode(value: unknown): value is FoodAttributePreferenceMode {
  return value === 'prefill' || value === 'auto'
}

/** IndexedDB・バックアップから読んだ設定を、壊れた項目だけ除外して正規化する。 */
export function normalizeFoodAttributePreferences(value: unknown): FoodAttributePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: FoodAttributePreferences = {}
  for (const [attributeId, preference] of Object.entries(value)) {
    if (!attributeId || !preference || typeof preference !== 'object' || Array.isArray(preference)) continue
    const candidate = preference as Record<string, unknown>
    if (typeof candidate.defaultValueId !== 'string' || candidate.defaultValueId.length === 0 || !isFoodAttributePreferenceMode(candidate.mode)) continue
    normalized[attributeId] = { defaultValueId: candidate.defaultValueId, mode: candidate.mode }
  }
  return normalized
}

export function setFoodAttributePreference(
  preferences: FoodAttributePreferences,
  attributeId: string,
  preference: FoodAttributePreference | null,
): FoodAttributePreferences {
  const next = { ...preferences }
  if (preference === null) delete next[attributeId]
  else next[attributeId] = { ...preference }
  return next
}

export function applyMextFoodAttributePreferences(
  attributes: readonly MextFoodGroupAttribute[],
  masterDefaults: Readonly<Record<string, string>>,
  preferences: FoodAttributePreferences,
): AppliedMextFoodAttributePreferences {
  const selectableAttributes = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const selection = Object.fromEntries(Object.entries(masterDefaults).filter(([attributeId]) => {
    const attribute = selectableAttributes.get(attributeId)
    return attribute !== undefined && attribute.visibility !== 'hidden'
  }))
  const autoHiddenAttributeIds = new Set<string>()
  const invalidAttributeIds = new Set<string>()
  for (const attribute of attributes) {
    const preference = preferences[attribute.id]
    if (attribute.visibility === 'hidden') continue
    if (!preference) continue
    if (!attribute.values.some((value) => value.id === preference.defaultValueId)) {
      invalidAttributeIds.add(attribute.id)
      continue
    }
    selection[attribute.id] = preference.defaultValueId
    if (preference.mode === 'auto') autoHiddenAttributeIds.add(attribute.id)
  }
  return { selection, autoHiddenAttributeIds, invalidAttributeIds }
}
