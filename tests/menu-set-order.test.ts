import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, getAllMenuSets, reorderMenuSets, saveMenuSet, searchMenuSets } from '../src/db/db'
import type { MenuSet } from '../src/types'

const timestamp = '2026-07-29T00:00:00.000Z'

function menuSet(id: string, name: string, sortOrder?: number): MenuSet {
  return {
    id,
    name,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    menuIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Myセットの表示順', () => {
  it('sortOrderを優先し、未設定データは既存の名前順で安定して返す', async () => {
    await saveMenuSet(menuSet('legacy', '旧セット'))
    await saveMenuSet(menuSet('second', '昼セット', 1))
    await saveMenuSet(menuSet('first', '朝セット', 0))

    expect((await getAllMenuSets()).map((item) => item.id)).toEqual(['first', 'second', 'legacy'])
    expect((await searchMenuSets('セット')).map((item) => item.id)).toEqual(['first', 'second', 'legacy'])
  })

  it('同じsortOrderは名前順で安定して返す', async () => {
    await saveMenuSet(menuSet('z', 'Zセット', 0))
    await saveMenuSet(menuSet('a', 'Aセット', 0))
    await saveMenuSet(menuSet('legacy-z', '旧Zセット'))
    await saveMenuSet(menuSet('legacy-a', '旧Aセット'))

    expect((await getAllMenuSets()).map((item) => item.id)).toEqual(['a', 'z', 'legacy-a', 'legacy-z'])
  })

  it('全件を指定ID順へトランザクションで0始まりに更新する', async () => {
    await saveMenuSet(menuSet('a', '朝セット'))
    await saveMenuSet(menuSet('b', '昼セット'))
    await saveMenuSet(menuSet('c', '夜セット'))

    await reorderMenuSets(['c', 'a', 'b'])

    expect((await getAllMenuSets()).map((item) => [item.id, item.sortOrder])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ])
  })

  it.each([
    ['不明ID', ['a', 'unknown', 'b']],
    ['重複ID', ['a', 'a', 'b']],
    ['対象不足', ['a']],
  ])('%sの場合は部分更新しない', async (_reason, orderedIds) => {
    await saveMenuSet(menuSet('a', '朝セット', 4))
    await saveMenuSet(menuSet('b', '昼セット', 5))
    const before = await db.menuSets.toArray()

    await expect(reorderMenuSets(orderedIds)).rejects.toThrow()

    expect(await db.menuSets.toArray()).toEqual(before)
  })
})
