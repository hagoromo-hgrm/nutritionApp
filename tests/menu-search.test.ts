import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, searchGeneralMenus, searchMenus, searchMenuSets } from '../src/db/db'
import { EMPTY_NUTRIENTS, type Food, type FoodAlias, type Menu, type MenuSet } from '../src/types'

const timestamp = '2026-07-15T00:00:00.000Z'
const food: Food = {
  id: 'ingredient', name: '元の名称', displayName: '表示名称', officialName: '正式名称',
  maker: '試験メーカー', reading: 'よみがな', foodGroupId: 'ingredient-group',
  barcode: '', source: 'user', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g',
  servingAmount: null, servingUnit: null, nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 100 },
  createdAt: timestamp, updatedAt: timestamp,
}

function menu(id: string, name: string, overrides: Partial<Menu> = {}): Menu {
  return { id, name, category: '主菜', foodIds: [], createdAt: timestamp, updatedAt: timestamp, ...overrides }
}

function menuSet(id: string, sortOrder: number, overrides: Partial<MenuSet> = {}): MenuSet {
  return { id, name: id, menuIds: [], sortOrder, createdAt: timestamp, updatedAt: timestamp, ...overrides }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('menu search across catalogs', () => {
  it('食品名・メーカー・読み・別名を入れ子のメニューから検索し、カタログの順序を保つ', async () => {
    await db.foods.put(food)
    const alias: FoodAlias = {
      id: 'alias', foodGroupId: food.foodGroupId!, foodVariantId: null, alias: 'ＡＢＣ別称',
      normalizedAlias: 'abc別称', aliasType: 'synonym', priority: 50, isActive: false, metadataSource: 'manual',
    }
    await db.foodAliases.put(alias)
    const child = menu('child', 'B child', { foodIds: [food.id] })
    const parent = menu('parent', 'A parent', {
      ingredients: [{ kind: 'menu', itemId: child.id, amount: 1, unit: '食' }],
    })
    const general = menu('general', 'General', {
      ingredients: [{ kind: 'menu', itemId: parent.id, amount: 1, unit: '食' }],
    })
    await db.menus.bulkPut([child, parent])
    await db.generalMenus.put(general)
    await db.menuSets.bulkPut([
      menuSet('a-direct', 3, { foodIds: [food.id] }),
      menuSet('b-portion', 2, { foodItems: [{ foodId: food.id, amount: 50, unit: 'g' }] }),
      menuSet('c-menu', 1, { menuIds: [parent.id] }),
      menuSet('d-general', 0, { generalMenuIds: [general.id] }),
    ])

    for (const query of ['表示名称', '正式名称', '試験メーカー', 'よみがな', ' abc別称 ']) {
      expect((await searchMenus(query)).map((item) => item.id)).toEqual(['parent', 'child'])
      expect((await searchGeneralMenus(query)).map((item) => item.id)).toEqual(['general'])
      expect((await searchMenuSets(query)).map((item) => item.id)).toEqual(['d-general', 'c-menu', 'b-portion', 'a-direct'])
    }
    expect(await searchMenus('元の名称')).toEqual([])
    expect(await searchGeneralMenus('元の名称')).toEqual([])
    expect(await searchMenuSets('元の名称')).toEqual([])
  })

  it('旧foodIdsより明示された構成を優先し、欠落した食品を一致扱いにしない', async () => {
    await db.foods.put({ ...food, displayName: undefined, officialName: undefined })
    const legacy = menu('legacy', 'B legacy', { foodIds: [food.id] })
    const empty = menu('empty', 'A empty', { foodIds: [food.id], ingredients: [] })
    const missing = menu('missing', 'C missing', { foodIds: ['deleted-food'] })
    await db.menus.bulkPut([legacy, empty, missing])
    await db.generalMenus.bulkPut([legacy, empty, missing])
    await db.menuSets.put(menuSet('missing-set', 0, { foodIds: ['deleted-food'] }))

    expect((await searchMenus('元の名称')).map((item) => item.id)).toEqual(['legacy'])
    expect((await searchGeneralMenus('元の名称')).map((item) => item.id)).toEqual(['legacy'])
    expect(await searchMenuSets('deleted-food')).toEqual([])
    expect((await searchMenus('　')).map((item) => item.id)).toEqual(['empty', 'legacy', 'missing'])
    expect((await searchGeneralMenus('　')).map((item) => item.id)).toEqual(['empty', 'legacy', 'missing'])
    expect((await searchMenuSets('　')).map((item) => item.id)).toEqual(['missing-set'])
  })

  it('循環したMyメニューの検索を終了し、別ストアの同一IDの探索範囲を保つ', async () => {
    await db.foods.put(food)
    const shared = menu('shared', 'Shared', {
      ingredients: [
        { kind: 'menu', itemId: 'shared', amount: 1, unit: '食' },
        { kind: 'food', itemId: food.id, amount: 100, unit: 'g' },
      ],
    })
    await db.menus.put(shared)
    await db.generalMenus.put(menu('shared', 'General', {
      ingredients: [{ kind: 'menu', itemId: shared.id, amount: 1, unit: '食' }],
    }))
    await db.menuSets.bulkPut([
      menuSet('my-set', 1, { menuIds: ['shared'] }),
      menuSet('general-set', 0, { generalMenuIds: ['shared'] }),
    ])

    expect((await searchMenus('表示名称')).map((item) => item.id)).toEqual(['shared'])
    expect((await searchGeneralMenus('表示名称')).map((item) => item.id)).toEqual(['shared'])
    expect((await searchMenuSets('表示名称')).map((item) => item.id)).toEqual(['my-set'])
    expect(await searchMenus('一致なし')).toEqual([])
    expect(await searchGeneralMenus('一致なし')).toEqual([])
    expect(await searchMenuSets('一致なし')).toEqual([])
  })
})
