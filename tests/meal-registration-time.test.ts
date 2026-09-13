import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, exportBackup, getRecentFoods, reorderMealEntries, replaceAllData, saveMealEntries, saveMealEntry } from '../src/db/db'
import { backupToJson, parseBackupText, validateBackup } from '../src/services/backup'
import { mealsToCsv, parseMealsCsv } from '../src/services/csv'
import { isRegistrationTimestamp, withLegacyRegistrationTime } from '../src/services/mealRegistrationTime'
import { DEFAULT_SETTINGS, DEFAULT_ESTIMATION_SETTINGS, EMPTY_NUTRIENTS, type BackupData, type Food, type MealEntry } from '../src/types'

const eatenAt = '2026-09-01T00:00:00.000Z'
const now = '2026-09-12T00:00:00.000Z'
const food = (id: string): Food => ({
  id, name: id, maker: '', barcode: '', source: 'user', sourceVersion: 'test',
  baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null,
  nutrients: { ...EMPTY_NUTRIENTS, energyKcal: 100 }, createdAt: eatenAt, updatedAt: eatenAt,
})
const meal = (id: string, foodId = id): MealEntry => ({
  id, foodId, eatenAt, mealType: '朝食', amount: 100, amountUnit: 'g',
  foodSnapshot: { name: foodId, maker: '', barcode: '', baseAmount: 100, baseUnit: 'g', nutrients: food(foodId).nutrients },
  calculatedNutrients: food(foodId).nutrients,
})
const backup = (mealEntries: MealEntry[]): BackupData => ({
  format: 'nutrition-pwa-backup', dataFormatVersion: 3, exportedAt: now,
  foods: [food('a'), food('b')], mealEntries, favorites: [], menus: [], generalMenus: [], menuSets: [], weightRecords: [],
  settings: { ...DEFAULT_SETTINGS, dataFormatVersion: 3 },
  estimationDataFormatVersion: 1, estimationSettings: DEFAULT_ESTIMATION_SETTINGS, estimationRequests: [], estimationResults: [], estimationDecisions: [],
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.foods.bulkPut([food('a'), food('b'), food('c')])
})
afterEach(() => { vi.restoreAllMocks() })

describe('食事の初回登録順', () => {
  it('同じ摂取日時・同じ端末時計でも、複数保存とバッチ内の登録順が安定する', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(now).getTime())
    await saveMealEntry(meal('z-first', 'a'))
    await saveMealEntries([meal('y-second', 'b'), meal('x-third', 'c')])
    expect((await getRecentFoods(3, '朝食')).map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect((await db.mealEntries.orderBy('registeredAt').toArray()).map((entry) => entry.registeredAt)).toEqual([
      now, '2026-09-12T00:00:00.001Z', '2026-09-12T00:00:00.002Z',
    ])
    await db.close()
    await db.open()
    await saveMealEntry(meal('w-after-reopen', 'a'))
    expect((await getRecentFoods(3)).map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect((await db.mealEntries.get('w-after-reopen'))?.registeredAt).toBe('2026-09-12T00:00:00.003Z')
  })

  it('後日追加入力を優先し、摂取日時の編集・表示順変更で登録順を変えない', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(now).getTime())
    await saveMealEntry({ ...meal('a'), eatenAt: '2026-09-11T00:00:00.000Z' })
    await saveMealEntry(meal('b'))
    expect((await getRecentFoods()).map((item) => item.id)).toEqual(['b', 'a'])
    const first = await db.mealEntries.get('a')
    if (!first) throw new Error('記録がありません')
    await saveMealEntry({ ...first, eatenAt, amount: 200, registeredAt: '2026-09-13T00:00:00.000Z' })
    await reorderMealEntries('2026-09-01', '朝食', ['a', 'b'])
    expect((await getRecentFoods()).map((item) => item.id)).toEqual(['b', 'a'])
    expect((await db.mealEntries.get('a'))?.registeredAt).toBe(first.registeredAt)
  })

  it('新規コピーは登録日時を付け直し、CSVなど新規移送記録の登録日時は保持する', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(now).getTime())
    const imported = { ...meal('old', 'a'), registeredAt: eatenAt }
    await saveMealEntry(imported)
    await saveMealEntry({ ...imported, id: 'copy', registeredAt: undefined })
    expect((await db.mealEntries.get('old'))?.registeredAt).toBe(eatenAt)
    expect((await db.mealEntries.get('copy'))?.registeredAt).toBe(now)
  })

  it('JSONとCSVの登録日時を保持し、旧形式の復元には摂取日時を代用する', async () => {
    const source = { ...meal('a'), registeredAt: now }
    expect(parseMealsCsv(mealsToCsv([source]))[0].registeredAt).toBe(now)
    expect(parseBackupText(backupToJson(backup([source]))).mealEntries[0].registeredAt).toBe(now)
    await replaceAllData(backup([source, meal('b')]))
    expect((await db.mealEntries.get('a'))?.registeredAt).toBe(now)
    expect((await db.mealEntries.get('b'))?.registeredAt).toBe(eatenAt)
    expect((await getRecentFoods()).map((item) => item.id)).toEqual(['a', 'b'])
    expect(validateBackup(await exportBackup()).mealEntries.find((entry) => entry.id === 'a')?.registeredAt).toBe(now)
    // 従来の最終列までで切ったCSVを読み込める。
    const oldCsv = mealsToCsv([meal('a')]).trimEnd().split('\r\n').map((row) => row.slice(0, row.lastIndexOf(','))).join('\r\n')
    const oldEntry = parseMealsCsv(oldCsv)[0]
    expect(oldEntry.registeredAt).toBeUndefined()
    expect(withLegacyRegistrationTime(oldEntry).registeredAt).toBe(eatenAt)
  })

  it.each(['invalid', '2026-02-30T00:00:00.000Z', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00.000+00:00'])('登録日時 %s を不正として拒否する', async (registeredAt) => {
    expect(isRegistrationTimestamp(registeredAt)).toBe(false)
    const invalidEntry = { ...meal('a'), registeredAt }
    expect(() => validateBackup(backup([invalidEntry]))).toThrow('形式')
    expect(() => parseMealsCsv(mealsToCsv([invalidEntry]))).toThrow('登録日時')
    await expect(saveMealEntry(invalidEntry)).rejects.toThrow('登録日時')
    expect(await db.mealEntries.count()).toBe(0)
  })

  it('v9からの更新は食品・食事を保持し、旧記録を登録日時索引へ移す', async () => {
    // 実際のv9スキーマを使い、v10追加索引だけを除いた旧DBを作る。
    const oldStores = Object.fromEntries(db.tables.map((table) => [table.name, [table.schema.primKey.src, ...table.schema.indexes.filter((index) => index.name !== 'registeredAt').map((index) => index.src)].join(', ')]))
    await db.delete()
    const legacy = new Dexie(db.name)
    legacy.version(9).stores(oldStores)
    await legacy.open()
    await legacy.table('foods').put(food('a'))
    await legacy.table('meal_entries').put(meal('legacy', 'a'))
    legacy.close()
    await db.open()
    expect(await db.foods.get('a')).toEqual(food('a'))
    expect(await db.mealEntries.get('legacy')).toMatchObject({ ...meal('legacy', 'a'), registeredAt: eatenAt })
    expect((await getRecentFoods()).map((item) => item.id)).toEqual(['a'])
    expect((await db.metadata.get('schema-version'))?.value).toBe(11)
  })
})
