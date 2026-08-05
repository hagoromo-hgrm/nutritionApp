import type { WeightRecord } from '../types'
import { formatDateKey } from '../utils/date'
import { createId } from '../utils/id'

const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidWeightKg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 500
}

export function isValidIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_TIME_PATTERN.exec(value)
  if (!match) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && date.getUTCSeconds() === Number(match[6])
}

export function isValidTokyoDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && formatDateKey(date) === value
}

export function isValidWeightRecord(value: unknown): value is WeightRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<WeightRecord>
  return typeof record.id === 'string'
    && record.id.trim().length > 0
    && isValidIsoDateTime(record.recordedAt)
    && isValidTokyoDateKey(record.date)
    && record.date === formatDateKey(record.recordedAt)
    && isValidWeightKg(record.weightKg)
}

export function createWeightRecord(weightKg: number, recordedAt = new Date().toISOString(), id = createId('weight')): WeightRecord {
  if (!isValidWeightKg(weightKg)) throw new Error('体重は正の有限値で入力してください。')
  if (!isValidIsoDateTime(recordedAt)) throw new Error('体重記録日時の形式が不正です。')
  return { id, recordedAt, date: formatDateKey(recordedAt), weightKg }
}

export function sortWeightRecords(records: WeightRecord[]): WeightRecord[] {
  return [...records].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
}

export interface DailyWeightTrendPoint {
  date: string
  weightKg: number | null
  recordId: string | null
}

export interface WeightChartRange {
  min: number
  max: number
}

export function buildDailyWeightTrend(records: WeightRecord[], dates: string[]): DailyWeightTrendPoint[] {
  const latestByDate = new Map<string, WeightRecord>()
  for (const record of sortWeightRecords(records)) {
    latestByDate.set(record.date, record)
  }
  return dates.map((date) => {
    const record = latestByDate.get(date)
    return {
      date,
      weightKg: record?.weightKg ?? null,
      recordId: record?.id ?? null,
    }
  })
}

export function buildWeightChartRange(points: DailyWeightTrendPoint[]): WeightChartRange {
  const values = points
    .map((point) => point.weightKg)
    .filter((value): value is number => value !== null)
  if (values.length === 0) return { min: 0, max: 1 }
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = maximum - minimum
  const padding = span > 0 ? Math.max(0.5, span * 0.15) : Math.max(0.5, minimum * 0.02)
  const min = Math.max(0, minimum - padding)
  const max = maximum + padding
  return max > min ? { min, max } : { min: Math.max(0, minimum - 0.5), max: maximum + 0.5 }
}
