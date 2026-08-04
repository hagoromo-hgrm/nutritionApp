import { describe, expect, it } from 'vitest'
import { barcodeMissAction, barcodePurposeLabel } from '../src/services/barcodeFlow'

describe('barcode flow', () => {
  it('lookupの未一致は外部APIや登録へ進まずFOODMASTERに留まる', () => {
    expect(barcodeMissAction('lookup')).toBe('stay-food-master')
  })

  it('registerとmealの未一致は従来の外部API fallbackを使う', () => {
    expect(barcodeMissAction('register')).toBe('external-api')
    expect(barcodeMissAction('meal')).toBe('external-api')
  })

  it('目的に応じた見出しを返す', () => {
    expect(barcodePurposeLabel('register')).toBe('バーコードで登録')
    expect(barcodePurposeLabel('lookup')).toBe('バーコード検索')
    expect(barcodePurposeLabel('meal')).toBe('バーコードで追加')
  })
})
