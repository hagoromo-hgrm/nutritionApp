import { describe, expect, it } from 'vitest'
import { buildDailyWeightTrend, buildWeightChartRange, createWeightRecord, isValidWeightRecord, sortWeightRecords } from '../src/services/weightHistory'

describe('weight history', () => {
  it('東京の日付を持つ体重記録を作成する', () => {
    const record = createWeightRecord(65.4, '2026-08-04T15:00:00.000Z', 'weight_test')
    expect(record).toEqual({ id: 'weight_test', recordedAt: '2026-08-04T15:00:00.000Z', date: '2026-08-05', weightKg: 65.4 })
    expect(isValidWeightRecord(record)).toBe(true)
  })

  it('日付と日時が一致しない記録を拒否する', () => {
    expect(isValidWeightRecord({ id: 'weight_test', recordedAt: '2026-08-04T15:00:00.000Z', date: '2026-08-04', weightKg: 65 })).toBe(false)
    expect(() => createWeightRecord(0, '2026-08-04T15:00:00.000Z')).toThrow('正の有限値')
    expect(() => createWeightRecord(501, '2026-08-04T15:00:00.000Z')).toThrow('正の有限値')
    expect(() => createWeightRecord(65, '2026-02-30T00:00:00.000Z')).toThrow('日時')
  })

  it('日時順に並べ替える', () => {
    const records = [
      createWeightRecord(66, '2026-08-05T01:00:00.000Z', 'weight_late'),
      createWeightRecord(65, '2026-08-04T01:00:00.000Z', 'weight_early'),
    ]
    expect(sortWeightRecords(records).map((record) => record.id)).toEqual(['weight_early', 'weight_late'])
  })

  it('同日の最後の記録だけを日次推移へ使用する', () => {
    const points = buildDailyWeightTrend([
      createWeightRecord(65, '2026-08-04T01:00:00.000Z', 'weight_first'),
      createWeightRecord(64.8, '2026-08-04T12:00:00.000Z', 'weight_latest'),
      createWeightRecord(64.5, '2026-08-06T01:00:00.000Z', 'weight_next'),
    ], ['2026-08-04', '2026-08-05', '2026-08-06'])
    expect(points).toEqual([
      { date: '2026-08-04', weightKg: 64.8, recordId: 'weight_latest' },
      { date: '2026-08-05', weightKg: null, recordId: null },
      { date: '2026-08-06', weightKg: 64.5, recordId: 'weight_next' },
    ])
  })

  it('小さな体重変化も読める表示範囲を返す', () => {
    const points = buildDailyWeightTrend([
      createWeightRecord(65, '2026-08-04T01:00:00.000Z', 'weight_first'),
      createWeightRecord(65.2, '2026-08-05T01:00:00.000Z', 'weight_second'),
    ], ['2026-08-04', '2026-08-05'])
    const range = buildWeightChartRange(points)
    expect(range.min).toBeLessThan(65)
    expect(range.max).toBeGreaterThan(65.2)
    expect(range.max - range.min).toBeLessThan(3)
  })
})
