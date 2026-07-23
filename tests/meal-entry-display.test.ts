import { describe, expect, it } from 'vitest'
import { getFoodSnapshotDisplayName, getMealEntryDisplayName, getMextUserFacingFoodName } from '../src/services/mealEntryDisplay'
import type { MealEntry } from '../src/types'

describe('meal entry display name', () => {
  it('displayNameを一般名として優先する', () => {
    const entry = { foodSnapshot: { name: '正式名称', displayName: '検索用の一般名' } } as MealEntry
    expect(getMealEntryDisplayName(entry)).toBe('検索用の一般名')
  })

  it('保存済みの検索結果名を最優先する', () => {
    const entry = {
      foodId: 'mext_01085',
      foodSnapshot: { name: '水稲玄米ごはん', displayName: '水稲玄米ごはん', userFacingName: '玄米ごはん' },
    } as MealEntry
    expect(getMealEntryDisplayName(entry)).toBe('玄米ごはん')
    expect(getFoodSnapshotDisplayName(entry.foodSnapshot)).toBe('玄米ごはん')
  })

  it('displayNameが空欄または未設定ならnameへ戻る', () => {
    expect(getFoodSnapshotDisplayName({ name: '正式名称', displayName: '  ' })).toBe('正式名称')
    expect(getFoodSnapshotDisplayName({ name: '正式名称' })).toBe('正式名称')
  })

  it('旧記録のご飯と砂糖を上位の一般名へ補正する', () => {
    const rice = { foodId: 'mext_01088', foodSnapshot: { name: '水稲精白米ごはん' } } as MealEntry
    const sugar = { foodId: 'mext_03003', foodSnapshot: { name: '車糖　上白糖' } } as MealEntry
    expect(getMealEntryDisplayName(rice)).toBe('ご飯')
    expect(getMealEntryDisplayName(sugar)).toBe('砂糖')
    expect(getMextUserFacingFoodName(rice.foodId)).toBe('ご飯')
  })

  it('部位と卵種は検索結果どおり独立した名称を保つ', () => {
    const beef = { foodId: 'mext_11008', foodSnapshot: { name: '輸入牛肉かたロース脂身つき生' } } as MealEntry
    const chickenEgg = { foodId: 'mext_12004', foodSnapshot: { name: '鶏卵全卵生' } } as MealEntry
    expect(getMealEntryDisplayName(beef)).toBe('牛かたロース肉')
    expect(getMealEntryDisplayName(chickenEgg)).toBe('鶏卵')
  })
})
