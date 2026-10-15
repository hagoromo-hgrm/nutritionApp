import { describe, expect, it } from 'vitest'
import {
  calculateMealMenuEntryAvailableNutrients,
  calculateMealMenuEntryNutrients,
  calculateMealMenuSnapshotAvailableNutrients,
  calculateMealMenuSnapshotNutrients,
  cloneMealMenuSnapshot,
  createMealFoodIngredientSnapshot,
  createGeneralMealMenuSnapshot,
  createMealMenuSnapshot,
  createTemporaryMealMenuSnapshot,
  isMealMenuSnapshot,
} from '../src/services/mealMenuSnapshots'
import { EMPTY_NUTRIENTS, type Food, type GeneralMenu, type Menu, type Nutrients } from '../src/types'

const nutrients = (energyKcal: number): Nutrients => ({
  energyKcal, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0,
  calciumMg: 1, ironMg: 1, vitaminAMcg: 1, vitaminEMg: 1, vitaminB1Mg: 1,
  vitaminB2Mg: 1, vitaminCMg: 1, saturatedFatG: 1,
})

const food = (id: string, name: string, energyKcal: number, baseAmount = 100): Food => ({
  id, name, maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount, baseUnit: 'g',
  servingAmount: null, servingUnit: null, nutrients: nutrients(energyKcal), createdAt: '', updatedAt: '',
})

const rice = food('rice', 'ご飯', 150)
const egg = food('egg', '卵', 80, 1)
const child: Menu = {
  id: 'child', name: '卵料理', category: '主菜', foodIds: ['egg'],
  ingredients: [{ kind: 'food', itemId: 'egg', amount: 1, unit: 'g' }], createdAt: '', updatedAt: '',
}
const parent: Menu = {
  id: 'parent', name: 'アレンジご飯', category: '主食', foodIds: ['rice'],
  ingredients: [
    { kind: 'food', itemId: 'rice', amount: 200, unit: 'g' },
    { kind: 'menu', itemId: 'child', amount: 0.5, unit: '食' },
  ],
  createdAt: '', updatedAt: '',
}
const generalMenu: GeneralMenu = {
  id: 'general-parent', name: '一般の卵ご飯', category: '主食', foodIds: ['rice', 'egg'],
  ingredients: [{ kind: 'food', itemId: 'rice', amount: 100, unit: 'g' }, { kind: 'food', itemId: 'egg', amount: 1, unit: 'g' }],
  aliases: ['たまごかけご飯'], createdAt: '', updatedAt: '',
}

describe('meal menu snapshots', () => {
  it('食品の既定入力単位と換算情報を構成スナップショットへ複製する', () => {
    const customFood = food('custom', 'パン', 200, 100)
    customFood.servingAmount = 2
    customFood.servingUnit = '切れ'
    customFood.inputUnitConversions = [{ unit: '切れ', baseAmount: 40 }]
    customFood.nutrientMetadata = {
      fiberG: { origin: 'estimated', source: 'MEXT', sourceFoodIds: ['mext_01015'], requestId: 'estimate_1' },
    }
    const ingredient = createMealFoodIngredientSnapshot(customFood)
    expect(ingredient).toMatchObject({ amount: 2, unit: '切れ' })
    expect(ingredient.foodSnapshot.inputUnitConversions).toEqual([{ unit: '切れ', baseAmount: 40 }])
    const cloned = cloneMealMenuSnapshot({ sourceMenuId: 'm', sourceMenuName: 'm', ingredients: [ingredient] })
    if (cloned.ingredients[0].kind !== 'food' || ingredient.kind !== 'food') throw new Error('食品食材がありません')
    cloned.ingredients[0].foodSnapshot.inputUnitConversions![0].baseAmount = 50
    cloned.ingredients[0].foodSnapshot.nutrientMetadata!.fiberG!.sourceFoodIds![0] = 'changed'
    expect(ingredient.foodSnapshot.inputUnitConversions?.[0].baseAmount).toBe(40)
    expect(ingredient.foodSnapshot.nutrientMetadata?.fiberG?.sourceFoodIds).toEqual(['mext_01015'])
  })

  it('カスタム単位の構成を明示換算し、未登録単位は拒否する', () => {
    const customFood = food('custom', 'パン', 200, 100)
    customFood.inputUnitConversions = [{ unit: '切れ', baseAmount: 40 }]
    const customMenu: Menu = {
      id: 'custom-menu', name: 'パン盛り', category: '主食', foodIds: ['custom'],
      ingredients: [{ kind: 'food', itemId: 'custom', amount: 2, unit: '切れ' }], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(customMenu, [customMenu], [customFood])
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(160)
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(isMealMenuSnapshot({ ...snapshot, ingredients: [{ ...snapshot.ingredients[0], unit: 'パック' }] })).toBe(false)
  })

  it('料理メニューと子メニューを食事側へ複製して栄養計算する', () => {
    const snapshot = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    expect(snapshot.sourceMenuName).toBe('アレンジご飯')
    expect(snapshot.ingredients[1]).toMatchObject({ kind: 'menu', name: '卵料理', amount: 0.5 })
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(340)
    expect(calculateMealMenuEntryNutrients(snapshot, 2, '食').energyKcal).toBe(680)
    expect(calculateMealMenuEntryNutrients(snapshot, 2, '個').energyKcal).toBeNull()
  })

  it('メニュー全体の任意単位をスナップショットへ固定して換算する', () => {
    const customMenu: Menu = {
      ...parent,
      baseAmount: 2,
      baseUnit: '皿',
      servingAmount: 1,
      servingUnit: '皿',
    }
    const snapshot = createMealMenuSnapshot(customMenu, [customMenu, child], [rice, egg])

    expect(snapshot).toMatchObject({ baseAmount: 2, baseUnit: '皿' })
    expect(snapshot.inputUnitConversions).toBeUndefined()
    expect(calculateMealMenuEntryNutrients(snapshot, 1, '皿').energyKcal).toBe(170)
    expect(calculateMealMenuEntryNutrients(snapshot, 2, '皿').energyKcal).toBe(340)
    expect(calculateMealMenuEntryAvailableNutrients(snapshot, 1, '皿').energyKcal).toBe(170)
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(isMealMenuSnapshot({ ...snapshot, baseAmount: undefined })).toBe(false)
    expect(isMealMenuSnapshot({ ...snapshot, inputUnitConversions: [{ unit: '食', baseAmount: 1 }] })).toBe(false)
  })

  it('子メニューにも登録時点の基準量と単位を保存して換算する', () => {
    const customChild: Menu = { ...child, baseAmount: 2, baseUnit: '個' }
    const customParent: Menu = {
      ...parent,
      ingredients: [{ kind: 'menu', itemId: customChild.id, amount: 1, unit: '個' }],
    }
    const snapshot = createMealMenuSnapshot(customParent, [customParent, customChild], [egg])
    const nested = snapshot.ingredients[0]

    expect(nested).toMatchObject({ kind: 'menu', amount: 1, unit: '個', baseAmount: 2, baseUnit: '個' })
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(40)
    expect(calculateMealMenuEntryAvailableNutrients(snapshot, 1, '食').energyKcal).toBe(40)
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
  })

  it('正規集計はnullを維持し、表示用小計は栄養素別に既知分だけを1単位へ換算する', () => {
    const energyFood = food('energy-only', 'エネルギーのみ', 100)
    energyFood.nutrients = { ...EMPTY_NUTRIENTS, energyKcal: 100 }
    const proteinFood = food('protein-only', 'たんぱく質のみ', 100)
    proteinFood.nutrients = { ...EMPTY_NUTRIENTS, proteinG: 20 }
    const missingMenu: Menu = {
      id: 'partial', name: '部分欠損', category: '主菜', baseAmount: 2, baseUnit: '食', foodIds: [],
      ingredients: [
        { kind: 'food', itemId: energyFood.id, amount: 100, unit: 'g' },
        { kind: 'food', itemId: proteinFood.id, amount: 100, unit: 'g' },
        { kind: 'food', itemId: 'deleted-food', amount: 100, unit: 'g' },
      ], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(missingMenu, [missingMenu], [energyFood, proteinFood])

    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBeNull()
    expect(calculateMealMenuSnapshotNutrients(snapshot).proteinG).toBeNull()
    expect(calculateMealMenuEntryNutrients(snapshot, 1, '食').energyKcal).toBeNull()
    expect(calculateMealMenuSnapshotAvailableNutrients(snapshot)).toMatchObject({ energyKcal: 100, proteinG: 20, fatG: null })
    expect(calculateMealMenuEntryAvailableNutrients(snapshot, 1, '食')).toMatchObject({ energyKcal: 50, proteinG: 10, fatG: null })
  })

  it('欠損だけならnullを返し、明示された0は既知の0として保持する', () => {
    const missingMenu: Menu = {
      id: 'missing', name: '欠損のみ', category: '主菜', foodIds: [],
      ingredients: [{ kind: 'food', itemId: 'not-found', amount: 10, unit: 'g' }], createdAt: '', updatedAt: '',
    }
    const missingSnapshot = createMealMenuSnapshot(missingMenu, [missingMenu], [])
    expect(calculateMealMenuEntryAvailableNutrients(missingSnapshot, 1, '食').energyKcal).toBeNull()

    const zeroFood = food('zero', '0kcal食品', 0)
    zeroFood.nutrients = { ...nutrients(0), energyKcal: 0 }
    const zeroMenu: Menu = {
      id: 'zero-menu', name: '0kcal', category: '主菜', foodIds: [zeroFood.id],
      ingredients: [{ kind: 'food', itemId: zeroFood.id, amount: 100, unit: 'g' }], createdAt: '', updatedAt: '',
    }
    const zeroSnapshot = createMealMenuSnapshot(zeroMenu, [zeroMenu], [zeroFood])
    expect(calculateMealMenuEntryAvailableNutrients(zeroSnapshot, 1, '食').energyKcal).toBe(0)
  })

  it('旧スナップショットの明示換算とネスト単位を既知小計にも反映する', () => {
    const knownFood = food('known', '既知食品', 100)
    const ingredient = createMealFoodIngredientSnapshot(knownFood, 100, 'g')
    const legacySnapshot = {
      sourceMenuId: 'legacy-parent', sourceMenuName: '旧親メニュー',
      inputUnitConversions: [{ unit: '皿', baseAmount: 0.5 }],
      ingredients: [{
        kind: 'menu' as const, itemId: 'legacy-child', name: '旧子メニュー', amount: 2, unit: '皿',
        inputUnitConversions: [{ unit: '皿', baseAmount: 0.5 }],
        ingredients: [ingredient], missing: false,
      }],
    }

    expect(calculateMealMenuEntryAvailableNutrients(legacySnapshot, 1, '皿').energyKcal).toBe(50)
  })

  it('子メニューと親メニューの分量を段階的に換算して既知小計を出す', () => {
    const knownFood = food('known-child', '子メニューの既知食品', 100)
    const childMenu: Menu = {
      id: 'two-piece-child', name: '2個分の子メニュー', category: '主菜', baseAmount: 2, baseUnit: '個', foodIds: [knownFood.id, 'deleted-child-food'],
      ingredients: [
        { kind: 'food', itemId: knownFood.id, amount: 200, unit: 'g' },
        { kind: 'food', itemId: 'deleted-child-food', amount: 100, unit: 'g' },
      ], createdAt: '', updatedAt: '',
    }
    const parentMenu: Menu = {
      id: 'four-serving-parent', name: '4食分の親メニュー', category: '主菜', baseAmount: 4, baseUnit: '食', foodIds: [],
      ingredients: [{ kind: 'menu', itemId: childMenu.id, amount: 1, unit: '個' }], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(parentMenu, [parentMenu, childMenu], [knownFood])

    expect(calculateMealMenuEntryNutrients(snapshot, 1.5, '食').energyKcal).toBeNull()
    expect(calculateMealMenuEntryAvailableNutrients(snapshot, 1.5, '食').energyKcal).toBe(37.5)
  })

  it('missingフラグ付きの数値、無効単位、削除済み子メニューを既知寄与へ含めない', () => {
    const knownFood = food('known', '既知食品', 100)
    const missingFlagFood = food('deleted', '削除済み食品', 900)
    const invalidUnitFood = food('invalid-unit', '換算のない食品', 700)
    const menu: Menu = {
      id: 'mixed-invalid', name: '欠損と無効単位', category: '主菜', foodIds: [],
      ingredients: [
        { kind: 'food', itemId: knownFood.id, amount: 100, unit: 'g' },
        { kind: 'food', itemId: missingFlagFood.id, amount: 100, unit: 'g' },
        { kind: 'food', itemId: invalidUnitFood.id, amount: 1, unit: '切れ' },
        { kind: 'menu', itemId: 'deleted-child-menu', amount: 1, unit: '食' },
      ], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(menu, [menu], [knownFood, missingFlagFood, invalidUnitFood])
    const missingFlagIngredient = snapshot.ingredients.find((ingredient) => ingredient.kind === 'food' && ingredient.itemId === missingFlagFood.id)
    if (!missingFlagIngredient || missingFlagIngredient.kind !== 'food') throw new Error('missing食品スナップショットがありません')
    missingFlagIngredient.foodSnapshot.missing = true

    expect(calculateMealMenuEntryAvailableNutrients(snapshot, 1, '食').energyKcal).toBe(100)
  })

  it('一般メニューのスナップショットは由来を区別して複製する', () => {
    const snapshot = createGeneralMealMenuSnapshot(generalMenu, [child], [rice, egg])
    expect(snapshot).toMatchObject({ sourceMenuId: 'general-parent', sourceMenuName: '一般の卵ご飯', sourceKind: 'general-menu' })
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBe(230)
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
  })

  it('一時メニューは原本を持たず、構成を複製して一意な非空IDを持つ', () => {
    const ingredient = createMealFoodIngredientSnapshot(rice, 100, 'g')
    const snapshot = createTemporaryMealMenuSnapshot('この食事だけ', [ingredient], 'temporary-test')
    expect(snapshot).toMatchObject({ sourceMenuId: 'temporary-test', sourceMenuName: 'この食事だけ', sourceKind: 'temporary' })
    expect(snapshot.ingredients).not.toBe([ingredient])
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(() => createTemporaryMealMenuSnapshot(' ', [])).toThrow()
    expect(() => createTemporaryMealMenuSnapshot('名前', [], ' ')).toThrow()
    expect(() => createTemporaryMealMenuSnapshot('名前', [], 'temporary-invalid', 0, '皿')).toThrow('基準量')
    expect(() => createTemporaryMealMenuSnapshot('名前', [], 'temporary-invalid', 1, ' ')).toThrow('基準量')
  })

  it('食事側の変更は原本と元のスナップショットを変更しない', () => {
    const original = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    const arranged = cloneMealMenuSnapshot(original)
    arranged.ingredients[0].amount = 100
    const nested = arranged.ingredients[1]
    if (nested.kind !== 'menu') throw new Error('子メニューがありません')
    nested.amount = 1
    nested.ingredients[0].amount = 2

    expect(calculateMealMenuSnapshotNutrients(arranged).energyKcal).toBe(310)
    expect(calculateMealMenuSnapshotNutrients(original).energyKcal).toBe(340)
    expect(parent.ingredients?.[0].amount).toBe(200)
  })

  it('欠損した構成食材をゼロとして集計しない', () => {
    const missingMenu: Menu = {
      id: 'missing', name: '欠損あり', category: '主食', foodIds: [],
      ingredients: [{ kind: 'food', itemId: 'not-found', amount: 10, unit: 'g' }], createdAt: '', updatedAt: '',
    }
    const snapshot = createMealMenuSnapshot(missingMenu, [missingMenu], [])
    expect(calculateMealMenuSnapshotNutrients(snapshot).energyKcal).toBeNull()
  })

  it('バックアップ・CSV用の構造検証で不正な分量を拒否する', () => {
    const snapshot = createMealMenuSnapshot(parent, [parent, child], [rice, egg])
    expect(isMealMenuSnapshot(snapshot)).toBe(true)
    expect(isMealMenuSnapshot({ ...snapshot, ingredients: [{ ...snapshot.ingredients[0], amount: 0 }] })).toBe(false)
  })
})
