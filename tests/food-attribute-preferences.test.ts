import { describe, expect, it } from 'vitest'
import { applyMextFoodAttributePreferences, normalizeFoodAttributePreferences, setFoodAttributePreference } from '../src/services/foodAttributePreferences'

describe('食品属性設定', () => {
  it('旧設定や不正項目を空の設定として安全に扱う', () => {
    expect(normalizeFoodAttributePreferences(undefined)).toEqual({})
    expect(normalizeFoodAttributePreferences({ cooking_state: { defaultValueId: 'raw', mode: 'auto' }, broken: { defaultValueId: 1, mode: 'auto' }, invalidMode: { defaultValueId: 'x', mode: 'hide' } })).toEqual({ cooking_state: { defaultValueId: 'raw', mode: 'auto' } })
  })

  it('属性設定を追加・解除できる', () => {
    const preferences = setFoodAttributePreference({}, 'cooking_state', { defaultValueId: 'raw', mode: 'prefill' })
    expect(preferences).toEqual({ cooking_state: { defaultValueId: 'raw', mode: 'prefill' } })
    expect(setFoodAttributePreference(preferences, 'cooking_state', null)).toEqual({})
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

  it('食品グループにない既定値は適用せず、曖昧な解決を補完しない', () => {
    const attribute = { foodGroupId: 'group', id: 'state', displayName: '状態', required: true, visibility: 'primary' as const, defaultValueId: null, sourceDimensions: [], values: [{ id: 'raw', canonicalValue: 'raw', displayName: '生', isUnspecified: false, isNotApplicable: false, isNoFilling: false, sourceValues: [] }] }
    const applied = applyMextFoodAttributePreferences([attribute], {}, { state: { defaultValueId: 'missing', mode: 'auto' } })
    expect(applied.selection).toEqual({})
    expect(applied.autoHiddenAttributeIds).toEqual(new Set())
    expect(applied.invalidAttributeIds).toEqual(new Set(['state']))
  })
})
