import { describe, expect, it } from 'vitest'
import { getMealEntryAvailableNutrients, sumAvailableNutrients } from '../src/services/mealEntryNutrition'
import { createMenuSetMealBatch } from '../src/services/menuSetMeals'
import { EMPTY_NUTRIENTS, type Food, type Menu, type Nutrients } from '../src/types'

const makeFood = (id: string, nutrients: Nutrients): Food => ({
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

describe('meal entry available nutrients', () => {
  it('保存済みメニュースナップショットから既知分を出し、後日のマスター変更を反映しない', () => {
    const knownFood = makeFood('known', { ...EMPTY_NUTRIENTS, energyKcal: 100, proteinG: 20 })
    const menu: Menu = {
      id: 'recipe',
      name: '部分欠損レシピ',
      category: '主菜',
      baseAmount: 2,
      baseUnit: '食',
      servingAmount: 1,
      servingUnit: '食',
      foodIds: [knownFood.id, 'deleted-food'],
      ingredients: [
        { kind: 'food', itemId: knownFood.id, amount: 200, unit: 'g' },
        { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
      ],
      createdAt: '',
      updatedAt: '',
    }
    const batch = createMenuSetMealBatch({
      menuSet: { id: 'set', name: 'test', menuIds: [menu.id], createdAt: '', updatedAt: '' },
      menus: [menu],
      foods: [knownFood],
      mealType: '昼食',
      eatenAt: '2026-10-15T03:00:00.000Z',
      createId: () => 'entry',
    })
    const [entry] = batch.entries

    expect(batch.missingFoodIds).toEqual([])
    expect(entry.menuSnapshot).toBeDefined()
    expect(entry.calculatedNutrients.energyKcal).toBeNull()
    expect(entry.calculatedNutrients.proteinG).toBeNull()
    expect(getMealEntryAvailableNutrients(entry)).toMatchObject({ energyKcal: 100, proteinG: 20, fatG: null })

    knownFood.nutrients.energyKcal = 900
    knownFood.nutrients.proteinG = 900
    expect(getMealEntryAvailableNutrients(entry)).toMatchObject({ energyKcal: 100, proteinG: 20 })
  })

  it('通常食品とスナップショットのない旧記録は保存済み計算値を使う', () => {
    const saved = {
      id: 'legacy',
      eatenAt: '2026-10-15T03:00:00.000Z',
      mealType: '朝食' as const,
      foodId: 'food',
      foodSnapshot: {
        name: '編集後の食品', maker: '', barcode: '', baseAmount: 100, baseUnit: 'g',
        nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 999 },
      },
      amount: 1,
      amountUnit: '食',
      calculatedNutrients: { ...EMPTY_NUTRIENTS, energyKcal: 75 },
    }

    expect(getMealEntryAvailableNutrients(saved)).toMatchObject({ energyKcal: 75 })
  })

  it('記録単位で既知分を小計し、空の記録は従来どおり0にする', () => {
    const knownEntry = {
      id: 'known',
      eatenAt: '2026-10-15T03:00:00.000Z',
      mealType: '朝食' as const,
      foodId: 'food',
      foodSnapshot: { name: '食品', maker: '', barcode: '', baseAmount: 1, baseUnit: '個', nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 40 } },
      amount: 1,
      amountUnit: '個',
      calculatedNutrients: { ...EMPTY_NUTRIENTS, energyKcal: 40 },
    }
    const missingEntry = { ...knownEntry, id: 'missing', calculatedNutrients: { ...EMPTY_NUTRIENTS } }

    expect(sumAvailableNutrients([knownEntry, missingEntry]).energyKcal).toBe(40)
    expect(sumAvailableNutrients([missingEntry]).proteinG).toBeNull()
    expect(sumAvailableNutrients([]).energyKcal).toBe(0)
  })
})
