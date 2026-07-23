import { EXTERNAL_UNNAMED_PRODUCT_LABEL } from './externalFoodApi'

/** バーコード導線で登録・更新した食品は、明示分類を外さず「外食・市販」として保存する。 */
export function resolveBarcodeCommercialFlag(currentValue: boolean, barcode: string, registeredByBarcode: boolean): boolean {
  return currentValue || (registeredByBarcode && Boolean(barcode.trim()))
}

/** 表示名を商品名から自動生成している状態かを判定する。 */
export function shouldFollowFoodName(groupDisplayName: string, currentProductName: string): boolean {
  const displayName = groupDisplayName.trim()
  return !displayName || displayName === EXTERNAL_UNNAMED_PRODUCT_LABEL || displayName === currentProductName.trim()
}

/** 自動表示名だけを商品名変更へ追従させ、明示した表示名は保持する。 */
export function resolveFoodGroupDisplayName(groupDisplayName: string, productName: string, previousProductName = ''): string {
  const displayName = groupDisplayName.trim()
  const nextProductName = productName.trim()
  const previousName = previousProductName.trim()
  if (!displayName || displayName === EXTERNAL_UNNAMED_PRODUCT_LABEL || (previousName && displayName === previousName)) return nextProductName
  return displayName
}
