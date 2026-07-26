import { db } from '../db/db'
import type { EstimatorGenreId, UnresolvedIngredientStat } from '../types'

const EXPORT_FORMAT_VERSION = 1

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ja-JP')
}

function statId(genreId: EstimatorGenreId, normalizedName: string): string {
  return `${genreId}:${normalizedName}`
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

export async function recordUnresolvedIngredients(
  names: readonly string[],
  genreId: EstimatorGenreId,
  now = new Date().toISOString(),
): Promise<void> {
  const unique = [...new Set(names.map(normalize).filter(Boolean))]
  if (unique.length === 0) return
  await db.transaction('rw', db.unresolvedIngredientStats, async () => {
    for (const normalizedName of unique) {
      const id = statId(genreId, normalizedName)
      const current = await db.unresolvedIngredientStats.get(id)
      const next: UnresolvedIngredientStat = current
        ? { ...current, count: current.count + 1, lastSeenAt: now }
        : {
            id,
            normalizedName,
            example: normalizedName.slice(0, 80),
            estimatorGenreId: genreId,
            count: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          }
      await db.unresolvedIngredientStats.put(next)
    }
  })
}

export async function getUnresolvedIngredientStats(): Promise<UnresolvedIngredientStat[]> {
  return db.unresolvedIngredientStats.orderBy('lastSeenAt').reverse().toArray()
}

export async function unresolvedIngredientsToJson(): Promise<string> {
  const items = await getUnresolvedIngredientStats()
  return JSON.stringify({
    format: 'nutrition-pwa-unresolved-ingredients',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    items,
  }, null, 2)
}

export async function unresolvedIngredientsToCsv(): Promise<string> {
  const items = await getUnresolvedIngredientStats()
  const rows: Array<Array<string | number>> = [
    ['normalizedName', 'example', 'estimatorGenreId', 'count', 'firstSeenAt', 'lastSeenAt'],
    ...items.map((item) => [
      item.normalizedName,
      item.example,
      item.estimatorGenreId,
      item.count,
      item.firstSeenAt,
      item.lastSeenAt,
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
