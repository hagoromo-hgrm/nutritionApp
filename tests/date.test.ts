import { describe, expect, it } from 'vitest'
import { formatTime, isoFromTokyoTimeInput, toTokyoTimeInput } from '../src/utils/date'

describe('食事時刻表示', () => {
  it('日付を含めず東京時刻だけを表示・入力できる', () => {
    const iso = '2026-07-16T03:05:00.000Z'
    expect(formatTime(iso)).toBe('12:05')
    expect(toTokyoTimeInput(iso)).toBe('12:05')
    expect(isoFromTokyoTimeInput('2026-07-16', '12:05')).toBe(iso)
  })
})
