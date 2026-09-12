// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FoodFormView } from '../src/components/FoodFormView'
import type { SettingsView } from '../src/components/SettingsView'
import type { FoodsView } from '../src/components/FoodsView'
import type { SearchInputView, SearchResultsView } from '../src/components/SearchViews'
import { db } from '../src/db/db'
import { DEFAULT_SETTINGS } from '../src/types'
import App from '../src/App'

const screens = vi.hoisted(() => ({ form: null as ComponentProps<typeof FoodFormView> | null, settings: null as ComponentProps<typeof SettingsView> | null, foods: null as ComponentProps<typeof FoodsView> | null, input: null as ComponentProps<typeof SearchInputView> | null, results: null as ComponentProps<typeof SearchResultsView> | null }))
vi.mock('../src/components/FoodFormView', () => ({ FoodFormView: (props: ComponentProps<typeof FoodFormView>) => { screens.form = props; return null } }))
vi.mock('../src/components/SettingsView', () => ({ SettingsView: (props: ComponentProps<typeof SettingsView>) => { screens.settings = props; return null } }))
vi.mock('../src/components/FoodsView', () => ({ FoodsView: (props: ComponentProps<typeof FoodsView>) => { screens.foods = props; return null } }))
vi.mock('../src/components/SearchViews', () => ({ SearchInputView: (props: ComponentProps<typeof SearchInputView>) => { screens.input = props; return null }, SearchResultsView: (props: ComponentProps<typeof SearchResultsView>) => { screens.results = props; return null } }))
vi.mock('virtual:pwa-register', () => ({ registerSW: () => vi.fn() }))
vi.mock('../src/db/db', async (original) => ({ ...await original<typeof import('../src/db/db')>(), initializeDatabase: async () => {} }))
let root: Root
let host: HTMLDivElement
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  await db.delete(); await db.open()
  await db.foods.put({ id: 'test-food', name: 'テスト専用食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null, nutrients: { ...DEFAULT_SETTINGS.goals, energyKcal: 123 }, foodGroupId: 'test-group', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  await db.foodGroups.put({ id: 'test-group', displayName: 'テスト専用食品', reading: null, category: null, representativeScore: 0, defaultVariantId: 'test-food', isActive: true, metadataSource: 'manual', generationVersion: 'manual-v1', needsReview: false, createdAt: '', updatedAt: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(createElement(App)) })
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(host.querySelector('nav')).not.toBeNull() })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await db.delete(); vi.restoreAllMocks() })
it('FOODMASTER保存後に同じ検索結果を再編集すると更新値を開く', async () => {
  await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('設定'))!.click() })
  await act(async () => screens.settings!.onOpenFoodMaster())
  await act(async () => screens.foods!.onOpenSearch!())
  await act(async () => screens.input!.setBars(['テスト専用食品']))
  await act(async () => screens.input!.onSearch())
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(screens.results?.groups[0]?.items).toHaveLength(1) })
  const result = screens.results!.groups[0]
  await act(async () => screens.results!.onSelect(result.query, result.items[0]))
  expect(screens.form!.draft.nutrients.energyKcal).toBe('123')
  await act(async () => screens.form!.setDraft({ ...screens.form!.draft, nutrients: { ...screens.form!.draft.nutrients, energyKcal: '456' } }))
  await act(async () => { await screens.form!.onSubmit() })
  expect((await db.foods.get('test-food'))!.nutrients.energyKcal).toBe(456)
  await act(async () => screens.form!.onClose())
  expect(screens.results!.groups[0].items[0].subtitle).toContain('456')
  await act(async () => screens.results!.onSelect(result.query, result.items[0]))
  expect(screens.form!.draft.nutrients.energyKcal).toBe('456')
})

it('検索分類で除外された同一familyの食品を再選択候補へ追加しない', async () => {
  const { refreshSearchFoodItem } = await import('../src/components/foodSearchModels')
  const food = (await db.foods.get('test-food'))!
  const group = (await db.foodGroups.get('test-group'))!
  const item = { id: group.id, kind: 'food' as const, title: '', subtitle: '', food, group, variants: [food], score: 0, matchedBy: null, recentlyUsed: false, searchLogId: null, searchRank: null }
  const refreshed = refreshSearchFoodItem(item, [food, { ...food, id: 'excluded' }], [group])
  expect(refreshed?.variants.map((variant) => variant.id)).toEqual([food.id])
  expect(refreshSearchFoodItem(item, [], [group])).toBeNull()
})


async function startBreakfastAddition() {
  await act(async () => { host.querySelector<HTMLButtonElement>('.meal-record-button')!.click() })
  await act(async () => { host.querySelector<HTMLButtonElement>('.meal-confirmation-actions button')!.click() })
}
async function submitMeal() {
  await act(async () => {
    host.querySelector('.modal-card form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}
it.each(['food', 'set'] as const)('確認画面から%sを追加して戻ると同じ区分の保存済み一覧を表示する', async (kind) => {
  await startBreakfastAddition()
  const food = (await db.foods.get('test-food'))!
  if (kind === 'food') {
    await act(async () => screens.foods!.onSelectFood!(food))
    await submitMeal()
  } else {
    await act(async () => {
      screens.foods!.onSelectMenuSet!({ id: 'set', name: 'セット', menuIds: [], foodItems: [{ foodId: food.id, amount: 100, unit: 'g' }], createdAt: food.createdAt, updatedAt: food.updatedAt })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  expect(await db.mealEntries.count()).toBe(1)
  await act(async () => screens.foods!.onBack!())
  expect(host.querySelector('.meal-confirmation-heading h1')?.textContent).toBe('朝食の確認')
  expect(host.querySelectorAll('.meal-confirmation-entry')).toHaveLength(1)
})
