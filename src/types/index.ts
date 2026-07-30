export const NUTRIENT_KEYS = [
  'energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'fiberG',
  'calciumMg', 'ironMg', 'vitaminAMcg', 'vitaminEMg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminCMg', 'saturatedFatG', 'saltG',
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]
export type Nutrients = Record<NutrientKey, number | null>

export type NutrientOrigin = 'manufacturer_label' | 'external_source' | 'user_input' | 'estimated' | 'derived' | 'unknown'
export type EstimationConfidence = 'high' | 'medium' | 'low' | 'unavailable'
export type EstimationZeroEvidence = 'derived_from_parent_zero' | 'known_parent_zero' | 'uncertain'
export type EstimationAdoptionClass =
  | 'standard_confirmation'
  | 'limited_confirmation'
  | 'genre_prior_confirmation'

export const ESTIMATION_LIMITATION_REASONS = [
  'invalid_basis',
  'reference_mass_missing',
  'reference_mass_source_missing',
  'ingredients_missing',
  'ingredients_unverified',
  'ingredient_parse_failed',
  'ingredient_unresolved',
  'reference_value_missing',
  'additive_contribution_unknown',
  'not_requested',
] as const

export type EstimationLimitationReason = (typeof ESTIMATION_LIMITATION_REASONS)[number]

/** 栄養値の由来。推計値は値だけでなく不確実性も一緒に保持する。 */
export interface NutrientMetadata {
  origin: NutrientOrigin
  source?: string
  verified?: boolean
  confidence?: EstimationConfidence
  estimatedRange?: { min: number; max: number }
  method?: string
  modelVersion?: string
  sourceFoodIds?: string[]
  requestId?: string
  adoptedAt?: string
  calibration?: EstimationCalibrationMetadata
  zeroEvidence?: EstimationZeroEvidence
  adoptionClass?: EstimationAdoptionClass
}

export type NutrientMetadataMap = Partial<Record<NutrientKey, NutrientMetadata>>

export interface IngredientsSource {
  provider: string
  retrievedAt?: string
  version?: string
  verified?: boolean
  note?: string
}

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

export type FoodSource = 'mext' | 'open_food_facts' | 'imported' | 'user'
export type SearchMetadataSource = 'llm' | 'rule' | 'manual' | 'imported'
export const ESTIMATOR_GENRE_IDS = [
  'baked_sweets',
  'cake_pastry',
  'bread',
  'chocolate',
  'sugar_confectionery',
  'snack_rice_cracker',
  'frozen_dessert',
  'dairy',
  'drink_jelly_pudding',
  'fried_food',
  'noodle_flour_dish',
  'prepared_meal',
  'sauce_spread',
  'other_unknown',
] as const
export type EstimatorGenreId = (typeof ESTIMATOR_GENRE_IDS)[number]
export type EstimatorGenreSource = 'user' | 'off_category' | 'name_rule' | 'ingredient_rule' | 'unknown'
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
  /** パッケージ等から確認した原材料表示。未確認の外部値は保存しない。 */
  ingredientsText?: string | null
  ingredientsSource?: IngredientsSource | null
  /** 基準量に対応する質量を明示できる場合だけ設定する。単位から推測してはならない。 */
  estimationReferenceMassG?: number | null
  estimationReferenceMassSource?: string | null
  /** 推計専用のユーザー向け1階層ジャンル。食品検索用のfoodGroupIdとは分離する。 */
  estimatorGenreId?: EstimatorGenreId | null
  estimatorGenreSource?: EstimatorGenreSource | null
  nutrientMetadata?: NutrientMetadataMap
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
  /** 検索結果など、ユーザーが食品を選んだ入口で表示されていた一般名。 */
  userFacingName?: string
  maker: string
  barcode: string
  baseAmount: number
  baseUnit: FoodUnit
  inputUnitConversions?: FoodUnitConversion[]
  /** 食品マスターが削除済みの場合に、未集計の履歴として保持する印。 */
  missing?: boolean
  nutrients: Nutrients
  /** 記録時点の由来を固定し、後から食品マスターの推計採用を遡及させない。 */
  nutrientMetadata?: NutrientMetadataMap
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
  /** 未指定は既存データとの互換のためMyメニューとして扱う。 */
  sourceKind?: 'my-menu' | 'general-menu' | 'temporary'
  ingredients: MealIngredientSnapshot[]
}

export interface MealEntry {
  id: string
  eatenAt: string
  mealType: MealType
  /** 同じ日・食事区分内の表示順。時刻とは独立して扱う。 */
  sortOrder?: number
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

/** ユーザーが作成する一般メニュー。Myメニューとは別ストアで管理する。 */
export type GeneralMenu = Menu

export interface MenuSet {
  id: string
  name: string
  /** 同じMyセット一覧内の表示順。未指定は既存の名前順で扱う。 */
  sortOrder?: number
  menuIds: string[]
  /** 一般メニューをセットへ含めるための参照。未指定は空として扱う。 */
  generalMenuIds?: string[]
  /** 新形式。食品の確定variantと入力分量を保持する。 */
  foodItems?: MenuSetFoodItem[]
  /** 旧形式。foodItemsがない場合は食品の既定量へ読み替える。 */
  foodIds?: string[]
  createdAt: string
  updatedAt: string
}

export interface MenuSetFoodItem {
  foodId: string
  amount: number
  unit: QuantityUnit
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

export type EstimationRequestStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled'
export type EstimationDecisionKind = 'adopted' | 'rejected' | 'reverted'
export type EstimationTrigger = 'manual' | 'after_barcode'

export interface NutritionEstimationInput {
  requestId: string
  foodId: string
  barcode: string
  name: string
  maker: string
  estimatorCategoryId?: string | null
  estimatorGenreId?: EstimatorGenreId | null
  estimatorGenreSource?: EstimatorGenreSource | null
  baseAmount: number
  baseUnit: FoodUnit
  inputUnitConversions: FoodUnitConversion[]
  referenceMassG?: number | null
  referenceMassSource?: string | null
  knownNutrients: Partial<Nutrients>
  missingNutrients: NutrientKey[]
  ingredientsText: string | null
  ingredientsSource: IngredientsSource | null
  requestedAt: string
  /** 競合検出用に要求作成時の食品更新日時も保存する。 */
  foodUpdatedAt: string
  inputHash: string
}

export interface EstimationRequest {
  requestId: string
  foodId: string
  barcode: string
  inputSnapshot: NutritionEstimationInput
  status: EstimationRequestStatus
  inputHash: string
  createdAt: string
  updatedAt: string
}

export interface NutrientEstimate {
  value: number
  range?: { min: number; max: number }
  confidence: EstimationConfidence
  method: string
  source?: string
  sourceFoodIds?: string[]
  warnings: string[]
  limitationReasons?: EstimationLimitationReason[]
  calibration?: EstimationCalibrationMetadata
  zeroEvidence?: EstimationZeroEvidence
  adoptionClass?: EstimationAdoptionClass
  ratioAdjustment?: EstimationRatioAdjustment
}

export interface EstimationCalibrationMetadata {
  calibrationVersion: string
  targetCoverage: number
  actualCoverage?: number
  sampleSize: number
  datasetHash?: string
  scope: 'genre_nutrient' | 'pooled_nutrient' | 'fallback'
}

export interface EstimationRatioAdjustment {
  ratioKey: 'saturatedFatToFat'
  parentNutrient: 'fatG'
  parentValue: number
  blendWeight: number
  p05: number
  median: number
  p95: number
  sampleSize: number
  pooledSampleSize?: number
  scope: Extract<EstimationCalibrationMetadata['scope'], 'genre_nutrient' | 'pooled_nutrient'>
  priorVersion: string
  datasetHash: string
  unadjustedValue: number
  unadjustedRange: { min: number; max: number }
}

export interface EstimationRatioFeedback {
  ratioKey: 'saturatedFatToFat'
  parentNutrient: 'fatG'
  parentValue: number
  feedbackWeight: number
  p05: number
  median: number
  p95: number
  sampleSize: number
  pooledSampleSize?: number
  scope: Extract<EstimationCalibrationMetadata['scope'], 'genre_nutrient' | 'pooled_nutrient'>
  priorVersion: string
  datasetHash: string
  predictedRatio: number
  penalty: number
  optimizedIngredientRatios: boolean
}

export interface EstimationTrace {
  ingredientNames: string[]
  selectedProfileIds: Array<string | null>
  ingredientRatios: number[]
  fitScore: number | null
  normalizedFitError: number | null
  candidateCombinationCount: number
  retainedCandidateCombinationCount: number
  plausibleScenarioCount: number
  unresolvedMassRatio: number
  /** 対象栄養素でジャンル分布を適用した、製品重量に対する暫定重量比。 */
  genrePriorContributionRatios: Partial<Record<NutrientKey, number>>
  /** 候補・配合探索へ弱い制約として戻した栄養素比率。 */
  ratioFeedback?: EstimationRatioFeedback
}

export interface EstimationOptimization {
  converged: boolean
  objectiveError?: number
  scenarioCount?: number
  trace?: EstimationTrace
}

export interface EstimationResult {
  requestId: string
  foodId: string
  inputHash: string
  status: Extract<EstimationRequestStatus, 'completed' | 'partial' | 'failed'>
  basis?: { baseAmount: number; baseUnit: FoodUnit }
  estimates: Partial<Record<NutrientKey, NutrientEstimate>>
  globalWarnings: string[]
  unresolvedIngredients?: string[]
  limitationReasons?: EstimationLimitationReason[]
  optimization?: EstimationOptimization
  error?: { code: string; message: string; nextAction: string }
  modelVersion: string
  estimatedAt: string
}

/** 未対応原材料は食品・バーコードへ紐付けず、端末内で集計値だけを保持する。 */
export interface UnresolvedIngredientStat {
  id: string
  normalizedName: string
  example: string
  estimatorGenreId: EstimatorGenreId
  count: number
  firstSeenAt: string
  lastSeenAt: string
}

export interface EstimationDecision {
  decisionId: string
  requestId: string
  foodId: string
  nutrientKey: NutrientKey
  decision: EstimationDecisionKind
  previousValue: number | null
  previousMetadata?: NutrientMetadata
  adoptedValue?: number
  adoptedMetadata?: NutrientMetadata
  foodUpdatedAtBeforeDecision: string
  foodUpdatedAtAfterDecision?: string
  decidedAt: string
}

export interface EstimationSettings {
  id: 'default'
  enabled: boolean
  trigger: EstimationTrigger
  /** 正本要件により自動採用は許可しない。 */
  applyMode: 'manual'
  minimumConfidenceForSuggestion: EstimationConfidence
  updatedAt: string
}

export const DEFAULT_ESTIMATION_SETTINGS: EstimationSettings = {
  id: 'default',
  enabled: false,
  trigger: 'manual',
  applyMode: 'manual',
  minimumConfidenceForSuggestion: 'low',
  updatedAt: '1970-01-01T00:00:00.000Z',
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
  generalMenus?: GeneralMenu[]
  menuSets?: MenuSet[]
  settings: AppSettings
  /** v2からの推計関連データ。v1バックアップには存在しない。 */
  estimationDataFormatVersion?: number
  estimationSettings?: EstimationSettings
  estimationRequests?: EstimationRequest[]
  estimationResults?: EstimationResult[]
  estimationDecisions?: EstimationDecision[]
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
  dataFormatVersion: 2,
  externalApiEnabled: false,
  externalApiEndpoint: 'https://world.openfoodfacts.org/api/v3/product',
  mealTimeMode: 'auto',
  bodyProfile: DEFAULT_BODY_PROFILE,
}
