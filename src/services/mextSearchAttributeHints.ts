import { getSelectableAttributes, reconcileFoodAttributeSelection } from './mextFoodData'

export function applicableMextSearchAttributeHints(
  hintedFoodGroupId: string | null | undefined,
  activeFoodGroupId: string | null,
  hints: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!activeFoodGroupId || (hintedFoodGroupId && hintedFoodGroupId !== activeFoodGroupId)) return undefined
  return hints
}

export function reconcileMextSearchAttributeHints(
  foodGroupId: string,
  baseSelection: Readonly<Record<string, string>>,
  searchAttributeSelection: Readonly<Record<string, string>> | undefined,
  orderedAttributeIds: readonly string[],
  editingSelection?: Readonly<Record<string, string>>,
): { selection: Record<string, string>; appliedHintAttributeIds: Set<string> } {
  if (editingSelection) {
    return { selection: { ...editingSelection }, appliedHintAttributeIds: new Set() }
  }
  const attributes = getSelectableAttributes(foodGroupId)
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const validHints = Object.fromEntries(Object.entries(searchAttributeSelection ?? {}).filter(([attributeId, valueId]) => {
    return attributesById.get(attributeId)?.values.some((value) => value.id === valueId) === true
  }))
  const hintedAttributeIds = Object.keys(validHints)
  const hintFirstOrder = [
    ...hintedAttributeIds,
    ...orderedAttributeIds.filter((attributeId) => !hintedAttributeIds.includes(attributeId)),
  ]
  const reconciled = reconcileFoodAttributeSelection(foodGroupId, { ...baseSelection, ...validHints }, hintFirstOrder)
  return {
    selection: reconciled.selection,
    appliedHintAttributeIds: new Set(hintedAttributeIds.filter((attributeId) => reconciled.selection[attributeId] === validHints[attributeId])),
  }
}
