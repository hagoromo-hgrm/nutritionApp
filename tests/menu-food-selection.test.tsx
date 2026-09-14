// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MenuFoodSelection } from '../src/components/MenuFoodSelection'
import { EMPTY_NUTRIENTS, type Food } from '../src/types'

const commercialFood: Food = {
  id: 'commercial-food',
  name: '市販ヨーグルト',
  displayName: '市販ヨーグルト',
  maker: 'テストメーカー',
  barcode: '4901234567890',
  isCommercial: true,
  source: 'user',
  sourceVersion: 'test',
  baseAmount: 100,
  baseUnit: 'g',
  servingAmount: null,
  servingUnit: null,
  // 手入力・外部商品由来の食品は独自のfoodGroupIdを持つことがある。
  foodGroupId: 'manual-commercial-group',
  nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 120 },
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
}

describe('MenuFoodSelection', () => {
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

  it('独自foodGroupIdを持つ外食・市販食品を分量指定でMyセットへ追加できる', async () => {
    const onAddWithAmount = vi.fn()
    await act(async () => {
      root.render(createElement(MenuFoodSelection, {
        selectedIds: [],
        foods: [commercialFood],
        foodGroups: [],
        recentFoods: [],
        favoriteFoods: [],
        favoriteIds: new Set<string>(),
        onToggleFavorite: vi.fn(),
        onAdd: vi.fn(),
        onAddWithAmount,
        onRemove: vi.fn(),
        allowFoodCategoryFilter: true,
        showSelectedList: false,
      }))
    })

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.menu-food-category-tabs button:last-child')!.click()
      host.querySelector<HTMLButtonElement>('.food-add-button')!.click()
    })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === '追加する')!.click()
    })
    expect(onAddWithAmount).toHaveBeenCalledWith(commercialFood, '100', 'g')
  })
})
