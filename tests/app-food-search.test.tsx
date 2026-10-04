// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FoodFormView } from '../src/components/FoodFormView'
import type { SettingsView } from '../src/components/SettingsView'
import type { ReleaseNotesView } from '../src/components/ReleaseNotesView'
import type { FoodsView } from '../src/components/FoodsView'
import type { SearchInputView, SearchResultsView } from '../src/components/SearchViews'
import { db } from '../src/db/db'
import { DEFAULT_SETTINGS } from '../src/types'
import App from '../src/App'
import { queueFoodEstimateAdoption } from '../src/components/formDrafts'
import { confirmedNutrientInputsFromFood } from '../src/services/confirmedNutrientInputs'
import { estimateNutrients, type NutrientEstimateRequest } from '../src/services/nutrientEstimator'
import { EMPTY_NUTRIENTS } from '../src/types'
import { createIngredientDeclarationFingerprint } from '../src/services/explicitCompositionEvidence'

const screens = vi.hoisted(() => ({ form: null as ComponentProps<typeof FoodFormView> | null, settings: null as ComponentProps<typeof SettingsView> | null, releaseNotes: null as ComponentProps<typeof ReleaseNotesView> | null, foods: null as ComponentProps<typeof FoodsView> | null, input: null as ComponentProps<typeof SearchInputView> | null, results: null as ComponentProps<typeof SearchResultsView> | null }))
vi.mock('../src/components/FoodFormView', () => ({ FoodFormView: (props: ComponentProps<typeof FoodFormView>) => { screens.form = props; return null } }))
vi.mock('../src/components/SettingsView', () => ({ SettingsView: (props: ComponentProps<typeof SettingsView>) => { screens.settings = props; return null } }))
vi.mock('../src/components/ReleaseNotesView', () => ({ ReleaseNotesView: (props: ComponentProps<typeof ReleaseNotesView>) => { screens.releaseNotes = props; return <div>リリースノート画面</div> } }))
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
it('設定からリリースノートを開いて設定へ戻れる', async () => {
  await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('設定'))!.click() })
  await act(async () => screens.settings!.onOpenReleaseNotes())
  expect(host.textContent).toContain('リリースノート画面')
  screens.settings = null
  await act(async () => screens.releaseNotes!.onBack())
  expect(screens.settings).not.toBeNull()
})

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

it.each([false, true])('推計の実入力を保存し、数値が同じでも根拠変更=%sなら採用を止める', async (changeEvidence) => {
  await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('設定'))!.click() })
  await act(async () => screens.settings!.onOpenFoodMaster())
  await act(async () => screens.foods!.onOpenSearch!())
  await act(async () => screens.input!.setBars(['テスト専用食品']))
  await act(async () => screens.input!.onSearch())
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(screens.results?.groups[0]?.items).toHaveLength(1) })
  const selected = screens.results!.groups[0]
  await act(async () => screens.results!.onSelect(selected.query, selected.items[0]))
  const draft = {
    ...screens.form!.draft,
    ingredientsText: '薄力粉、砂糖', ingredientsSourceProvider: '合成テスト出典',
    estimatorGenreId: 'other_unknown' as const,
    estimatorGenreSource: 'user' as const,
  }
  const known = confirmedNutrientInputsFromFood({
    source: draft.source, nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 123 },
    nutrientMetadata: draft.nutrientMetadata, legacyFallbackBlocked: draft.legacyFallbackBlocked,
  })
  const request: NutrientEstimateRequest = {
    requestId: 'actual-evaluated-input', productName: draft.name, estimatorGenreId: draft.estimatorGenreId,
    estimatorGenreSource: draft.estimatorGenreSource, inputUnitConversions: [],
    baseAmount: 100, baseUnit: 'g', referenceMassG: 100, referenceMassSource: '基準単位がg',
    ingredientsText: draft.ingredientsText, ingredientsSource: { provider: draft.ingredientsSourceProvider, verified: true },
    ...known, requestedNutrients: ['fiberG'], requestedAt: '2026-10-04T00:00:00.000Z',
    fitMode: 'robust_interval', knownNutrientReferenceBasis: { amount: 100, unit: 'g' },
    knownNutrientReferences: { energyKcal: {
      origin: 'user_input', verified: true, sourceReference: '合成ラベル記録',
      reference: { kind: 'fixed', value: 123 }, basis: { amount: 100, unit: 'g' },
    } },
  }
  const result = estimateNutrients(request)
  expect(result.estimates.fiberG.status).toBe('available')
  if (result.estimates.fiberG.status !== 'available') return
  const staged = queueFoodEstimateAdoption(draft, {
    requestId: request.requestId, request, result, basis: result.basis,
    values: { fiberG: result.estimates.fiberG.value },
  })
  await act(async () => screens.form!.setDraft(changeEvidence
    ? { ...staged, nutrientMetadata: { ...staged.nutrientMetadata, energyKcal: { origin: 'user_input', verified: false } } }
    : staged))
  await act(async () => { await screens.form!.onSubmit() })
  if (changeEvidence) {
    expect(await db.estimationRequests.count()).toBe(0)
    expect((await db.foods.get('test-food'))!.nutrients.fiberG).toBeNull()
    expect(host.textContent).toContain('もう一度推計')
  } else {
    const snapshot = (await db.estimationRequests.get(request.requestId))!.inputSnapshot
    expect(snapshot.knownNutrientEvidence).toEqual(request.knownNutrientEvidence)
    expect(snapshot.knownNutrientReferences).toEqual(request.knownNutrientReferences)
    expect(snapshot.fitMode).toBe('robust_interval')
    expect(snapshot.requestedNutrients).toEqual(['fiberG'])
    expect((await db.foods.get('test-food'))!.nutrients.fiberG).toBe(result.estimates.fiberG.value)
  }
})

it('通常食品編集は配合根拠を保持し、原材料変更で根拠の宣言fingerprintを更新しない', async () => {
  const ingredientsText = '上白糖、脱脂粉乳'
  const evidence = {
    schemaVersion: 1 as const,
    declarationFingerprint: createIngredientDeclarationFingerprint(ingredientsText),
    compositions: [{
      id: 'app-synthetic-batch', parent: { section: 'ingredient' as const, path: [] },
      expectedChildNames: ['上白糖', '脱脂粉乳'], denominator: 'product' as const, weightStage: 'finished' as const,
      amounts: { kind: 'masses_g' as const, denominatorMassG: 100, children: [{ index: 0, value: 60 }, { index: 1, value: 40 }] },
      source: { kind: 'user_measurement' as const, reference: '合成計測記録', verified: true as const, checkedAt: '2026-10-04T00:00:00.000Z' },
    }],
  }
  await db.foods.update('test-food', { ingredientsText, estimationEvidence: evidence })
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(createElement(App)))
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(host.querySelector('nav')).not.toBeNull() })
  await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('設定'))!.click() })
  await act(async () => screens.settings!.onOpenFoodMaster())
  await act(async () => screens.foods!.onOpenSearch!())
  await act(async () => screens.input!.setBars(['テスト専用食品']))
  await act(async () => screens.input!.onSearch())
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(screens.results?.groups[0]?.items).toHaveLength(1) })
  const selected = screens.results!.groups[0]
  await act(async () => screens.results!.onSelect(selected.query, selected.items[0]))
  expect(screens.form!.draft.estimationEvidence).toEqual(evidence)
  await act(async () => screens.form!.setDraft({ ...screens.form!.draft, ingredientsText: '上白糖、脱脂粉乳、ココアパウダー' }))
  await act(async () => { await screens.form!.onSubmit() })
  expect((await db.foods.get('test-food'))!.estimationEvidence).toEqual(evidence)
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


it('検索0件から食品を新規登録して食事保存した後も未選択の検索結果を維持する', async () => {
  await startBreakfastAddition()
  await act(async () => screens.foods!.onOpenSearch!())
  await act(async () => screens.input!.setBars(['未登録専用食品', 'テスト専用食品']))
  await act(async () => { screens.input!.onSearch(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(screens.results!.groups).toHaveLength(2)
  await act(async () => screens.results!.onAddFood('未登録専用食品'))
  await act(async () => { await screens.form!.onSubmit() })
  await act(async () => screens.form!.onClose())
  await submitMeal()
  expect(await db.mealEntries.count()).toBe(1)
  expect(screens.results!.groups.map((group) => group.query)).toEqual(['テスト専用食品'])
  await act(async () => screens.results!.onOpenConfirmation!())
  expect(host.querySelector('.meal-confirmation-heading h1')?.textContent).toBe('朝食の確認')
})

it('検索から新規食事を保存できた時だけ検索文脈付きの利用実績にする', async () => {
  await startBreakfastAddition()
  await act(async () => screens.foods!.onOpenSearch!())
  await act(async () => screens.input!.setBars(['テスト専用食品']))
  await act(async () => { screens.input!.onSearch(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  const result = screens.results!.groups[0]
  expect(result.items).toHaveLength(1)
  await act(async () => screens.results!.onSelect(result.query, result.items[0]))
  expect((await db.mealEntries.toArray())).toHaveLength(0)

  await submitMeal()

  const saved = (await db.mealEntries.toArray())[0]
  expect(saved.usageEvidence).toMatchObject({
    version: 1,
    kind: 'direct-food',
    entryPoint: 'search',
    search: {
      foodGroupId: 'test-group',
      foodVariantId: 'test-food',
      rank: 1,
    },
  })
  expect(await db.searchLogs.get(saved.usageEvidence!.search!.logId)).toMatchObject({
    selectedFoodGroupId: 'test-group',
    selectedFoodVariantId: 'test-food',
    selectedRank: 1,
    savedAt: saved.usageEvidence!.savedAt,
  })
})

it('手動familyの既存食事は登録時の属性と分量を開き、属性変更で同じ記録を更新する', async () => {
  await act(async () => root.unmount())
  const first = (await db.foods.get('test-food'))!
  await db.foods.update(first.id, { variantAttributes: { preparation: '生' } })
  const second = { ...first, id: 'test-cooked', officialName: 'テスト専用食品 ゆで', variantAttributes: { preparation: 'ゆで' }, servingAmount: 80, servingUnit: 'g' }
  await db.foods.put(second)
  root = createRoot(host)
  await act(async () => root.render(createElement(App)))
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); expect(host.querySelector('nav')).not.toBeNull() })
  await startBreakfastAddition()
  await act(async () => screens.foods!.onSelectFood!({ ...second, servingAmount: 37 }))
  await submitMeal()
  const saved = (await db.mealEntries.toArray())[0]
  await act(async () => screens.foods!.onBack!())
  await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>('.meal-confirmation-entry button')).find((button) => button.textContent === '編集')!.click() })
  expect(host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toBe('ゆで')
  expect(host.querySelector<HTMLInputElement>('.variant-picker-modal input')?.value).toBe('37')
  expect(host.querySelector<HTMLSelectElement>('.variant-picker-modal select')?.value).toBe('g')
  await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>('.variant-choice-button')).find((button) => button.textContent === '生')!.click() })
  expect(host.querySelector<HTMLInputElement>('.variant-picker-modal input')?.value).toBe('100')
  await act(async () => { host.querySelector<HTMLButtonElement>('.variant-picker-confirm')!.click(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  const updated = (await db.mealEntries.toArray())[0]
  expect(updated.id).toBe(saved.id)
  expect(updated.sortOrder).toBe(saved.sortOrder)
  expect(updated.foodId).toBe(first.id)
  expect(updated.foodSnapshot.name).toBe(first.name)
  expect(await db.mealEntries.count()).toBe(1)
})
