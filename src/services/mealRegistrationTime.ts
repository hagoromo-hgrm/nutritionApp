import type { MealEntry } from '../types'

/** IndexedDBの文字列索引が日時順になるよう、登録日時はUTC・ミリ秒表記に統一する。 */
export function isRegistrationTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

export function withLegacyRegistrationTime(entry: MealEntry): MealEntry {
  return { ...entry, registeredAt: entry.registeredAt ?? new Date(entry.eatenAt).toISOString() }
}
