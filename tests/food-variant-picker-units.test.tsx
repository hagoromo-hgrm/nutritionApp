// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FoodVariantPickerModal } from '../src/components/FoodVariantPicker'
import { buildMextFoodSearchResult } from '../src/components/foodSearchModels'
import { mextFoods } from '../src/data/mextFoods'
import { getFoodAttributeDisplayName, getFoodVariantBySourceId, getSelectableAttributes } from '../src/services/mextFoodData'
import { searchUserFoodGroups } from '../src/services/mextUserFoodData'
import type { Food, FoodAttributePreferences, FoodGroup } from '../src/types'
import { EMPTY_NUTRIENTS } from '../src/types'

const foodsWithMextGroups: Food[] = mextFoods.map((food) => ({
  ...food,
  foodGroupId: getFoodVariantBySourceId(food.id)?.foodGroupId,
}))
const noFoodGroups: FoodGroup[] = []
const noAttributePreferences: FoodAttributePreferences = {}

const legacyFoods: Food[] = [
  {
    id: 'legacy-unit-a', name: '単位確認食品 A', displayName: '単位確認食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
    baseAmount: 100, baseUnit: 'g', servingAmount: 1, servingUnit: '個', inputUnitConversions: [{ unit: '個', baseAmount: 50 }], variantAttributes: { preparation: '生' },
    nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 120 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'legacy-unit-b', name: '単位確認食品 B', displayName: '単位確認食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test',
    baseAmount: 100, baseUnit: 'g', servingAmount: 200, servingUnit: 'g', variantAttributes: { preparation: 'ゆで' },
    nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 220 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
]
const legacyResult = {
  group: {
    id: 'legacy-unit-group', displayName: '単位確認食品', reading: null, category: null, representativeScore: 0,
    defaultVariantId: legacyFoods[0].id, isActive: true, metadataSource: 'manual' as const,
    generationVersion: 'test-v1', needsReview: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  food: legacyFoods[0], variants: legacyFoods, score: 0, matchedBy: 'test', recentlyUsed: false,
  scoreBreakdown: { text: 0, representative: 0, personalFrequency: 0, recent: 0, total: 0 },
}

describe('FoodVariantPicker quantity unit state', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('MEXT直接検索では分量と変更した単位を保持し、同じ食品IDのデータ更新でも編集値を保つ', async () => {
    const foodGroupId = 'fg_000435'
    const result = buildMextFoodSearchResult(foodGroupId, foodsWithMextGroups, noFoodGroups)
    expect(result).not.toBeNull()
    await renderPicker({ result })
    await chooseMextVariant(foodGroupId, {}, getFoodVariantBySourceId('mext_01088')!.attributes)

    const amount = getAmountInput()
    const unit = getUnitSelect()
    expect(unit.value).toBe('杯')
    await changeInput(amount, '37')
    await changeUnit(unit, 'g')
    expect(amount.value).toBe('37')
    expect(unit.value).toBe('g')

    const refreshedFoods = foodsWithMextGroups.map((food) => food.id === result!.food.id
      ? { ...food, servingAmount: 4 }
      : food)
    const refreshedResult = buildMextFoodSearchResult(foodGroupId, refreshedFoods, noFoodGroups)
    await renderPicker({ result: refreshedResult, foods: refreshedFoods })
    expect(getAmountInput().value).toBe('37')
    expect(getUnitSelect().value).toBe('g')
  })

  it('上位ユーザー食品検索の玄米でも、単位変更後に入力値を保持する', async () => {
    const userFoodResult = searchUserFoodGroups('玄米').find((item) => item.group.canonicalName === 'ご飯')
    expect(userFoodResult?.foodGroupId).toBe('fg_001282')
    await renderPicker({ result: null, userFoodResult })

    const amount = getAmountInput()
    const unit = getUnitSelect()
    expect(unit.value).toBe('杯')
    await changeInput(amount, '75')
    await changeUnit(unit, 'g')
    expect(amount.value).toBe('75')
    expect(unit.value).toBe('g')
  })

  it('MEXT新規選択では食品を切り替えると既定値へ戻し、無効になった単位を補正する', async () => {
    const foodGroupId = 'fg_000687'
    const result = buildMextFoodSearchResult(foodGroupId, foodsWithMextGroups, noFoodGroups)
    expect(result).not.toBeNull()
    await renderPicker({ result, initialFoodId: 'mext_02017' })

    const rawPotato = getFoodVariantBySourceId('mext_02017')!
    const steamedPotato = getFoodVariantBySourceId('mext_02018')!
    expect(getAmountInput().value).toBe('1')
    expect(getUnitSelect().value).toBe('個')
    await changeInput(getAmountInput(), '23')
    await chooseMextVariant(foodGroupId, rawPotato.attributes, steamedPotato.attributes)

    expect(getAmountInput().value).toBe('100')
    expect(getUnitSelect().value).toBe('g')
  })

  it('MEXT編集では初期分量を保ち、食品切替時は互換単位を維持して無効単位だけ既定値へ戻す', async () => {
    const riceGroupId = 'fg_000435'
    const riceResult = buildMextFoodSearchResult(riceGroupId, foodsWithMextGroups, noFoodGroups)
    expect(riceResult).not.toBeNull()
    await renderPicker({ result: riceResult, initialFoodId: 'mext_01088', initialAmount: '75', initialAmountUnit: '杯' })
    await changeUnit(getUnitSelect(), 'g')
    expect(getAmountInput().value).toBe('75')
    expect(getUnitSelect().value).toBe('g')
    await chooseMextVariant(riceGroupId, getFoodVariantBySourceId('mext_01088')!.attributes, getFoodVariantBySourceId('mext_01151')!.attributes)
    expect(getAmountInput().value).toBe('75')
    expect(getUnitSelect().value).toBe('g')

    await clearPicker()
    const potatoGroupId = 'fg_000687'
    const potatoResult = buildMextFoodSearchResult(potatoGroupId, foodsWithMextGroups, noFoodGroups)
    await renderPicker({ result: potatoResult, initialFoodId: 'mext_02017', initialAmount: '23', initialAmountUnit: '個' })
    await chooseMextVariant(potatoGroupId, getFoodVariantBySourceId('mext_02017')!.attributes, getFoodVariantBySourceId('mext_02018')!.attributes)
    expect(getAmountInput().value).toBe('23')
    expect(getUnitSelect().value).toBe('g')
  })

  it('Legacyの新規・編集では単位変更を保ち、食品IDが変わったときだけ新しい既定値へ戻す', async () => {
    await renderPicker({ result: legacyResult })
    expect(getAmountInput().value).toBe('1')
    expect(getUnitSelect().value).toBe('個')
    await changeInput(getAmountInput(), '12')
    await changeUnit(getUnitSelect(), 'g')
    expect(getAmountInput().value).toBe('12')
    expect(getUnitSelect().value).toBe('g')
    await chooseButton('ゆで')
    expect(getAmountInput().value).toBe('200')
    expect(getUnitSelect().value).toBe('g')

    await clearPicker()
    await renderPicker({ result: legacyResult, initialFoodId: legacyFoods[1].id, initialAmount: '17', initialAmountUnit: 'g' })
    expect(getAmountInput().value).toBe('17')
    expect(getUnitSelect().value).toBe('g')
    await chooseButton('生')
    expect(getAmountInput().value).toBe('1')
    expect(getUnitSelect().value).toBe('個')
  })

  async function renderPicker(options: {
    result: ReturnType<typeof buildMextFoodSearchResult> | typeof legacyResult | null
    userFoodResult?: ReturnType<typeof searchUserFoodGroups>[number]
    foods?: Food[]
    initialFoodId?: string
    initialAmount?: string
    initialAmountUnit?: string
  }) {
    await act(async () => {
      root.render(createElement(FoodVariantPickerModal, {
        result: options.result,
        userFoodResult: options.userFoodResult,
        foods: options.foods ?? foodsWithMextGroups,
        foodGroups: noFoodGroups,
        foodAttributePreferences: noAttributePreferences,
        onSelect: vi.fn(),
        onClose: vi.fn(),
        mealMode: true,
        onSubmitMeal: vi.fn(),
        initialFoodId: options.initialFoodId,
        initialAmount: options.initialAmount,
        initialAmountUnit: options.initialAmountUnit,
      }))
    })
  }

  async function clearPicker() {
    await act(async () => { root.render(null) })
  }

  function getAmountInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('.variant-picker-modal input[type="number"]')
    if (!input) throw new Error(`分量入力が見つかりません: ${host.textContent}`)
    return input
  }

  function getUnitSelect(): HTMLSelectElement {
    const select = host.querySelector<HTMLSelectElement>('.variant-picker-modal select[aria-label="入力単位"]')
    if (!select) throw new Error('単位選択が見つかりません')
    return select
  }

  async function changeInput(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function changeUnit(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  async function chooseButton(label: string) {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.includes(label))
    if (!button) throw new Error(`選択肢が見つかりません: ${label} / ${host.textContent}`)
    await act(async () => { button.click() })
  }

  async function chooseMextVariant(foodGroupId: string, current: Record<string, string>, target: Record<string, string>) {
    const attributeId = Object.keys(target).find((key) => target[key] !== current[key])
    if (!attributeId) throw new Error('切り替え可能なMEXT属性がありません')
    const attribute = getSelectableAttributes(foodGroupId).find((candidate) => candidate.id === attributeId)
    const targetValue = attribute?.values.find((value) => value.id === target[attributeId])
    if (!attribute || !targetValue) throw new Error(`MEXT属性値が見つかりません: ${foodGroupId}/${attributeId}`)
    const displayName = getFoodAttributeDisplayName(foodGroupId, attribute)
    const section = Array.from(host.querySelectorAll<HTMLElement>('.variant-choice-group'))
      .find((candidate) => candidate.querySelector('h3')?.textContent === displayName)
    const button = Array.from(section?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((candidate) => candidate.querySelector('span')?.textContent === targetValue.displayName)
    if (!button) throw new Error(`MEXT選択肢が見つかりません: ${displayName}/${targetValue.displayName}`)
    await act(async () => { button.click() })
  }
})
