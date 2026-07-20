import { mextFoods } from './mextFoods'

// 初期投入の正本は確定済みMEXT 2,538件だけとし、旧サンプルとの重複を作らない。
export const initialFoods = [...mextFoods]
