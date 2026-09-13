import { describe, expect, it } from 'vitest'
import { applicableMextSearchAttributeHints, reconcileMextSearchAttributeHints } from '../src/services/mextSearchAttributeHints'
import { getDefaultSelectedAttributes, getSelectableAttributes } from '../src/services/mextFoodData'
import { searchUserFoodGroups } from '../src/services/mextUserFoodData'

describe('MEXT picker search attribute hints', () => {
  const searchResult = searchUserFoodGroups('鶏肉 むね 皮なし')
    .find((result) => result.group.canonicalName === '鶏肉')

  it('検索で明示された属性を既定値より優先し、実在する組み合わせへ整合する', () => {
    expect(searchResult?.foodGroupId).toBeTruthy()
    const foodGroupId = searchResult!.foodGroupId!
    const attributes = getSelectableAttributes(foodGroupId)
    const state = reconcileMextSearchAttributeHints(
      foodGroupId,
      { ...getDefaultSelectedAttributes(foodGroupId), skin_state: 'with_skin' },
      searchResult?.attributeSelection,
      attributes.map((attribute) => attribute.id),
    )

    expect(state.selection.skin_state).toBe('without_skin')
    expect(state.appliedHintAttributeIds).toEqual(new Set(['skin_state']))
  })

  it('編集対象の属性は検索ヒントより優先する', () => {
    const foodGroupId = searchResult!.foodGroupId!
    const editingSelection = {
      variety: 'v_090',
      cooking_state: 'raw',
      skin_state: 'with_skin',
      other: 'v_005',
    }
    const state = reconcileMextSearchAttributeHints(
      foodGroupId,
      getDefaultSelectedAttributes(foodGroupId),
      searchResult?.attributeSelection,
      getSelectableAttributes(foodGroupId).map((attribute) => attribute.id),
      editingSelection,
    )

    expect(state.selection).toEqual(editingSelection)
    expect(state.appliedHintAttributeIds).toEqual(new Set())
  })

  it('現在の食品グループに存在しないヒントは適用しない', () => {
    const foodGroupId = searchResult!.foodGroupId!
    const state = reconcileMextSearchAttributeHints(
      foodGroupId,
      getDefaultSelectedAttributes(foodGroupId),
      { unknown_attribute: 'unknown_value' },
      getSelectableAttributes(foodGroupId).map((attribute) => attribute.id),
    )

    expect(state.selection).not.toHaveProperty('unknown_attribute')
    expect(state.appliedHintAttributeIds).toEqual(new Set())
  })

  it('上位分類の検索ヒントを、部位選択後の食品グループへ引き継ぐ', () => {
    const broadResult = searchUserFoodGroups('鶏肉 皮なし')
      .find((result) => result.group.canonicalName === '鶏肉')
    expect(broadResult?.foodGroupId).toBeNull()

    const hints = applicableMextSearchAttributeHints(
      broadResult?.foodGroupId,
      searchResult!.foodGroupId!,
      broadResult?.attributeSelection,
    )
    expect(hints).toEqual({ skin_state: 'without_skin' })
  })
})
