import type { Food } from '../types'
import mextFoodData from '../../data/mext/processed/mext_foods.json'

// 栄養値はMEXTの可食部100g基準を維持し、根拠のある日常単位だけを入力換算として保持する。
export const mextFoods = mextFoodData.foods as unknown as Food[]
