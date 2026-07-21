import rawUserFoodGroups from '../../data/mext/app/user_food_groups.json'
import rawUserFoodGroupMappings from '../../data/mext/app/user_food_group_mappings.json'
import rawUserFoodSearchIndex from '../../data/mext/app/user_food_search_index.json'
import {
  getSelectableAttributes,
  getSourceId,
  type MextFoodGroupAttribute,
} from './mextFoodData'

export interface UserFoodSelectionValue {
  id: string
  displayName: string
  foodGroupId: string
  searchShortcut: boolean
}

export interface UserFoodSelectionDimension {
  id: string
  displayName: string
  required: boolean
  defaultValueId: string | null
  values: UserFoodSelectionValue[]
}

export interface UserFoodGroup {
  id: string
  canonicalName: string
  displayName: string
  groupingLevel: 'strong' | 'moderate' | 'weak' | 'standalone'
  category: string
  searchTerms: string[]
  defaultFoodGroupId: string | null
  selectionDimensions: UserFoodSelectionDimension[]
  memberFoodGroupIds: string[]
  memberCount: number
  hasDirectSelection: boolean
  generatedUserName: boolean
  nameEvidence: string[]
  groupingReason: string | null
  separationReason: string | null
  confidence: number
  needsReview: boolean
  reviewReasons: string[]
}

export interface UserFoodGroupMapping {
  foodGroupId: string
  canonicalName: string
  userFoodGroupId: string
  userFoodGroupName: string
  presetSelection: Record<string, string>
  isDefault: boolean
}

interface UserFoodSearchTarget {
  targetType: 'user_food_group' | 'user_food_variant'
  userFoodGroupId: string
  presetSelection: Record<string, string>
  foodGroupId: string | null
  matchSource: 'group_name' | 'group_term' | 'shortcut' | 'member_canonical'
  sourceTerm: string
}

interface UserFoodSearchIndexEntry {
  normalizedTerm: string
  compactTerm: string
  targets: UserFoodSearchTarget[]
}

export interface UserFoodSearchResult {
  group: UserFoodGroup
  presetSelection: Record<string, string>
  foodGroupId: string | null
  targetType: UserFoodSearchTarget['targetType']
  matchedTerm: string
  score: number
}

export class UserFoodGroupNotFound extends Error {
  constructor(userFoodGroupId: string) {
    super(`ユーザー向け食品グループがありません: user_food_group_id=${userFoodGroupId}`)
    this.name = 'UserFoodGroupNotFound'
  }
}

export class MissingRequiredUserSelection extends Error {
  constructor(userFoodGroupId: string, dimensionIds: string[]) {
    super(`必須の上位属性が不足しています: user_food_group_id=${userFoodGroupId}, dimensions=${dimensionIds.join(',')}`)
    this.name = 'MissingRequiredUserSelection'
  }
}

export class InvalidUserSelectionValue extends Error {
  constructor(userFoodGroupId: string, dimensionId: string, valueId: string) {
    super(`上位属性値が不正です: user_food_group_id=${userFoodGroupId}, dimension=${dimensionId}, value=${valueId}`)
    this.name = 'InvalidUserSelectionValue'
  }
}

export class AmbiguousUserFoodSelection extends Error {
  constructor(userFoodGroupId: string) {
    super(`既存食品グループを一意に決定できません: user_food_group_id=${userFoodGroupId}`)
    this.name = 'AmbiguousUserFoodSelection'
  }
}

export const mextUserFoodGroups = rawUserFoodGroups as UserFoodGroup[]
export const mextUserFoodGroupMappings = rawUserFoodGroupMappings as UserFoodGroupMapping[]
const userFoodSearchIndex = rawUserFoodSearchIndex as UserFoodSearchIndexEntry[]

if (mextUserFoodGroupMappings.length !== 1494
  || new Set(mextUserFoodGroupMappings.map((mapping) => mapping.foodGroupId)).size !== 1494) {
  throw new Error('検証済みのユーザー向けMEXT食品データを読み込めません')
}

const groupsById = new Map(mextUserFoodGroups.map((group) => [group.id, group]))
const mappingsByFoodGroupId = new Map(mextUserFoodGroupMappings.map((mapping) => [mapping.foodGroupId, mapping]))

export function normalizeUserFoodSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(/\s+/g, ' ')
}

function compactUserFoodSearchText(value: string): string {
  return normalizeUserFoodSearchText(value).replace(/\s+/g, '')
}

export function listUserFoodGroups(): UserFoodGroup[] {
  return [...mextUserFoodGroups]
}

export function getUserFoodGroup(userFoodGroupId: string): UserFoodGroup {
  const group = groupsById.get(userFoodGroupId)
  if (!group) throw new UserFoodGroupNotFound(userFoodGroupId)
  return group
}

export function getUserFoodGroupForFoodGroup(foodGroupId: string): UserFoodGroupMapping | undefined {
  return mappingsByFoodGroupId.get(foodGroupId)
}

export function getUserSelectionDimensions(userFoodGroupId: string): UserFoodSelectionDimension[] {
  return [...getUserFoodGroup(userFoodGroupId).selectionDimensions]
}

export function resolveFoodGroupId(
  userFoodGroupId: string,
  selectedValues: Readonly<Record<string, string>>,
): string {
  const group = getUserFoodGroup(userFoodGroupId)
  const dimensionsById = new Map(group.selectionDimensions.map((dimension) => [dimension.id, dimension]))
  for (const [dimensionId, valueId] of Object.entries(selectedValues)) {
    const dimension = dimensionsById.get(dimensionId)
    if (!dimension || !dimension.values.some((value) => value.id === valueId)) {
      throw new InvalidUserSelectionValue(userFoodGroupId, dimensionId, valueId)
    }
  }
  if (group.selectionDimensions.length === 0) {
    if (!group.defaultFoodGroupId) throw new AmbiguousUserFoodSelection(userFoodGroupId)
    return group.defaultFoodGroupId
  }

  const resolvedFoodGroupIds = new Set<string>()
  const missing: string[] = []
  for (const dimension of group.selectionDimensions) {
    let valueId: string | undefined = selectedValues[dimension.id]
    if (valueId === undefined && Object.keys(selectedValues).length === 0 && group.hasDirectSelection) {
      valueId = dimension.defaultValueId ?? undefined
    }
    if (valueId === undefined) {
      if (dimension.required) missing.push(dimension.id)
      continue
    }
    const value = dimension.values.find((item) => item.id === valueId)
    if (!value) throw new InvalidUserSelectionValue(userFoodGroupId, dimension.id, valueId)
    resolvedFoodGroupIds.add(value.foodGroupId)
  }
  if (missing.length > 0) throw new MissingRequiredUserSelection(userFoodGroupId, missing)
  if (resolvedFoodGroupIds.size !== 1) throw new AmbiguousUserFoodSelection(userFoodGroupId)
  return [...resolvedFoodGroupIds][0]
}

function matchScore(entry: UserFoodSearchIndexEntry, target: UserFoodSearchTarget, normalizedQuery: string, compactQuery: string): number {
  const exact = entry.normalizedTerm === normalizedQuery || entry.compactTerm === compactQuery
  const prefix = entry.normalizedTerm.startsWith(normalizedQuery) || entry.compactTerm.startsWith(compactQuery)
  const partial = entry.normalizedTerm.includes(normalizedQuery) || entry.compactTerm.includes(compactQuery)
  if (!exact && !prefix && !partial) return -1
  if (exact && target.matchSource === 'group_name') return 600
  if (exact && target.matchSource === 'shortcut') return 550
  if ((exact || prefix) && (target.matchSource === 'group_name' || target.matchSource === 'group_term')) return 500
  if (prefix && target.matchSource === 'shortcut') return 450
  if (target.matchSource === 'member_canonical') return 200
  return 300
}

export function searchUserFoodGroups(query: string): UserFoodSearchResult[] {
  const normalizedQuery = normalizeUserFoodSearchText(query)
  const compactQuery = compactUserFoodSearchText(query)
  if (!normalizedQuery) return []
  const bestByGroup = new Map<string, UserFoodSearchResult>()
  for (const entry of userFoodSearchIndex) {
    for (const target of entry.targets) {
      const score = matchScore(entry, target, normalizedQuery, compactQuery)
      if (score < 0) continue
      const candidate: UserFoodSearchResult = {
        group: getUserFoodGroup(target.userFoodGroupId),
        presetSelection: { ...target.presetSelection },
        foodGroupId: target.foodGroupId,
        targetType: target.targetType,
        matchedTerm: target.sourceTerm,
        score,
      }
      const current = bestByGroup.get(target.userFoodGroupId)
      if (!current
        || candidate.score > current.score
        || (candidate.score === current.score && candidate.matchedTerm.localeCompare(current.matchedTerm, 'ja') < 0)) {
        bestByGroup.set(target.userFoodGroupId, candidate)
      }
    }
  }
  return [...bestByGroup.values()].sort((left, right) => right.score - left.score
    || left.group.displayName.localeCompare(right.group.displayName, 'ja')
    || left.group.id.localeCompare(right.group.id))
}

/** Resolve the existing lower-layer attributes without copying their definitions. */
export function getFoodGroupAttributes(foodGroupId: string): MextFoodGroupAttribute[] {
  return getSelectableAttributes(foodGroupId)
}

export function resolveSourceId(
  foodGroupId: string,
  selectedAttributes: Readonly<Record<string, string>>,
): string {
  return getSourceId(foodGroupId, selectedAttributes)
}
