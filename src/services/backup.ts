import { NUTRIENT_KEYS, type AppSettings, type BackupData, type Food, type MealEntry, type Menu, type MenuSet, type Nutrients } from '../types'
import { isNutrients, isValidUnit } from '../utils/validation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isFood(value: unknown): value is Food {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.name) && isString(value.maker) && isString(value.barcode)
    && ['mext', 'open_food_facts', 'user'].includes(String(value.source))
    && isString(value.sourceVersion) && typeof value.baseAmount === 'number' && value.baseAmount > 0
    && isValidUnit(String(value.baseUnit)) && isNullableNumber(value.servingAmount)
    && (value.servingUnit === null || isValidUnit(String(value.servingUnit)))
    && isNutrients(value.nutrients) && isString(value.createdAt) && isString(value.updatedAt)
    && (value.menuIds === undefined || (Array.isArray(value.menuIds) && value.menuIds.every(isString)))
}

function isSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isString(value.name) && isString(value.maker) && isString(value.barcode)
    && typeof value.baseAmount === 'number' && value.baseAmount > 0 && isValidUnit(String(value.baseUnit))
    && isNutrients(value.nutrients)
}

function isMealEntry(value: unknown): value is MealEntry {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.eatenAt) && ['朝食', '昼食', '夕食', '間食'].includes(String(value.mealType))
    && isString(value.foodId) && isSnapshot(value.foodSnapshot) && typeof value.amount === 'number' && value.amount > 0
    && isValidUnit(String(value.amountUnit)) && isNutrients(value.calculatedNutrients)
}

function isMenu(value: unknown): value is Menu {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.name) && ['主食', '主菜', '副菜', '汁物', '乳製品・果物', 'お菓子・スイーツ', 'その他'].includes(String(value.category))
    && Array.isArray(value.foodIds) && value.foodIds.every(isString) && isString(value.createdAt) && isString(value.updatedAt)
}

function isMenuSet(value: unknown): value is MenuSet {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.name) && Array.isArray(value.menuIds) && value.menuIds.every(isString)
    && (value.foodIds === undefined || (Array.isArray(value.foodIds) && value.foodIds.every(isString)))
    && isString(value.createdAt) && isString(value.updatedAt)
}

function isBodyProfile(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isNullableNumber(value.heightCm) && isNullableNumber(value.weightKg) && isNullableNumber(value.ageYears)
    && ['male', 'female', 'unspecified'].includes(String(value.sex))
    && ['low', 'moderate', 'high'].includes(String(value.activityLevel))
}

function isSettings(value: unknown): value is AppSettings {
  if (!isRecord(value) || value.id !== 'app' || !isRecord(value.goals)) return false
  const goals = value.goals
  return NUTRIENT_KEYS.every((key) => isNullableNumber(goals[key]))
    && value.displayUnit === 'default' && (value.lastBackupAt === null || isString(value.lastBackupAt))
    && value.dataFormatVersion === 1 && typeof value.externalApiEnabled === 'boolean'
    && isString(value.externalApiEndpoint)
    && (value.mealTimeMode === undefined || value.mealTimeMode === 'auto' || value.mealTimeMode === 'manual')
    && (value.bodyProfile === undefined || isBodyProfile(value.bodyProfile))
}

export function validateBackup(value: unknown): BackupData {
  if (!isRecord(value)) throw new Error('JSONのトップレベルがオブジェクトではありません。')
  if (value.format !== 'nutrition-pwa-backup' || value.dataFormatVersion !== 1) {
    throw new Error('対応していないバックアップ形式またはバージョンです。')
  }
  if (!isString(value.exportedAt) || !Array.isArray(value.foods) || !Array.isArray(value.mealEntries)
    || !Array.isArray(value.favorites) || !isSettings(value.settings)) {
    throw new Error('バックアップの必須項目が不足しています。')
  }
  if (!value.foods.every(isFood) || !value.mealEntries.every(isMealEntry)) {
    throw new Error('食品または食事記録の形式が不正です。')
  }
  if ((value.menus !== undefined && (!Array.isArray(value.menus) || !value.menus.every(isMenu)))
    || (value.menuSets !== undefined && (!Array.isArray(value.menuSets) || !value.menuSets.every(isMenuSet)))) {
    throw new Error('メニューまたはメニューセットの形式が不正です。')
  }
  if (!value.favorites.every((favorite) => isRecord(favorite) && isString(favorite.foodId) && isString(favorite.createdAt))) {
    throw new Error('お気に入り情報の形式が不正です。')
  }
  // 旧形式のバックアップは元の形を保ったまま復元し、読み込み側の設定正規化に任せる。
  return value as unknown as BackupData
}

export function backupToJson(backup: BackupData): string {
  return JSON.stringify(backup, null, 2)
}

export function downloadBlob(content: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseBackupText(text: string): BackupData {
  try {
    return validateBackup(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JSONを読み込めません。ファイル内容を確認してください。')
    throw error
  }
}

export function cloneNutrients(nutrients: Nutrients): Nutrients {
  return { ...nutrients }
}
