export type IngredientSection = 'ingredient' | 'additive'

export interface ParsedIngredient {
  rawName: string
  normalizedName: string
  section: IngredientSection
  compoundName: string | null
  components: ParsedIngredient[]
  notes: string[]
}

export interface ParsedIngredientDeclaration {
  ingredients: ParsedIngredient[]
  additives: ParsedIngredient[]
  usedExplicitAdditiveBoundary: boolean
  inferredAdditiveBoundary: boolean
}

const ADDITIVE_TERMS = [
  '増粘剤',
  '増粘多糖類',
  'ゲル化剤',
  '安定剤',
  '乳化剤',
  '膨張剤',
  '香料',
  '着色料',
  '酸味料',
  '甘味料',
  '調味料',
  '保存料',
  '酸化防止剤',
  'pH調整剤',
  'ph調整剤',
  '発色剤',
  '漂白剤',
  '糊料',
] as const

const ANNOTATION_PATTERNS = [
  /(?:国内|外国|日本|国)製造/u,
  /(?:国産|産)$/u,
  /原産(?:国|地)/u,
  /(?:一部に)?[^、,]*(?:を含む|由来)/u,
  /遺伝子組換え/u,
  /分別生産流通管理/u,
  /同一製造/u,
  /アレルゲン/u,
] as const

interface DeclarationToken {
  kind: 'item' | 'additive-boundary'
  value?: string
}

function tokenizeDeclaration(text: string): DeclarationToken[] {
  const tokens: DeclarationToken[] = []
  let current = ''
  let depth = 0

  const pushCurrent = () => {
    const value = current.trim()
    if (value) tokens.push({ kind: 'item', value })
    current = ''
  }

  for (const character of text) {
    if (character === '(' || character === '（' || character === '[' || character === '［') {
      depth += 1
      current += character
      continue
    }
    if (character === ')' || character === '）' || character === ']' || character === '］') {
      depth = Math.max(0, depth - 1)
      current += character
      continue
    }
    if (depth === 0 && (character === '/' || character === '／')) {
      pushCurrent()
      tokens.push({ kind: 'additive-boundary' })
      continue
    }
    if (depth === 0 && /[、,，;；\n\r]/u.test(character)) {
      pushCurrent()
      continue
    }
    current += character
  }
  pushCurrent()
  return tokens
}

function extractParentheticalGroups(value: string): { name: string; groups: string[] } {
  const groups: string[] = []
  let name = ''
  let group = ''
  let depth = 0

  for (const character of value) {
    const isOpening = character === '(' || character === '（'
    const isClosing = character === ')' || character === '）'
    if (isOpening) {
      if (depth > 0) group += character
      depth += 1
      continue
    }
    if (isClosing && depth > 0) {
      depth -= 1
      if (depth === 0) {
        const normalized = group.trim()
        if (normalized) groups.push(normalized)
        group = ''
      } else {
        group += character
      }
      continue
    }
    if (depth > 0) group += character
    else name += character
  }

  // 閉じ括弧がない入力は推測で分解せず、元の文字列を食品名として保持する。
  if (depth > 0) return { name: value.trim(), groups: [] }
  return { name: name.trim(), groups }
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^\s*(?:原材料(?:名)?|添加物)\s*[:：]\s*/u, '')
    .replace(/\s+/gu, '')
    .trim()
}

function looksLikeAdditive(value: string): boolean {
  const normalized = normalizeName(extractParentheticalGroups(value).name || value)
  return ADDITIVE_TERMS.some((term) => normalized.includes(term))
}

function isAnnotationGroup(value: string): boolean {
  const values = tokenizeDeclaration(value)
    .filter((token): token is DeclarationToken & { value: string } => token.kind === 'item' && Boolean(token.value))
    .map((token) => normalizeName(token.value))
  if (values.length === 0) return true
  const hasAnnotation = values.some((item) => ANNOTATION_PATTERNS.some((pattern) => pattern.test(item)))
  return hasAnnotation && values.every((item) => (
    item === 'その他'
    || ANNOTATION_PATTERNS.some((pattern) => pattern.test(item))
  ))
}

function parseItem(rawName: string, section: IngredientSection): {
  item: ParsedIngredient
  nestedAdditives: ParsedIngredient[]
} {
  const { name, groups } = extractParentheticalGroups(rawName)
  const normalizedName = normalizeName(name || rawName)
  const compoundGroup = groups.find((group) => {
    const foodItems = tokenizeDeclaration(group).filter((token) => token.kind === 'item')
    return foodItems.length >= 2 && !isAnnotationGroup(group)
  })
  const notes = groups.filter((group) => group !== compoundGroup)
  const components: ParsedIngredient[] = []
  const nestedAdditives: ParsedIngredient[] = []

  if (compoundGroup) {
    const nested = parseIngredientDeclaration(compoundGroup)
    components.push(...nested.ingredients.map((ingredient) => ({
      ...ingredient,
      compoundName: normalizedName,
    })))
    nestedAdditives.push(...nested.additives.map((additive) => ({
      ...additive,
      compoundName: normalizedName,
    })))
  }

  return {
    item: {
      rawName,
      normalizedName,
      section,
      compoundName: compoundGroup ? normalizedName : null,
      components,
      notes,
    },
    nestedAdditives,
  }
}

/**
 * 消費者庁の表示例にある「／」区切りと、複合原材料の括弧内表示を区別して解析する。
 * 産地・アレルゲン注記は構成原材料として展開しない。
 */
export function parseIngredientDeclaration(text: string): ParsedIngredientDeclaration {
  const normalizedText = text
    .normalize('NFKC')
    .replace(/^\s*原材料(?:名)?\s*[:：]\s*/u, '')
  const ingredients: ParsedIngredient[] = []
  const additives: ParsedIngredient[] = []
  let additiveSection = false
  let usedExplicitAdditiveBoundary = false
  let inferredAdditiveBoundary = false

  for (const token of tokenizeDeclaration(normalizedText)) {
    if (token.kind === 'additive-boundary') {
      additiveSection = true
      usedExplicitAdditiveBoundary = true
      continue
    }
    const rawName = token.value?.trim()
    if (!rawName) continue
    const normalizedName = normalizeName(rawName)
    if (normalizedName === '添加物') {
      additiveSection = true
      usedExplicitAdditiveBoundary = true
      continue
    }
    if (!additiveSection && looksLikeAdditive(rawName)) {
      additiveSection = true
      inferredAdditiveBoundary = true
    }

    const parsed = parseItem(rawName, additiveSection ? 'additive' : 'ingredient')
    if (additiveSection) additives.push(parsed.item)
    else ingredients.push(parsed.item)
    additives.push(...parsed.nestedAdditives)
  }

  return {
    ingredients,
    additives,
    usedExplicitAdditiveBoundary,
    inferredAdditiveBoundary,
  }
}
