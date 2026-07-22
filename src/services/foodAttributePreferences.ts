import type { FoodAttributePreference, FoodAttributePreferenceMode, FoodAttributePreferences } from '../types'
import { reconcileFoodAttributeSelection, type MextFoodGroupAttribute } from './mextFoodData'
import { reconcileUserFoodSelection, type UserFoodSelectionDimension } from './mextUserFoodData'

export const FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY = '__global__'

export interface AppliedMextFoodAttributePreferences {
  selection: Record<string, string>
  autoHiddenAttributeIds: Set<string>
  invalidAttributeIds: Set<string>
}

export interface AppliedUserFoodSelectionPreferences {
  selection: Record<string, string>
  autoHiddenDimensionIds: Set<string>
  invalidDimensionIds: Set<string>
}

export interface ConstrainedMextFoodAttributePreferences extends AppliedMextFoodAttributePreferences {
  incompatibleAttributeIds: Set<string>
}

export interface ConstrainedUserFoodSelectionPreferences extends AppliedUserFoodSelectionPreferences {
  incompatibleDimensionIds: Set<string>
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

export function applyConstrainedMextFoodAttributePreferences(
  foodGroupId: string,
  attributes: readonly MextFoodGroupAttribute[],
  masterDefaults: Readonly<Record<string, string>>,
  preferences: Readonly<Record<string, FoodAttributePreference>>,
): ConstrainedMextFoodAttributePreferences {
  const applied = applyMextFoodAttributePreferences(attributes, masterDefaults, preferences)
  const orderedAttributeIds = [
    ...attributes.filter((attribute) => attribute.visibility !== 'hidden' && !applied.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => applied.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => attribute.visibility === 'hidden'),
  ].map((attribute) => attribute.id)
  const reconciled = reconcileFoodAttributeSelection(foodGroupId, applied.selection, orderedAttributeIds)
  return {
    ...applied,
    selection: reconciled.selection,
    invalidAttributeIds: new Set([...applied.invalidAttributeIds, ...reconciled.clearedAttributeIds]),
    incompatibleAttributeIds: reconciled.clearedAttributeIds,
  }
}

/** 上位の食品種類もMEXT属性と同じ既定値・表示設定で扱う。 */
export function applyUserFoodSelectionPreferences(
  dimensions: readonly UserFoodSelectionDimension[],
  presetSelection: Readonly<Record<string, string>>,
  preferences: Readonly<Record<string, FoodAttributePreference>>,
): AppliedUserFoodSelectionPreferences {
  const selection: Record<string, string> = {}
  const autoHiddenDimensionIds = new Set<string>()
  const invalidDimensionIds = new Set<string>()
  for (const dimension of dimensions) {
    if (dimension.defaultValueId !== null && dimension.values.some((value) => value.id === dimension.defaultValueId)) {
      selection[dimension.id] = dimension.defaultValueId
    }
    const preference = preferences[dimension.id]
    if (!preference) continue
    if (!dimension.values.some((value) => value.id === preference.defaultValueId)) {
      invalidDimensionIds.add(dimension.id)
      continue
    }
    selection[dimension.id] = preference.defaultValueId
    if (preference.visible === false || (preference.visible === undefined && preference.mode === 'auto')) {
      autoHiddenDimensionIds.add(dimension.id)
    }
  }
  for (const [dimensionId, valueId] of Object.entries(presetSelection)) {
    const dimension = dimensions.find((candidate) => candidate.id === dimensionId)
    if (dimension?.values.some((value) => value.id === valueId)) selection[dimensionId] = valueId
  }
  return { selection, autoHiddenDimensionIds, invalidDimensionIds }
}

export function applyConstrainedUserFoodSelectionPreferences(
  userFoodGroupId: string,
  dimensions: readonly UserFoodSelectionDimension[],
  presetSelection: Readonly<Record<string, string>>,
  preferences: Readonly<Record<string, FoodAttributePreference>>,
): ConstrainedUserFoodSelectionPreferences {
  const applied = applyUserFoodSelectionPreferences(dimensions, presetSelection, preferences)
  const orderedDimensionIds = [
    ...dimensions.filter((dimension) => !applied.autoHiddenDimensionIds.has(dimension.id)),
    ...dimensions.filter((dimension) => applied.autoHiddenDimensionIds.has(dimension.id)),
  ].map((dimension) => dimension.id)
  const reconciled = reconcileUserFoodSelection(userFoodGroupId, applied.selection, orderedDimensionIds)
  return {
    ...applied,
    selection: reconciled.selection,
    invalidDimensionIds: new Set([...applied.invalidDimensionIds, ...reconciled.clearedDimensionIds]),
    incompatibleDimensionIds: reconciled.clearedDimensionIds,
  }
}
