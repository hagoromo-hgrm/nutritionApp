import { formatDateKey } from '../utils/date'
import { isValidUnit } from '../utils/validation'
import type { MealEntry, NutrientKey, Nutrients } from '../types'
import { isMealMenuSnapshot } from './mealMenuSnapshots'

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

export const CSV_HEADERS = [
  ...BASE_HEADERS,
  ...NUTRIENT_COLUMNS.map(([, header]) => header),
  ...SNAPSHOT_NUTRIENT_COLUMNS.map(([, header]) => header),
  'menu_snapshot_json',
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
    entry.menuSnapshot ? JSON.stringify(entry.menuSnapshot) : '',
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

export function parseMealsCsv(text: string): MealEntry[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0 || rows[0].length !== CSV_HEADERS.length || rows[0].some((header, index) => header !== CSV_HEADERS[index])) {
    throw new Error('このPWAで出力した食事履歴CSVではありません。列名と順序を確認してください。')
  }
  const headerIndex = new Map<string, number>(CSV_HEADERS.map((header, index) => [header, index]))
  return rows.slice(1).map((row, rowIndex) => {
    const rowNumber = rowIndex + 2
    if (row.length !== CSV_HEADERS.length) throw new Error(`${rowNumber}行目の列数が不正です。`)
    const value = (header: string) => row[headerIndex.get(header) ?? -1] ?? ''
    const id = value('id')
    const eatenAt = value('eaten_at')
    const date = value('date')
    const mealType = value('meal_type')
    const foodId = value('food_id')
    const foodName = value('food_name')
    const amountUnit = value('amount_unit')
    const baseUnit = value('base_unit')

    if (!id || !eatenAt || Number.isNaN(new Date(eatenAt).getTime()) || date !== formatDateKey(eatenAt)) throw new Error(`${rowNumber}行目の日時またはIDが不正です。`)
    if (!['朝食', '昼食', '夕食', '間食'].includes(mealType)) throw new Error(`${rowNumber}行目の食事区分が不正です。`)
    if (!foodId || !foodName || !isValidUnit(amountUnit) || !isValidUnit(baseUnit)) throw new Error(`${rowNumber}行目の食品または単位が不正です。`)

    const calculatedNutrients = parseNutrients(row, headerIndex, NUTRIENT_COLUMNS, rowNumber)
    const snapshotNutrients = parseNutrients(row, headerIndex, SNAPSHOT_NUTRIENT_COLUMNS, rowNumber)
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
        maker: value('maker'),
        barcode: value('barcode'),
        baseAmount: parsePositiveNumber(value('base_amount'), '基準量', rowNumber),
        baseUnit,
        nutrients: snapshotNutrients,
      },
      amount: parsePositiveNumber(value('amount'), '分量', rowNumber),
      amountUnit,
      calculatedNutrients,
      ...(menuSnapshot ? { menuSnapshot } : {}),
    }
  })
}
