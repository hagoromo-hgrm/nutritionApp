import type { Food } from '../types'
import mextFoodData from '../../data/mext/processed/mext_foods.json'

// 元データの基準量は可食部100g。個・合などへ推測変換せず、gのまま登録する。
export const mextFoods = mextFoodData.foods as unknown as Food[]
