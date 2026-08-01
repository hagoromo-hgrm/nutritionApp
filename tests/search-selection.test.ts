import { describe, expect, it } from 'vitest'
import { consumeSearchSelectionGroup } from '../src/services/searchSelection'

describe('multi search selection', () => {
  const groups = [
    { query: 'ご飯', marker: 1 },
    { query: 'みそ汁', marker: 2 },
  ]

  it('選択した検索結果だけを完了扱いにして残りを返す', () => {
    expect(consumeSearchSelectionGroup(groups, 'ご飯')).toEqual({
      matched: true,
      remainingGroups: [{ query: 'みそ汁', marker: 2 }],
    })
  })

  it('同じ検索語が複数あっても一度に1グループだけ完了させる', () => {
    const duplicated = [
      { query: '卵', marker: 1 },
      { query: '卵', marker: 2 },
    ]
    expect(consumeSearchSelectionGroup(duplicated, '卵')).toEqual({
      matched: true,
      remainingGroups: [{ query: '卵', marker: 2 }],
    })
  })

  it('検索結果にない選択は完了扱いにしない', () => {
    expect(consumeSearchSelectionGroup(groups, '納豆')).toEqual({
      matched: false,
      remainingGroups: groups,
    })
    expect(consumeSearchSelectionGroup(groups, null)).toEqual({
      matched: false,
      remainingGroups: groups,
    })
  })
})
