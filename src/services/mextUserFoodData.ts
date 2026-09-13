import rawUserFoodGroups from '../../data/mext/app/user_food_groups.json'
import rawUserFoodGroupMappings from '../../data/mext/app/user_food_group_mappings.json'
import rawUserFoodSearchIndex from '../../data/mext/app/user_food_search_index.json'
import {
  getSelectableAttributes,
  getSourceId,
  type MextFoodGroupAttribute,
} from './mextFoodData'
import {
  compareSearchCandidates,
  compactSearchText,
  matchParsedSearchText,
  normalizeSearchPhrase,
  parseSearchText,
  type SearchableTextField,
  type SearchRelevance,
} from './searchText'
import { getAvailableConstraintValues, reconcileConstraintSelection, type VariantConstraintCandidate, type VariantConstraintValue } from './variantConstraints'

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
  attributeSelection?: Record<string, string>
  foodGroupId: string | null
  targetType: UserFoodSearchTarget['targetType']
  matchedTerm: string
  score: number
  /** Always populated by searchUserFoodGroups; optional for legacy/manual wrappers. */
  relevance?: SearchRelevance
}

export interface UserFoodSearchOptions {
  expandPartShortcuts?: boolean
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
  return normalizeSearchPhrase(value)
}

function compactUserFoodSearchText(value: string): string {
  return compactSearchText(value)
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

function userFoodConstraintCandidates(group: UserFoodGroup): VariantConstraintCandidate[] {
  return group.memberFoodGroupIds.flatMap((foodGroupId) => {
    let selections: Array<Record<string, VariantConstraintValue>> = [{}]
    for (const dimension of group.selectionDimensions) {
      const values = dimension.values.filter((value) => value.foodGroupId === foodGroupId).map((value) => value.id)
      if (values.length === 0 && dimension.required) return []
      const candidateValues: VariantConstraintValue[] = values.length > 0 ? values : [null]
      selections = selections.flatMap((selection) => candidateValues.map((value) => ({ ...selection, [dimension.id]: value })))
    }
    return selections.map((values, index) => ({ id: `${foodGroupId}:${index}`, values }))
  })
}

export function getAvailableUserSelectionValueIds(
  userFoodGroupId: string,
  selectedValues: Readonly<Record<string, string>>,
  targetDimensionId: string,
  orderedDimensionIds?: readonly string[],
): Set<string> {
  const group = getUserFoodGroup(userFoodGroupId)
  const order = orderedDimensionIds ?? group.selectionDimensions.map((dimension) => dimension.id)
  const available = getAvailableConstraintValues(
    userFoodConstraintCandidates(group),
    order,
    selectedValues,
    targetDimensionId,
  )
  return new Set([...available].filter((value): value is string => value !== null))
}

export function reconcileUserFoodSelection(
  userFoodGroupId: string,
  selectedValues: Readonly<Record<string, string>>,
  orderedDimensionIds?: readonly string[],
): { selection: Record<string, string>; clearedDimensionIds: Set<string> } {
  const group = getUserFoodGroup(userFoodGroupId)
  const reconciled = reconcileConstraintSelection(
    userFoodConstraintCandidates(group),
    orderedDimensionIds ?? group.selectionDimensions.map((dimension) => dimension.id),
    selectedValues,
  )
  return {
    selection: Object.fromEntries(Object.entries(reconciled.selection).filter((entry): entry is [string, string] => entry[1] !== null)),
    clearedDimensionIds: reconciled.clearedKeys,
  }
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

interface MextSearchField extends SearchableTextField {
  sourceTerm: string
  attributeId?: string
  attributeValueId?: string
}

interface MextSearchCandidate {
  group: UserFoodGroup
  presetSelection: Record<string, string>
  foodGroupId: string | null
  targetType: UserFoodSearchTarget['targetType']
  fields: MextSearchField[]
}

let searchCandidatesCache: MextSearchCandidate[] | null = null

function stableSelectionKey(selection: Readonly<Record<string, string>>): string {
  return Object.entries(selection).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`).join('|')
}

function targetKey(target: UserFoodSearchTarget): string {
  return `${target.userFoodGroupId}::${target.foodGroupId ?? ''}::${stableSelectionKey(target.presetSelection)}`
}

function baseGroupFields(group: UserFoodGroup): MextSearchField[] {
  const terms = [group.displayName, group.canonicalName, ...group.searchTerms]
  return [...new Set(terms)].map((term, index) => ({
    value: compactUserFoodSearchText(term),
    name: index === 0 ? 'display' : 'alias',
    priority: index === 0 ? 60 : 50,
    sourceTerm: term,
  }))
}

function selectionFields(group: UserFoodGroup, selection: Readonly<Record<string, string>>): MextSearchField[] {
  return Object.entries(selection).flatMap(([dimensionId, valueId]) => {
    const value = group.selectionDimensions.find((dimension) => dimension.id === dimensionId)
      ?.values.find((candidate) => candidate.id === valueId)
    if (!value) return []
    return [{ value: compactUserFoodSearchText(value.displayName), name: 'alias', priority: 55, sourceTerm: value.displayName }]
  })
}

function attributeFields(foodGroupIds: readonly string[]): MextSearchField[] {
  const values = new Map<string, MextSearchField>()
  for (const foodGroupId of foodGroupIds) {
    for (const attribute of getSelectableAttributes(foodGroupId)) {
      if (attribute.visibility === 'hidden') continue
      for (const value of attribute.values) {
        const normalizedValue = compactUserFoodSearchText(value.displayName)
        if (!normalizedValue || value.isUnspecified || value.isNotApplicable) continue
        const key = `${normalizedValue}::${attribute.id}::${value.id}`
        values.set(key, {
          value: normalizedValue,
          name: 'attribute',
          priority: 45,
          sourceTerm: value.displayName,
          attributeId: attribute.id,
          attributeValueId: value.id,
        })
      }
    }
  }
  return [...values.values()]
}

function getSearchCandidates(): MextSearchCandidate[] {
  if (searchCandidatesCache) return searchCandidatesCache
  const candidates = new Map<string, MextSearchCandidate>()
  for (const group of mextUserFoodGroups) {
    candidates.set(`${group.id}::::`, {
      group,
      presetSelection: {},
      foodGroupId: group.defaultFoodGroupId,
      targetType: 'user_food_group',
      fields: [
        ...baseGroupFields(group),
        ...attributeFields(group.memberFoodGroupIds),
      ],
    })
  }
  for (const entry of userFoodSearchIndex) {
    for (const target of entry.targets) {
      const key = targetKey(target)
      const group = getUserFoodGroup(target.userFoodGroupId)
      const candidate = candidates.get(key) ?? {
        group,
        presetSelection: { ...target.presetSelection },
        foodGroupId: target.foodGroupId,
        targetType: target.targetType,
        fields: [
          ...baseGroupFields(group),
          ...selectionFields(group, target.presetSelection),
          ...attributeFields(target.foodGroupId ? [target.foodGroupId] : group.memberFoodGroupIds),
        ],
      }
      const sourcePriority = target.matchSource === 'group_name' ? 60
        : target.matchSource === 'shortcut' ? 55
          : target.matchSource === 'group_term' ? 50
            : 20
      candidate.fields.push({
        value: compactUserFoodSearchText(target.sourceTerm),
        name: target.matchSource === 'group_name' ? 'display' : target.matchSource === 'member_canonical' ? 'official' : 'alias',
        priority: sourcePriority,
        sourceTerm: target.sourceTerm,
      })
      candidates.set(key, candidate)
    }
  }
  searchCandidatesCache = [...candidates.values()]
  return searchCandidatesCache
}

function explicitAttributeSelection(queryTokens: readonly string[], fields: readonly SearchableTextField[]): Record<string, string> | undefined {
  const valuesByAttribute = new Map<string, Set<string>>()
  for (const token of queryTokens) {
    const exactMatches = fields.filter((field): field is MextSearchField & { attributeId: string; attributeValueId: string } => {
      const candidate = field as MextSearchField
      return candidate.value === token
        && typeof candidate.attributeId === 'string'
        && typeof candidate.attributeValueId === 'string'
    })
    const uniquePairs = new Map(exactMatches.map((field) => [`${field.attributeId}::${field.attributeValueId}`, field]))
    if (uniquePairs.size !== 1) continue
    const field = [...uniquePairs.values()][0]
    const values = valuesByAttribute.get(field.attributeId) ?? new Set<string>()
    values.add(field.attributeValueId)
    valuesByAttribute.set(field.attributeId, values)
  }
  const selection = Object.fromEntries([...valuesByAttribute]
    .filter(([, values]) => values.size === 1)
    .map(([attributeId, values]) => [attributeId, [...values][0]]))
  return Object.keys(selection).length > 0 ? selection : undefined
}

export function searchUserFoodGroups(query: string, options: UserFoodSearchOptions = {}): UserFoodSearchResult[] {
  const parsedQuery = parseSearchText(query)
  if (!parsedQuery.normalized) return []
  const bestByGroup = new Map<string, UserFoodSearchResult>()
  const exactParentGroupIds = new Set<string>()
  for (const candidate of getSearchCandidates()) {
    const match = matchParsedSearchText(parsedQuery, candidate.fields)
    if (match.score < 0) continue
    const isParent = candidate.targetType === 'user_food_group' && Object.keys(candidate.presetSelection).length === 0
    if (options.expandPartShortcuts
      && isParent
      && baseGroupFields(candidate.group).some((field) => field.value === parsedQuery.compact)) {
      exactParentGroupIds.add(candidate.group.id)
    }
    const matchedField = match.matchedFields.slice().sort((left, right) => right.priority - left.priority)[0] as MextSearchField | undefined
    const result: UserFoodSearchResult = {
      group: candidate.group,
      presetSelection: { ...candidate.presetSelection },
      attributeSelection: explicitAttributeSelection(parsedQuery.tokens, candidate.fields),
      foodGroupId: candidate.foodGroupId,
      targetType: candidate.targetType,
      matchedTerm: matchedField?.sourceTerm ?? candidate.group.displayName,
      score: match.score,
      relevance: match.relevance,
    }
    const current = bestByGroup.get(candidate.group.id)
    const relevanceOrder = current ? compareSearchCandidates(result, current) : -1
    if (!current
      || relevanceOrder < 0
      || (relevanceOrder === 0 && current.targetType === 'user_food_variant' && result.targetType === 'user_food_group')
      || (relevanceOrder === 0 && current.targetType === result.targetType && result.matchedTerm.localeCompare(current.matchedTerm, 'ja') < 0)) {
      bestByGroup.set(candidate.group.id, result)
    }
  }
  const expandedGroupIds = new Set<string>()
  const expandedResults: UserFoodSearchResult[] = []
  if (options.expandPartShortcuts) {
    for (const userFoodGroupId of exactParentGroupIds) {
      const parent = bestByGroup.get(userFoodGroupId)
      if (!parent) continue
      const shortcutValues = parent.group.selectionDimensions
        .filter((dimension) => dimension.displayName === '部位' || dimension.id === 'egg_type')
        .flatMap((dimension) => dimension.values
          .filter((value) => value.searchShortcut)
          .map((value) => ({ dimension, value })))
      if (shortcutValues.length === 0) continue
      expandedGroupIds.add(userFoodGroupId)
      for (const { dimension, value } of shortcutValues) {
        expandedResults.push({
          group: parent.group,
          presetSelection: { [dimension.id]: value.id },
          foodGroupId: value.foodGroupId,
          targetType: 'user_food_variant',
          matchedTerm: parent.matchedTerm,
          score: parent.score,
          relevance: parent.relevance,
        })
      }
    }
  }
  return [...bestByGroup.values()].filter((result) => !expandedGroupIds.has(result.group.id)).concat(expandedResults).sort((left, right) => compareSearchCandidates(left, right)
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
