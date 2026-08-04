export type BarcodePurpose = 'register' | 'lookup' | 'meal'

export type BarcodeMissAction = 'external-api' | 'stay-food-master'

/**
 * FOODMASTERの検索は端末内データの管理導線として完結させ、登録導線とは分離する。
 */
export function barcodeMissAction(purpose: BarcodePurpose): BarcodeMissAction {
  return purpose === 'lookup' ? 'stay-food-master' : 'external-api'
}

export function barcodePurposeLabel(purpose: BarcodePurpose): string {
  if (purpose === 'register') return 'バーコードで登録'
  if (purpose === 'lookup') return 'バーコード検索'
  return 'バーコードで追加'
}
