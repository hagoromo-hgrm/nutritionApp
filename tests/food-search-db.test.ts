import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../src/db/db'
import { searchStoredFoodPage } from '../src/db/foodSearch'
import { searchFoodResults, type FoodSearchData, type FoodSearchResult } from '../src/services/foodSearch'
import { type FoodSearchCategory } from '../src/services/foodClassification'
import { EMPTY_NUTRIENTS, type Food, type FoodGroup } from '../src/types'

const now = new Date('2026-09-11T00:00:00.000Z')
const food = (id: string, foodGroupId?: string): Food => ({ id, name: `正式名 ${id}`, displayName: `食品 ${id}`, maker: '', barcode: '', source: 'user', sourceVersion: 'test', foodGroupId, baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null, nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 100 }, createdAt: now.toISOString(), updatedAt: now.toISOString() })
const group = (id: string, displayName: string, defaultVariantId: string | null): FoodGroup => ({ id, displayName, reading: 'よみがな', category: null, representativeScore: 0, defaultVariantId, isActive: true, metadataSource: 'manual', generationVersion: 'test', needsReview: false, createdAt: now.toISOString(), updatedAt: now.toISOString() })

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => vi.restoreAllMocks())

async function seed(data: FoodSearchData): Promise<void> {
  await Promise.all([
    db.foods.bulkPut(data.foods), db.foodGroups.bulkPut(data.groups), db.foodAliases.bulkPut(data.aliases),
    db.foodRelatedTerms.bulkPut(data.relatedTerms), db.foodUsageStats.bulkPut(data.usageStats),
    db.favorites.bulkPut([...data.favoriteIds ?? []].map((foodId) => ({ foodId, createdAt: now.toISOString() }))),
  ])
}

function expectedResults(query: string, data: FoodSearchData, category: FoodSearchCategory): FoodSearchResult[] {
  const results: FoodSearchResult[] = []
  let cursor: string | null = null
  do {
    const page = searchFoodResults(query, data, { now, category, limit: 100, cursor })
    results.push(...page.results)
    cursor = page.nextCursor
  } while (cursor)
  return results
}

async function allPages(query: string, category: FoodSearchCategory, limit = 7): Promise<FoodSearchResult[]> {
  const results: FoodSearchResult[] = []
  let cursor: string | null = null
  do {
    const page = await searchStoredFoodPage(db, query, { now, category, limit, cursor })
    results.push(...page.results)
    cursor = page.nextCursor
    if (results.length > 2000) throw new Error('ページが終了しません')
  } while (cursor)
  return results
}

describe('bounded IndexedDB food search', () => {
  it('別名・関連語・中間一致・分類・既定variant・個人順位を純粋検索と同じ順にページングする', async () => {
    const data: FoodSearchData = { foods: [], groups: [], aliases: [], relatedTerms: [], usageStats: [], favoriteIds: new Set(['f3b', 'f5a']) }
    for (let index = 0; index < 31; index += 1) {
      const id = `g${index}`
      const first = { ...food(`f${index}a`, id), officialName: index % 4 === 0 ? '中間ことば末尾' : '一般の正式名' }
      const second = { ...food(`f${index}b`, id), maker: index % 5 === 0 ? '中間メーカー末尾' : '', isCommercial: true }
      data.foods.push(first, second)
      data.groups.push({ ...group(id, index % 3 === 0 ? '前ことば後' : `食品${index % 4}`, first.id), representativeScore: index % 4, isActive: index !== 30 })
      data.aliases.push({ id: `a${index}`, foodGroupId: id, foodVariantId: null, alias: index % 2 === 0 ? '前エイリアス後' : 'ことば', normalizedAlias: '保存済み正規化値に依存しない', aliasType: 'synonym', priority: 5, isActive: index !== 6, metadataSource: 'manual' })
      data.relatedTerms.push({ id: `r${index}`, foodGroupId: id, term: '前関連語後', normalizedTerm: '関連語', weight: (index % 3) / 2, isActive: index !== 8, metadataSource: 'manual' })
      data.usageStats.push({ foodId: second.id, selectionCount: index, lastSelectedAt: new Date(now.getTime() - index * 86_400_000).toISOString(), updatedAt: now.toISOString() })
    }
    data.foods.push(food('fallback'), food('missing', 'missing-group'))
    await seed(data)
    for (const category of ['all', 'general', 'commercial', 'menu'] as const) {
      for (const query of ['', 'ことば', 'エイリアス', 'メーカー', 'よみがな', '関連語', '一致しない']) {
        expect(await allPages(query, category)).toEqual(expectedResults(query, data, category))
      }
    }
  }, 30000)

  it('1000件より後の候補・大きいfamilyを切り捨てず、テーブル全体を配列にしない', async () => {
    const target = group('family', '目当てのfamily', 'v1034')
    const foods = Array.from({ length: 1035 }, (_, index) => ({ ...food(`v${String(index).padStart(4, '0')}`, target.id), officialName: index === 1034 ? '終端だけにある文字列' : '他の正式名' }))
    target.defaultVariantId = 'v1034'
    const data: FoodSearchData = { foods, groups: [target], aliases: [], relatedTerms: [], usageStats: [] }
    await seed(data)
    for (const table of [db.foods, db.foodGroups, db.foodAliases, db.foodRelatedTerms, db.foodUsageStats, db.favorites]) {
      vi.spyOn(table, 'toArray').mockRejectedValue(new Error('全件配列化は禁止'))
    }
    const page = await searchStoredFoodPage(db, '終端だけ', { now })
    expect(page.results).toEqual(expectedResults('終端だけ', data, 'all'))
    expect(page.results[0].variants).toHaveLength(1035)
    expect(page.nextCursor).toBeNull()
  })

  it('同点の候補を飛ばさず、ページ境界の時刻を維持して次ページを返す', async () => {
    const foods = Array.from({ length: 137 }, (_, index) => food(`f${String(index).padStart(3, '0')}`, `g${index}`))
    const data: FoodSearchData = { foods, groups: foods.map((item) => group(item.foodGroupId!, '同じ表示名', item.id)), aliases: [], relatedTerms: [], usageStats: [] }
    await seed(data)
    const first = await searchStoredFoodPage(db, '', { now, limit: 20 })
    const second = await searchStoredFoodPage(db, '', { now: new Date('2026-12-01'), limit: 20, cursor: first.nextCursor })
    const expected = expectedResults('', data, 'all')
    expect([...first.results, ...second.results]).toEqual(expected.slice(0, 40))
    expect(await allPages('', 'all', 30)).toEqual(expected)
    expect((await searchStoredFoodPage(db, '', { now, limit: 20, cursor: '120' })).results).toEqual(expected.slice(120))
  }, 30000)

  it('無所属のfallbackが永続groupに衝突した場合も従来結果を保つ', async () => {
    const orphan = food('orphan')
    const linked = food('linked', 'food:orphan')
    const empty1 = food('empty1', '')
    const empty2 = food('empty2', '')
    const data: FoodSearchData = { foods: [empty1, empty2, linked, orphan], groups: [group('food:orphan', '上書きされる名前', linked.id)], aliases: [], relatedTerms: [], usageStats: [] }
    await seed(data)
    expect(await allPages('', 'all')).toEqual(expectedResults('', data, 'all'))
  })
})
