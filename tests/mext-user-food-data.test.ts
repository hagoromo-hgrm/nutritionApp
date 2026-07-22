import { describe, expect, it } from 'vitest'
import { getFoodVariants, getSourceId } from '../src/services/mextFoodData'
import {
  InvalidUserSelectionValue,
  MissingRequiredUserSelection,
  UserFoodGroupNotFound,
  getAvailableUserSelectionValueIds,
  getFoodGroupAttributes,
  getUserFoodGroupForFoodGroup,
  getUserSelectionDimensions,
  listUserFoodGroups,
  mextUserFoodGroupMappings,
  mextUserFoodGroups,
  reconcileUserFoodSelection,
  resolveFoodGroupId,
  searchUserFoodGroups,
} from '../src/services/mextUserFoodData'

describe('MEXT user-facing food groups', () => {
  it('全1,494 food_group_idを重複なく一つの上位グループへ割り当てる', () => {
    expect(mextUserFoodGroupMappings).toHaveLength(1494)
    expect(new Set(mextUserFoodGroupMappings.map((mapping) => mapping.foodGroupId)).size).toBe(1494)
    expect(listUserFoodGroups()).toHaveLength(1399)
    expect(mextUserFoodGroups.filter((group) => group.memberCount > 1)).toHaveLength(20)
  })

  it('ご飯を上位グループとして検索し、重複表示しない', () => {
    const results = searchUserFoodGroups('ご飯')
    const rice = results.filter((result) => result.group.canonicalName === 'ご飯')
    expect(rice).toHaveLength(1)
    expect(rice[0].presetSelection).toEqual({})
    expect(rice[0].group.selectionDimensions[0]?.displayName).toBe('ご飯の種類')
    expect(new Set(results.map((result) => result.group.id)).size).toBe(results.length)
  })

  it('玄米検索を「ご飯 > 玄米ごはん」のプリセットへ解決する', () => {
    const result = searchUserFoodGroups('玄米').find((item) => item.group.canonicalName === 'ご飯')
    expect(result).toMatchObject({
      presetSelection: { rice_type: 'brown_rice' },
      foodGroupId: 'fg_001282',
      targetType: 'user_food_variant',
    })
    expect(resolveFoodGroupId(result!.group.id, result!.presetSelection)).toBe('fg_001282')
  })

  it('砂糖類を一つの大分類として検索し、種類を選択できる', () => {
    const results = searchUserFoodGroups('砂糖')
    const sugarResults = results.filter((result) => result.group.canonicalName === '砂糖')
    expect(sugarResults).toHaveLength(1)
    expect(sugarResults[0].presetSelection).toEqual({})

    const sugar = sugarResults[0].group
    expect(sugar.defaultFoodGroupId).toBe('fg_001357')
    expect(sugar.memberCount).toBe(15)
    expect(sugar.selectionDimensions[0]?.displayName).toBe('砂糖の種類')
    expect(sugar.selectionDimensions[0]?.values.map((value) => value.displayName)).toEqual([
      '上白糖', '三温糖', 'グラニュー糖', '黒砂糖', 'てんさい含蜜糖', '和三盆糖', '白ざら糖',
      '中ざら糖', '角砂糖', '氷砂糖', 'コーヒーシュガー', '粉糖', 'しょ糖型液糖', '転化型液糖', '氷糖みつ',
    ])
    expect(sugar.needsReview).toBe(false)
  })

  it('上白糖検索を「砂糖 > 上白糖」のプリセットへ解決する', () => {
    const result = searchUserFoodGroups('上白糖').find((item) => item.group.canonicalName === '砂糖')
    expect(result).toMatchObject({
      presetSelection: { sugar_type: 'white_sugar' },
      foodGroupId: 'fg_001357',
      targetType: 'user_food_variant',
    })
    expect(resolveFoodGroupId(result!.group.id, result!.presetSelection)).toBe('fg_001357')
  })

  it('肉の完全一致では部位ショートカットを独立候補へ展開する', () => {
    const expected = { 豚肉: 7, 牛肉: 10, 鶏肉: 6 }
    for (const [query, count] of Object.entries(expected)) {
      const results = searchUserFoodGroups(query, { expandPartShortcuts: true })
      const variants = results.filter((result) => result.group.canonicalName === query)
      expect(variants).toHaveLength(count)
      expect(variants.every((result) => result.targetType === 'user_food_variant')).toBe(true)
      expect(variants.every((result) => Object.keys(result.presetSelection).length === 1)).toBe(true)
      expect(variants.every((result) => result.foodGroupId !== null)).toBe(true)
      expect(variants.every((result) => result.group.selectionDimensions
        .find((dimension) => dimension.displayName === '部位')
        ?.values.some((value) => value.id === Object.values(result.presetSelection)[0]))).toBe(true)
    }
  })

  it('部位以外の検索と部分一致では展開しない', () => {
    expect(searchUserFoodGroups('豚', { expandPartShortcuts: true })
      .filter((result) => result.group.canonicalName === '豚肉')).toHaveLength(1)
    const broadResults = searchUserFoodGroups('肉', { expandPartShortcuts: true })
    expect(broadResults.filter((result) => ['豚肉', '牛肉', '鶏肉'].includes(result.group.canonicalName)
      && result.targetType === 'user_food_variant')).toHaveLength(0)
    expect(searchUserFoodGroups('豚肉')
      .filter((result) => result.group.canonicalName === '豚肉')).toHaveLength(1)
  })

  it('卵の完全一致では鶏卵・うずら卵・うこっけい卵を独立候補へ展開する', () => {
    for (const query of ['卵', 'たまご']) {
      const results = searchUserFoodGroups(query, { expandPartShortcuts: true })
      const eggResults = results.filter((result) => result.group.canonicalName === '卵')
      expect(eggResults).toHaveLength(3)
      expect(eggResults.every((result) => result.targetType === 'user_food_variant')).toBe(true)
      expect(eggResults.map((result) => result.foodGroupId)).toEqual(expect.arrayContaining(['fg_001094', 'fg_000557', 'fg_000555']))
      expect(eggResults.map((result) => result.presetSelection)).toEqual(expect.arrayContaining([
        { egg_type: 'chicken_egg' },
        { egg_type: 'quail_egg' },
        { egg_type: 'silkie_egg' },
      ]))
      expect(eggResults.some((result) => result.targetType === 'user_food_group')).toBe(false)
    }
    expect(searchUserFoodGroups('たま', { expandPartShortcuts: true })
      .filter((result) => result.group.canonicalName === '卵')).toHaveLength(1)
  })

  it('上位選択後に既存属性を参照し、source_idまで解決する', () => {
    const rice = mextUserFoodGroups.find((group) => group.canonicalName === 'ご飯')
    if (!rice) throw new Error('ご飯グループがありません')
    const foodGroupId = resolveFoodGroupId(rice.id, { rice_type: 'white_rice' })
    const attributes = getFoodGroupAttributes(foodGroupId)
    const variant = getFoodVariants(foodGroupId)[0]
    expect(attributes.length).toBeGreaterThan(0)
    expect(getSourceId(foodGroupId, variant.attributes)).toBe(variant.sourceId)
    expect(getUserFoodGroupForFoodGroup(foodGroupId)?.userFoodGroupId).toBe(rice.id)
  })

  it('standalone食品は上位属性なしで直接解決する', () => {
    const group = mextUserFoodGroups.find((item) => item.groupingLevel === 'standalone')
    if (!group) throw new Error('standaloneグループがありません')
    expect(getUserSelectionDimensions(group.id)).toEqual([])
    expect(resolveFoodGroupId(group.id, {})).toBe(group.memberFoodGroupIds[0])
  })

  it('明示的デフォルトがある場合だけ未選択で解決する', () => {
    const rice = mextUserFoodGroups.find((group) => group.canonicalName === 'ご飯')
    const cheese = mextUserFoodGroups.find((group) => group.canonicalName === 'チーズ')
    if (!rice || !cheese) throw new Error('対象グループがありません')
    expect(resolveFoodGroupId(rice.id, {})).toBe(rice.defaultFoodGroupId)
    expect(cheese.defaultFoodGroupId).toBeNull()
    expect(() => resolveFoodGroupId(cheese.id, {})).toThrow(MissingRequiredUserSelection)
  })

  it('上位分類の値を実在する食品グループから判定する', () => {
    const eggs = mextUserFoodGroups.find((group) => group.canonicalName === '卵')
    if (!eggs) throw new Error('卵グループがありません')
    const available = getAvailableUserSelectionValueIds(eggs.id, {}, 'egg_type')
    expect(available).toEqual(new Set(['chicken_egg', 'quail_egg', 'silkie_egg']))
    expect(reconcileUserFoodSelection(eggs.id, { egg_type: 'chicken_egg' }).selection).toEqual({ egg_type: 'chicken_egg' })
  })

  it('不正な上位属性値・次元・グループを拒否する', () => {
    const rice = mextUserFoodGroups.find((group) => group.canonicalName === 'ご飯')
    if (!rice) throw new Error('ご飯グループがありません')
    expect(() => resolveFoodGroupId(rice.id, { rice_type: 'invalid' })).toThrow(InvalidUserSelectionValue)
    expect(() => resolveFoodGroupId(rice.id, { unknown: 'white_rice' })).toThrow(InvalidUserSelectionValue)
    expect(() => resolveFoodGroupId(`${rice.id}_missing`, {})).toThrow(UserFoodGroupNotFound)
  })

  it('曖昧な広域検索でも同じuser_food_groupを重複させない', () => {
    for (const query of ['パン', '肉', '砂糖', '上白糖', 'チーズ', 'まんじゅう']) {
      const results = searchUserFoodGroups(query)
      expect(new Set(results.map((result) => result.group.id)).size).toBe(results.length)
    }
  })
})
