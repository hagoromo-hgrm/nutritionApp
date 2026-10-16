// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphsView } from '../src/components/GraphsView'
import { getEntriesBetween, getWeightRecordsBetween } from '../src/db/db'
import { EMPTY_NUTRIENTS, type MealEntry } from '../src/types'
import { currentDateKey } from '../src/utils/date'

vi.mock('../src/db/db', () => ({
  getEntriesBetween: vi.fn(),
  getWeightRecordsBetween: vi.fn(),
}))

describe('グラフの既知小計表示', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it('欠損を含むエネルギー小計が目標範囲内なら推移グラフも青く表示する', async () => {
    const today = currentDateKey()
    const entry: MealEntry = {
      id: 'partial-menu-entry',
      eatenAt: `${today}T12:00:00+09:00`,
      mealType: '朝食',
      foodId: 'menu',
      foodSnapshot: {
        name: '部分欠損メニュー', maker: '', barcode: '', baseAmount: 1, baseUnit: '食',
        missing: false, nutrients: EMPTY_NUTRIENTS,
      },
      amount: 1,
      amountUnit: '食',
      calculatedNutrients: EMPTY_NUTRIENTS,
      menuSnapshot: {
        sourceMenuId: 'menu',
        sourceMenuName: '部分欠損メニュー',
        baseAmount: 1,
        baseUnit: '食',
        ingredients: [{
          kind: 'food',
          itemId: 'known-food',
          amount: 100,
          unit: 'g',
          foodSnapshot: {
            name: '既知食品', maker: '', barcode: '', baseAmount: 100, baseUnit: 'g',
            missing: false, nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 1800 },
          },
        }, {
          kind: 'food',
          itemId: 'unknown-food',
          amount: 100,
          unit: 'g',
          foodSnapshot: {
            name: '欠損食品', maker: '', barcode: '', baseAmount: 100, baseUnit: 'g',
            missing: false, nutrients: EMPTY_NUTRIENTS,
          },
        }],
      },
    }
    vi.mocked(getEntriesBetween).mockResolvedValue([entry])
    vi.mocked(getWeightRecordsBetween).mockResolvedValue([])

    await act(async () => {
      root.render(<GraphsView
        range="week"
        goals={{ ...EMPTY_NUTRIENTS, energyKcal: 2000 }}
        goalRecords={[]}
        onRangeChange={() => undefined}
      />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const withinGoalLabel = host.querySelector('.trend-bar-value.is-within-goal')
    expect(withinGoalLabel?.textContent).toContain('1800.0kcal')
    expect(entry.calculatedNutrients.energyKcal).toBeNull()
  })
})
