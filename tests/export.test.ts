import { describe, expect, it } from 'vitest'
import { validateBackup } from '../src/services/backup'
import { CSV_HEADERS, mealsToCsv, parseMealsCsv } from '../src/services/csv'
import type { BackupData, Food, MealEntry } from '../src/types'

const addedNutrients = { calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }

const entry: MealEntry = {
  id: 'meal_1', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: 'food_1', amount: 50, amountUnit: 'g',
  foodSnapshot: { name: '米, 白米', maker: 'メーカー"A"', barcode: '0012345678901', baseAmount: 100, baseUnit: 'g', nutrients: { energyKcal: 156, proteinG: 2.5, fatG: 0.3, carbohydrateG: 37, fiberG: null, saltG: 0, ...addedNutrients } },
  calculatedNutrients: { energyKcal: 78, proteinG: 1.25, fatG: 0.15, carbohydrateG: 18.5, fiberG: null, saltG: 0, ...addedNutrients },
}

const backup: BackupData = {
  format: 'nutrition-pwa-backup', dataFormatVersion: 1, exportedAt: '2026-07-15T00:00:00.000Z', foods: [], mealEntries: [], favorites: [],
  settings: { id: 'app', goals: { energyKcal: null, proteinG: null, fatG: null, carbohydrateG: null, fiberG: null, saltG: null, calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }, displayUnit: 'default', lastBackupAt: null, dataFormatVersion: 1, externalApiEnabled: false, externalApiEndpoint: 'https://world.openfoodfacts.org/api/v3/product' },
}

const classifiedFood: Food = {
  id: 'commercial_1', name: '外食メニュー', maker: '', barcode: '', isCommercial: true, source: 'user', sourceVersion: 'test',
  baseAmount: 1, baseUnit: '食', servingAmount: null, servingUnit: null,
  nutrients: { energyKcal: 500, proteinG: null, fatG: null, carbohydrateG: null, fiberG: null, saltG: null, ...addedNutrients },
  createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
}

const menuEntry: MealEntry = {
  ...entry,
  foodId: 'menu:menu_1',
  amount: 1,
  amountUnit: '食',
  foodSnapshot: { ...entry.foodSnapshot, name: '朝ごはん', baseAmount: 1, baseUnit: '食' },
  menuSnapshot: {
    sourceMenuId: 'menu_1',
    sourceMenuName: '朝ごはん',
    ingredients: [{
      kind: 'food', itemId: entry.foodId, amount: entry.amount, unit: entry.amountUnit,
      foodSnapshot: { ...entry.foodSnapshot, nutrients: { ...entry.foodSnapshot.nutrients } },
    }],
  },
}

describe('export formats', () => {
  it('CSVはBOM付きで要件どおりの列順とエスケープになる', () => {
    const csv = mealsToCsv([entry])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.split('\r\n')[0].slice(1).split(',')).toEqual(CSV_HEADERS)
    expect(csv).toContain('"米, 白米"')
    expect(csv).toContain('"メーカー""A"""')
  })

  it('このPWAで出力したCSVから食事スナップショットを復元できる', () => {
    const restored = parseMealsCsv(mealsToCsv([entry]))
    expect(restored).toEqual([entry])
  })

  it('料理メニューの食事別構成をJSONとCSVで保持する', () => {
    const validated = validateBackup({ ...backup, mealEntries: [menuEntry] })
    expect(validated.mealEntries[0].menuSnapshot?.ingredients[0].amount).toBe(50)
    expect(parseMealsCsv(mealsToCsv([menuEntry]))).toEqual([menuEntry])

    const invalidEntry = {
      ...menuEntry,
      menuSnapshot: { ...menuEntry.menuSnapshot, ingredients: [{ ...menuEntry.menuSnapshot!.ingredients[0], amount: 0 }] },
    }
    expect(() => validateBackup({ ...backup, mealEntries: [invalidEntry] })).toThrow('食品または食事記録')
  })

  it('列が欠けたCSVは取り込まない', () => {
    expect(() => parseMealsCsv('\uFEFFid,date\r\nmeal_1,2026-07-15\r\n')).toThrow('列名と順序')
  })

  it('不正なバックアップは取り込まない', () => {
    expect(validateBackup(backup)).toEqual(backup)
    expect(() => validateBackup({ ...backup, dataFormatVersion: 99 })).toThrow('対応していない')
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, goals: { energyKcal: 'bad' } } })).toThrow()
  })

  it('外食・市販の明示フラグを保持し、旧形式との互換性も維持する', () => {
    expect(validateBackup({ ...backup, foods: [classifiedFood] }).foods[0].isCommercial).toBe(true)
    const legacyFood = { ...classifiedFood }
    delete legacyFood.isCommercial
    expect(validateBackup({ ...backup, foods: [legacyFood] }).foods[0].isCommercial).toBeUndefined()
    expect(() => validateBackup({ ...backup, foods: [{ ...classifiedFood, isCommercial: 'yes' }] })).toThrow('食品または食事記録')
  })

  it('食品属性設定を含むバックアップを検証し、不正な型を拒否する', () => {
    const withPreferences = { ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 'raw', mode: 'auto' }, unknown_attribute: { defaultValueId: 'value', mode: 'prefill' } }, ufg_000960: { rice_type: { defaultValueId: 'white_rice', mode: 'auto', visible: false } } } } }
    expect(validateBackup(withPreferences).settings.foodAttributePreferences?.group_a.cooking_state.mode).toBe('auto')
    expect(validateBackup(withPreferences).settings.foodAttributePreferences?.ufg_000960.rice_type.defaultValueId).toBe('white_rice')
    const legacy = { ...backup, settings: { ...backup.settings, foodAttributePreferences: { cooking_state: { defaultValueId: 'raw', mode: 'auto' } } } }
    expect(validateBackup(legacy).settings.foodAttributePreferences?.cooking_state.mode).toBe('auto')
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 1, mode: 'auto' } } } } })).toThrow()
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 'raw', mode: 'hidden' } } } } })).toThrow()
  })

  it('メニューを含むバックアップを検証できる', () => {
    const withMenu = {
      ...backup,
      menus: [
        { id: 'menu_1', name: '朝ごはん', category: '主食', foodIds: ['food_1'], ingredients: [{ kind: 'food', itemId: 'food_1', amount: 150, unit: 'g' }], aliases: ['朝食'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
        { id: 'menu_2', name: 'おやつ', category: 'お菓子・スイーツ', foodIds: [], ingredients: [{ kind: 'menu', itemId: 'menu_1', amount: 0.5, unit: '食' }], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
      ],
      menuSets: [{ id: 'set_1', name: '平日セット', menuIds: ['menu_1'], foodIds: ['food_1'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
    }
    expect(validateBackup(withMenu).menus?.[0].name).toBe('朝ごはん')
    expect(validateBackup(withMenu).menus?.[0].aliases).toEqual(['朝食'])
    expect(validateBackup(withMenu).menus?.[0].ingredients?.[0].amount).toBe(150)
    expect(validateBackup(withMenu).menus?.[1].ingredients?.[0].kind).toBe('menu')
    expect(validateBackup(withMenu).menus?.[1].category).toBe('お菓子・スイーツ')
    expect(validateBackup(withMenu).menuSets?.[0].menuIds).toEqual(['menu_1'])
    expect(validateBackup(withMenu).menuSets?.[0].foodIds).toEqual(['food_1'])
    expect(() => validateBackup({ ...withMenu, menus: [{ ...withMenu.menus[0], ingredients: [{ kind: 'food', itemId: 'food_1', amount: 0, unit: 'g' }] }] })).toThrow()
    expect(() => validateBackup({ ...withMenu, menus: [
      { ...withMenu.menus[0], ingredients: [{ kind: 'menu', itemId: 'menu_2', amount: 1, unit: '食' }] },
      { ...withMenu.menus[1], ingredients: [{ kind: 'menu', itemId: 'menu_1', amount: 1, unit: '食' }] },
    ] })).toThrow('循環')
  })

  it('検索ログと利用統計を含むバックアップを検証できる', () => {
    const withSearchData: BackupData = {
      ...backup,
      foodGroups: [{ id: 'group_1', displayName: '食品', reading: null, category: null, representativeScore: 0, defaultVariantId: null, isActive: true, metadataSource: 'manual', generationVersion: 'test', needsReview: false, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
      foodAliases: [{ id: 'alias_1', foodGroupId: 'group_1', foodVariantId: null, alias: 'しょくひん', normalizedAlias: 'しょくひん', aliasType: 'reading', priority: 100, isActive: true, metadataSource: 'manual' }],
      foodRelatedTerms: [{ id: 'related_1', foodGroupId: 'group_1', term: '食材', normalizedTerm: '食材', weight: 0.5, isActive: true, metadataSource: 'manual' }],
      foodUsageStats: [{ foodId: 'food_1', selectionCount: 2, lastSelectedAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
      searchLogs: [{ id: 'search_1', createdAt: '2026-07-15T00:00:00.000Z', query: '食品', normalizedQuery: '食品', resultCount: 1, processingMs: 1, items: [], selectedFoodGroupId: 'group_1', selectedFoodVariantId: 'food_1', selectedRank: 1, selectionElapsedMs: 2, unselected: false }],
    }
    expect(validateBackup(withSearchData).searchLogs?.[0].selectedFoodVariantId).toBe('food_1')
  })
})
