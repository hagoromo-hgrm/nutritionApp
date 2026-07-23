import { describe, expect, it } from 'vitest'
import { getFoodSnapshotDisplayName, getMealEntryDisplayName } from '../src/services/mealEntryDisplay'
import type { MealEntry } from '../src/types'

describe('meal entry display name', () => {
  it('displayNameを一般名として優先する', () => {
    const entry = { foodSnapshot: { name: '正式名称', displayName: '検索用の一般名' } } as MealEntry
    expect(getMealEntryDisplayName(entry)).toBe('検索用の一般名')
  })

  it('displayNameが空欄または未設定ならnameへ戻る', () => {
    expect(getFoodSnapshotDisplayName({ name: '正式名称', displayName: '  ' })).toBe('正式名称')
    expect(getFoodSnapshotDisplayName({ name: '正式名称' })).toBe('正式名称')
  })

  it('旧記録でも現在の食品マスターに一般名があれば表示へ使用する', () => {
    const legacyEntry = { foodSnapshot: { name: '旧記録の正式名称' } } as MealEntry
    expect(getMealEntryDisplayName(legacyEntry, { name: '食品マスター名', displayName: '検索用の一般名' })).toBe('検索用の一般名')
    expect(getMealEntryDisplayName(legacyEntry)).toBe('旧記録の正式名称')
  })
})
