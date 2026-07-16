import Dexie, { type Table } from 'dexie'
import {
  DEFAULT_SETTINGS,
  DEFAULT_BODY_PROFILE,
  NUTRIENT_KEYS,
  type AppSettings,
  type BackupData,
  type FavoriteRecord,
  type Food,
  type MealEntry,
  type MetadataRecord,
  type Menu,
  type MenuSet,
  type Nutrients,
} from '../types'
import { createId } from '../utils/id'
import { estimateDailyGoals } from '../services/nutrition'

const INITIAL_FOODS_VERSION = 4

export class NutritionDatabase extends Dexie {
  foods!: Table<Food, string>
  mealEntries!: Table<MealEntry, string>
  favorites!: Table<FavoriteRecord, string>
  settings!: Table<AppSettings, string>
  metadata!: Table<MetadataRecord, string>
  menus!: Table<Menu, string>
  menuSets!: Table<MenuSet, string>

  constructor() {
    super('nutrition-pwa')
    this.version(1).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
    })
    this.version(2).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
    })
    this.version(3).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
    })
    this.version(4).stores({
      foods: 'id, name, maker, barcode, source, updatedAt',
      meal_entries: 'id, eatenAt, mealType, foodId',
      favorites: 'foodId, createdAt',
      settings: 'id',
      metadata: 'key',
      menus: 'id, name, category, updatedAt',
      menu_sets: 'id, name, updatedAt',
    }).upgrade(async (transaction) => {
      const normalize = (value: Partial<Nutrients> | undefined): Nutrients => Object.fromEntries(NUTRIENT_KEYS.map((key) => {
        const nutrient = value?.[key]
        return [key, typeof nutrient === 'number' && Number.isFinite(nutrient) ? nutrient : null]
      })) as Nutrients
      const foodTable = transaction.table('foods')
      const foods = await foodTable.toArray() as Food[]
      if (foods.length > 0) await foodTable.bulkPut(foods.map((food) => ({ ...food, nutrients: normalize(food.nutrients) })))
      const mealTable = transaction.table('meal_entries')
      const entries = await mealTable.toArray() as MealEntry[]
      if (entries.length > 0) await mealTable.bulkPut(entries.map((entry) => ({
        ...entry,
        foodSnapshot: { ...entry.foodSnapshot, nutrients: normalize(entry.foodSnapshot.nutrients) },
        calculatedNutrients: normalize(entry.calculatedNutrients),
      })))
    })
    this.mealEntries = this.table('meal_entries')
    this.menus = this.table('menus')
    this.menuSets = this.table('menu_sets')
  }
}

export const db = new NutritionDatabase()

export async function initializeDatabase(): Promise<void> {
  const { initialFoods } = await import('../data/initialFoods')
  const settings = await db.settings.get('app')
  if (!settings) await db.settings.put({ ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals } })

  const seeded = await db.metadata.get('initial-foods-seeded')
  const seedVersion = await db.metadata.get('initial-foods-version')
  if (!seeded) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
      const existing = await db.foods.count()
      if (existing === 0) await db.foods.bulkAdd(initialFoods)
      await db.metadata.put({ key: 'initial-foods-seeded', value: true })
      await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
      await db.metadata.put({ key: 'schema-version', value: 4 })
    })
  } else if (seedVersion?.value !== INITIAL_FOODS_VERSION) {
    await db.transaction('rw', [db.foods, db.metadata], async () => {
      for (const bundledFood of initialFoods) {
        const existing = await db.foods.get(bundledFood.id)
        if (!existing) {
          await db.foods.add(bundledFood)
        } else if (
          existing.source === 'mext'
          && existing.sourceVersion.includes('初期サンプル')
          && existing.createdAt === existing.updatedAt
        ) {
          await db.foods.put(bundledFood)
        }
      }
      await db.metadata.put({ key: 'initial-foods-version', value: INITIAL_FOODS_VERSION })
      await db.metadata.put({ key: 'schema-version', value: 4 })
    })
  }
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.settings.get('app')
  const normalized = stored
    ? {
      ...DEFAULT_SETTINGS, ...stored, goals: { ...DEFAULT_SETTINGS.goals, ...stored.goals },
      mealTimeMode: stored.mealTimeMode ?? 'auto', bodyProfile: { ...DEFAULT_BODY_PROFILE, ...stored.bodyProfile },
    }
    : { ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals }, bodyProfile: { ...DEFAULT_BODY_PROFILE } }
  const estimated = estimateDailyGoals(normalized.bodyProfile)
  const goals = { ...normalized.goals }
  if (estimated) {
    for (const key of NUTRIENT_KEYS) {
      if (goals[key] === null && estimated[key] !== null) goals[key] = estimated[key]
    }
  }
  const next = { ...normalized, goals }
  if (stored && NUTRIENT_KEYS.some((key) => stored.goals[key] !== next.goals[key])) await db.settings.put(next)
  return next
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(settings)
}

export async function searchFoods(query: string): Promise<Food[]> {
  const normalized = query.trim().toLocaleLowerCase('ja-JP')
  if (!normalized) return db.foods.orderBy('name').toArray()
  return db.foods
    .filter((food) => [food.name, food.maker, food.barcode].some((field) => field.toLocaleLowerCase('ja-JP').includes(normalized)))
    .sortBy('name')
}

export async function getFoodById(id: string): Promise<Food | undefined> {
  return db.foods.get(id)
}

export async function getFoodByBarcode(barcode: string): Promise<Food | undefined> {
  return db.foods.where('barcode').equals(barcode).first()
}

export async function saveFood(food: Food): Promise<void> {
  await db.foods.put(food)
}

export async function deleteFood(id: string): Promise<void> {
  await db.transaction('rw', [db.foods, db.favorites], async () => {
    await db.foods.delete(id)
    await db.favorites.delete(id)
  })
}

export async function getAllFoods(): Promise<Food[]> {
  return db.foods.orderBy('name').toArray()
}

export async function searchMenus(query: string): Promise<Menu[]> {
  const normalized = query.trim().toLocaleLowerCase('ja-JP')
  const menus = await db.menus.orderBy('name').toArray()
  if (!normalized) return menus
  const ingredientFoods = await db.foods.bulkGet([...new Set(menus.flatMap((menu) => menu.foodIds))])
  const foodsById = new Map(ingredientFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food]))
  return menus.filter((menu) => [menu.name, menu.category].some((field) => field.toLocaleLowerCase('ja-JP').includes(normalized))
    || menu.foodIds.some((foodId) => {
      const food = foodsById.get(foodId)
      return food ? [food.name, food.maker, food.barcode].some((field) => field.toLocaleLowerCase('ja-JP').includes(normalized)) : false
    }))
}

export async function searchMenuSets(query: string): Promise<MenuSet[]> {
  const normalized = query.trim().toLocaleLowerCase('ja-JP')
  const sets = await db.menuSets.orderBy('name').toArray()
  if (!normalized) return sets
  const menus = await db.menus.toArray()
  const menuById = new Map(menus.map((menu) => [menu.id, menu]))
  const foodIds = [...new Set([...sets.flatMap((set) => set.foodIds ?? []), ...menus.flatMap((menu) => menu.foodIds)])]
  const ingredientFoods = await db.foods.bulkGet(foodIds)
  const foodsById = new Map(ingredientFoods.filter((food): food is Food => Boolean(food)).map((food) => [food.id, food]))
  const foodMatches = (foodId: string) => {
    const food = foodsById.get(foodId)
    return food ? [food.name, food.maker, food.barcode].some((field) => field.toLocaleLowerCase('ja-JP').includes(normalized)) : false
  }
  const menuMatches = (menuId: string) => {
    const menu = menuById.get(menuId)
    return menu ? [menu.name, menu.category].some((field) => field.toLocaleLowerCase('ja-JP').includes(normalized)) || menu.foodIds.some(foodMatches) : false
  }
  return sets.filter((set) => set.name.toLocaleLowerCase('ja-JP').includes(normalized) || (set.foodIds ?? []).some(foodMatches) || set.menuIds.some(menuMatches))
}

export async function getAllMenus(): Promise<Menu[]> {
  return db.menus.orderBy('name').toArray()
}

export async function getAllMenuSets(): Promise<MenuSet[]> {
  return db.menuSets.orderBy('name').toArray()
}

export async function saveMenu(menu: Menu): Promise<void> {
  await db.menus.put(menu)
}

export async function deleteMenu(id: string): Promise<void> {
  await db.transaction('rw', [db.menus, db.menuSets], async () => {
    await db.menus.delete(id)
    const sets = await db.menuSets.toArray()
    await Promise.all(sets.filter((set) => set.menuIds.includes(id)).map((set) => db.menuSets.put({ ...set, menuIds: set.menuIds.filter((menuId) => menuId !== id), updatedAt: new Date().toISOString() })))
  })
}

export async function saveMenuSet(menuSet: MenuSet): Promise<void> {
  await db.menuSets.put(menuSet)
}

export async function deleteMenuSet(id: string): Promise<void> {
  await db.menuSets.delete(id)
}

export async function getEntriesForDate(dateKey: string): Promise<MealEntry[]> {
  const start = new Date(`${dateKey}T00:00:00+09:00`).toISOString()
  const nextDate = new Date(`${dateKey}T00:00:00+09:00`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const end = nextDate.toISOString()
  return db.mealEntries.where('eatenAt').between(start, end, true, false).toArray()
}

export async function getEntriesBetween(from: string, to: string): Promise<MealEntry[]> {
  const start = new Date(`${from}T00:00:00+09:00`).toISOString()
  const endDate = new Date(`${to}T00:00:00+09:00`)
  endDate.setUTCDate(endDate.getUTCDate() + 1)
  return db.mealEntries.where('eatenAt').between(start, endDate.toISOString(), true, false).toArray()
}

export async function saveMealEntry(entry: MealEntry): Promise<void> {
  await db.mealEntries.put(entry)
}

export async function saveMealEntries(entries: MealEntry[]): Promise<void> {
  await db.transaction('rw', db.mealEntries, async () => {
    if (entries.length > 0) await db.mealEntries.bulkPut(entries)
  })
}

export async function deleteMealEntry(id: string): Promise<void> {
  await db.mealEntries.delete(id)
}

export async function getFavoriteIds(): Promise<Set<string>> {
  const records = await db.favorites.toArray()
  return new Set(records.map((record) => record.foodId))
}

export async function setFavorite(foodId: string, favorite: boolean): Promise<void> {
  if (favorite) await db.favorites.put({ foodId, createdAt: new Date().toISOString() })
  else await db.favorites.delete(foodId)
}

export async function getFavoriteFoods(): Promise<Food[]> {
  const favoriteIds = await getFavoriteIds()
  const foods = await getAllFoods()
  return foods.filter((food) => favoriteIds.has(food.id))
}

export async function getRecentFoods(limit = 20): Promise<Food[]> {
  const entries = await db.mealEntries.orderBy('eatenAt').reverse().toArray()
  const ids: string[] = []
  for (const entry of entries) {
    if (!ids.includes(entry.foodId)) ids.push(entry.foodId)
    if (ids.length >= limit) break
  }
  const foods = await db.foods.bulkGet(ids)
  return ids.map((id) => foods.find((food) => food?.id === id)).filter((food): food is Food => Boolean(food))
}

export async function exportBackup(): Promise<BackupData> {
  const settings = await getSettings()
  return {
    format: 'nutrition-pwa-backup',
    dataFormatVersion: settings.dataFormatVersion,
    exportedAt: new Date().toISOString(),
    foods: await db.foods.toArray(),
    mealEntries: await db.mealEntries.toArray(),
    favorites: await db.favorites.toArray(),
    menus: await db.menus.toArray(),
    menuSets: await db.menuSets.toArray(),
    settings,
  }
}

export async function replaceAllData(backup: BackupData): Promise<void> {
  await db.transaction('rw', [db.foods, db.mealEntries, db.favorites, db.settings, db.metadata, db.menus, db.menuSets], async () => {
    await db.foods.clear()
    await db.mealEntries.clear()
    await db.favorites.clear()
    await db.settings.clear()
    await db.metadata.clear()
    await db.menus.clear()
    await db.menuSets.clear()
    if (backup.foods.length) await db.foods.bulkAdd(backup.foods)
    if (backup.mealEntries.length) await db.mealEntries.bulkAdd(backup.mealEntries)
    if (backup.favorites.length) await db.favorites.bulkAdd(backup.favorites)
    if (backup.menus?.length) await db.menus.bulkAdd(backup.menus)
    if (backup.menuSets?.length) await db.menuSets.bulkAdd(backup.menuSets)
    await db.settings.put(backup.settings)
    await db.metadata.put({ key: 'schema-version', value: 3 })
    await db.metadata.put({ key: 'initial-foods-seeded', value: true })
    await db.metadata.put({ key: 'initial-foods-version', value: 2 })
  })
}

export function createNewFoodId(): string {
  return createId('food')
}

export function createNewMealId(): string {
  return createId('meal')
}

export function createNewMenuId(): string {
  return createId('menu')
}

export function createNewMenuSetId(): string {
  return createId('menu-set')
}
