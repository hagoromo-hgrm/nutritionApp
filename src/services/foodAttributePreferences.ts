import type { FoodAttributePreference, FoodAttributePreferenceMode, FoodAttributePreferences } from '../types'
import type { MextFoodGroupAttribute } from './mextFoodData'

export const FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY = '__global__'

export interface AppliedMextFoodAttributePreferences {
  selection: Record<string, string>
  autoHiddenAttributeIds: Set<string>
  invalidAttributeIds: Set<string>
}

export function isFoodAttributePreferenceMode(value: unknown): value is FoodAttributePreferenceMode {
  return value === 'prefill' || value === 'auto'
}

export function isFoodAttributePreference(value: unknown): value is FoodAttributePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.defaultValueId === 'string' && candidate.defaultValueId.length > 0 && isFoodAttributePreferenceMode(candidate.mode)
    && (candidate.visible === undefined || typeof candidate.visible === 'boolean')
}

/** IndexedDB・バックアップから読んだ設定を、新旧形式を保ったまま正規化する。 */
export function normalizeFoodAttributePreferences(value: unknown): FoodAttributePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: FoodAttributePreferences = {}
  const legacy: Record<string, FoodAttributePreference> = {}
  for (const [groupId, groupPreferences] of Object.entries(value)) {
    if (!groupId || !groupPreferences || typeof groupPreferences !== 'object' || Array.isArray(groupPreferences)) continue
    if (isFoodAttributePreference(groupPreferences)) {
      legacy[groupId] = { ...groupPreferences, visible: groupPreferences.visible ?? groupPreferences.mode !== 'auto' }
      continue
    }
    const group: Record<string, FoodAttributePreference> = {}
    for (const [attributeId, preference] of Object.entries(groupPreferences)) {
      if (!attributeId || !isFoodAttributePreference(preference)) continue
      group[attributeId] = { ...preference, visible: preference.visible ?? preference.mode !== 'auto' }
    }
    if (Object.keys(group).length > 0) normalized[groupId] = group
  }
  if (Object.keys(legacy).length > 0) normalized[FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY] = legacy
  return normalized
}

export function setFoodAttributePreference(
  preferences: FoodAttributePreferences,
  foodGroupId: string,
  attributeId: string,
  preference: FoodAttributePreference | null,
): FoodAttributePreferences {
  const next = { ...preferences }
  const group = { ...(next[foodGroupId] ?? {}) }
  if (preference === null) delete group[attributeId]
  else group[attributeId] = { ...preference }
  if (Object.keys(group).length === 0) delete next[foodGroupId]
  else next[foodGroupId] = group
  return next
}

export function getFoodAttributePreferencesForGroup(
  preferences: FoodAttributePreferences,
  foodGroupId: string,
): Record<string, FoodAttributePreference> {
  return { ...(preferences[FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY] ?? {}), ...(preferences[foodGroupId] ?? {}) }
}

export function applyMextFoodAttributePreferences(
  attributes: readonly MextFoodGroupAttribute[],
  masterDefaults: Readonly<Record<string, string>>,
  preferences: Readonly<Record<string, FoodAttributePreference>>,
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
    if (preference.visible === false || (preference.visible === undefined && preference.mode === 'auto')) autoHiddenAttributeIds.add(attribute.id)
  }
  return { selection, autoHiddenAttributeIds, invalidAttributeIds }
}
