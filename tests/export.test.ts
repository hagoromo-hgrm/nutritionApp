import { describe, expect, it } from 'vitest'
import { validateBackup } from '../src/services/backup'
import { CSV_HEADERS, mealsToCsv, parseMealsCsv } from '../src/services/csv'
import type { BackupData, MealEntry } from '../src/types'

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

  it('列が欠けたCSVは取り込まない', () => {
    expect(() => parseMealsCsv('\uFEFFid,date\r\nmeal_1,2026-07-15\r\n')).toThrow('列名と順序')
  })

  it('不正なバックアップは取り込まない', () => {
    expect(validateBackup(backup)).toEqual(backup)
    expect(() => validateBackup({ ...backup, dataFormatVersion: 99 })).toThrow('対応していない')
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, goals: { energyKcal: 'bad' } } })).toThrow()
  })

  it('食品属性設定を含むバックアップを検証し、不正な型を拒否する', () => {
    const withPreferences = { ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 'raw', mode: 'auto' }, unknown_attribute: { defaultValueId: 'value', mode: 'prefill' } } } } }
    expect(validateBackup(withPreferences).settings.foodAttributePreferences?.group_a.cooking_state.mode).toBe('auto')
    const legacy = { ...backup, settings: { ...backup.settings, foodAttributePreferences: { cooking_state: { defaultValueId: 'raw', mode: 'auto' } } } }
    expect(validateBackup(legacy).settings.foodAttributePreferences?.cooking_state.mode).toBe('auto')
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 1, mode: 'auto' } } } } })).toThrow()
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, foodAttributePreferences: { group_a: { cooking_state: { defaultValueId: 'raw', mode: 'hidden' } } } } })).toThrow()
  })

  it('メニューを含むバックアップを検証できる', () => {
    const withMenu = {
      ...backup,
      menus: [
        { id: 'menu_1', name: '朝ごはん', category: '主食', foodIds: ['food_1'], aliases: ['朝食'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
        { id: 'menu_2', name: 'おやつ', category: 'お菓子・スイーツ', foodIds: ['food_1'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
      ],
      menuSets: [{ id: 'set_1', name: '平日セット', menuIds: ['menu_1'], foodIds: ['food_1'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
    }
    expect(validateBackup(withMenu).menus?.[0].name).toBe('朝ごはん')
    expect(validateBackup(withMenu).menus?.[0].aliases).toEqual(['朝食'])
    expect(validateBackup(withMenu).menus?.[1].category).toBe('お菓子・スイーツ')
    expect(validateBackup(withMenu).menuSets?.[0].menuIds).toEqual(['menu_1'])
    expect(validateBackup(withMenu).menuSets?.[0].foodIds).toEqual(['food_1'])
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
