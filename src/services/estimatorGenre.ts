import {
  ESTIMATOR_GENRE_IDS,
  type EstimatorGenreId,
  type EstimatorGenreSource,
} from '../types'

export const ESTIMATOR_GENRE_LABELS: Record<EstimatorGenreId, string> = {
  baked_sweets: '焼き菓子',
  cake_pastry: 'ケーキ・ドーナツ',
  bread: 'パン・菓子パン',
  chocolate: 'チョコレート菓子',
  sugar_confectionery: 'キャンディ・グミ・和菓子',
  snack_rice_cracker: 'スナック・米菓',
  frozen_dessert: 'アイス・冷菓',
  dairy: '乳製品・乳飲料',
  drink_jelly_pudding: '飲料・ゼリー・プリン',
  fried_food: '揚げ物・フライ',
  noodle_flour_dish: '麺・粉もの',
  prepared_meal: '惣菜・弁当・スープ',
  sauce_spread: 'ソース・調味料',
  other_unknown: 'その他・不明',
}

export const ESTIMATOR_GENRE_OPTIONS = ESTIMATOR_GENRE_IDS.map((id) => ({
  id,
  label: ESTIMATOR_GENRE_LABELS[id],
}))

export interface EstimatorGenreSuggestion {
  id: EstimatorGenreId
  source: EstimatorGenreSource
}

interface GenreRule {
  id: Exclude<EstimatorGenreId, 'other_unknown'>
  terms: readonly string[]
}

const OFF_CATEGORY_RULES: readonly GenreRule[] = [
  { id: 'chocolate', terms: ['chocolate', 'chocolates', 'cocoa-and-chocolate-powders'] },
  { id: 'baked_sweets', terms: ['biscuits', 'cookies', 'shortbread', 'crackers'] },
  { id: 'cake_pastry', terms: ['cakes', 'pastries', 'doughnuts', 'donuts'] },
  { id: 'bread', terms: ['breads', 'bread-products', 'sweet-breads', 'brioches'] },
  { id: 'snack_rice_cracker', terms: ['snacks', 'chips', 'crisps', 'rice-crackers'] },
  { id: 'frozen_dessert', terms: ['ice-creams', 'frozen-desserts', 'sorbets'] },
  { id: 'dairy', terms: ['dairies', 'milks', 'cheeses', 'yogurts', 'fermented-milk-products'] },
  { id: 'sugar_confectionery', terms: ['candies', 'gummies', 'confectioneries', 'traditional-sweets'] },
  { id: 'drink_jelly_pudding', terms: ['beverages', 'drinks', 'jellies', 'puddings', 'dessert-creams'] },
  { id: 'fried_food', terms: ['fried-foods', 'fritters', 'tempura'] },
  { id: 'noodle_flour_dish', terms: ['noodles', 'pastas', 'pizzas', 'pancakes'] },
  { id: 'prepared_meal', terms: ['meals', 'prepared-meals', 'soups', 'sandwiches'] },
  { id: 'sauce_spread', terms: ['sauces', 'spreads', 'condiments', 'dressings'] },
]

const NAME_RULES: readonly GenreRule[] = [
  { id: 'chocolate', terms: ['チョコ', 'ショコラ', 'カカオ'] },
  { id: 'baked_sweets', terms: ['クッキー', 'ビスケット', 'サブレ', 'クラッカー', 'ウエハース', 'フィナンシェ', 'マドレーヌ'] },
  { id: 'cake_pastry', terms: ['ケーキ', 'ドーナツ', 'シュークリーム', 'アップルパイ', 'ミートパイ', 'パイ菓子', 'パイ生地', 'パイの実', 'タルト', 'カステラ'] },
  { id: 'bread', terms: ['パン', 'ベーグル', 'ブリオッシュ', 'クロワッサン'] },
  { id: 'snack_rice_cracker', terms: ['スナック', 'ポテトチップ', 'せんべい', '煎餅', 'あられ', 'おかき'] },
  { id: 'frozen_dessert', terms: ['アイス', 'ジェラート', 'シャーベット', '氷菓'] },
  { id: 'dairy', terms: ['ヨーグルト', 'チーズ', '乳飲料', 'ミルク'] },
  { id: 'sugar_confectionery', terms: ['キャンディ', 'あめ', '飴', 'グミ', 'キャラメル', '羊羹', 'ようかん', 'まんじゅう', '大福'] },
  { id: 'drink_jelly_pudding', terms: ['ジュース', 'ドリンク', '飲料', 'ゼリー', 'プリン'] },
  { id: 'fried_food', terms: ['フライ', '揚げ', '天ぷら', '唐揚げ', 'コロッケ', 'カツ'] },
  { id: 'noodle_flour_dish', terms: ['麺', 'うどん', 'そば', 'ラーメン', 'パスタ', 'ピザ', 'お好み焼き', 'たこ焼き'] },
  { id: 'prepared_meal', terms: ['弁当', '惣菜', 'スープ', 'カレー', 'シチュー', 'サンドイッチ'] },
  { id: 'sauce_spread', terms: ['ソース', 'ドレッシング', 'たれ', 'ケチャップ', 'マヨネーズ', 'ジャム', 'スプレッド'] },
]

const INGREDIENT_RULES: readonly GenreRule[] = [
  { id: 'chocolate', terms: ['カカオマス', 'ココアバター', 'カカオバター'] },
  { id: 'bread', terms: ['パン酵母', 'ドライイースト', 'イーストフード'] },
  { id: 'frozen_dessert', terms: ['アイスクリームミックス', '乳固形分'] },
  { id: 'dairy', terms: ['生乳', '乳製品', '脱脂濃縮乳'] },
  { id: 'sauce_spread', terms: ['醸造酢', 'しょうゆ', '味噌'] },
]

const NAME_TERM_EXCLUSIONS: Readonly<Record<string, readonly string[]>> = {
  パン: ['フライパン', 'パンツ', 'パンフレット', 'パンダ', 'パンチ'],
  フライ: ['フライパン'],
  カツ: ['カツオ'],
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, '')
}

function findRule(
  value: string,
  rules: readonly GenreRule[],
  exclusions: Readonly<Record<string, readonly string[]>> = {},
): EstimatorGenreId | null {
  const normalized = normalize(value)
  return rules.find((rule) => rule.terms.some((term) => {
    const normalizedTerm = normalize(term)
    return normalized.includes(normalizedTerm)
      && !(exclusions[term] ?? []).some((excluded) => normalized.includes(normalize(excluded)))
  }))?.id ?? null
}

export function isEstimatorGenreId(value: unknown): value is EstimatorGenreId {
  return typeof value === 'string' && (ESTIMATOR_GENRE_IDS as readonly string[]).includes(value)
}

export function inferEstimatorGenre(input: {
  productName?: string | null
  ingredientsText?: string | null
  offCategories?: readonly string[]
}): EstimatorGenreSuggestion {
  const offGenre = findRule((input.offCategories ?? []).join(' '), OFF_CATEGORY_RULES)
  if (offGenre) return { id: offGenre, source: 'off_category' }
  const nameGenre = findRule(input.productName ?? '', NAME_RULES, NAME_TERM_EXCLUSIONS)
  if (nameGenre) return { id: nameGenre, source: 'name_rule' }
  const ingredientGenre = findRule(input.ingredientsText ?? '', INGREDIENT_RULES)
  if (ingredientGenre) return { id: ingredientGenre, source: 'ingredient_rule' }
  return { id: 'other_unknown', source: 'unknown' }
}

/** ユーザー確定値は再推定せず、それ以外だけを最新入力から更新する。 */
export function refreshEstimatorGenre(
  current: EstimatorGenreSuggestion,
  input: Parameters<typeof inferEstimatorGenre>[0],
): EstimatorGenreSuggestion {
  if (current.source === 'user') return current
  // OFFカテゴリ自体を保持していない編集画面では、商品名編集だけで上位の外部カテゴリ候補を失わせない。
  if (current.source === 'off_category' && input.offCategories === undefined) return current
  return inferEstimatorGenre(input)
}
