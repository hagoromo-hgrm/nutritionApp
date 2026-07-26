import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import {
  getUnresolvedIngredientStats,
  recordUnresolvedIngredients,
  unresolvedIngredientsToCsv,
  unresolvedIngredientsToJson,
} from '../src/services/unresolvedIngredients'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('unresolved ingredient statistics', () => {
  it('商品やバーコードへ紐付けずジャンル別に重複排除して集計する', async () => {
    await recordUnresolvedIngredients(
      [' 未対応 原材料 ', '未対応 原材料', '別の原料'],
      'baked_sweets',
      '2026-07-26T00:00:00.000Z',
    )
    await recordUnresolvedIngredients(
      ['未対応 原材料'],
      'baked_sweets',
      '2026-07-27T00:00:00.000Z',
    )

    const items = await getUnresolvedIngredientStats()
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.normalizedName === '未対応 原材料')).toMatchObject({
      estimatorGenreId: 'baked_sweets',
      count: 2,
      firstSeenAt: '2026-07-26T00:00:00.000Z',
      lastSeenAt: '2026-07-27T00:00:00.000Z',
    })
    expect(JSON.stringify(items)).not.toContain('barcode')
    expect(JSON.stringify(items)).not.toContain('productName')
  })

  it('手動共有用JSONとBOM付きCSVを別形式で出力する', async () => {
    await recordUnresolvedIngredients(['原料, A'], 'other_unknown', '2026-07-26T00:00:00.000Z')
    const json = JSON.parse(await unresolvedIngredientsToJson()) as { format: string; items: unknown[] }
    const csv = await unresolvedIngredientsToCsv()

    expect(json.format).toBe('nutrition-pwa-unresolved-ingredients')
    expect(json.items).toHaveLength(1)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"原料, a"')
  })
})
