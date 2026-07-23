import { NUTRIENT_KEYS, type AppSettings, type BackupData, type Food, type FoodAlias, type FoodGroup, type FoodRelatedTerm, type FoodSnapshot, type FoodUsageStat, type MealEntry, type Menu, type MenuIngredient, type MenuSet, type Nutrients, type SearchLog } from '../types'
import { isFoodAttributePreference } from './foodAttributePreferences'
import { hasMenuCycles } from './menuIngredients'
import { isMealMenuSnapshot } from './mealMenuSnapshots'
import { isNutrients, isValidBarcode, isValidUnit } from '../utils/validation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0
}

function isIsoDateTime(value: unknown): value is string {
  if (!isString(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function isNullablePositiveNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000)
}

function hasUniqueValues<T>(items: T[], getValue: (item: T) => string): boolean {
  const values = items.map(getValue)
  return new Set(values).size === values.length
}

function isVariantAttributes(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => item === null || isString(item))
}

function isFood(value: unknown): value is Food {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.name) && isString(value.maker)
    && isString(value.barcode) && (!value.barcode || isValidBarcode(value.barcode))
    && (value.isCommercial === undefined || typeof value.isCommercial === 'boolean')
    && ['mext', 'open_food_facts', 'user'].includes(String(value.source))
    && isNonEmptyString(value.sourceVersion) && typeof value.baseAmount === 'number' && Number.isFinite(value.baseAmount) && value.baseAmount > 0 && value.baseAmount <= 100000
    && isValidUnit(String(value.baseUnit)) && isNullablePositiveNumber(value.servingAmount)
    && ((value.servingAmount === null && value.servingUnit === null) || (value.servingAmount !== null && value.servingUnit === value.baseUnit))
    && isNutrients(value.nutrients) && isIsoDateTime(value.createdAt) && isIsoDateTime(value.updatedAt)
    && (value.menuIds === undefined || (Array.isArray(value.menuIds) && value.menuIds.every(isNonEmptyString)))
    && (value.officialName === undefined || isString(value.officialName))
    && (value.displayName === undefined || isString(value.displayName))
    && (value.reading === undefined || value.reading === null || isString(value.reading))
    && (value.foodGroupId === undefined || isString(value.foodGroupId))
    && isVariantAttributes(value.variantAttributes)
}

function isSnapshot(value: unknown): value is FoodSnapshot {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.name) && isString(value.maker) && isString(value.barcode) && (!value.barcode || isValidBarcode(value.barcode))
    && typeof value.baseAmount === 'number' && Number.isFinite(value.baseAmount) && value.baseAmount > 0 && value.baseAmount <= 100000 && isValidUnit(String(value.baseUnit))
    && isNutrients(value.nutrients)
    && (value.officialName === undefined || isString(value.officialName))
    && (value.displayName === undefined || isString(value.displayName))
}

function isFoodGroup(value: unknown): value is FoodGroup {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.displayName) && (value.reading === null || isString(value.reading))
    && (value.category === null || isString(value.category)) && typeof value.representativeScore === 'number' && Number.isFinite(value.representativeScore)
    && (value.defaultVariantId === null || isNonEmptyString(value.defaultVariantId)) && typeof value.isActive === 'boolean'
    && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource)) && isNonEmptyString(value.generationVersion)
    && typeof value.needsReview === 'boolean' && isIsoDateTime(value.createdAt) && isIsoDateTime(value.updatedAt)
}

function isFoodAlias(value: unknown): value is FoodAlias {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.foodGroupId) && (value.foodVariantId === null || isNonEmptyString(value.foodVariantId))
    && isNonEmptyString(value.alias) && isNonEmptyString(value.normalizedAlias) && ['synonym', 'reading', 'abbreviation'].includes(String(value.aliasType))
    && typeof value.priority === 'number' && Number.isFinite(value.priority) && typeof value.isActive === 'boolean' && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource))
}

function isFoodRelatedTerm(value: unknown): value is FoodRelatedTerm {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.foodGroupId) && isNonEmptyString(value.term) && isNonEmptyString(value.normalizedTerm)
    && typeof value.weight === 'number' && value.weight >= 0 && value.weight <= 1 && typeof value.isActive === 'boolean'
    && ['llm', 'rule', 'manual', 'imported'].includes(String(value.metadataSource))
}

function isFoodUsageStat(value: unknown): value is FoodUsageStat {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.foodId) && Number.isInteger(value.selectionCount) && Number(value.selectionCount) >= 0
    && (value.lastSelectedAt === null || isIsoDateTime(value.lastSelectedAt)) && isIsoDateTime(value.updatedAt)
}

function isSearchLogItem(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.foodGroupId) || !isNonEmptyString(value.foodVariantId) || !Number.isInteger(value.rank) || Number(value.rank) < 1 || typeof value.score !== 'number' || !Number.isFinite(value.score) || !isNonEmptyString(value.matchedBy) || !isRecord(value.scoreBreakdown)) return false
  const breakdown = value.scoreBreakdown as Record<string, unknown>
  return ['text', 'representative', 'personalFrequency', 'recent', 'total'].every((key) => typeof breakdown[key] === 'number' && Number.isFinite(breakdown[key]))
}

function isSearchLog(value: unknown): value is SearchLog {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isIsoDateTime(value.createdAt) && isString(value.query) && isString(value.normalizedQuery)
    && Number.isInteger(value.resultCount) && Number(value.resultCount) >= 0 && typeof value.processingMs === 'number' && Number.isFinite(value.processingMs) && value.processingMs >= 0 && Array.isArray(value.items) && value.items.every(isSearchLogItem)
    && (value.selectedFoodGroupId === null || isNonEmptyString(value.selectedFoodGroupId))
    && (value.selectedFoodVariantId === null || isNonEmptyString(value.selectedFoodVariantId))
    && (value.selectedRank === null || (Number.isInteger(value.selectedRank) && Number(value.selectedRank) >= 1))
    && (value.selectionElapsedMs === null || (typeof value.selectionElapsedMs === 'number' && Number.isFinite(value.selectionElapsedMs) && value.selectionElapsedMs >= 0)) && typeof value.unselected === 'boolean'
}

function isMealEntry(value: unknown): value is MealEntry {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isIsoDateTime(value.eatenAt) && ['朝食', '昼食', '夕食', '間食'].includes(String(value.mealType))
    && isNonEmptyString(value.foodId) && isSnapshot(value.foodSnapshot) && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 100000
    && isValidUnit(String(value.amountUnit)) && value.amountUnit === value.foodSnapshot.baseUnit && isNutrients(value.calculatedNutrients)
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
  return isNonEmptyString(value.id) && isNonEmptyString(value.name) && ['主食', '主菜', '副菜', '汁物', '乳製品・果物', 'お菓子・スイーツ', 'その他'].includes(String(value.category))
    && Array.isArray(value.foodIds) && value.foodIds.every(isNonEmptyString)
    && (value.ingredients === undefined || (Array.isArray(value.ingredients) && value.ingredients.every(isMenuIngredient)))
    && (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every(isNonEmptyString)))
    && isIsoDateTime(value.createdAt) && isIsoDateTime(value.updatedAt)
}

function isMenuSet(value: unknown): value is MenuSet {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.name) && Array.isArray(value.menuIds) && value.menuIds.every(isNonEmptyString)
    && (value.foodIds === undefined || (Array.isArray(value.foodIds) && value.foodIds.every(isNonEmptyString)))
    && isIsoDateTime(value.createdAt) && isIsoDateTime(value.updatedAt)
}

function isBodyProfile(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isNullablePositiveNumber(value.heightCm) && isNullablePositiveNumber(value.weightKg) && isNullablePositiveNumber(value.ageYears)
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
    && value.displayUnit === 'default' && (value.lastBackupAt === null || isIsoDateTime(value.lastBackupAt))
    && value.dataFormatVersion === 1 && typeof value.externalApiEnabled === 'boolean'
    && isNonEmptyString(value.externalApiEndpoint)
    && (value.mealTimeMode === undefined || value.mealTimeMode === 'auto' || value.mealTimeMode === 'manual')
    && (value.bodyProfile === undefined || isBodyProfile(value.bodyProfile))
    && isFoodAttributePreferences(value.foodAttributePreferences)
}

export function validateBackup(value: unknown): BackupData {
  if (!isRecord(value)) throw new Error('JSONのトップレベルがオブジェクトではありません。')
  if (value.format !== 'nutrition-pwa-backup' || value.dataFormatVersion !== 1) {
    throw new Error('対応していないバックアップ形式またはバージョンです。')
  }
  if (!isIsoDateTime(value.exportedAt) || !Array.isArray(value.foods) || !Array.isArray(value.mealEntries)
    || !Array.isArray(value.favorites) || !isSettings(value.settings)) {
    throw new Error('バックアップの必須項目が不足しています。')
  }
  if (!value.foods.every(isFood) || !value.mealEntries.every(isMealEntry)) {
    throw new Error('食品または食事記録の形式が不正です。')
  }
  if (!hasUniqueValues(value.foods as Food[], (food) => food.id) || !hasUniqueValues(value.mealEntries as MealEntry[], (entry) => entry.id)) {
    throw new Error('食品または食事記録に重複したIDがあります。')
  }
  if ((value.menus !== undefined && (!Array.isArray(value.menus) || !value.menus.every(isMenu)))
    || (value.menuSets !== undefined && (!Array.isArray(value.menuSets) || !value.menuSets.every(isMenuSet)))) {
    throw new Error('メニューまたはメニューセットの形式が不正です。')
  }
  if ((value.menus !== undefined && !hasUniqueValues(value.menus as Menu[], (menu) => menu.id))
    || (value.menuSets !== undefined && !hasUniqueValues(value.menuSets as MenuSet[], (menuSet) => menuSet.id))) {
    throw new Error('メニューまたはメニューセットに重複したIDがあります。')
  }
  if (value.menus !== undefined && hasMenuCycles(value.menus as Menu[])) {
    throw new Error('料理メニューが循環して参照されています。')
  }
  if (!value.favorites.every((favorite) => isRecord(favorite) && isNonEmptyString(favorite.foodId) && isIsoDateTime(favorite.createdAt))
    || !hasUniqueValues(value.favorites as Array<{ foodId: string }>, (favorite) => favorite.foodId)) {
    throw new Error('お気に入り情報の形式が不正です。')
  }
  if ((value.foodGroups !== undefined && (!Array.isArray(value.foodGroups) || !value.foodGroups.every(isFoodGroup)))
    || (value.foodAliases !== undefined && (!Array.isArray(value.foodAliases) || !value.foodAliases.every(isFoodAlias)))
    || (value.foodRelatedTerms !== undefined && (!Array.isArray(value.foodRelatedTerms) || !value.foodRelatedTerms.every(isFoodRelatedTerm)))
    || (value.foodUsageStats !== undefined && (!Array.isArray(value.foodUsageStats) || !value.foodUsageStats.every(isFoodUsageStat)))
    || (value.searchLogs !== undefined && (!Array.isArray(value.searchLogs) || !value.searchLogs.every(isSearchLog)))) {
    throw new Error('食品グループ、検索メタデータ、利用統計または検索ログの形式が不正です。')
  }
  if ((value.foodGroups !== undefined && !hasUniqueValues(value.foodGroups as FoodGroup[], (group) => group.id))
    || (value.foodAliases !== undefined && !hasUniqueValues(value.foodAliases as FoodAlias[], (alias) => alias.id))
    || (value.foodRelatedTerms !== undefined && !hasUniqueValues(value.foodRelatedTerms as FoodRelatedTerm[], (term) => term.id))
    || (value.foodUsageStats !== undefined && !hasUniqueValues(value.foodUsageStats as FoodUsageStat[], (stat) => stat.foodId))
    || (value.searchLogs !== undefined && !hasUniqueValues(value.searchLogs as SearchLog[], (log) => log.id))) {
    throw new Error('検索関連データに重複したIDがあります。')
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
