import rawAttributes from '../../data/mext/app/food_group_attributes.json'
import rawFixedAttributes from '../../data/mext/app/food_group_fixed_attributes.json'
import rawGroups from '../../data/mext/app/food_groups.json'
import rawSearchIndex from '../../data/mext/app/food_search_index.json'
import rawVariants from '../../data/mext/app/food_variants.json'
import rawBuildSummary from '../../data/mext/app/build_summary.json'

export interface MextFoodGroup {
  id: string
  canonicalName: string
  displayName: string
  parentConcept: string | null
  foodForm: string
  keyParts: Array<{ dimension: string; value: string }>
  searchTerms: string[]
  hasSelectableAttributes: boolean
  selectableAttributeCount: number
  fixedAttributeCount: number
  sourceCount: number
  defaultSourceId: string | null
}

export interface MextAttributeValue {
  id: string
  canonicalValue: string
  displayName: string
  isUnspecified: boolean
  isNotApplicable: boolean
  isNoFilling: boolean
  sourceValues: Array<{ dimension: string; value: string }>
}

export interface MextFoodGroupAttribute {
  foodGroupId: string
  id: string
  displayName: string
  required: boolean
  visibility: 'primary' | 'optional' | 'advanced' | 'hidden'
  defaultValueId: string | null
  sourceDimensions: string[]
  subtype?: string
  values: MextAttributeValue[]
}

export interface MextFixedAttribute {
  id: string
  displayName: string
  visibility: 'primary' | 'optional' | 'advanced' | 'hidden'
  valueId: string
  canonicalValue: string
  valueDisplayName: string
  sourceDimensions: string[]
  sourceValues: Array<{ dimension: string; value: string }>
  subtype?: string
}

export interface MextFoodVariant {
  sourceId: string
  sourceName: string
  foodGroupId: string
  canonicalName: string
  attributes: Record<string, string>
  fixedAttributes: Record<string, string>
  variantKey: string
}

interface MextSearchIndexEntry {
  normalizedTerm: string
  compactTerm: string
  sourceTerms: string[]
  foodGroupIds: string[]
}

interface MextBuildSummary {
  outputFoodGroupCount: number
  outputVariantCount: number
  validationPassed: boolean
}

export interface MextFoodGroupSearchResult {
  group: MextFoodGroup
  matchedTerms: string[]
  score: number
}

export class FoodGroupNotFound extends Error {
  constructor(foodGroupId: string) {
    super(`食品グループがありません: food_group_id=${foodGroupId}`)
    this.name = 'FoodGroupNotFound'
  }
}

export class MissingRequiredAttribute extends Error {
  constructor(foodGroupId: string, attributeIds: string[]) {
    super(`必須属性が不足しています: food_group_id=${foodGroupId}, attributes=${attributeIds.join(',')}`)
    this.name = 'MissingRequiredAttribute'
  }
}

export class InvalidAttributeValue extends Error {
  constructor(foodGroupId: string, attributeId: string, valueId: string) {
    super(`属性値が不正です: food_group_id=${foodGroupId}, attribute_id=${attributeId}, value_id=${valueId}`)
    this.name = 'InvalidAttributeValue'
  }
}

export class FoodVariantNotFound extends Error {
  constructor(foodGroupId: string, variantKey: string) {
    super(`対応する食品成分レコードがありません: food_group_id=${foodGroupId}, variant_key=${variantKey}`)
    this.name = 'FoodVariantNotFound'
  }
}

export class AmbiguousFoodVariant extends Error {
  constructor(foodGroupId: string, variantKey: string) {
    super(`食品成分レコードを一意に決定できません: food_group_id=${foodGroupId}, variant_key=${variantKey}`)
    this.name = 'AmbiguousFoodVariant'
  }
}

const buildSummary = rawBuildSummary as MextBuildSummary
if (!buildSummary.validationPassed || buildSummary.outputFoodGroupCount !== 1494 || buildSummary.outputVariantCount !== 2538) {
  throw new Error('検証済みのMEXT本番データを読み込めません')
}

export const mextFoodGroups = rawGroups as MextFoodGroup[]
export const mextFoodGroupAttributes = rawAttributes as MextFoodGroupAttribute[]
export const mextFoodGroupFixedAttributes = rawFixedAttributes as Array<{ foodGroupId: string; attributes: MextFixedAttribute[] }>
export const mextFoodVariants = rawVariants as MextFoodVariant[]
const mextSearchIndex = rawSearchIndex as MextSearchIndexEntry[]

const groupsById = new Map(mextFoodGroups.map((group) => [group.id, group]))
const attributesByGroup = new Map<string, MextFoodGroupAttribute[]>()
for (const attribute of mextFoodGroupAttributes) {
  const attributes = attributesByGroup.get(attribute.foodGroupId) ?? []
  attributes.push(attribute)
  attributesByGroup.set(attribute.foodGroupId, attributes)
}
const fixedAttributesByGroup = new Map(mextFoodGroupFixedAttributes.map((record) => [record.foodGroupId, record.attributes]))
const variantsBySourceId = new Map(mextFoodVariants.map((variant) => [variant.sourceId, variant]))
const variantsByGroup = new Map<string, MextFoodVariant[]>()
const variantsByKey = new Map<string, MextFoodVariant[]>()
for (const variant of mextFoodVariants) {
  const groupVariants = variantsByGroup.get(variant.foodGroupId) ?? []
  groupVariants.push(variant)
  variantsByGroup.set(variant.foodGroupId, groupVariants)
  const lookupKey = `${variant.foodGroupId}\u0000${variant.variantKey}`
  const matches = variantsByKey.get(lookupKey) ?? []
  matches.push(variant)
  variantsByKey.set(lookupKey, matches)
}

export function normalizeMextSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(/\s+/g, ' ')
}

function compactMextSearchText(value: string): string {
  return normalizeMextSearchText(value).replace(/\s+/g, '')
}

export function listFoodGroups(): MextFoodGroup[] {
  return [...mextFoodGroups]
}

export function hasFoodGroup(foodGroupId: string): boolean {
  return groupsById.has(foodGroupId)
}

export function getFoodGroup(foodGroupId: string): MextFoodGroup {
  const group = groupsById.get(foodGroupId)
  if (!group) throw new FoodGroupNotFound(foodGroupId)
  return group
}

export function getSelectableAttributes(foodGroupId: string): MextFoodGroupAttribute[] {
  getFoodGroup(foodGroupId)
  return [...(attributesByGroup.get(foodGroupId) ?? [])]
}

export function getFixedAttributes(foodGroupId: string): MextFixedAttribute[] {
  getFoodGroup(foodGroupId)
  return [...(fixedAttributesByGroup.get(foodGroupId) ?? [])]
}

export function getFoodVariantBySourceId(sourceId: string): MextFoodVariant | undefined {
  return variantsBySourceId.get(sourceId)
}

export function getFoodVariants(foodGroupId: string): MextFoodVariant[] {
  getFoodGroup(foodGroupId)
  return [...(variantsByGroup.get(foodGroupId) ?? [])]
}

export function getDefaultSelectedAttributes(foodGroupId: string): Record<string, string> {
  return Object.fromEntries(
    getSelectableAttributes(foodGroupId)
      .filter((attribute): attribute is MextFoodGroupAttribute & { defaultValueId: string } => attribute.defaultValueId !== null)
      .map((attribute) => [attribute.id, attribute.defaultValueId]),
  )
}

export function buildMextVariantKey(
  selectedAttributes: Readonly<Record<string, string>>,
  attributes: readonly MextFoodGroupAttribute[],
): string {
  if (Object.keys(selectedAttributes).length === 0) return 'default'
  return attributes
    .filter((attribute) => selectedAttributes[attribute.id] !== undefined)
    .map((attribute) => `${attribute.id}=${selectedAttributes[attribute.id]}`)
    .join('|')
}

export function resolveFoodVariant(
  foodGroupId: string,
  selectedAttributes: Readonly<Record<string, string>>,
): MextFoodVariant {
  getFoodGroup(foodGroupId)
  const attributes = getSelectableAttributes(foodGroupId)
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  for (const [attributeId, valueId] of Object.entries(selectedAttributes)) {
    const attribute = attributesById.get(attributeId)
    if (!attribute || !attribute.values.some((value) => value.id === valueId)) {
      throw new InvalidAttributeValue(foodGroupId, attributeId, valueId)
    }
  }
  const missing = attributes
    .filter((attribute) => attribute.required && selectedAttributes[attribute.id] === undefined)
    .map((attribute) => attribute.id)
  if (missing.length > 0) throw new MissingRequiredAttribute(foodGroupId, missing)
  const variantKey = buildMextVariantKey(selectedAttributes, attributes)
  const matches = variantsByKey.get(`${foodGroupId}\u0000${variantKey}`) ?? []
  if (matches.length === 0) throw new FoodVariantNotFound(foodGroupId, variantKey)
  if (matches.length > 1) throw new AmbiguousFoodVariant(foodGroupId, variantKey)
  return matches[0]
}

/** hidden属性は通常表示せず、表示属性だけで一意なら内部的に補って解決する。 */
export function resolveFoodVariantForUi(
  foodGroupId: string,
  selectedAttributes: Readonly<Record<string, string>>,
): MextFoodVariant {
  getFoodGroup(foodGroupId)
  const attributes = getSelectableAttributes(foodGroupId)
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  for (const [attributeId, valueId] of Object.entries(selectedAttributes)) {
    const attribute = attributesById.get(attributeId)
    if (!attribute || !attribute.values.some((value) => value.id === valueId)) {
      throw new InvalidAttributeValue(foodGroupId, attributeId, valueId)
    }
  }
  const missing = attributes
    .filter((attribute) => attribute.visibility !== 'hidden' && attribute.required && selectedAttributes[attribute.id] === undefined)
    .map((attribute) => attribute.id)
  if (missing.length > 0) throw new MissingRequiredAttribute(foodGroupId, missing)
  const matches = getFoodVariants(foodGroupId).filter((variant) => Object.entries(selectedAttributes)
    .every(([attributeId, valueId]) => variant.attributes[attributeId] === valueId))
  const variantKey = buildMextVariantKey(selectedAttributes, attributes)
  if (matches.length === 0) throw new FoodVariantNotFound(foodGroupId, variantKey)
  if (matches.length > 1) throw new AmbiguousFoodVariant(foodGroupId, variantKey)
  return matches[0]
}

export function getSourceId(
  foodGroupId: string,
  selectedAttributes: Readonly<Record<string, string>>,
): string {
  return resolveFoodVariant(foodGroupId, selectedAttributes).sourceId
}

export function searchFoodGroups(query: string): MextFoodGroupSearchResult[] {
  const normalizedQuery = normalizeMextSearchText(query)
  const compactQuery = compactMextSearchText(query)
  if (!normalizedQuery) {
    return mextFoodGroups.map((group) => ({ group, matchedTerms: [], score: 0 }))
  }
  const matchesByGroup = new Map<string, { score: number; matchedTerms: Set<string> }>()
  for (const entry of mextSearchIndex) {
    let score = -1
    if (entry.normalizedTerm === normalizedQuery) score = 100
    else if (entry.compactTerm === compactQuery) score = 95
    else if (entry.normalizedTerm.startsWith(normalizedQuery)) score = 80
    else if (entry.compactTerm.startsWith(compactQuery)) score = 75
    else if (entry.normalizedTerm.includes(normalizedQuery)) score = 60
    else if (entry.compactTerm.includes(compactQuery)) score = 55
    if (score < 0) continue
    for (const foodGroupId of entry.foodGroupIds) {
      const current = matchesByGroup.get(foodGroupId) ?? { score: -1, matchedTerms: new Set<string>() }
      current.score = Math.max(current.score, score)
      entry.sourceTerms.forEach((term) => current.matchedTerms.add(term))
      matchesByGroup.set(foodGroupId, current)
    }
  }
  return [...matchesByGroup.entries()]
    .map(([foodGroupId, match]) => ({
      group: getFoodGroup(foodGroupId),
      matchedTerms: [...match.matchedTerms],
      score: match.score,
    }))
    .sort((left, right) => right.score - left.score
      || left.group.displayName.localeCompare(right.group.displayName, 'ja')
      || left.group.id.localeCompare(right.group.id))
}
