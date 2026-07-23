export const NUTRIENT_KEYS = [
  'energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'fiberG',
  'calciumMg', 'ironMg', 'vitaminAMcg', 'vitaminEMg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminCMg', 'saturatedFatG', 'saltG',
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]
export type Nutrients = Record<NutrientKey, number | null>

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  energyKcal: 'エネルギー',
  proteinG: 'たんぱく質',
  fatG: '脂質',
  carbohydrateG: '炭水化物',
  fiberG: '食物繊維',
  saltG: '食塩相当量',
  calciumMg: 'カルシウム',
  ironMg: '鉄',
  vitaminAMcg: 'ビタミンA',
  vitaminEMg: 'ビタミンE',
  vitaminB1Mg: 'ビタミンB1',
  vitaminB2Mg: 'ビタミンB2',
  vitaminCMg: 'ビタミンC',
  saturatedFatG: '飽和脂肪酸',
}

export const NUTRIENT_UNITS: Record<NutrientKey, string> = {
  energyKcal: 'kcal',
  proteinG: 'g',
  fatG: 'g',
  carbohydrateG: 'g',
  fiberG: 'g',
  saltG: 'g',
  calciumMg: 'mg',
  ironMg: 'mg',
  vitaminAMcg: 'μg',
  vitaminEMg: 'mg',
  vitaminB1Mg: 'mg',
  vitaminB2Mg: 'mg',
  vitaminCMg: 'mg',
  saturatedFatG: 'g',
}

export type FoodSource = 'mext' | 'open_food_facts' | 'user'
export type SearchMetadataSource = 'llm' | 'rule' | 'manual' | 'imported'
/** 栄養価の基準量に使う、アプリが管理する単位。 */
export type FoodUnit = 'g' | 'ml' | '個' | '合' | '袋' | '本' | '枚' | '食' | '丁' | '小さじ' | '杯' | 'その他'
/** 食品ごとに明示登録された入力用単位。ユーザー定義ラベルを含む。 */
export type QuantityUnit = string
export type MealType = '朝食' | '昼食' | '夕食' | '間食'
export type MealTimeMode = 'auto' | 'manual'
export type BiologicalSex = 'male' | 'female' | 'unspecified'
export type ActivityLevel = 'low' | 'moderate' | 'high'
export type MenuCategory = '主食' | '主菜' | '副菜' | '汁物' | '乳製品・果物' | 'お菓子・スイーツ' | 'その他'

export const FOOD_UNITS: FoodUnit[] = ['g', 'ml', '個', '合', '袋', '本', '枚', '食', '丁', '小さじ', '杯', 'その他']

export const MEAL_TYPES: MealType[] = ['朝食', '昼食', '夕食', '間食']
export const MENU_CATEGORIES: MenuCategory[] = ['主食', '主菜', '副菜', '汁物', '乳製品・果物', 'お菓子・スイーツ', 'その他']

export interface Food {
  id: string
  name: string
  officialName?: string
  displayName?: string
  reading?: string | null
  maker: string
  barcode: string
  isCommercial?: boolean
  source: FoodSource
  sourceVersion: string
  baseAmount: number
  baseUnit: FoodUnit
  servingAmount: number | null
  servingUnit: QuantityUnit | null
  /** 1入力用単位が何基準量に相当するか。将来の複数単位に備えて配列で保持する。 */
  inputUnitConversions?: FoodUnitConversion[]
  menuIds?: string[]
  foodGroupId?: string
  variantAttributes?: FoodVariantAttributes
  nutrients: Nutrients
  createdAt: string
  updatedAt: string
}

export interface FoodUnitConversion {
  unit: QuantityUnit
  baseAmount: number
}

export interface FoodVariantAttributes {
  species?: string | null
  part?: string | null
  cultivation?: string | null
  sourceBean?: string | null
  skin?: string | null
  preparation?: string | null
  processing?: string | null
  variety?: string | null
  nameSpecification?: string | null
}

export interface FoodGroup {
  id: string
  displayName: string
  reading: string | null
  category: string | null
  representativeScore: number
  defaultVariantId: string | null
  isActive: boolean
  metadataSource: SearchMetadataSource
  generationVersion: string
  needsReview: boolean
  createdAt: string
  updatedAt: string
}

export type FoodAliasType = 'synonym' | 'reading' | 'abbreviation'

export interface FoodAlias {
  id: string
  foodGroupId: string
  foodVariantId: string | null
  alias: string
  normalizedAlias: string
  aliasType: FoodAliasType
  priority: number
  isActive: boolean
  metadataSource: SearchMetadataSource
}

export interface FoodRelatedTerm {
  id: string
  foodGroupId: string
  term: string
  normalizedTerm: string
  weight: number
  isActive: boolean
  metadataSource: SearchMetadataSource
}

export interface FoodUsageStat {
  foodId: string
  selectionCount: number
  lastSelectedAt: string | null
  updatedAt: string
}

export interface SearchScoreBreakdown {
  text: number
  representative: number
  personalFrequency: number
  recent: number
  total: number
}

export interface SearchLogItem {
  foodGroupId: string
  foodVariantId: string
  rank: number
  score: number
  matchedBy: string
  scoreBreakdown: SearchScoreBreakdown
}

export interface SearchLog {
  id: string
  createdAt: string
  query: string
  normalizedQuery: string
  resultCount: number
  processingMs: number
  items: SearchLogItem[]
  selectedFoodGroupId: string | null
  selectedFoodVariantId: string | null
  selectedRank: number | null
  selectionElapsedMs: number | null
  unselected: boolean
}

export interface FoodSnapshot {
  name: string
  officialName?: string
  displayName?: string
  maker: string
  barcode: string
  baseAmount: number
  baseUnit: FoodUnit
  inputUnitConversions?: FoodUnitConversion[]
  /** 食品マスターが削除済みの場合に、未集計の履歴として保持する印。 */
  missing?: boolean
  nutrients: Nutrients
}

export interface MealFoodIngredientSnapshot {
  kind: 'food'
  itemId: string
  amount: number
  unit: QuantityUnit
  foodSnapshot: FoodSnapshot
}

export interface MealMenuIngredientSnapshot {
  kind: 'menu'
  itemId: string
  name: string
  amount: number
  unit: QuantityUnit
  ingredients: MealIngredientSnapshot[]
  missing: boolean
}

export type MealIngredientSnapshot = MealFoodIngredientSnapshot | MealMenuIngredientSnapshot

export interface MealMenuSnapshot {
  sourceMenuId: string
  sourceMenuName: string
  ingredients: MealIngredientSnapshot[]
}

export interface MealEntry {
  id: string
  eatenAt: string
  mealType: MealType
  foodId: string
  foodSnapshot: FoodSnapshot
  amount: number
  amountUnit: QuantityUnit
  calculatedNutrients: Nutrients
  /** 料理メニューを登録した時点の構成。食事ごとのアレンジはこの複製だけを変更する。 */
  menuSnapshot?: MealMenuSnapshot
}

export interface MenuIngredient {
  kind: 'food' | 'menu'
  itemId: string
  amount: number
  unit: QuantityUnit
}

export interface Menu {
  id: string
  name: string
  category: MenuCategory
  /** 旧データおよび食品検索との互換用。新規保存ではingredients内の食品IDと同期する。 */
  foodIds: string[]
  ingredients?: MenuIngredient[]
  aliases?: string[]
  createdAt: string
  updatedAt: string
}

export interface MenuSet {
  id: string
  name: string
  menuIds: string[]
  foodIds?: string[]
  createdAt: string
  updatedAt: string
}

export interface NutritionGoals {
  energyKcal: number | null
  proteinG: number | null
  fatG: number | null
  carbohydrateG: number | null
  fiberG: number | null
  saltG: number | null
  calciumMg: number | null
  ironMg: number | null
  vitaminAMcg: number | null
  vitaminEMg: number | null
  vitaminB1Mg: number | null
  vitaminB2Mg: number | null
  vitaminCMg: number | null
  saturatedFatG: number | null
}

export interface BodyProfile {
  heightCm: number | null
  weightKg: number | null
  sex: BiologicalSex
  ageYears: number | null
  activityLevel: ActivityLevel
}

export type FoodAttributePreferenceMode = 'prefill' | 'auto'

export interface FoodAttributePreference {
  defaultValueId: string
  mode: FoodAttributePreferenceMode
  /** falseの場合は食品ピッカーで属性を省略する。旧バックアップでは未指定。 */
  visible?: boolean
}

export type FoodAttributePreferences = Record<string, Record<string, FoodAttributePreference>>

export interface AppSettings {
  id: 'app'
  goals: NutritionGoals
  displayUnit: 'default'
  lastBackupAt: string | null
  dataFormatVersion: number
  externalApiEnabled: boolean
  externalApiEndpoint: string
  mealTimeMode?: MealTimeMode
  bodyProfile?: BodyProfile
  foodAttributePreferences?: FoodAttributePreferences
}

export interface FavoriteRecord {
  foodId: string
  createdAt: string
}

export interface MetadataRecord {
  key: string
  value: string | number | boolean
}

export interface BackupData {
  format: 'nutrition-pwa-backup'
  dataFormatVersion: number
  exportedAt: string
  foods: Food[]
  mealEntries: MealEntry[]
  favorites: FavoriteRecord[]
  foodGroups?: FoodGroup[]
  foodAliases?: FoodAlias[]
  foodRelatedTerms?: FoodRelatedTerm[]
  foodUsageStats?: FoodUsageStat[]
  searchLogs?: SearchLog[]
  menus?: Menu[]
  menuSets?: MenuSet[]
  settings: AppSettings
}

export const EMPTY_NUTRIENTS: Nutrients = {
  energyKcal: null,
  proteinG: null,
  fatG: null,
  carbohydrateG: null,
  fiberG: null,
  saltG: null,
  calciumMg: null,
  ironMg: null,
  vitaminAMcg: null,
  vitaminEMg: null,
  vitaminB1Mg: null,
  vitaminB2Mg: null,
  vitaminCMg: null,
  saturatedFatG: null,
}

export const DEFAULT_GOALS: NutritionGoals = { ...EMPTY_NUTRIENTS }

export const DEFAULT_BODY_PROFILE: BodyProfile = {
  heightCm: null,
  weightKg: null,
  sex: 'unspecified',
  ageYears: null,
  activityLevel: 'moderate',
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  goals: DEFAULT_GOALS,
  displayUnit: 'default',
  lastBackupAt: null,
  dataFormatVersion: 1,
  externalApiEnabled: false,
  externalApiEndpoint: 'https://world.openfoodfacts.org/api/v3/product',
  mealTimeMode: 'auto',
  bodyProfile: DEFAULT_BODY_PROFILE,
}
