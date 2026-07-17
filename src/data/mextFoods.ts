import type { Food } from '../types'
import mextFoodData from '../../data/mext/processed/mext_foods.json'

// 元データをアプリ用の基準単位へ変換済み。推測変換できない食品はgを維持する。
export const mextFoods = mextFoodData.foods as unknown as Food[]
