import { describe, expect, it } from 'vitest'
import {
  AmbiguousFoodVariant,
  FoodGroupNotFound,
  FoodVariantNotFound,
  InvalidAttributeValue,
  MissingRequiredAttribute,
  getDefaultSelectedAttributes,
  getFoodAttributeDisplayName,
  getFixedAttributes,
  getFoodVariantBySourceId,
  getFoodVariants,
  getSelectableAttributes,
  getSourceId,
  listFoodGroups,
  mextFoodGroupAttributes,
  mextFoodGroups,
  mextFoodVariants,
  resolveFoodVariant,
  resolveFoodVariantForUi,
  searchFoodGroups,
  type MextFoodGroupAttribute,
} from '../src/services/mextFoodData'

function representativeAttribute(predicate: (attribute: MextFoodGroupAttribute) => boolean): MextFoodGroupAttribute {
  const attribute = mextFoodGroupAttributes.find(predicate)
  if (!attribute) throw new Error('テスト対象の属性が実データにありません')
  return attribute
}

function expectRepresentativeResolves(attribute: MextFoodGroupAttribute): void {
  const variant = mextFoodVariants.find((item) => item.foodGroupId === attribute.foodGroupId)
  if (!variant) throw new Error(`variantがありません: ${attribute.foodGroupId}`)
  expect(getSourceId(attribute.foodGroupId, variant.attributes)).toBe(variant.sourceId)
}

describe('confirmed MEXT app data access', () => {
  it('確定件数を保持し、食品グループ一覧を返す', () => {
    expect(listFoodGroups()).toHaveLength(1494)
    expect(mextFoodGroups).toHaveLength(1494)
    expect(mextFoodVariants).toHaveLength(2538)
    expect(new Set(mextFoodGroups.map((group) => group.id)).size).toBe(1494)
    expect(new Set(mextFoodVariants.map((variant) => variant.sourceId)).size).toBe(2538)
  })

  it('検索語が複数一致しても食品グループを重複表示しない', () => {
    const group = mextFoodGroups.find((item) => item.searchTerms.length > 1)
    if (!group) throw new Error('複数検索語を持つグループがありません')
    const results = searchFoodGroups(group.canonicalName)
    expect(results.some((result) => result.group.id === group.id)).toBe(true)
    expect(new Set(results.map((result) => result.group.id)).size).toBe(results.length)
  })

  it('代表的な全属性カテゴリとUI統合属性をsource_idへ解決する', () => {
    const attributes = [
      representativeAttribute((attribute) => attribute.id === 'cooking_state'),
      representativeAttribute((attribute) => attribute.id === 'skin_state'),
      representativeAttribute((attribute) => attribute.id === 'fat_state'),
      representativeAttribute((attribute) => attribute.id === 'filling'),
      representativeAttribute((attribute) => attribute.id === 'flavor'),
      representativeAttribute((attribute) => attribute.sourceDimensions.length > 1),
    ]
    attributes.forEach(expectRepresentativeResolves)
  })

  it('指定なし・該当なし・中身なしを別の内部値として解決する', () => {
    for (const valueId of ['unspecified', 'not_applicable', 'no_filling']) {
      const attribute = representativeAttribute((item) => item.values.some((value) => value.id === valueId))
      const value = attribute.values.find((item) => item.id === valueId)
      expect(value).toMatchObject({
        isUnspecified: valueId === 'unspecified',
        isNotApplicable: valueId === 'not_applicable',
        isNoFilling: valueId === 'no_filling',
      })
      const variant = mextFoodVariants.find((item) => item.foodGroupId === attribute.foodGroupId && item.attributes[attribute.id] === valueId)
      if (!variant) throw new Error(`対象variantがありません: ${attribute.foodGroupId}/${valueId}`)
      expect(resolveFoodVariant(attribute.foodGroupId, variant.attributes).sourceId).toBe(variant.sourceId)
    }
  })

  it('属性なしグループを即時解決し、固定属性だけのグループもUI属性を持たない', () => {
    const noAttributeGroup = mextFoodGroups.find((group) => group.selectableAttributeCount === 0 && group.fixedAttributeCount === 0)
    const fixedOnlyGroup = mextFoodGroups.find((group) => group.selectableAttributeCount === 0 && group.fixedAttributeCount > 0)
    if (!noAttributeGroup || !fixedOnlyGroup) throw new Error('対象グループがありません')
    expect(getSelectableAttributes(noAttributeGroup.id)).toEqual([])
    expect(getSourceId(noAttributeGroup.id, {})).toBe(noAttributeGroup.defaultSourceId)
    expect(getSelectableAttributes(fixedOnlyGroup.id)).toEqual([])
    expect(getFixedAttributes(fixedOnlyGroup.id)).toHaveLength(fixedOnlyGroup.fixedAttributeCount)
    expect(getSourceId(fixedOnlyGroup.id, {})).toBe(fixedOnlyGroup.defaultSourceId)
  })

  it('明示されたデフォルトだけを初期選択し、null属性は選ばない', () => {
    const attribute = representativeAttribute((item) => item.defaultValueId === null)
    const defaults = getDefaultSelectedAttributes(attribute.foodGroupId)
    expect(defaults[attribute.id]).toBeUndefined()
  })

  it('ご飯のvariety属性を上位のご飯種類と区別できる名称で返す', () => {
    const variety = getSelectableAttributes('fg_000435').find((attribute) => attribute.id === 'variety')
    if (!variety) throw new Error('白ごはんの種類属性がありません')
    expect(getFoodAttributeDisplayName('fg_000435', variety)).toBe('米の種類')
  })

  it('hidden属性を表示せずに一意なvariantを内部解決する', () => {
    const group = mextFoodGroups.find((item) => item.displayName === '鶏むね肉')
    if (!group) throw new Error('鶏むね肉グループがありません')
    const definitions = getSelectableAttributes(group.id)
    const hiddenIds = new Set(definitions.filter((attribute) => attribute.visibility === 'hidden').map((attribute) => attribute.id))
    const variant = getFoodVariants(group.id).find((item) => [...hiddenIds].some((attributeId) => item.attributes[attributeId] !== undefined))
    if (!variant) throw new Error('hidden属性を持つ鶏むね肉variantがありません')
    const visibleSelection = Object.fromEntries(Object.entries(variant.attributes).filter(([attributeId]) => !hiddenIds.has(attributeId)))

    expect(resolveFoodVariantForUi(group.id, visibleSelection).sourceId).toBe(variant.sourceId)
  })

  it('hidden属性なしでは衝突する場合だけ追加選択を要求する', () => {
    const group = mextFoodGroups.find((item) => item.displayName === '即席中華めん')
    if (!group) throw new Error('即席中華めんグループがありません')
    const definitions = getSelectableAttributes(group.id)
    const hiddenIds = new Set(definitions.filter((attribute) => attribute.visibility === 'hidden').map((attribute) => attribute.id))
    const variants = getFoodVariants(group.id)
    const byVisibleSignature = new Map<string, typeof variants>()
    for (const variant of variants) {
      const visibleSelection = Object.fromEntries(Object.entries(variant.attributes).filter(([attributeId]) => !hiddenIds.has(attributeId)))
      const signature = JSON.stringify(visibleSelection)
      byVisibleSignature.set(signature, [...(byVisibleSignature.get(signature) ?? []), variant])
    }
    const collision = [...byVisibleSignature.entries()].find(([, matches]) => matches.length > 1)
    if (!collision) throw new Error('hidden属性で区別するvariantがありません')
    const [visibleSignature, matches] = collision

    expect(() => resolveFoodVariantForUi(group.id, JSON.parse(visibleSignature) as Record<string, string>)).toThrow(AmbiguousFoodVariant)
    expect(resolveFoodVariantForUi(group.id, matches[0].attributes).sourceId).toBe(matches[0].sourceId)
  })

  it('不正値・required不足・未知グループ・存在しない組合せを区別する', () => {
    const group = mextFoodGroups.find((item) => item.selectableAttributeCount > 0)
    if (!group) throw new Error('選択属性グループがありません')
    const attribute = getSelectableAttributes(group.id)[0]
    expect(() => getSourceId(group.id, {})).toThrow(MissingRequiredAttribute)
    expect(() => getSourceId(group.id, { [attribute.id]: `${attribute.values[0].id}_invalid` })).toThrow(InvalidAttributeValue)
    expect(() => getSourceId(`${group.id}_missing`, {})).toThrow(FoodGroupNotFound)

    const sparseGroup = mextFoodGroups.find((item) => {
      const definitions = getSelectableAttributes(item.id)
      if (definitions.length < 2) return false
      const firstSelection = Object.fromEntries(definitions.map((definition) => [definition.id, definition.values[0].id]))
      try {
        resolveFoodVariant(item.id, firstSelection)
        return false
      } catch (error) {
        return error instanceof FoodVariantNotFound
      }
    })
    expect(sparseGroup).toBeDefined()
  })

  it('source_idからグループ・属性・固定属性を逆参照できる', () => {
    const source = mextFoodVariants.find((variant) => Object.keys(variant.fixedAttributes).length > 0 && Object.keys(variant.attributes).length > 0)
    if (!source) throw new Error('選択属性と固定属性を持つvariantがありません')
    expect(getFoodVariantBySourceId(source.sourceId)).toEqual(source)
    expect(getFoodVariants(source.foodGroupId).some((variant) => variant.sourceId === source.sourceId)).toBe(true)
    expect(getFixedAttributes(source.foodGroupId).map((attribute) => attribute.id).sort()).toEqual(Object.keys(source.fixedAttributes).sort())
  })
})
