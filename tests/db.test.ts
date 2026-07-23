import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, deleteFood, deleteMenu, exportBackup, getEntriesForDate, getFoodByBarcode, getRecentFoods, getSettings, initializeDatabase, recordFoodSelection, reorderMealEntries, replaceAllData, saveFood, saveFoodWithMetadata, saveMealEntries, saveMealEntry, saveMenu, searchFoodResults, searchMenus } from '../src/db/db'
import { validateBackup } from '../src/services/backup'
import { getFoodVariantBySourceId, hasFoodGroup as hasMextFoodGroup } from '../src/services/mextFoodData'
import type { BackupData, Food, FoodAlias, FoodGroup, FoodRelatedTerm, MealEntry, Menu } from '../src/types'

const addedNutrients = { calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }

const userFood: Food = {
  id: 'user_food', name: 'テスト食品', maker: '', barcode: '', source: 'user', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g',
  servingAmount: null, servingUnit: null, nutrients: { energyKcal: 100, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0, ...addedNutrients }, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeDatabase()
})

describe('IndexedDB data safety', () => {
  it('初期食品は食品ごとの基準単位を持つ', async () => {
    const rice = await db.foods.get('mext_01088')
    const egg = await db.foods.get('mext_12004')
    const banana = await db.foods.get('mext_07107')
    const tofu = await db.foods.get('mext_04032')
    expect(rice?.baseUnit).toBe('合')
    expect(egg?.baseUnit).toBe('個')
    expect(banana?.baseUnit).toBe('本')
    expect(tofu?.baseUnit).toBe('丁')
  })

  it('MEXTの収集済み食品を初期データとして検索できる', async () => {
    expect(await db.foods.count()).toBe(2682)
    expect(await db.foods.where('source').equals('mext').count()).toBe(2538)
    expect(await db.foodGroups.count()).toBe(1638)
    const amaranth = await db.foods.get('mext_01001')
    expect(amaranth?.baseUnit).toBe('g')
    expect(amaranth?.nutrients.calciumMg).toBe(160)
    expect(amaranth?.nutrients.saturatedFatG).toBe(1.18)
    expect(amaranth?.sourceVersion).toContain('増補2023年')
    expect((await db.foods.get('mext_01088'))?.nutrients.saturatedFatG).toBe(0.15)
    expect((await db.foods.get('mext_12004'))?.nutrients.saturatedFatG).toBe(1.56)
    expect((await db.foods.get('mext_12014'))?.nutrients.saturatedFatG).toBeNull()
    const foods = await db.foods.toArray()
    const egg = foods.find((food) => food.name.includes('鶏卵'))
    const rice = foods.find((food) => food.name.includes('水稲めし'))
    const seasoning = foods.find((food) => food.id === 'mext_17001')
    expect(egg?.baseUnit).toBe('個')
    expect(rice?.baseUnit).toBe('合')
    expect(seasoning?.baseAmount).toBe(1)
    expect(seasoning?.baseUnit).toBe('小さじ')
    expect(seasoning?.name).toContain('（小さじ1=')
    expect(foods.filter((food) => food.source === 'mext').some((food) => /^(＜|（|\()/.test(food.name))).toBe(false)
    expect((await db.foodGroups.toArray()).filter((group) => group.generationVersion === 'mext-app-v2')).toHaveLength(1494)
    expect(await db.foodAliases.where('normalizedAlias').equals('塩').count()).toBe(0)
    expect(await db.foods.get('mext_chicken_breast')).toBeUndefined()
  })

  it('検証済みのimported食品だけを外食・市販として初期投入する', async () => {
    expect(await db.foods.where('source').equals('imported').count()).toBe(144)
    const famichiki = await db.foods.get('imported:9e784b46d56a4071')
    if (!famichiki) throw new Error('imported食品が初期投入されていません')
    expect(famichiki?.name).toBe('ファミチキ')
    expect(famichiki?.maker).toBe('ファミリーマート')
    expect(famichiki?.isCommercial).toBe(true)
    expect(famichiki.foodGroupId).toBe(`food:${famichiki.id}`)
    expect(famichiki?.inputUnitConversions).toEqual([])

    const packagedBread = await db.foods.get('imported:fbd962b175e449ca')
    expect(packagedBread?.baseUnit).toBe('その他')
    expect(packagedBread?.servingUnit).toBe('包装')
    expect(packagedBread?.inputUnitConversions).toEqual([{ unit: '包装', baseAmount: 1 }])
    expect(await db.foods.get('imported:c93d4aba6bcd99bf')).toBeUndefined()

    const searched = await searchFoodResults('ファミリーマート', { category: 'commercial' })
    expect(searched.page.results.some((result) => result.food.id === famichiki?.id)).toBe(true)
    expect(validateBackup(await exportBackup()).foods.filter((food) => food.source === 'imported')).toHaveLength(144)
  })

  it('食品グループをリセット状態で初期化する', async () => {
    const azukiAn = await db.foods.get('mext_04004')
    const azukiCanned = await db.foods.get('mext_04003')
    expect(azukiAn?.foodGroupId).toBe(getFoodVariantBySourceId('mext_04004')?.foodGroupId)
    expect(azukiCanned?.foodGroupId).toBe(getFoodVariantBySourceId('mext_04003')?.foodGroupId)
    expect(azukiAn?.foodGroupId).not.toBe(azukiCanned?.foodGroupId)
    expect((await db.foodGroups.get(azukiAn?.foodGroupId ?? ''))?.needsReview).toBe(false)
  })

  it('リセット時に手動familyを保持し、旧生成メタデータを整理する', async () => {
    const now = '2026-07-20T00:00:00.000Z'
    const manualGroup: FoodGroup = { id: 'manual:keep', displayName: '手動family', reading: null, category: 'その他', representativeScore: 0, defaultVariantId: 'manual_keep_food', isActive: true, metadataSource: 'manual', generationVersion: 'manual-v1', needsReview: false, createdAt: now, updatedAt: now }
    const manualFood: Food = { ...userFood, id: 'manual_keep_food', name: '手動食品', displayName: '手動family', foodGroupId: manualGroup.id, createdAt: now, updatedAt: now }
    await saveFoodWithMetadata(manualFood, { group: manualGroup, aliases: [], relatedTerms: [] })

    const legacyFood: Food = { ...userFood, id: 'legacy_group_food', name: '旧分類食品', foodGroupId: 'llm:old', createdAt: now, updatedAt: now }
    const legacyGroup: FoodGroup = { id: 'llm:old', displayName: '旧family', reading: null, category: null, representativeScore: 0, defaultVariantId: legacyFood.id, isActive: true, metadataSource: 'llm', generationVersion: 'llm-review-v1', needsReview: false, createdAt: now, updatedAt: now }
    const legacyAlias: FoodAlias = { id: 'alias:llm:old:0', foodGroupId: legacyGroup.id, foodVariantId: null, alias: '旧検索語', normalizedAlias: '旧検索語', aliasType: 'synonym', priority: 50, isActive: true, metadataSource: 'manual' }
    const legacyRelated: FoodRelatedTerm = { id: 'related:llm:old:0', foodGroupId: legacyGroup.id, term: '旧関連語', normalizedTerm: '旧関連語', weight: 0.5, isActive: true, metadataSource: 'manual' }
    await db.foods.put(legacyFood)
    await db.foodGroups.put(legacyGroup)
    await db.foodAliases.put(legacyAlias)
    await db.foodRelatedTerms.put(legacyRelated)
    await db.metadata.put({ key: 'search-metadata-version', value: 6 })

    await initializeDatabase()

    expect((await db.foods.get(manualFood.id))?.foodGroupId).toBe(manualGroup.id)
    expect(await db.foodGroups.get(manualGroup.id)).toBeDefined()
    expect((await db.foods.get(legacyFood.id))?.foodGroupId).toBe(`food:${legacyFood.id}`)
    expect(await db.foodGroups.get(legacyGroup.id)).toBeUndefined()
    expect(await db.foodAliases.get(legacyAlias.id)).toBeUndefined()
    expect(await db.foodRelatedTerms.get(legacyRelated.id)).toBeUndefined()
  }, 30000)

  it('旧初期サンプルを更新時に削除する', async () => {
    const legacySample: Food = {
      ...userFood,
      id: 'mext_chicken_breast',
      name: '若鶏むね肉（皮なし）',
      source: 'mext',
      sourceVersion: '日本食品標準成分表（八訂）増補2023年・初期サンプル v3',
    }
    await db.foods.put(legacySample)
    await db.metadata.put({ key: 'initial-foods-version', value: 7 })

    await initializeDatabase()

    expect(await db.foods.get(legacySample.id)).toBeUndefined()
    expect(await db.foods.count()).toBe(2682)
    expect(await db.foodGroups.count()).toBe(1638)
  }, 30000)

  it('公式MEXT familyへ追加した手動食品を再初期化後も保持する', async () => {
    const group = await db.foodGroups.where('displayName').equals('鶏むね肉').first()
    if (!group) throw new Error('鶏むね肉グループがありません')
    const now = '2026-07-20T00:00:00.000Z'
    const manualFood: Food = {
      ...userFood,
      id: 'manual_mext_family_food',
      name: '自家製鶏むね肉',
      officialName: '自家製鶏むね肉',
      displayName: group.displayName,
      foodGroupId: group.id,
      createdAt: now,
      updatedAt: now,
    }
    await saveFoodWithMetadata(manualFood, { group: { ...group, updatedAt: now }, aliases: [], relatedTerms: [] })

    await initializeDatabase()
    await initializeDatabase()

    expect((await db.foods.get(manualFood.id))?.foodGroupId).toBe(group.id)
    expect((await db.foodGroups.get(group.id))?.generationVersion).toBe('mext-app-v2')
    const result = (await searchFoodResults(manualFood.name)).page.results.find((item) => item.group.id === group.id)
    expect(result?.variants.some((food) => food.id === manualFood.id)).toBe(true)
    expect(result?.variants).toHaveLength(8)
  }, 25000)

  it('食品グループ単位の関連度検索と個人利用統計を保存できる', async () => {
    const searched = await searchFoodResults('塩')
    expect(searched.page.results.length).toBeGreaterThan(0)
    expect(hasMextFoodGroup(searched.page.results[0].group.id)).toBe(true)
    expect(searched.page.results[0].variants.length).toBeGreaterThan(0)
    await recordFoodSelection(searched.logId, searched.page.results[0].group.id, searched.page.results[0].food.id, 1)
    expect((await db.foodUsageStats.get(searched.page.results[0].food.id))?.selectionCount).toBe(1)
    const backup = await exportBackup()
    expect(backup.foodGroups?.filter((group) => group.generationVersion === 'mext-app-v2')).toHaveLength(1494)
    expect(backup.searchLogs?.[0].selectedFoodGroupId).toBe(searched.page.results[0].group.id)
    expect(backup.foodUsageStats?.[0].foodId).toBe(searched.page.results[0].food.id)
  })

  it('食品削除時も食事記録とスナップショットを残す', async () => {
    await saveFood(userFood)
    const entry: MealEntry = {
      id: 'meal_test', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: userFood.name, maker: userFood.maker, barcode: userFood.barcode, baseAmount: userFood.baseAmount, baseUnit: userFood.baseUnit, nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { energyKcal: 50, proteinG: 0.5, fatG: 0.5, carbohydrateG: 0.5, fiberG: 0.5, saltG: 0, ...addedNutrients },
    }
    await saveMealEntry(entry)
    await deleteFood(userFood.id)
    const entries = await getEntriesForDate('2026-07-15')
    expect(entries).toHaveLength(1)
    expect(entries[0].foodSnapshot.name).toBe('テスト食品')
    expect(await db.foods.get(userFood.id)).toBeUndefined()
  })

  it('最近使った食品は削除済み食品や料理メニューを除外して指定件数を返す', async () => {
    const secondFood: Food = { ...userFood, id: 'user_food_2', name: 'テスト食品2' }
    await saveFood(userFood)
    await saveFood(secondFood)
    const meal = (id: string, foodId: string, name: string, eatenAt: string): MealEntry => ({
      id, eatenAt, mealType: '朝食', foodId,
      foodSnapshot: { name, maker: '', barcode: '', baseAmount: 100, baseUnit: 'g', nutrients: { ...userFood.nutrients } },
      amount: 100, amountUnit: 'g', calculatedNutrients: { ...userFood.nutrients },
    })
    await saveMealEntries([
      meal('meal_old', userFood.id, userFood.name, '2026-07-15T00:00:00.000Z'),
      meal('meal_middle', secondFood.id, secondFood.name, '2026-07-16T00:00:00.000Z'),
      meal('meal_new', 'menu:deleted', '削除済み料理', '2026-07-17T00:00:00.000Z'),
    ])

    expect((await getRecentFoods(2)).map((food) => food.id)).toEqual([secondFood.id, userFood.id])
  })

  it('手動食品のfamily・別名・属性を一括保存して検索できる', async () => {
    const now = '2026-07-15T00:00:00.000Z'
    const manualFood: Food = { ...userFood, id: 'manual_metadata_food', name: '自家製鶏肉', displayName: '鶏肉', foodGroupId: 'manual:chicken', variantAttributes: { species: '鶏', part: 'もも', skin: '皮なし', preparation: '焼き' }, createdAt: now, updatedAt: now }
    const group: FoodGroup = { id: 'manual:chicken', displayName: '鶏肉', reading: 'とりにく', category: '主菜', representativeScore: 0, defaultVariantId: manualFood.id, isActive: true, metadataSource: 'manual', generationVersion: 'manual-v1', needsReview: false, createdAt: now, updatedAt: now }
    const alias: FoodAlias = { id: 'manual:alias:chicken', foodGroupId: group.id, foodVariantId: null, alias: 'とり', normalizedAlias: 'とり', aliasType: 'synonym', priority: 80, isActive: true, metadataSource: 'manual' }
    const related: FoodRelatedTerm = { id: 'manual:related:chicken', foodGroupId: group.id, term: '炭火串焼き', normalizedTerm: '炭火串焼き', weight: 0.5, isActive: true, metadataSource: 'manual' }
    await saveFoodWithMetadata(manualFood, { group, aliases: [alias], relatedTerms: [related] })
    expect((await db.foods.get(manualFood.id))?.foodGroupId).toBe(group.id)
    expect((await searchFoodResults('とり')).page.results[0]?.group.displayName).toBe('鶏肉')
    expect((await searchFoodResults('炭火串焼き')).page.results[0]?.group.displayName).toBe('鶏肉')
  })

  it('バーコード食品の名前・メーカー・分類フラグを保存し、再読取と検索で端末内記録を優先する', async () => {
    const barcode = '0012345678901'
    const now = '2026-07-15T00:00:00.000Z'
    const food: Food = {
      ...userFood,
      id: 'barcode_saved_food', name: 'ユーザー入力商品', officialName: 'ユーザー入力商品', displayName: 'ユーザー入力商品',
      maker: '保存メーカー', barcode, isCommercial: true, source: 'open_food_facts', sourceVersion: 'Open Food Facts（取得値は確認後に保存）',
      foodGroupId: 'food:barcode_saved_food', createdAt: now, updatedAt: now,
    }
    const group: FoodGroup = {
      id: food.foodGroupId ?? `food:${food.id}`, displayName: food.name, reading: null, category: null,
      representativeScore: 0, defaultVariantId: food.id, isActive: true, metadataSource: 'manual', generationVersion: 'manual-v1', needsReview: false,
      createdAt: now, updatedAt: now,
    }

    await saveFoodWithMetadata(food, { group, aliases: [], relatedTerms: [] })

    expect(await getFoodByBarcode(barcode)).toMatchObject({ id: food.id, name: food.name, maker: food.maker, barcode, isCommercial: true })
    expect((await searchFoodResults('保存メーカー')).page.results[0]?.food.id).toBe(food.id)
    expect((await searchFoodResults(food.name)).page.results[0]?.food.id).toBe(food.id)
    expect((await searchFoodResults(food.name, { category: 'commercial' })).page.results.some((result) => result.food.id === food.id)).toBe(true)
  })

  it('メニューを保存して名前・区分で検索できる', async () => {
    await saveFood(userFood)
    const menu: Menu = {
      id: 'menu_test', name: '朝ごはん', category: '主食', foodIds: [userFood.id], aliases: ['モーニング'],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    await saveMenu(menu)
    expect(await searchMenus('朝')).toEqual([menu])
    expect(await searchMenus('主食')).toEqual([menu])
    expect(await searchMenus('テスト食品')).toEqual([menu])
    expect(await searchMenus('モーニング')).toEqual([menu])
  })

  it('料理メニューを食材として検索でき、循環参照と参照中の削除を拒否する', async () => {
    await saveFood(userFood)
    const child: Menu = {
      id: 'menu_child', name: '具材メニュー', category: '主菜', foodIds: [userFood.id],
      ingredients: [{ kind: 'food', itemId: userFood.id, amount: 50, unit: 'g' }],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    const parent: Menu = {
      id: 'menu_parent', name: '親メニュー', category: '主食', foodIds: [],
      ingredients: [{ kind: 'menu', itemId: child.id, amount: 1, unit: '食' }],
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }
    await saveMenu(child)
    await saveMenu(parent)
    expect((await searchMenus('テスト食品')).map((menu) => menu.id).sort()).toEqual(['menu_child', 'menu_parent'])
    await expect(saveMenu({ ...child, ingredients: [{ kind: 'menu', itemId: parent.id, amount: 1, unit: '食' }] })).rejects.toThrow('循環')
    await expect(deleteMenu(child.id)).rejects.toThrow('親メニュー')
  })

  it('初期設定に身体情報の既定値を持つ', async () => {
    const settings = await getSettings()
    expect(settings.bodyProfile?.sex).toBe('unspecified')
    expect(settings.bodyProfile?.activityLevel).toBe('moderate')
  })

  it('食事区分の時刻を複数記録へ一括保存できる', async () => {
    const first: MealEntry = {
      id: 'meal_first', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: userFood.name, maker: userFood.maker, barcode: userFood.barcode, baseAmount: userFood.baseAmount, baseUnit: userFood.baseUnit, nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { energyKcal: 50, proteinG: 0.5, fatG: 0.5, carbohydrateG: 0.5, fiberG: 0.5, saltG: 0, ...addedNutrients },
    }
    const second = { ...first, id: 'meal_second', eatenAt: '2026-07-15T03:00:00.000Z' }
    await saveMealEntries([first, second])
    const entries = await getEntriesForDate('2026-07-15')
    expect(entries.map((entry) => entry.id).sort()).toEqual(['meal_first', 'meal_second'])
  })

  it('同じ日・食事区分の表示順を時刻と独立して一括更新する', async () => {
    const first: MealEntry = {
      id: 'meal_order_first', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: '先', maker: '', barcode: '', baseAmount: 100, baseUnit: 'g', nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { ...userFood.nutrients },
    }
    const second = { ...first, id: 'meal_order_second', foodSnapshot: { ...first.foodSnapshot, name: '後' } }
    await saveMealEntries([first, second])

    await reorderMealEntries('2026-07-15', '朝食', [second.id, first.id])
    const reordered = await getEntriesForDate('2026-07-15')
    expect(reordered.map((entry) => entry.id)).toEqual([second.id, first.id])
    expect(reordered.map((entry) => entry.sortOrder)).toEqual([0, 1])
    expect(reordered.every((entry) => entry.eatenAt === first.eatenAt)).toBe(true)
  })

  it('確認中に記録集合が変わった並び替えは一件も更新しない', async () => {
    const first: MealEntry = {
      id: 'meal_stale_first', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: userFood.id,
      foodSnapshot: { name: '先', maker: '', barcode: '', baseAmount: 100, baseUnit: 'g', nutrients: { ...userFood.nutrients } },
      amount: 50, amountUnit: 'g', calculatedNutrients: { ...userFood.nutrients },
    }
    const second = { ...first, id: 'meal_stale_second' }
    await saveMealEntries([first, second])

    await expect(reorderMealEntries('2026-07-15', '朝食', [second.id])).rejects.toThrow('変更された')
    expect((await getEntriesForDate('2026-07-15')).map((entry) => entry.id)).toEqual([first.id, second.id])
  })

  it('料理メニューの食事別構成スナップショットを保存する', async () => {
    const menuEntry: MealEntry = {
      id: 'meal_menu_snapshot', eatenAt: '2026-07-15T03:00:00.000Z', mealType: '朝食', foodId: 'menu:breakfast',
      foodSnapshot: { name: '朝ごはん', maker: '', barcode: '', baseAmount: 1, baseUnit: '食', nutrients: { energyKcal: 100, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0, ...addedNutrients } },
      amount: 1, amountUnit: '食', calculatedNutrients: { energyKcal: 100, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0, ...addedNutrients },
      menuSnapshot: {
        sourceMenuId: 'breakfast', sourceMenuName: '朝ごはん',
        ingredients: [{ kind: 'food', itemId: userFood.id, amount: 50, unit: 'g', foodSnapshot: { name: userFood.name, maker: userFood.maker, barcode: userFood.barcode, baseAmount: userFood.baseAmount, baseUnit: userFood.baseUnit, nutrients: { ...userFood.nutrients } } }],
      },
    }
    await saveMealEntry(menuEntry)
    expect((await getEntriesForDate('2026-07-15')).find((entry) => entry.id === menuEntry.id)?.menuSnapshot).toEqual(menuEntry.menuSnapshot)
  })

  it('全置換トランザクションが失敗した場合は既存データを保持する', async () => {
    await saveFood(userFood)
    const replacement = { ...userFood, id: 'replacement_food', name: '復元食品' }
    const backup: BackupData = {
      format: 'nutrition-pwa-backup', dataFormatVersion: 1, exportedAt: '2026-07-15T00:00:00.000Z',
      foods: [replacement, replacement], mealEntries: [], favorites: [], settings: await getSettings(),
    }

    await expect(replaceAllData(backup)).rejects.toThrow()
    expect(await db.foods.get(userFood.id)).toBeDefined()
    expect(await db.foods.get(replacement.id)).toBeUndefined()
  })

  it('全置換後の検索データ更新失敗を、復元済みの結果として返す', async () => {
    await saveFood(userFood)
    const replacement = { ...userFood, id: 'replacement_food', name: '復元食品' }
    const backup: BackupData = {
      format: 'nutrition-pwa-backup', dataFormatVersion: 1, exportedAt: '2026-07-15T00:00:00.000Z',
      foods: [replacement], mealEntries: [], favorites: [], settings: await getSettings(),
    }
    const metadataFailure = vi.spyOn(db.foodGroups, 'bulkPut').mockRejectedValueOnce(new Error('metadata failure'))

    const result = await replaceAllData(backup)
    metadataFailure.mockRestore()

    expect(result).toEqual({ committed: true, searchMetadataReady: false })
    expect(await db.foods.get(replacement.id)).toBeDefined()
    expect(await db.foods.get(userFood.id)).toBeUndefined()
  })
})
