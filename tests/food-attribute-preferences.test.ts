import { describe, expect, it } from 'vitest'
import { applyMextFoodAttributePreferences, applyUserFoodSelectionPreferences, FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY, getFoodAttributePreferencesForGroup, normalizeFoodAttributePreferences, setFoodAttributePreference } from '../src/services/foodAttributePreferences'

describe('食品属性設定', () => {
  it('旧設定や不正項目を空の設定として安全に扱う', () => {
    expect(normalizeFoodAttributePreferences(undefined)).toEqual({})
    expect(normalizeFoodAttributePreferences({ cooking_state: { defaultValueId: 'raw', mode: 'auto' }, broken: { defaultValueId: 1, mode: 'auto' }, invalidMode: { defaultValueId: 'x', mode: 'hide' } })).toEqual({ [FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY]: { cooking_state: { defaultValueId: 'raw', mode: 'auto', visible: false } } })
    expect(normalizeFoodAttributePreferences({ group_a: { cooking_state: { defaultValueId: 'cooked', mode: 'prefill' } } })).toEqual({ group_a: { cooking_state: { defaultValueId: 'cooked', mode: 'prefill', visible: true } } })
  })

  it('属性設定を追加・解除できる', () => {
    const preferences = setFoodAttributePreference({}, 'group_a', 'cooking_state', { defaultValueId: 'raw', mode: 'prefill' })
    expect(preferences).toEqual({ group_a: { cooking_state: { defaultValueId: 'raw', mode: 'prefill' } } })
    expect(setFoodAttributePreference(preferences, 'group_a', 'cooking_state', null)).toEqual({})
  })

  it('食品単位設定が共通設定を上書きし、別グループへ漏れない', () => {
    const preferences = {
      [FOOD_ATTRIBUTE_PREFERENCES_GLOBAL_KEY]: { state: { defaultValueId: 'cooked', mode: 'prefill' as const } },
      group_a: { state: { defaultValueId: 'raw', mode: 'auto' as const } },
    }
    expect(getFoodAttributePreferencesForGroup(preferences, 'group_a').state).toEqual({ defaultValueId: 'raw', mode: 'auto' })
    expect(getFoodAttributePreferencesForGroup(preferences, 'group_b').state).toEqual({ defaultValueId: 'cooked', mode: 'prefill' })
  })

  it('ユーザー既定値をMEXT既定値より優先し、autoとprefillの表示差を返す', () => {
    const attributes = [
      { foodGroupId: 'group', id: 'state', displayName: '状態', required: true, visibility: 'primary' as const, defaultValueId: 'cooked', sourceDimensions: [], values: [{ id: 'raw', canonicalValue: 'raw', displayName: '生', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }, { id: 'cooked', canonicalValue: 'cooked', displayName: '加熱', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }] },
      { foodGroupId: 'group', id: 'skin', displayName: '皮', required: true, visibility: 'primary' as const, defaultValueId: null, sourceDimensions: [], values: [{ id: 'with', canonicalValue: 'with', displayName: 'あり', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }, { id: 'without', canonicalValue: 'without', displayName: 'なし', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }] },
    ]
    const applied = applyMextFoodAttributePreferences(attributes, { state: 'cooked' }, { state: { defaultValueId: 'raw', mode: 'auto' }, skin: { defaultValueId: 'without', mode: 'prefill' } })
    expect(applied.selection).toEqual({ state: 'raw', skin: 'without' })
    expect(applied.autoHiddenAttributeIds).toEqual(new Set(['state']))
    expect(applied.invalidAttributeIds).toEqual(new Set())
  })

  it('チェックを外した属性だけを非表示属性として返す', () => {
    const attribute = { foodGroupId: 'group', id: 'state', displayName: '状態', required: true, visibility: 'primary' as const, defaultValueId: null, sourceDimensions: [], values: [{ id: 'raw', canonicalValue: 'raw', displayName: '生', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }] }
    const applied = applyMextFoodAttributePreferences([attribute], {}, { state: { defaultValueId: 'raw', mode: 'auto', visible: false } })
    expect(applied.selection).toEqual({ state: 'raw' })
    expect(applied.autoHiddenAttributeIds).toEqual(new Set(['state']))
  })

  it('上位の食品種類にも食品単位の既定値と非表示設定を適用する', () => {
    const dimension = { id: 'rice_type', displayName: 'ご飯の種類', required: true, defaultValueId: 'white_rice', values: [{ id: 'white_rice', displayName: '白ごはん', foodGroupId: 'white', searchShortcut: true }, { id: 'barley_rice', displayName: '麦ごはん', foodGroupId: 'barley', searchShortcut: true }] }
    const applied = applyUserFoodSelectionPreferences([dimension], {}, { rice_type: { defaultValueId: 'barley_rice', mode: 'auto', visible: false } })
    expect(applied.selection).toEqual({ rice_type: 'barley_rice' })
    expect(applied.autoHiddenDimensionIds).toEqual(new Set(['rice_type']))
    expect(applied.invalidDimensionIds).toEqual(new Set())
  })

  it('上位の食品種類では検索プリセットをユーザー既定値より優先し、不正な既定値では非表示にしない', () => {
    const dimension = { id: 'rice_type', displayName: 'ご飯の種類', required: true, defaultValueId: 'white_rice', values: [{ id: 'white_rice', displayName: '白ごはん', foodGroupId: 'white', searchShortcut: true }, { id: 'brown_rice', displayName: '玄米ごはん', foodGroupId: 'brown', searchShortcut: true }] }
    expect(applyUserFoodSelectionPreferences([dimension], { rice_type: 'brown_rice' }, { rice_type: { defaultValueId: 'white_rice', mode: 'auto', visible: false } }).selection).toEqual({ rice_type: 'brown_rice' })
    const invalid = applyUserFoodSelectionPreferences([dimension], {}, { rice_type: { defaultValueId: 'missing', mode: 'auto', visible: false } })
    expect(invalid.selection).toEqual({ rice_type: 'white_rice' })
    expect(invalid.autoHiddenDimensionIds).toEqual(new Set())
    expect(invalid.invalidDimensionIds).toEqual(new Set(['rice_type']))
  })

  it('食品グループにない既定値は適用せず、曖昧な解決を補完しない', () => {
    const attribute = { foodGroupId: 'group', id: 'state', displayName: '状態', required: true, visibility: 'primary' as const, defaultValueId: null, sourceDimensions: [], values: [{ id: 'raw', canonicalValue: 'raw', displayName: '生', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }] }
    const applied = applyMextFoodAttributePreferences([attribute], {}, { state: { defaultValueId: 'missing', mode: 'auto' } })
    expect(applied.selection).toEqual({})
    expect(applied.autoHiddenAttributeIds).toEqual(new Set())
    expect(applied.invalidAttributeIds).toEqual(new Set(['state']))
  })
})
