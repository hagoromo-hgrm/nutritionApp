import type { Food, FoodGroup } from '../types'

export const FOOD_INDEX_GROUPS = [
  { key: 'a', label: 'あ行' },
  { key: 'ka', label: 'か行' },
  { key: 'sa', label: 'さ行' },
  { key: 'ta', label: 'た行' },
  { key: 'na', label: 'な行' },
  { key: 'ha', label: 'は行' },
  { key: 'ma', label: 'ま行' },
  { key: 'ya', label: 'や行' },
  { key: 'ra', label: 'ら行' },
  { key: 'wa', label: 'わ行' },
  { key: 'other', label: '英数字・その他' },
] as const

export type FoodIndexGroupKey = (typeof FOOD_INDEX_GROUPS)[number]['key']
export type FoodIndexGroupLabel = (typeof FOOD_INDEX_GROUPS)[number]['label']

export interface FoodIndexGroup {
  key: FoodIndexGroupKey
  label: FoodIndexGroupLabel
  foods: Food[]
}

interface IndexedFood {
  food: Food
  reading: string
  inputOrder: number
}

const collator = new Intl.Collator('ja')
const leadingNonLetterOrNumber = /^[\p{White_Space}\p{P}\p{S}]+/u

const rowByInitial: Readonly<Record<string, FoodIndexGroupKey>> = {
  あ: 'a', い: 'a', う: 'a', え: 'a', お: 'a',
  ぁ: 'a', ぃ: 'a', ぅ: 'a', ぇ: 'a', ぉ: 'a',
  か: 'ka', き: 'ka', く: 'ka', け: 'ka', こ: 'ka',
  ゕ: 'ka', ゖ: 'ka',
  さ: 'sa', し: 'sa', す: 'sa', せ: 'sa', そ: 'sa',
  た: 'ta', ち: 'ta', つ: 'ta', て: 'ta', と: 'ta', っ: 'ta',
  な: 'na', に: 'na', ぬ: 'na', ね: 'na', の: 'na',
  は: 'ha', ひ: 'ha', ふ: 'ha', へ: 'ha', ほ: 'ha',
  ま: 'ma', み: 'ma', む: 'ma', め: 'ma', も: 'ma',
  や: 'ya', ゆ: 'ya', よ: 'ya', ゃ: 'ya', ゅ: 'ya', ょ: 'ya',
  ら: 'ra', り: 'ra', る: 'ra', れ: 'ra', ろ: 'ra',
  わ: 'wa', ゐ: 'wa', ゑ: 'wa', を: 'wa', ん: 'wa', ゎ: 'wa',
}

function toHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60))
}

function normalizeReading(value: string): string {
  return toHiragana(value.normalize('NFKC'))
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(leadingNonLetterOrNumber, '')
    .normalize('NFC')
}

function displayNameOf(food: Food): string {
  return food.displayName?.trim() || food.name
}

function readingOf(food: Food, foodGroupsById: ReadonlyMap<string, FoodGroup>): string {
  const candidates = [
    food.reading,
    food.foodGroupId ? foodGroupsById.get(food.foodGroupId)?.reading : undefined,
    displayNameOf(food),
  ]

  for (const candidate of candidates) {
    if (candidate?.trim()) return candidate
  }
  return ''
}

function groupKeyFor(reading: string): FoodIndexGroupKey {
  const initial = [...normalizeReading(reading)][0]
  return initial ? (rowByInitial[initial] ?? 'other') : 'other'
}

/**
 * 食品マスター向けに、全固定見出しを含む五十音グループを返す。
 * 同一IDが複数含まれる場合は、入力順で最初の食品だけを採用する。
 */
export function groupFoodsByKana(foods: Food[], foodGroups: FoodGroup[]): FoodIndexGroup[] {
  const foodGroupsById = new Map(foodGroups.map((group) => [group.id, group]))
  const grouped = new Map<FoodIndexGroupKey, IndexedFood[]>(
    FOOD_INDEX_GROUPS.map(({ key }) => [key, []]),
  )
  const seenFoodIds = new Set<string>()

  foods.forEach((food, inputOrder) => {
    if (seenFoodIds.has(food.id)) return
    seenFoodIds.add(food.id)

    const reading = readingOf(food, foodGroupsById)
    grouped.get(groupKeyFor(reading))?.push({ food, reading, inputOrder })
  })

  return FOOD_INDEX_GROUPS.map(({ key, label }) => ({
    key,
    label,
    foods: (grouped.get(key) ?? [])
      .sort((left, right) =>
        collator.compare(left.reading, right.reading)
        || collator.compare(displayNameOf(left.food), displayNameOf(right.food))
        || left.inputOrder - right.inputOrder)
      .map(({ food }) => food),
  }))
}
