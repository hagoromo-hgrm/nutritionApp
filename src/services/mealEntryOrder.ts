import { MEAL_TYPES, type MealEntry } from '../types'
import { formatDateKey } from '../utils/date'

export function isValidMealEntrySortOrder(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function groupKey(entry: MealEntry): string {
  return `${formatDateKey(entry.eatenAt)}\u0000${entry.mealType}`
}

function fallbackCompare(a: MealEntry, b: MealEntry): number {
  return a.eatenAt.localeCompare(b.eatenAt) || a.id.localeCompare(b.id)
}

function hasCompleteUniqueOrder(entries: MealEntry[]): boolean {
  const orders = entries.map((entry) => entry.sortOrder)
  return orders.every(isValidMealEntrySortOrder) && new Set(orders).size === entries.length
}

/** 同じ日・食事区分の記録を、明示順または旧データ用の安定順で並べる。 */
export function sortMealEntryGroup(entries: MealEntry[]): MealEntry[] {
  const ordered = [...entries]
  if (!hasCompleteUniqueOrder(ordered)) return ordered.sort(fallbackCompare)
  return ordered.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || fallbackCompare(a, b))
}

/** 配列の現在順を、その日・食事区分内の連番として確定する。 */
export function normalizeMealEntryOrder(entries: MealEntry[]): MealEntry[] {
  return entries.map((entry, sortOrder) => ({ ...entry, sortOrder }))
}

/** 複数日を含む取得結果を、日付・食事区分・区分内表示順で安定化する。 */
export function sortMealEntries(entries: MealEntry[]): MealEntry[] {
  const groups = new Map<string, MealEntry[]>()
  for (const entry of entries) {
    const key = groupKey(entry)
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const mealTypeOrder = new Map(MEAL_TYPES.map((type, index) => [type, index]))
  return [...groups.entries()]
    .sort(([leftKey, leftEntries], [rightKey, rightEntries]) => {
      const dateComparison = formatDateKey(leftEntries[0].eatenAt).localeCompare(formatDateKey(rightEntries[0].eatenAt))
      if (dateComparison !== 0) return dateComparison
      const mealComparison = (mealTypeOrder.get(leftEntries[0].mealType) ?? MEAL_TYPES.length)
        - (mealTypeOrder.get(rightEntries[0].mealType) ?? MEAL_TYPES.length)
      return mealComparison || leftKey.localeCompare(rightKey)
    })
    .flatMap(([, group]) => sortMealEntryGroup(group))
}

/** 複数日・複数区分を含む配列を安定順に並べ、区分ごとに0始まりへ正規化する。 */
export function normalizeMealEntryGroups(entries: MealEntry[]): MealEntry[] {
  const nextOrder = new Map<string, number>()
  return sortMealEntries(entries).map((entry) => {
    const key = groupKey(entry)
    const sortOrder = nextOrder.get(key) ?? 0
    nextOrder.set(key, sortOrder + 1)
    return { ...entry, sortOrder }
  })
}
