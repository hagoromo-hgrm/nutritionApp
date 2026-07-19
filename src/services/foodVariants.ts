import type { Food, FoodVariantAttributes } from '../types'

export type VariantAttributeKey = keyof FoodVariantAttributes

export interface VariantOption {
  value: string | null
  label: string
}

export interface VariantOptionGroup {
  key: VariantAttributeKey | 'variant'
  label: string
  options: VariantOption[]
}

const ATTRIBUTE_ORDER: VariantAttributeKey[] = ['species', 'part', 'variety', 'nameSpecification', 'cultivation', 'sourceBean', 'skin', 'preparation', 'processing']
const ATTRIBUTE_LABELS: Record<VariantAttributeKey, string> = {
  species: '種類',
  part: '部位',
  cultivation: '栽培方法',
  sourceBean: '原料豆',
  skin: '皮の状態',
  preparation: '調理方法',
  processing: '加工状態',
  variety: '区分',
  nameSpecification: '名称仕様',
}
const SKIN_VALUE_ALIASES = new Map([['皮つき', '皮つき'], ['皮なし', '皮なし']])
const SKIN_VALUES = new Set(SKIN_VALUE_ALIASES.keys())
const PREPARATION_VALUES = new Set(['生', 'ゆで', '焼き', '水煮', '蒸し', '電子レンジ調理', '油いため', '素揚げ', '天ぷら', 'から揚げ', 'ソテー', 'フライ', '煮', 'あめ色たまねぎ'])
const PROCESSING_VALUES = new Set(['冷凍', '乾', '乾燥', '水戻し', '塩抜き', '水さらし', 'カット', '常法洗浄', '次亜塩素酸洗浄', 'おろし'])
const CULTIVATION_VALUES = new Set(['菌床栽培', '原木栽培'])
const SOURCE_BEAN_VALUES = new Map([['アルファルファもやし', 'アルファルファ'], ['だいずもやし', 'だいず'], ['ブラックマッペもやし', 'ブラックマッペ'], ['りょくとうもやし', 'りょくとう']])
const PART_VALUES = ['手羽さき', '手羽もと', 'ひき肉', 'なんこつ（胸肉）', 'りん茎及び葉', '結球葉', '生しいたけ', '乾しいたけ', 'むね', 'もも', 'ささみ', '手羽', '心臓', '肝臓', 'すなぎも', '皮', '赤身', '脂身', '卵白', '卵黄', '根', '葉', '芽ばえ', '果実', 'りん茎', '塊根', '塊茎', 'ロース', 'ばら', 'かた', 'そともも', 'もも肉']

function standaloneSkinIsAttribute(tokens: string[]): boolean {
  return tokens.includes('皮') && tokens.includes('にんじん')
}

function tokensFor(food: Food): string[] {
  const source = (food.officialName ?? food.name)
    .replace(/（(?:小さじ|大さじ)1=[^)]+）$/, '')
    .replace(/＜[^＞]*＞/g, ' ')
    .replace(/（[^）]*類）/g, ' ')
    .replace(/\u3000/g, ' ')
  return source.split(/\s+/).filter(Boolean)
}

function variantToken(token: string): string {
  return token.replace(/^[（(]/, '').replace(/[）)]$/, '')
}

/** 生成済み属性がないユーザー食品でも、MEXTと同じ表示規則で扱う。 */
export function getVariantAttributes(food: Food): FoodVariantAttributes {
  if (food.variantAttributes) return food.variantAttributes
  const attributes: FoodVariantAttributes = {}
  const tokens = tokensFor(food)
  for (const token of tokens) {
    const normalizedToken = variantToken(token)
    if (SKIN_VALUES.has(normalizedToken)) attributes.skin = SKIN_VALUE_ALIASES.get(normalizedToken)
    else if (normalizedToken === '皮' && standaloneSkinIsAttribute(tokens)) attributes.skin = '皮つき'
    else if (PREPARATION_VALUES.has(normalizedToken)) attributes.preparation = normalizedToken
    else if (PROCESSING_VALUES.has(normalizedToken)) attributes.processing = normalizedToken
    else if (CULTIVATION_VALUES.has(normalizedToken)) attributes.cultivation = normalizedToken
    else if (SOURCE_BEAN_VALUES.has(normalizedToken)) attributes.sourceBean = SOURCE_BEAN_VALUES.get(normalizedToken)
    const squareContent = token.replace(/^[［[]|[］]]$/g, '')
    if (squareContent.includes('若どり')) attributes.variety = '若どり'
    else if (squareContent.includes('親')) attributes.variety = '親'
    else if (['和牛', '乳用肥育', '交雑', '黒毛'].some((marker) => squareContent.includes(marker))) attributes.variety = squareContent
    else if (token.includes('養殖')) attributes.variety = '養殖'
  }
  if (tokens.includes('皮') && !standaloneSkinIsAttribute(tokens)) attributes.part = '皮'
  else for (const part of [...PART_VALUES].filter((part) => part !== '皮').sort((left, right) => right.length - left.length)) {
    if (tokens.includes(part)) { attributes.part = part; break }
  }
  const species = [['にわとり', '鶏'], ['うし', '牛'], ['ぶた', '豚'], ['ひつじ', '羊'], ['やぎ', '山羊']] as const
  for (const [token, value] of species) {
    if (tokens.includes(token)) { attributes.species = value; break }
  }
  return attributes
}

function optionLabel(value: string | null): string {
  return value ?? '指定なし'
}

export function getVariantOptionGroups(variants: Food[]): VariantOptionGroup[] {
  return ATTRIBUTE_ORDER.flatMap((key) => {
    const values = [...new Set(variants.map((food) => getVariantAttributes(food)[key] ?? null))]
    if (values.length < 2) return []
    return [{ key, label: ATTRIBUTE_LABELS[key], options: values.map((value) => ({ value, label: optionLabel(value) })) }]
  })
}

export function getVariantSelection(variant: Food, groups: VariantOptionGroup[]): Partial<Record<VariantAttributeKey, string | null>> {
  const attributes = getVariantAttributes(variant)
  return Object.fromEntries(groups.filter((group): group is VariantOptionGroup & { key: VariantAttributeKey } => group.key !== 'variant').map((group) => [group.key, attributes[group.key] ?? null])) as Partial<Record<VariantAttributeKey, string | null>>
}

export function filterVariantsBySelection(variants: Food[], selection: Partial<Record<VariantAttributeKey, string | null>>): Food[] {
  return variants.filter((variant) => {
    const attributes = getVariantAttributes(variant)
    return Object.entries(selection).every(([key, value]) => (attributes[key as VariantAttributeKey] ?? null) === value)
  })
}

export function resolveVariantForSelection(variants: Food[], selection: Partial<Record<VariantAttributeKey, string | null>>, defaultVariantId: string | null): Food | null {
  const matches = filterVariantsBySelection(variants, selection)
  return matches.find((variant) => variant.id === defaultVariantId) ?? matches[0] ?? null
}

export function variantOptionText(food: Food): string {
  const attributes = getVariantAttributes(food)
  return ATTRIBUTE_ORDER.map((key) => attributes[key]).filter((value): value is string => Boolean(value)).join('・') || '標準'
}
