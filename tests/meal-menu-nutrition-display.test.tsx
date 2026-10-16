// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { MealDetailsModal, MealModal } from '../src/components/MealModals'
import { MealConfirmationView, TodayDetailsModal, TodayView } from '../src/components/TodayView'
import { menuToFood } from '../src/services/menuIngredients'
import { createMenuSetMealBatch } from '../src/services/menuSetMeals'
import { sumByMealType, sumEntries } from '../src/services/nutrition'
import { EMPTY_NUTRIENTS, type Food, type Menu, type Nutrients } from '../src/types'

const known: Food = {
  id: 'known', name: '既知の食材', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
  baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null,
  nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 800, proteinG: 40, saltG: 0 },
  createdAt: '', updatedAt: '',
}
const unknown: Food = { ...known, id: 'unknown', nutrients: { ...EMPTY_NUTRIENTS, proteinG: 20 } }
const menu: Menu = {
  id: 'recipe', name: '登録済みメニュー', category: '主菜', foodIds: [],
  baseAmount: 4, baseUnit: '食', servingAmount: 1.5, servingUnit: '食',
  ingredients: [
    { kind: 'food', itemId: known.id, amount: 100, unit: 'g' },
    { kind: 'food', itemId: unknown.id, amount: 100, unit: 'g' },
  ],
  createdAt: '', updatedAt: '',
}
const goals: Nutrients = { ...EMPTY_NUTRIENTS, energyKcal: 300, proteinG: 22.5 }
const noop = () => undefined

function savedMeal(foods = [known, unknown]) {
  return createMenuSetMealBatch({
    menuSet: { id: 'set', name: 'セット', menuIds: [menu.id], createdAt: '', updatedAt: '' },
    menus: [menu], foods, mealType: '朝食', eatenAt: '2026-10-15T00:00:00.000Z', createId: () => 'meal',
  }).entries[0]
}

function render(element: ReactNode) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(element)
  return container
}

function nutrientRow(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('.nutrient-graph-row')].find((row) => (
    row.querySelector('.nutrient-graph-label')?.textContent === label
  ))
}

describe('登録済みメニューの栄養価表示', () => {
  it('今日の食事カード・食事区分・概要に、登録分量の既知カロリーを表示する', () => {
    const entry = savedMeal()
    const original = JSON.stringify(entry)
    const container = render(<TodayView
      selectedDate="2026-10-15" setSelectedDate={noop} entries={[entry]} total={sumEntries([entry])}
      subtotals={sumByMealType([entry])} goals={goals} existingFoodIds={new Set()}
      onOpenMealConfirmation={noop} onShowMealDetails={noop} onShowTodayDetails={noop}
    />)

    expect(container.querySelector('.meal-entry-actions')?.textContent).toBe('300.0 kcal')
    expect(container.querySelector('.meal-heading-actions > span')?.textContent).toBe('300.0 kcal')
    expect(container.querySelector('.goal-progress-heading strong')?.textContent).toContain('300.0')
    expect(container.querySelector('.goal-intake-bar')).not.toBeNull()
    expect(container.querySelector('.goal-progress-status-ok')).not.toBeNull()
    expect(entry.calculatedNutrients.energyKcal).toBeNull()
    expect(JSON.stringify(entry)).toBe(original)
  })

  it('確認画面・食事詳細・TODAY詳細で同じ既知小計を表示し、範囲内の小計を適正扱いする', () => {
    const entry = savedMeal()
    const subtotal = sumEntries([entry])
    const confirmation = render(<MealConfirmationView
      type="朝食" entries={[entry]} subtotal={subtotal} onAdd={noop} onEdit={noop} onDelete={noop}
      onReorder={async () => undefined} onDone={noop}
    />)
    expect(confirmation.querySelector('.meal-confirmation-summary strong')?.textContent).toBe('1件 · 300.0 kcal')
    expect(confirmation.querySelector('.meal-confirmation-entry > b')?.textContent).toBe('300.0 kcal')

    const details = render(<MealDetailsModal details={{ type: '朝食', entries: [entry], subtotal }}
      goals={goals} onUpdateTimes={noop} onClose={noop} />)
    expect(details.querySelector('.detail-total strong')?.textContent).toBe('300.0 kcal')
    expect(details.querySelector('.detail-entry strong')?.textContent).toBe('300.0 kcal')
    const todayDetails = render(<TodayDetailsModal selectedDate="2026-10-15" entries={[entry]}
      goals={goals} goalRecords={[]} onClose={noop} />)
    for (const container of [details, todayDetails]) {
      expect(nutrientRow(container, 'エネルギー')?.querySelector('.nutrient-graph-value')?.textContent).toBe('300.0kcal')
      expect(nutrientRow(container, 'エネルギー')?.querySelector('.nutrient-graph-status-ok')).not.toBeNull()
      expect(nutrientRow(container, 'たんぱく質')?.querySelector('.nutrient-graph-value')?.textContent).toBe('22.5g')
      expect(nutrientRow(container, '脂質')?.querySelector('.nutrient-graph-value')?.textContent).toBe('--.-g')
      expect(nutrientRow(container, '脂質')?.querySelector('.nutrient-graph-intake')).toBeNull()
    }
  })

  it('食事登録・編集のカロリープレビューも保存済み構成の既知分を使う', () => {
    const entry = savedMeal()
    const food = menuToFood(menu, [menu], [known, unknown])
    const container = render(<MealModal food={food} amount="1.5" setAmount={noop}
      amountUnit="食" setAmountUnit={noop} menuSnapshot={entry.menuSnapshot ?? null} setMenuSnapshot={noop}
      menus={[]} foods={[]} foodGroups={[]} recentFoods={[]} favoriteFoods={[]} favoriteIds={new Set()}
      onToggleFavorite={noop} editing={false} onSubmit={noop} onClose={noop} />)
    expect(container.querySelector('.calorie-preview strong')?.textContent).toBe('300.0 kcal')
    expect(food.nutrients.energyKcal).toBeNull()
  })

  it.each([
    ['全寄与不明', null, '--.-'],
    ['既知の0', 0, '0.0'],
  ] as const)('%sを区別して表示する', (_name, energyKcal, expected) => {
    const entry = savedMeal([
      { ...known, nutrients: { ...EMPTY_NUTRIENTS, energyKcal } },
      { ...unknown, nutrients: { ...EMPTY_NUTRIENTS } },
    ])
    const container = render(<MealDetailsModal
      details={{ type: '朝食', entries: [entry], subtotal: sumEntries([entry]) }}
      goals={goals} onUpdateTimes={noop} onClose={noop} />)
    expect(container.querySelector('.detail-total strong')?.textContent).toBe(`${expected} kcal`)
    expect(container.querySelector('.detail-entry strong')?.textContent).toBe(`${expected} kcal`)
    const intake = nutrientRow(container, 'エネルギー')?.querySelector('.nutrient-graph-intake')
    if (energyKcal === null) expect(intake).toBeNull()
    else expect(intake).not.toBeNull()
  })
})
