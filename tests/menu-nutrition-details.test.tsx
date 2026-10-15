import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MenuNutritionDetailsModal, MenuView } from '../src/components/MenuView'
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

const renderDetails = (menu: Menu, menus: Menu[], foods: Food[], goals = { ...EMPTY_NUTRIENTS, energyKcal: 2000 }) => renderToStaticMarkup(
  <MenuNutritionDetailsModal menu={menu} menus={menus} foods={foods} goals={goals} onClose={() => undefined} />,
)

const getNutrientRow = (html: string, label: string) => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = html.match(new RegExp(`<div class="nutrient-graph-row"><span class="nutrient-graph-label">${escapedLabel}</span>[^]*?<span class="nutrient-graph-value[^>]*>(.*?)</span></div>`))
  return row?.[0] ?? ''
}

const expectNutrientValue = (html: string, label: string, value: string) => {
  expect(getNutrientRow(html, label)).toContain(value)
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

    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'エネルギー', '200.0')
    expectNutrientValue(html, '食塩相当量', '--.-')
  })

  it('栄養素ごとに既知分を独立して小計し、欠損行を適正扱いしない', () => {
    const energyFood = makeFood('energy', { ...EMPTY_NUTRIENTS, energyKcal: 100 })
    const proteinFood = makeFood('protein', { ...EMPTY_NUTRIENTS, proteinG: 20 })
    const menu = makeMenu('independent subtotals', [
      { kind: 'food', itemId: energyFood.id, amount: 100, unit: 'g' },
      { kind: 'food', itemId: proteinFood.id, amount: 100, unit: 'g' },
    ], { baseAmount: 2, baseUnit: '食' })
    const html = renderDetails(menu, [menu], [energyFood, proteinFood])

    expectNutrientValue(html, 'エネルギー', '50.0')
    expectNutrientValue(html, 'たんぱく質', '10.0')
    expect(getNutrientRow(html, 'エネルギー')).toContain('nutrient-graph-status-unknown')
    expect(getNutrientRow(html, '食塩相当量')).toContain('--.-')
  })

  it('全寄与が欠損なら未集計のまま、棒を表示しない', () => {
    const food = makeFood('all missing', { ...EMPTY_NUTRIENTS })
    const menu = makeMenu('all missing menu', [{ kind: 'food', itemId: food.id, amount: 100, unit: 'g' }])
    const html = renderDetails(menu, [menu], [food])
    const energyRow = getNutrientRow(html, 'エネルギー')

    expect(html).toContain('>--.-<small> kcal</small>')
    expect(energyRow).toContain('--.-')
    expect(energyRow).not.toContain('nutrient-graph-intake')
  })

  it('明示された0を既知の0として表示する', () => {
    const food = makeFood('zero', { ...EMPTY_NUTRIENTS, energyKcal: 0 })
    const menu = makeMenu('zero menu', [{ kind: 'food', itemId: food.id, amount: 100, unit: 'g' }])
    const html = renderDetails(menu, [menu], [food])
    const energyRow = getNutrientRow(html, 'エネルギー')

    expect(html).toContain('>0.0<small> kcal</small>')
    expect(energyRow).toContain('0.0')
    expect(energyRow).toContain('nutrient-graph-intake')
  })

  it('ネストしたメニューの分量と親の基準量をそれぞれ一度だけ換算する', () => {
    const food = makeFood('nested food')
    const nested = makeMenu('nested', [
      { kind: 'food', itemId: food.id, amount: 400, unit: 'g' },
      { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
    ], { baseAmount: 2, baseUnit: '食' })
    const parent = makeMenu('parent', [{ kind: 'menu', itemId: nested.id, amount: 2, unit: '食' }], { baseAmount: 4, baseUnit: '食' })
    const html = renderDetails(parent, [parent, nested], [food])

    expect(html).toContain('>200.0<small> kcal</small>')
    expectNutrientValue(html, 'たんぱく質', '20.0')
    expect(getNutrientRow(html, 'エネルギー')).toContain('nutrient-graph-status-unknown')
  })

  it('完全集計できた栄養素の適正色は維持する', () => {
    const food = makeFood('complete')
    const menu = makeMenu('complete menu', [{ kind: 'food', itemId: food.id, amount: 100, unit: 'g' }])
    const html = renderDetails(menu, [menu], [food], { ...EMPTY_NUTRIENTS, energyKcal: 200 })

    expect(getNutrientRow(html, 'エネルギー')).toContain('nutrient-graph-status-ok')
  })

  it('Myメニューカードはレシピ全体の既知カロリーを表示する', () => {
    const food = makeFood('card food')
    const menu = makeMenu('card menu', [
      { kind: 'food', itemId: food.id, amount: 100, unit: 'g' },
      { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
    ], { baseAmount: 2, baseUnit: '食' })
    const html = renderToStaticMarkup(<MenuView
      menus={[menu]}
      generalMenus={[]}
      menuSets={[]}
      foods={[food]}
      onNewMenu={() => undefined}
      onShowMenuNutrition={() => undefined}
      onEditMenu={() => undefined}
      onDeleteMenu={() => undefined}
      onNewGeneralMenu={() => undefined}
      onEditGeneralMenu={() => undefined}
      onDeleteGeneralMenu={() => undefined}
      onCloneGeneralMenu={() => undefined}
      onNewMenuSet={() => undefined}
      onEditMenuSet={() => undefined}
      onDeleteMenuSet={() => undefined}
      onReorderMenuSets={async () => undefined}
      onBack={() => undefined}
    />)

    expect(html).toContain('<strong>card menu</strong><small>200.0kcal</small>')
  })
})
