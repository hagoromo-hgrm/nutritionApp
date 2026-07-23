import { describe, expect, it } from 'vitest'
import { shouldShowTrendDate } from '../src/services/trendDateLabels'

describe('trend date labels', () => {
  it('1週間は毎日表示する', () => {
    expect(shouldShowTrendDate('2026-07-23', 'week')).toBe(true)
  })

  it('1ヶ月は1日と5日区切りだけ表示する', () => {
    expect(shouldShowTrendDate('2026-07-01', 'month')).toBe(true)
    expect(shouldShowTrendDate('2026-07-05', 'month')).toBe(true)
    expect(shouldShowTrendDate('2026-07-23', 'month')).toBe(false)
  })

  it('3ヶ月は各月1日と15日だけ表示する', () => {
    expect(shouldShowTrendDate('2026-07-01', 'threeMonths')).toBe(true)
    expect(shouldShowTrendDate('2026-07-15', 'threeMonths')).toBe(true)
    expect(shouldShowTrendDate('2026-07-20', 'threeMonths')).toBe(false)
  })

  it('1年は各月1日だけ表示する', () => {
    expect(shouldShowTrendDate('2026-07-01', 'year')).toBe(true)
    expect(shouldShowTrendDate('2026-07-15', 'year')).toBe(false)
  })
})
