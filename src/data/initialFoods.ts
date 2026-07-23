import { importedFoods } from './importedFoods'
import { mextFoods } from './mextFoods'

// 一般食品はMEXT、市販・外食食品は検証済みimportedデータを初期投入する。
export const initialFoods = [...mextFoods, ...importedFoods]
