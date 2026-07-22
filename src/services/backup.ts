import { NUTRIENT_KEYS, type AppSettings, type BackupData, type Food, type FoodAlias, type FoodGroup, type FoodRelatedTerm, type FoodUsageStat, type MealEntry, type Menu, type MenuIngredient, type MenuSet, type Nutrients, type SearchLog } from '../types'
import { isFoodAttributePreference } from './foodAttributePreferences'
import { hasMenuCycles } from './menuIngredients'
import { isMealMenuSnapshot } from './mealMenuSnapshots'
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

function isVariantAttributes(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => item === null || isString(item))
}

function isFood(value: unknown): value is Food {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.name) && isString(value.maker) && isString(value.barcode)
    && (value.isCommercial === undefined || typeof value.isCommercial === 'boolean')
    && ['mext', 'open_food_facts', 'user'].includes(String(value.source))
    && isString(value.sourceVersion) && typeof value.baseAmount === 'number' && value.baseAmount > 0
    && isValidUnit(String(value.baseUnit)) && isNullableNumber(value.servingAmount)
    && (value.servingUnit === null || isValidUnit(String(value.servingUnit)))
    && isNutrients(value.nutrients) && isString(value.createdAt) && isString(value.updatedAt)
    && (value.menuIds === undefined || (Array.isArray(value.menuIds) && value.menuIds.every(isString)))
    && (value.officialName === undefined || isString(value.officialName))
    && (value.displayName === undefined || isString(value.displayName))
    && (value.reading === undefined || value.reading === null || isString(value.reading))
    && (value.foodGroupId === undefined || isString(value.foodGroupId))
    && isVariantAttributes(value.variantAttributes)
}

function isSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isString(value.name) && isString(value.maker) && isString(value.barcode)
    && typeof value.baseAmount === 'number' && value.baseAmount > 0 && isValidUnit(String(value.baseUnit))
    && isNutrients(value.nutrients)
    && (value.officialName === undefined || isString(value.officialName))
    && (value.displayName === undefined || isString(value.displayName))
}

function isFoodGroup(value: unknown): value is FoodGroup {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.displayName) && (value.reading === null || isString(value.reading))
    && (value.category === null || isString(value.category)) && typeof value.representativeScore === 'number'
    && (value.defaultVariantId === null || isString(value.defaultVariantId)) && typeof value.isActive === 'boolean'
    && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource)) && isString(value.generationVersion)
    && typeof value.needsReview === 'boolean' && isString(value.createdAt) && isString(value.updatedAt)
}

function isFoodAlias(value: unknown): value is FoodAlias {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.foodGroupId) && (value.foodVariantId === null || isString(value.foodVariantId))
    && isString(value.alias) && isString(value.normalizedAlias) && ['synonym', 'reading', 'abbreviation'].includes(String(value.aliasType))
    && typeof value.priority === 'number' && typeof value.isActive === 'boolean' && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource))
}

function isFoodRelatedTerm(value: unknown): value is FoodRelatedTerm {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.foodGroupId) && isString(value.term) && isString(value.normalizedTerm)
    && typeof value.weight === 'number' && value.weight >= 0 && value.weight <= 1 && typeof value.isActive === 'boolean'
    && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource))
}

function isFoodUsageStat(value: unknown): value is FoodUsageStat {
  if (!isRecord(value)) return false
  return isString(value.foodId) && typeof value.selectionCount === 'number' && value.selectionCount >= 0
    && (value.lastSelectedAt === null || isString(value.lastSelectedAt)) && isString(value.updatedAt)
}

function isSearchLogItem(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.foodGroupId) || !isString(value.foodVariantId) || typeof value.rank !== 'number' || typeof value.score !== 'number' || !isString(value.matchedBy) || !isRecord(value.scoreBreakdown)) return false
  const breakdown = value.scoreBreakdown as Record<string, unknown>
  return ['text', 'representative', 'personalFrequency', 'recent', 'total'].every((key) => typeof breakdown[key] === 'number')
}

function isSearchLog(value: unknown): value is SearchLog {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.createdAt) && isString(value.query) && isString(value.normalizedQuery)
    && typeof value.resultCount === 'number' && typeof value.processingMs === 'number' && Array.isArray(value.items) && value.items.every(isSearchLogItem)
    && (value.selectedFoodGroupId === null || isString(value.selectedFoodGroupId))
    && (value.selectedFoodVariantId === null || isString(value.selectedFoodVariantId))
    && (value.selectedRank === null || typeof value.selectedRank === 'number')
    && (value.selectionElapsedMs === null || typeof value.selectionElapsedMs === 'number') && typeof value.unselected === 'boolean'
}

function isMealEntry(value: unknown): value is MealEntry {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.eatenAt) && ['朝食', '昼食', '夕食', '間食'].includes(String(value.mealType))
    && isString(value.foodId) && isSnapshot(value.foodSnapshot) && typeof value.amount === 'number' && value.amount > 0
    && isValidUnit(String(value.amountUnit)) && isNutrients(value.calculatedNutrients)
    && (value.menuSnapshot === undefined || isMealMenuSnapshot(value.menuSnapshot))
}

function isMenuIngredient(value: unknown): value is MenuIngredient {
  if (!isRecord(value)) return false
  return (value.kind === 'food' || value.kind === 'menu') && isString(value.itemId) && value.itemId.length > 0
    && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 100000
    && isValidUnit(String(value.unit))
}

function isMenu(value: unknown): value is Menu {
  if (!isRecord(value)) return false
  return isString(value.id) && isString(value.name) && ['主食', '主菜', '副菜', '汁物', '乳製品・果物', 'お菓子・スイーツ', 'その他'].includes(String(value.category))
    && Array.isArray(value.foodIds) && value.foodIds.every(isString)
    && (value.ingredients === undefined || (Array.isArray(value.ingredients) && value.ingredients.every(isMenuIngredient)))
    && (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every(isString)))
    && isString(value.createdAt) && isString(value.updatedAt)
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

function isFoodAttributePreferences(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (!key) return false
    if (isFoodAttributePreference(entry)) return true
    return isRecord(entry) && Object.entries(entry).every(([attributeId, preference]) => Boolean(attributeId) && isFoodAttributePreference(preference))
  })
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
    && isFoodAttributePreferences(value.foodAttributePreferences)
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
  if (value.menus !== undefined && hasMenuCycles(value.menus as Menu[])) {
    throw new Error('料理メニューが循環して参照されています。')
  }
  if (!value.favorites.every((favorite) => isRecord(favorite) && isString(favorite.foodId) && isString(favorite.createdAt))) {
    throw new Error('お気に入り情報の形式が不正です。')
  }
  if ((value.foodGroups !== undefined && (!Array.isArray(value.foodGroups) || !value.foodGroups.every(isFoodGroup)))
    || (value.foodAliases !== undefined && (!Array.isArray(value.foodAliases) || !value.foodAliases.every(isFoodAlias)))
    || (value.foodRelatedTerms !== undefined && (!Array.isArray(value.foodRelatedTerms) || !value.foodRelatedTerms.every(isFoodRelatedTerm)))
    || (value.foodUsageStats !== undefined && (!Array.isArray(value.foodUsageStats) || !value.foodUsageStats.every(isFoodUsageStat)))
    || (value.searchLogs !== undefined && (!Array.isArray(value.searchLogs) || !value.searchLogs.every(isSearchLog)))) {
    throw new Error('食品グループ、検索メタデータ、利用統計または検索ログの形式が不正です。')
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
