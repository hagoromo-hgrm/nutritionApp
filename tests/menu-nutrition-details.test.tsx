import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MenuNutritionDetailsModal } from '../src/components/MenuView'
import { EMPTY_NUTRIENTS, type Food, type Menu, type Nutrients } from '../src/types'

const makeNutrients = (overrides: Partial<Nutrients> = {}): Nutrients => ({
  ...EMPTY_NUTRIENTS,
  energyKcal: 200,
  proteinG: 20,
  fatG: 8,
  carbohydrateG: 36,
  fiberG: 4,
  saltG: 2,
  ...overrides,
})

const makeFood = (id: string, nutrients = makeNutrients()): Food => ({
  id,
  name: id,
  maker: '',
  barcode: '',
  source: 'user',
  sourceVersion: 'test',
  baseAmount: 100,
  baseUnit: 'g',
  servingAmount: null,
  servingUnit: null,
  nutrients,
  createdAt: '',
  updatedAt: '',
})

const makeMenu = (id: string, ingredients: Menu['ingredients'] = [], overrides: Partial<Menu> = {}): Menu => ({
  id,
  name: id,
  category: '主菜',
  foodIds: [],
  ingredients,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const renderDetails = (menu: Menu, menus: Menu[], foods: Food[]) => renderToStaticMarkup(
  <MenuNutritionDetailsModal menu={menu} menus={menus} foods={foods} goals={{ ...EMPTY_NUTRIENTS, energyKcal: 2000 }} onClose={() => undefined} />,
)

const expectNutrientValue = (html: string, label: string, value: string) => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = html.match(new RegExp(`<div class="nutrient-graph-row"><span class="nutrient-graph-label">${escapedLabel}</span>[^]*?<span class="nutrient-graph-value[^>]*>(.*?)</span></div>`))
  expect(row?.[1]).toContain(value)
}

describe('Myメニュー栄養価詳細', () => {
  it('複数食分のメニューを常に1食分へ換算し、カロリーとPFCを表示する', () => {
    const food = makeFood('rice')
    const menu = makeMenu('four servings', [{ kind: 'food', itemId: food.id, amount: 400, unit: 'g' }], {
      baseAmount: 4,
      baseUnit: '食',
      servingAmount: 2,
      servingUnit: '食',
    })
    const html = renderDetails(menu, [menu], [food])

    expect(html).toContain('1食あたり')
    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'エネルギー', '200.0')
    expectNutrientValue(html, 'たんぱく質', '20.0')
    expectNutrientValue(html, '脂質', '8.0')
    expectNutrientValue(html, '炭水化物', '36.0')
  })

  it('従来形式で基準量がない1食メニューは従来の栄養値を保つ', () => {
    const food = makeFood('legacy food')
    const legacyMenu = makeMenu('legacy', undefined, { foodIds: [food.id], ingredients: undefined })
    const html = renderDetails(legacyMenu, [legacyMenu], [food])

    expect(html).toContain('1食あたり')
    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'たんぱく質', '20.0')
  })

  it('2個分のメニューは1個分で示し、食事へ追加する既定分量を使わない', () => {
    const food = makeFood('croquette')
    const menu = makeMenu('croquettes', [{ kind: 'food', itemId: food.id, amount: 200, unit: 'g' }], {
      baseAmount: 2,
      baseUnit: '個',
      servingAmount: 2,
      servingUnit: '個',
    })
    const html = renderDetails(menu, [menu], [food])

    expect(html).toContain('1個あたり')
    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'たんぱく質', '20.0')
  })

  it('欠損栄養値を未集計のまま表示する', () => {
    const food = makeFood('incomplete', makeNutrients({ saltG: null }))
    const menu = makeMenu('incomplete menu', [{ kind: 'food', itemId: food.id, amount: 400, unit: 'g' }], { baseAmount: 4, baseUnit: '食' })
    const html = renderDetails(menu, [menu], [food])

    expectNutrientValue(html, '食塩相当量', '--.-')
  })

  it('ネストしたメニューの分量と親の基準量をそれぞれ一度だけ換算する', () => {
    const food = makeFood('nested food')
    const nested = makeMenu('nested', [{ kind: 'food', itemId: food.id, amount: 400, unit: 'g' }], { baseAmount: 2, baseUnit: '食' })
    const parent = makeMenu('parent', [{ kind: 'menu', itemId: nested.id, amount: 2, unit: '食' }], { baseAmount: 4, baseUnit: '食' })
    const html = renderDetails(parent, [parent, nested], [food])

    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'たんぱく質', '20.0')
  })
})
