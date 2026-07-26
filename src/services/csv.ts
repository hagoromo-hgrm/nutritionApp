import { formatDateKey } from '../utils/date'
import { NUTRIENT_KEYS, type MealEntry, type NutrientKey, type NutrientMetadataMap, type Nutrients } from '../types'
import { isMealMenuSnapshot } from './mealMenuSnapshots'
import { isFoodUnitConversion, isValidQuantityUnit, isValidUnit } from '../utils/validation'

const NUTRIENT_COLUMNS: ReadonlyArray<readonly [NutrientKey, string]> = [
  ['energyKcal', 'energy_kcal'],
  ['proteinG', 'protein_g'],
  ['fatG', 'fat_g'],
  ['carbohydrateG', 'carbohydrate_g'],
  ['fiberG', 'fiber_g'],
  ['saltG', 'salt_g'],
  ['calciumMg', 'calcium_mg'],
  ['ironMg', 'iron_mg'],
  ['vitaminAMcg', 'vitamin_a_mcg'],
  ['vitaminEMg', 'vitamin_e_mg'],
  ['vitaminB1Mg', 'vitamin_b1_mg'],
  ['vitaminB2Mg', 'vitamin_b2_mg'],
  ['vitaminCMg', 'vitamin_c_mg'],
  ['saturatedFatG', 'saturated_fat_g'],
]

const BASE_HEADERS = [
  'id', 'date', 'eaten_at', 'meal_type', 'food_id', 'food_name', 'maker', 'barcode', 'amount', 'amount_unit',
  'base_amount', 'base_unit',
] as const

const SNAPSHOT_NUTRIENT_COLUMNS: ReadonlyArray<readonly [NutrientKey, string]> = NUTRIENT_COLUMNS.map(([key, header]) => [key, `food_snapshot_${header}`] as const)

export const LEGACY_CSV_HEADERS = [
  ...BASE_HEADERS,
  ...NUTRIENT_COLUMNS.map(([, header]) => header),
  ...SNAPSHOT_NUTRIENT_COLUMNS.map(([, header]) => header),
  'menu_snapshot_json',
] as const

export const PREVIOUS_CSV_HEADERS = [
  ...BASE_HEADERS,
  ...NUTRIENT_COLUMNS.map(([, header]) => header),
  ...SNAPSHOT_NUTRIENT_COLUMNS.map(([, header]) => header),
  'input_unit_base_amount',
  'food_snapshot_input_unit_conversions_json',
  'menu_snapshot_json',
] as const

export const SORTED_CSV_HEADERS = [
  ...PREVIOUS_CSV_HEADERS,
  'sort_order',
] as const

export const USER_FACING_CSV_HEADERS = [
  ...SORTED_CSV_HEADERS,
  'user_facing_name',
] as const

export const CSV_HEADERS = [
  ...USER_FACING_CSV_HEADERS,
  'food_snapshot_nutrient_metadata_json',
] as const

function escapeCsv(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function mealsToCsv(entries: MealEntry[]): string {
  const rows = entries.map((entry) => [
    entry.id, formatDateKey(entry.eatenAt), entry.eatenAt, entry.mealType, entry.foodId,
    entry.foodSnapshot.name, entry.foodSnapshot.maker, entry.foodSnapshot.barcode, entry.amount, entry.amountUnit,
    entry.foodSnapshot.baseAmount, entry.foodSnapshot.baseUnit,
    ...NUTRIENT_COLUMNS.map(([key]) => entry.calculatedNutrients[key]),
    ...SNAPSHOT_NUTRIENT_COLUMNS.map(([key]) => entry.foodSnapshot.nutrients[key]),
    entry.foodSnapshot.inputUnitConversions?.find((conversion) => conversion.unit === entry.amountUnit)?.baseAmount ?? '',
    entry.foodSnapshot.inputUnitConversions?.length ? JSON.stringify(entry.foodSnapshot.inputUnitConversions) : '',
    entry.menuSnapshot ? JSON.stringify(entry.menuSnapshot) : '',
    entry.sortOrder ?? '',
    entry.foodSnapshot.userFacingName ?? '',
    entry.foodSnapshot.nutrientMetadata ? JSON.stringify(entry.foodSnapshot.nutrientMetadata) : '',
  ])
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('CSVの引用符が閉じられていません。')
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((value) => value !== '')) rows.push(row)
  }
  return rows
}

function parseRequiredNumber(value: string, label: string, rowNumber: number): number {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed)) throw new Error(`${rowNumber}行目の${label}が不正です。`)
  return parsed
}

function parsePositiveNumber(value: string, label: string, rowNumber: number): number {
  const parsed = parseRequiredNumber(value, label, rowNumber)
  if (parsed <= 0) throw new Error(`${rowNumber}行目の${label}は正の数値で入力してください。`)
  return parsed
}

function parseNullableNumber(value: string, label: string, rowNumber: number): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${rowNumber}行目の${label}が不正です。`)
  return parsed
}

function parseNutrients(row: string[], headerIndex: Map<string, number>, columns: ReadonlyArray<readonly [NutrientKey, string]>, rowNumber: number): Nutrients {
  return Object.fromEntries(columns.map(([key, header]) => [key, parseNullableNumber(row[headerIndex.get(header) ?? -1] ?? '', header, rowNumber)])) as Nutrients
}

function parseInputUnitConversions(value: string, rowNumber: number): MealEntry['foodSnapshot']['inputUnitConversions'] {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every(isFoodUnitConversion)) throw new Error('invalid')
    const units = parsed.map((conversion) => conversion.unit)
    if (new Set(units).size !== units.length) throw new Error('duplicate')
    return parsed.map((conversion) => ({ ...conversion, unit: conversion.unit.trim() }))
  } catch {
    throw new Error(`${rowNumber}行目の換算情報が不正です。`)
  }
}

function parseNutrientMetadata(value: string, rowNumber: number): NutrientMetadataMap | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid')
    const metadata = parsed as Record<string, unknown>
    for (const [key, item] of Object.entries(metadata)) {
      if (!(NUTRIENT_KEYS as readonly string[]).includes(key) || typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('invalid')
      const record = item as Record<string, unknown>
      if (!['manufacturer_label', 'external_source', 'user_input', 'estimated', 'derived', 'unknown'].includes(String(record.origin))) throw new Error('origin')
      if (record.source !== undefined && typeof record.source !== 'string') throw new Error('source')
      if (record.verified !== undefined && typeof record.verified !== 'boolean') throw new Error('verified')
      if (record.confidence !== undefined && !['high', 'medium', 'low', 'unavailable'].includes(String(record.confidence))) throw new Error('confidence')
      if (record.sourceFoodIds !== undefined && (!Array.isArray(record.sourceFoodIds) || !record.sourceFoodIds.every((id) => typeof id === 'string' && id.length > 0))) throw new Error('sourceFoodIds')
      if (record.estimatedRange !== undefined && (typeof record.estimatedRange !== 'object' || record.estimatedRange === null || Array.isArray(record.estimatedRange)
        || typeof (record.estimatedRange as Record<string, unknown>).min !== 'number' || !Number.isFinite((record.estimatedRange as Record<string, unknown>).min)
        || typeof (record.estimatedRange as Record<string, unknown>).max !== 'number' || !Number.isFinite((record.estimatedRange as Record<string, unknown>).max)
        || Number((record.estimatedRange as Record<string, unknown>).min) < 0
        || Number((record.estimatedRange as Record<string, unknown>).max) < Number((record.estimatedRange as Record<string, unknown>).min))) throw new Error('estimatedRange')
      if (record.method !== undefined && (typeof record.method !== 'string' || !record.method.trim())) throw new Error('method')
      if (record.modelVersion !== undefined && (typeof record.modelVersion !== 'string' || !record.modelVersion.trim())) throw new Error('modelVersion')
      if (record.requestId !== undefined && (typeof record.requestId !== 'string' || !record.requestId.trim())) throw new Error('requestId')
      if (record.adoptedAt !== undefined && (typeof record.adoptedAt !== 'string' || Number.isNaN(new Date(record.adoptedAt).getTime()))) throw new Error('adoptedAt')
    }
    return parsed as NutrientMetadataMap
  } catch {
    throw new Error(`${rowNumber}行目の栄養値由来情報が不正です。`)
  }
}

export function parseMealsCsv(text: string): MealEntry[] {
  const rows = parseCsvRows(text)
  const headers = rows[0] ?? []
  const isCurrentHeader = headers.length === CSV_HEADERS.length && headers.every((header, index) => header === CSV_HEADERS[index])
  const isUserFacingHeader = headers.length === USER_FACING_CSV_HEADERS.length && headers.every((header, index) => header === USER_FACING_CSV_HEADERS[index])
  const isSortedHeader = headers.length === SORTED_CSV_HEADERS.length && headers.every((header, index) => header === SORTED_CSV_HEADERS[index])
  const isPreviousHeader = headers.length === PREVIOUS_CSV_HEADERS.length && headers.every((header, index) => header === PREVIOUS_CSV_HEADERS[index])
  const isLegacyHeader = headers.length === LEGACY_CSV_HEADERS.length && headers.every((header, index) => header === LEGACY_CSV_HEADERS[index])
  if (rows.length === 0 || (!isCurrentHeader && !isUserFacingHeader && !isSortedHeader && !isPreviousHeader && !isLegacyHeader)) {
    throw new Error('このPWAで出力した食事履歴CSVではありません。列名と順序を確認してください。')
  }
  const headerIndex = new Map<string, number>(headers.map((header, index) => [header, index]))
  const seenIds = new Set<string>()
  return rows.slice(1).map((row, rowIndex) => {
    const rowNumber = rowIndex + 2
    if (row.length !== headers.length) throw new Error(`${rowNumber}行目の列数が不正です。`)
    const value = (header: string) => row[headerIndex.get(header) ?? -1] ?? ''
    const id = value('id')
    const eatenAt = value('eaten_at')
    const date = value('date')
    const mealType = value('meal_type')
    const foodId = value('food_id')
    const foodName = value('food_name')
    const amountUnit = value('amount_unit')
    const baseUnit = value('base_unit')
    const sortOrderText = value('sort_order')
    const sortOrder = sortOrderText === '' ? undefined : Number(sortOrderText)
    const userFacingName = value('user_facing_name').trim()
    const nutrientMetadata = parseNutrientMetadata(value('food_snapshot_nutrient_metadata_json'), rowNumber)

    const parsedDate = new Date(eatenAt)
    if (!id || !eatenAt || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== eatenAt || date !== formatDateKey(eatenAt)) throw new Error(`${rowNumber}行目の日時またはIDが不正です。`)
    if (seenIds.has(id)) throw new Error(`${rowNumber}行目のIDが重複しています。`)
    seenIds.add(id)
    if (!['朝食', '昼食', '夕食', '間食'].includes(mealType)) throw new Error(`${rowNumber}行目の食事区分が不正です。`)
    if (!foodId || !foodName || !isValidQuantityUnit(amountUnit) || !isValidUnit(baseUnit)) throw new Error(`${rowNumber}行目の食品または単位が不正です。`)
    if (sortOrder !== undefined && (!Number.isSafeInteger(sortOrder) || sortOrder < 0)) throw new Error(`${rowNumber}行目の表示順が不正です。`)

    const calculatedNutrients = parseNutrients(row, headerIndex, NUTRIENT_COLUMNS, rowNumber)
    const snapshotNutrients = parseNutrients(row, headerIndex, SNAPSHOT_NUTRIENT_COLUMNS, rowNumber)
    let inputUnitConversions = parseInputUnitConversions(value('food_snapshot_input_unit_conversions_json'), rowNumber)
    const conversionBaseAmountText = value('input_unit_base_amount')
    if (amountUnit !== baseUnit && !(inputUnitConversions ?? []).some((conversion) => conversion.unit === amountUnit)) {
      const conversionBaseAmount = conversionBaseAmountText ? Number(conversionBaseAmountText) : Number.NaN
      if (!Number.isFinite(conversionBaseAmount) || conversionBaseAmount <= 0) throw new Error(`${rowNumber}行目の換算情報が不足しています。`)
      inputUnitConversions = [...(inputUnitConversions ?? []), { unit: amountUnit, baseAmount: conversionBaseAmount }]
    }
    if (inputUnitConversions?.some((conversion) => conversion.unit === baseUnit)) throw new Error(`${rowNumber}行目の換算単位が基準単位と重複しています。`)
    const menuSnapshotText = value('menu_snapshot_json')
    let menuSnapshot: MealEntry['menuSnapshot']
    if (menuSnapshotText) {
      try {
        const candidate: unknown = JSON.parse(menuSnapshotText)
        if (!isMealMenuSnapshot(candidate)) throw new Error('invalid')
        menuSnapshot = candidate
      } catch {
        throw new Error(`${rowNumber}行目の料理メニュー構成が不正です。`)
      }
    }
    return {
      id,
      eatenAt,
      mealType: mealType as MealEntry['mealType'],
      foodId,
      foodSnapshot: {
        name: foodName,
        ...(userFacingName ? { userFacingName } : {}),
        maker: value('maker'),
        barcode: value('barcode'),
        baseAmount: parsePositiveNumber(value('base_amount'), '基準量', rowNumber),
        baseUnit,
        ...(inputUnitConversions ? { inputUnitConversions } : {}),
        nutrients: snapshotNutrients,
        ...(nutrientMetadata ? { nutrientMetadata } : {}),
      },
      amount: parsePositiveNumber(value('amount'), '分量', rowNumber),
      amountUnit,
      calculatedNutrients,
      ...(sortOrder === undefined ? {} : { sortOrder }),
      ...(menuSnapshot ? { menuSnapshot } : {}),
    }
  })
}
