export type TrendDateLabelRange = 'week' | 'month' | 'threeMonths' | 'year'

export function shouldShowTrendDate(dateKey: string, range: TrendDateLabelRange): boolean {
  if (range === 'week') return true
  const day = Number(dateKey.slice(-2))
  if (range === 'month') return day === 1 || day % 5 === 0
  if (range === 'threeMonths') return day === 1 || day === 15
  return day === 1
}
