import type { Food } from '../types'
import importedFoodData from '../../data/imported/purchase_prediction_foods.json'

// ユーザー提供DBを検証・正規化した生成物だけをアプリへ組み込む。
export const importedFoods = importedFoodData.foods as unknown as Food[]
