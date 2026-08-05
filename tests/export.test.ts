import { describe, expect, it } from 'vitest'
import { backupToJson, parseBackupText, validateBackup } from '../src/services/backup'
import { CSV_HEADERS, LEGACY_CSV_HEADERS, PREVIOUS_CSV_HEADERS, SORTED_CSV_HEADERS, USER_FACING_CSV_HEADERS, mealsToCsv, parseMealsCsv } from '../src/services/csv'
import { createEstimationRequest } from '../src/services/nutrientEstimationStore'
import { estimateNutrients, toStoredNutrientEstimateResult } from '../src/services/nutrientEstimator'
import { DEFAULT_ESTIMATION_SETTINGS } from '../src/types'
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

  it('v3バックアップは体重履歴を検証し、JSON roundtripできる', () => {
    const weightRecord = { id: 'weight_1', recordedAt: '2026-08-04T15:00:00.000Z', date: '2026-08-05', weightKg: 65.4 }
    const v3: BackupData = {
      ...backup,
      dataFormatVersion: 3,
      settings: { ...backup.settings, dataFormatVersion: 3 },
      weightRecords: [weightRecord],
      estimationDataFormatVersion: 1,
      estimationSettings: { ...DEFAULT_ESTIMATION_SETTINGS, updatedAt: '2026-07-15T00:00:00.000Z' },
      estimationRequests: [], estimationResults: [], estimationDecisions: [],
    }
    expect(parseBackupText(backupToJson(v3)).weightRecords).toEqual([weightRecord])
    expect(() => validateBackup({ ...v3, weightRecords: [{ ...weightRecord, date: '2026-08-04' }] })).toThrow('体重履歴')
    expect(() => validateBackup({ ...v3, weightRecords: [weightRecord, weightRecord] })).toThrow('重複')
    expect(() => validateBackup({ ...v3, weightRecords: [{ ...weightRecord, weightKg: Number.NaN }] })).toThrow('体重履歴')
    expect(() => validateBackup({ ...v3, weightRecords: undefined })).toThrow('体重履歴')
  })

  it('このPWAで出力したCSVから食事スナップショットを復元できる', () => {
    const orderedEntry = {
      ...entry,
      sortOrder: 3,
      foodSnapshot: { ...entry.foodSnapshot, userFacingName: 'ご飯' },
    }
    const restored = parseMealsCsv(mealsToCsv([orderedEntry]))
    expect(restored).toEqual([orderedEntry])
  })

  it('CSVのメニュースナップショットで一般・一時メニューの由来を保持する', () => {
    for (const sourceKind of ['general-menu', 'temporary'] as const) {
      const sourceEntry: MealEntry = { ...menuEntry, menuSnapshot: { ...menuEntry.menuSnapshot!, sourceKind } }
      expect(parseMealsCsv(mealsToCsv([sourceEntry]))[0].menuSnapshot?.sourceKind).toBe(sourceKind)
    }
    expect(parseMealsCsv(mealsToCsv([menuEntry]))[0].menuSnapshot?.sourceKind).toBeUndefined()
  })

  it('推計由来メタデータを既定列の後ろに追加してCSVで移送する', () => {
    const estimatedEntry: MealEntry = {
      ...entry,
      foodSnapshot: {
        ...entry.foodSnapshot,
        nutrientMetadata: {
          fiberG: {
            origin: 'estimated',
            source: '文部科学省 日本食品標準成分表',
            confidence: 'medium',
            estimatedRange: { min: 1, max: 2 },
            method: 'browser_ingredient_rule',
            modelVersion: 'browser-rule-0.1.0',
            sourceFoodIds: ['mext_01015'],
            requestId: 'estimate_1',
            adoptedAt: '2026-07-15T00:00:00.000Z',
          },
        },
      },
    }
    const csv = mealsToCsv([estimatedEntry])
    expect(CSV_HEADERS.at(-1)).toBe('food_snapshot_nutrient_metadata_json')
    expect(parseMealsCsv(csv)).toEqual([estimatedEntry])
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

  it('カスタム入力単位の換算情報をJSONと新CSVへ保持する', () => {
    const customEntry: MealEntry = {
      ...entry,
      amount: 2,
      amountUnit: '個',
      foodSnapshot: { ...entry.foodSnapshot, inputUnitConversions: [{ unit: '個', baseAmount: 60 }] },
    }
    const validated = validateBackup({ ...backup, mealEntries: [customEntry] })
    expect(validated.mealEntries[0].foodSnapshot.inputUnitConversions).toEqual([{ unit: '個', baseAmount: 60 }])
    const csv = mealsToCsv([customEntry])
    expect(csv).toContain('food_snapshot_input_unit_conversions_json')
    expect(parseMealsCsv(csv)).toEqual([customEntry])
  })

  it('換算列のない旧CSVヘッダーも取り込める', () => {
    const legacyEntry: MealEntry = { ...entry, foodSnapshot: { ...entry.foodSnapshot, name: '米' } }
    const modernRows = mealsToCsv([legacyEntry]).replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    const modernHeaders = modernRows[0].split(',')
    const modernValues = modernRows[1].split(',')
    const legacyIndexes = LEGACY_CSV_HEADERS.map((header) => modernHeaders.indexOf(header))
    const legacyCsv = `\uFEFF${LEGACY_CSV_HEADERS.join(',')}\r\n${legacyIndexes.map((index) => modernValues[index]).join(',')}\r\n`
    expect(parseMealsCsv(legacyCsv)).toEqual([legacyEntry])
  })

  it('表示順列を追加する前のCSVも取り込める', () => {
    const previousEntry: MealEntry = { ...entry, foodSnapshot: { ...entry.foodSnapshot, name: '米', maker: '' } }
    const modernRows = mealsToCsv([previousEntry]).replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    const modernHeaders = modernRows[0].split(',')
    const modernValues = modernRows[1].split(',')
    const previousIndexes = PREVIOUS_CSV_HEADERS.map((header) => modernHeaders.indexOf(header))
    const previousCsv = `\uFEFF${PREVIOUS_CSV_HEADERS.join(',')}\r\n${previousIndexes.map((index) => modernValues[index]).join(',')}\r\n`
    expect(parseMealsCsv(previousCsv)).toEqual([previousEntry])
  })

  it('一般名列を追加する前のCSVも取り込める', () => {
    const sortedEntry: MealEntry = { ...entry, sortOrder: 2, foodSnapshot: { ...entry.foodSnapshot, name: '米', maker: '' } }
    const modernRows = mealsToCsv([sortedEntry]).replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    const modernHeaders = modernRows[0].split(',')
    const modernValues = modernRows[1].split(',')
    const sortedIndexes = SORTED_CSV_HEADERS.map((header) => modernHeaders.indexOf(header))
    const sortedCsv = `\uFEFF${SORTED_CSV_HEADERS.join(',')}\r\n${sortedIndexes.map((index) => modernValues[index]).join(',')}\r\n`
    expect(parseMealsCsv(sortedCsv)).toEqual([sortedEntry])
  })

  it('推計由来列を追加する前のCSVも取り込める', () => {
    const previousCurrentEntry: MealEntry = { ...entry, sortOrder: 2, foodSnapshot: { ...entry.foodSnapshot, name: '米', maker: '', userFacingName: 'ご飯' } }
    const modernRows = mealsToCsv([previousCurrentEntry]).replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    const modernHeaders = modernRows[0].split(',')
    const modernValues = modernRows[1].split(',')
    const indexes = USER_FACING_CSV_HEADERS.map((header) => modernHeaders.indexOf(header))
    const csv = `\uFEFF${USER_FACING_CSV_HEADERS.join(',')}\r\n${indexes.map((index) => modernValues[index]).join(',')}\r\n`
    expect(parseMealsCsv(csv)).toEqual([previousCurrentEntry])
  })

  it('CSVの表示順は非負整数だけを受け入れる', () => {
    const csv = mealsToCsv([{ ...entry, sortOrder: 0 }])
    const invalid = csv.replace(/,0,,\r\n$/, ',-1,,\r\n')
    expect(() => parseMealsCsv(invalid)).toThrow('表示順')
  })

  it('列が欠けたCSVは取り込まない', () => {
    expect(() => parseMealsCsv('\uFEFFid,date\r\nmeal_1,2026-07-15\r\n')).toThrow('列名と順序')
  })

  it('CSV内で重複した食事IDを拒否する', () => {
    const csv = mealsToCsv([entry, entry])
    expect(() => parseMealsCsv(csv)).toThrow('IDが重複')
  })

  it('不正なバックアップは取り込まない', () => {
    expect(validateBackup(backup)).toEqual(backup)
    expect(() => validateBackup({ ...backup, dataFormatVersion: 99 })).toThrow('対応していない')
    expect(() => validateBackup({ ...backup, settings: { ...backup.settings, goals: { energyKcal: 'bad' } } })).toThrow()
    expect(() => validateBackup({ ...backup, exportedAt: '2026-02-30' })).toThrow('必須項目')
    expect(() => validateBackup({ ...backup, mealEntries: [{ ...entry, id: '' }] })).toThrow('形式が不正')
    expect(() => validateBackup({ ...backup, mealEntries: [entry, entry] })).toThrow('重複したID')
    expect(() => validateBackup({ ...backup, mealEntries: [{ ...entry, amountUnit: 'ml' }] })).toThrow('形式が不正')
    expect(() => validateBackup({ ...backup, foods: [{ ...classifiedFood, servingAmount: -1, servingUnit: '食' }] })).toThrow('形式が不正')
    expect(() => validateBackup({ ...backup, foods: [{ ...classifiedFood, nutrients: { ...classifiedFood.nutrients, energyKcal: Number.POSITIVE_INFINITY } }] })).toThrow('形式が不正')
    expect(() => validateBackup({ ...backup, foods: [{ ...classifiedFood, estimatorGenreId: 'bread' }] })).toThrow('形式が不正')
  })

  it('お気に入りの任意sortOrderを保持し、重複や混在した順序を拒否する', () => {
    const favorite = { foodId: 'food_1', createdAt: '2026-07-15T00:00:00.000Z', sortOrder: 0 }
    expect(validateBackup({ ...backup, favorites: [favorite] }).favorites[0]).toEqual(favorite)
    expect(validateBackup({ ...backup, favorites: [{ foodId: 'food_1', createdAt: favorite.createdAt }, { foodId: 'food_2', createdAt: favorite.createdAt }] }).favorites).toHaveLength(2)
    expect(() => validateBackup({ ...backup, favorites: [favorite, { ...favorite, foodId: 'food_2' }] })).toThrow('重複')
    expect(() => validateBackup({ ...backup, favorites: [favorite, { foodId: 'food_2', createdAt: favorite.createdAt }] })).toThrow('並び順')
    expect(() => validateBackup({ ...backup, favorites: [{ ...favorite, sortOrder: -1 }] })).toThrow('お気に入り')
  })

  it('v2バックアップは推計設定と履歴ストアを含めて検証し、v1も引き続き読み込める', () => {
    const estimatedAt = '2026-07-25T00:00:00.000Z'
    const traceFood: Food = {
      ...classifiedFood,
      id: 'trace_food',
      name: '砂糖菓子',
      baseAmount: 100,
      baseUnit: 'g',
      nutrients: {
        ...classifiedFood.nutrients,
        energyKcal: 363,
        proteinG: 5.5,
        fatG: 1,
        carbohydrateG: 83.6,
        saltG: 0,
      },
      ingredientsText: '薄力粉、砂糖',
      ingredientsSource: { provider: 'パッケージ表示', verified: true },
      updatedAt: estimatedAt,
    }
    const estimationRequest = createEstimationRequest(traceFood, {
      requestId: 'trace_request',
      status: 'completed',
      now: estimatedAt,
    })
    const browserResult = estimateNutrients({
      requestId: estimationRequest.requestId,
      productName: traceFood.name,
      estimatorGenreId: 'prepared_meal',
      baseAmount: traceFood.baseAmount,
      baseUnit: traceFood.baseUnit,
      referenceMassG: 100,
      referenceMassSource: '基準単位がg',
      ingredientsText: traceFood.ingredientsText ?? null,
      ingredientsSource: traceFood.ingredientsSource ?? null,
      knownNutrients: {
        energyKcal: 363,
        proteinG: 5.5,
        fatG: 1,
        carbohydrateG: 83.6,
        saltG: 0,
      },
      requestedNutrients: ['fiberG', 'saturatedFatG'],
      requestedAt: estimatedAt,
    }, { feedbackWeight: 0.2, postBlendWeight: 0.75 })
    const estimationResult = toStoredNutrientEstimateResult(browserResult, {
      foodId: traceFood.id,
      inputHash: estimationRequest.inputHash,
      baseAmount: traceFood.baseAmount,
      baseUnit: traceFood.baseUnit,
    })
    const v2 = {
      ...backup,
      dataFormatVersion: 2,
      foods: [traceFood],
      settings: { ...backup.settings, dataFormatVersion: 2 },
      estimationDataFormatVersion: 1,
      estimationSettings: { id: 'default' as const, enabled: false, trigger: 'manual' as const, applyMode: 'manual' as const, minimumConfidenceForSuggestion: 'low' as const, updatedAt: '2026-07-25T00:00:00.000Z' },
      estimationRequests: [estimationRequest], estimationResults: [estimationResult], estimationDecisions: [],
    }
    expect(validateBackup(v2).estimationSettings?.applyMode).toBe('manual')
    expect(validateBackup(v2).estimationResults?.[0].optimization?.trace).toEqual(estimationResult.optimization?.trace)
    expect(estimationResult.optimization?.trace?.ratioFeedback).toMatchObject({
      feedbackWeight: 0.2,
      pooledSampleSize: 113,
      scope: 'pooled_nutrient',
    })
    expect(validateBackup(v2).estimationResults?.[0].estimates.saturatedFatG?.ratioAdjustment)
      .toEqual(estimationResult.estimates.saturatedFatG?.ratioAdjustment)
    expect(estimationResult.estimates.saturatedFatG?.ratioAdjustment).toMatchObject({
      sampleSize: 0,
      pooledSampleSize: 113,
      scope: 'pooled_nutrient',
    })
    expect(() => validateBackup({ ...v2, estimationSettings: { ...v2.estimationSettings, applyMode: 'automatic' } })).toThrow('推計関連データ')
    expect(() => validateBackup({
      ...v2,
      estimationResults: [{
        ...estimationResult,
        optimization: {
          ...estimationResult.optimization!,
          trace: {
            ...estimationResult.optimization!.trace!,
            unresolvedMassRatio: 2,
          },
        },
      }],
    })).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup({
      ...v2,
      estimationResults: [{
        ...estimationResult,
        optimization: {
          ...estimationResult.optimization!,
          trace: {
            ...estimationResult.optimization!.trace!,
            ratioFeedback: {
              ...estimationResult.optimization!.trace!.ratioFeedback!,
              penalty: -1,
            },
          },
        },
      }],
    })).toThrow('推計要求、結果または採用履歴')
    expect(() => validateBackup({
      ...v2,
      estimationResults: [{
        ...estimationResult,
        estimates: {
          ...estimationResult.estimates,
          saturatedFatG: {
            ...estimationResult.estimates.saturatedFatG!,
            ratioAdjustment: {
              ...estimationResult.estimates.saturatedFatG!.ratioAdjustment!,
              p95: 2,
            },
          },
        },
      }],
    })).toThrow('推計要求、結果または採用履歴')
    expect(validateBackup(backup).dataFormatVersion).toBe(1)
  })

  it('外食・市販の明示フラグを保持し、旧形式との互換性も維持する', () => {
    expect(validateBackup({ ...backup, foods: [classifiedFood] }).foods[0].isCommercial).toBe(true)
    expect(validateBackup({ ...backup, foods: [{ ...classifiedFood, source: 'imported' }] }).foods[0].source).toBe('imported')
    expect(validateBackup({ ...backup, foods: [{ ...classifiedFood, createdAt: '2026-07-22T14:08:34.475979Z' }] }).foods[0].createdAt).toBe('2026-07-22T14:08:34.475979Z')
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
      foods: [{ ...classifiedFood, id: 'food_1', name: '白ごはん', baseAmount: 100, baseUnit: 'g' as const }],
      menus: [
        { id: 'menu_1', name: '朝ごはん', category: '主食', foodIds: ['food_1'], ingredients: [{ kind: 'food', itemId: 'food_1', amount: 150, unit: 'g' }], aliases: ['朝食'], memo: '平日の定番。前日に準備する。', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
        { id: 'menu_2', name: 'おやつ', category: 'お菓子・スイーツ', foodIds: [], ingredients: [{ kind: 'menu', itemId: 'menu_1', amount: 0.5, unit: '食' }], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
      ],
      generalMenus: [{ id: 'general_1', name: '一般朝食', category: '主食', foodIds: ['food_1'], ingredients: [{ kind: 'food', itemId: 'food_1', amount: 120, unit: 'g' }], aliases: ['簡単朝食'], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
      menuSets: [{ id: 'set_1', name: '平日セット', menuIds: ['menu_1'], generalMenuIds: ['general_1'], foodIds: ['food_1'], foodItems: [{ foodId: 'food_1', amount: 150, unit: 'g' }], createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' }],
    }
    expect(validateBackup(withMenu).menus?.[0].name).toBe('朝ごはん')
    expect(validateBackup(withMenu).menus?.[0].aliases).toEqual(['朝食'])
    expect(validateBackup(withMenu).menus?.[0].memo).toBe('平日の定番。前日に準備する。')
    expect(validateBackup(withMenu).menus?.[0].ingredients?.[0].amount).toBe(150)
    expect(validateBackup(withMenu).menus?.[1].ingredients?.[0].kind).toBe('menu')
    expect(validateBackup(withMenu).menus?.[1].category).toBe('お菓子・スイーツ')
    expect(validateBackup(withMenu).generalMenus?.[0].aliases).toEqual(['簡単朝食'])
    expect(validateBackup(withMenu).menuSets?.[0].menuIds).toEqual(['menu_1'])
    expect(validateBackup(withMenu).menuSets?.[0].generalMenuIds).toEqual(['general_1'])
    expect(validateBackup(withMenu).menuSets?.[0].foodIds).toEqual(['food_1'])
    expect(validateBackup(withMenu).menuSets?.[0].foodItems?.[0]).toMatchObject({ foodId: 'food_1', amount: 150, unit: 'g' })
    expect(() => validateBackup({ ...withMenu, menuSets: [{ ...withMenu.menuSets[0], foodItems: [{ foodId: 'food_1', amount: 1, unit: '食' }] }] })).toThrow('換算設定')
    expect(() => validateBackup({ ...withMenu, menus: [{ ...withMenu.menus[0], ingredients: [{ kind: 'food', itemId: 'food_1', amount: 0, unit: 'g' }] }] })).toThrow()
    expect(() => validateBackup({ ...withMenu, menus: [
      { ...withMenu.menus[0], ingredients: [{ kind: 'menu', itemId: 'menu_2', amount: 1, unit: '食' }] },
      { ...withMenu.menus[1], ingredients: [{ kind: 'menu', itemId: 'menu_1', amount: 1, unit: '食' }] },
    ] })).toThrow('循環')
    expect(() => validateBackup({ ...withMenu, menus: [{ ...withMenu.menus[0], memo: 123 }] })).toThrow('メニューまたはメニューセットの形式が不正')
  })

  it('バックアップ内の料理メニューで未登録の入力単位を拒否する', () => {
    const customFood: Food = {
      ...classifiedFood,
      id: 'bread',
      name: '食パン',
      baseAmount: 100,
      baseUnit: 'g',
      inputUnitConversions: [{ unit: '切れ', baseAmount: 40 }],
    }
    const menu = {
      id: 'menu_1', name: '朝食', category: '主食' as const, foodIds: ['bread'],
      ingredients: [{ kind: 'food' as const, itemId: 'bread', amount: 2, unit: '切れ' }],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    expect(validateBackup({ ...backup, foods: [customFood], menus: [menu] }).menus?.[0].ingredients?.[0].unit).toBe('切れ')
    expect(() => validateBackup({
      ...backup,
      foods: [customFood],
      menus: [{ ...menu, ingredients: [{ ...menu.ingredients[0], unit: 'パック' }] }],
    })).toThrow('換算設定と一致しない')
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
