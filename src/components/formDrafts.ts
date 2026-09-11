import {
  type NutrientEstimateAdoption,
  type NutrientEstimateEvaluation,
} from '../components/NutrientEstimatePanel'
import { inferEstimatorGenre } from '../services/estimatorGenre'
import { EXTERNAL_UNNAMED_PRODUCT_LABEL, type ExternalFoodPreview } from '../services/externalFoodApi'
import {
  DEFAULT_BODY_PROFILE,
  NUTRIENT_KEYS,
  type ActivityLevel,
  type BiologicalSex,
  type BodyProfile,
  type EstimatorGenreId,
  type EstimatorGenreSource,
  type Food,
  type FoodAlias,
  type FoodAliasType,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodUnit,
  type FoodVariantAttributes,
  type MenuCategory,
  type MenuIngredient,
  type NutrientKey,
  type NutrientMetadataMap,
  type QuantityUnit,
} from '../types'

export type FoodFormReturnView = 'food-screen' | 'settings' | 'search-results'

export type MenuIngredientDraft = Omit<MenuIngredient, 'amount'> & { amount: string }

export interface MenuDraft {
  id: string | null
  name: string
  category: MenuCategory
  ingredients: MenuIngredientDraft[]
  aliases: string[]
  memo?: string
}

export interface MenuSetDraft {
  id: string | null
  name: string
  menuIds: string[]
  generalMenuIds: string[]
  foodIds: string[]
  foodItems: MenuSetFoodItemDraft[]
}

export interface MenuSetFoodItemDraft {
  foodId: string
  amount: string
  unit: QuantityUnit
}

export interface BodyProfileDraft {
  heightCm: string
  weightKg: string
  ageYears: string
  sex: BiologicalSex
  activityLevel: ActivityLevel
}

interface PendingEstimationDecision {
  evaluation: NutrientEstimateEvaluation
  adoption: NutrientEstimateAdoption | null
  rejectedKeys: NutrientKey[]
}

export interface FoodDraft {
  id: string | null
  name: string
  maker: string
  barcode: string
  isCommercial: boolean
  source: Food['source']
  sourceVersion: string
  baseAmount: string
  baseUnit: FoodUnit
  inputUnit: string
  inputUnitBaseAmount: string
  servingAmount: string
  servingUnit: QuantityUnit
  menuIds: string[]
  foodGroupId: string
  groupDisplayName: string
  groupReading: string
  groupCategory: string
  aliases: Array<{ value: string; type: FoodAliasType }>
  relatedTerms: string[]
  variantAttributes: Record<keyof FoodVariantAttributes, string>
  nutrients: Record<NutrientKey, string>
  ingredientsText: string
  ingredientsSourceProvider: string
  estimatorGenreId: EstimatorGenreId
  estimatorGenreSource: EstimatorGenreSource
  estimationReferenceMassG: string
  estimationReferenceMassSource: string
  nutrientMetadata: NutrientMetadataMap
  pendingEstimation: PendingEstimationDecision | null
}

export const nutrientKeys = [...NUTRIENT_KEYS]
export const emptyNutrientInputs = (): Record<NutrientKey, string> => Object.fromEntries(nutrientKeys.map((key) => [key, ''])) as Record<NutrientKey, string>
export const formatEstimateInput = (value: number): string => value.toFixed(1)
export const variantAttributeKeys: Array<keyof FoodVariantAttributes> = ['species', 'part', 'variety', 'nameSpecification', 'cultivation', 'sourceBean', 'skin', 'preparation', 'processing']
export const variantAttributeLabels: Record<keyof FoodVariantAttributes, string> = {
  species: '種類', part: '部位', variety: '品種・区分', nameSpecification: '名称仕様', cultivation: '栽培方法', sourceBean: '原料豆', skin: '皮の状態', preparation: '調理方法', processing: '加工状態',
}
const emptyVariantInputs = (): Record<keyof FoodVariantAttributes, string> => Object.fromEntries(variantAttributeKeys.map((key) => [key, ''])) as Record<keyof FoodVariantAttributes, string>

export function emptyFoodDraft(barcode = '', initialName = ''): FoodDraft {
  const genre = inferEstimatorGenre({ productName: initialName })
  return {
    id: null, name: initialName, maker: '', barcode, isCommercial: Boolean(barcode.trim()), source: 'user', sourceVersion: 'ユーザー入力',
    baseAmount: '100', baseUnit: 'g', inputUnit: '', inputUnitBaseAmount: '', servingAmount: '', servingUnit: 'g', menuIds: [], foodGroupId: '', groupDisplayName: initialName,
    groupReading: '', groupCategory: '', aliases: [], relatedTerms: [], variantAttributes: emptyVariantInputs(), nutrients: emptyNutrientInputs(),
    ingredientsText: '', ingredientsSourceProvider: '', estimationReferenceMassG: '', estimationReferenceMassSource: '',
    estimatorGenreId: genre.id, estimatorGenreSource: genre.source,
    nutrientMetadata: {}, pendingEstimation: null,
  }
}

export function bodyProfileToDraft(profile: BodyProfile | undefined): BodyProfileDraft {
  const current = profile ?? DEFAULT_BODY_PROFILE
  return {
    heightCm: current.heightCm === null ? '' : String(current.heightCm), weightKg: current.weightKg === null ? '' : String(current.weightKg),
    ageYears: current.ageYears === null ? '' : String(current.ageYears), sex: current.sex, activityLevel: current.activityLevel,
  }
}

export function foodToDraft(food: Food, group: FoodGroup | undefined, aliases: FoodAlias[], relatedTerms: FoodRelatedTerm[]): FoodDraft {
  const conversion = food.inputUnitConversions?.[0]
  const inferredGenre = inferEstimatorGenre({ productName: food.name, ingredientsText: food.ingredientsText })
  return {
    id: food.id, name: food.name, maker: food.maker, barcode: food.barcode, isCommercial: food.isCommercial === true, source: food.source,
    sourceVersion: food.sourceVersion, baseAmount: String(food.baseAmount), baseUnit: food.baseUnit,
    inputUnit: conversion?.unit ?? '', inputUnitBaseAmount: conversion ? String(conversion.baseAmount) : '',
    servingAmount: food.servingAmount === null ? '' : String(food.servingAmount), servingUnit: food.servingUnit ?? food.baseUnit,
    menuIds: food.menuIds ?? [], foodGroupId: group?.id ?? food.foodGroupId ?? '', groupDisplayName: group?.displayName ?? food.displayName ?? food.name,
    groupReading: group?.reading ?? food.reading ?? '', groupCategory: group?.category ?? '',
    aliases: aliases.filter((alias) => alias.isActive).map((alias) => ({ value: alias.alias, type: alias.aliasType })),
    relatedTerms: relatedTerms.filter((term) => term.isActive).map((term) => term.term),
    variantAttributes: Object.fromEntries(variantAttributeKeys.map((key) => [key, food.variantAttributes?.[key] ?? ''])) as Record<keyof FoodVariantAttributes, string>,
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, food.nutrients[key] === null ? '' : String(food.nutrients[key])])) as Record<NutrientKey, string>,
    ingredientsText: food.ingredientsText ?? '',
    ingredientsSourceProvider: food.ingredientsSource?.provider ?? '',
    estimatorGenreId: food.estimatorGenreId ?? inferredGenre.id,
    estimatorGenreSource: food.estimatorGenreSource ?? inferredGenre.source,
    estimationReferenceMassG: food.estimationReferenceMassG === null || food.estimationReferenceMassG === undefined ? '' : String(food.estimationReferenceMassG),
    estimationReferenceMassSource: food.estimationReferenceMassSource ?? '',
    nutrientMetadata: Object.fromEntries(Object.entries(food.nutrientMetadata ?? {}).map(([key, metadata]) => [key, {
      ...metadata,
      sourceFoodIds: metadata.sourceFoodIds ? [...metadata.sourceFoodIds] : undefined,
      calibration: metadata.calibration ? { ...metadata.calibration } : undefined,
    }])) as NutrientMetadataMap,
    pendingEstimation: null,
  }
}

export function previewToDraft(preview: ExternalFoodPreview): FoodDraft {
  const initialName = preview.name === EXTERNAL_UNNAMED_PRODUCT_LABEL ? '' : preview.name
  const genre = inferEstimatorGenre({ productName: initialName, ingredientsText: preview.ingredientsText, offCategories: preview.categories })
  return {
    ...emptyFoodDraft(preview.barcode, initialName), groupDisplayName: initialName, maker: preview.maker, source: 'open_food_facts',
    sourceVersion: 'Open Food Facts（取得値は確認後に保存）', baseAmount: String(preview.baseAmount), baseUnit: preview.baseUnit,
    servingAmount: '', servingUnit: preview.baseUnit, menuIds: [],
    ingredientsText: preview.ingredientsText ?? '',
    ingredientsSourceProvider: preview.ingredientsText ? 'Open Food Facts' : '',
    estimatorGenreId: genre.id,
    estimatorGenreSource: genre.source,
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, preview.nutrients[key] === null ? '' : String(preview.nutrients[key])])) as Record<NutrientKey, string>,
  }
}
