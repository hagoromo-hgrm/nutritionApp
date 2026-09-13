export interface ParsedSearchText {
  normalized: string
  compact: string
  tokens: string[]
}

/**
 * Higher values sort first. Keep this tuple shared by regular and MEXT food
 * search so callers can merge candidates without translating private scores.
 */
export type SearchRelevance = readonly [
  phraseTier: number,
  weakestTokenTier: number,
  tokenScore: number,
  fieldPriority: number,
]

export interface SearchableTextField {
  value: string
  name: string
  priority: number
  variantSpecific?: boolean
  relatedWeight?: number
}

export interface SearchTextMatch {
  score: number
  matchedBy: string
  relevance: SearchRelevance
  variantSpecific: boolean
  matchedFields: SearchableTextField[]
}

const EXACT_TIER = 4
const PREFIX_TIER = 3
const PARTIAL_TIER = 2
const RELATED_TIER = 1

function katakanaToHiragana(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 0x30a1 && codePoint <= 0x30f6
      ? String.fromCodePoint(codePoint - 0x60)
      : character
  }).join('')
}

/** Normalize width, case and kana while retaining meaningful token boundaries. */
export function parseSearchText(value: string): ParsedSearchText {
  const normalized = katakanaToHiragana(value.normalize('NFKC').toLocaleLowerCase('ja-JP'))
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}_]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  return {
    normalized,
    compact: normalized.replace(/\s+/g, ''),
    tokens: normalized ? normalized.split(' ') : [],
  }
}

export function normalizeSearchPhrase(value: string): string {
  return parseSearchText(value).normalized
}

export function compactSearchText(value: string): string {
  return parseSearchText(value).compact
}

export function compareSearchRelevance(left: SearchRelevance, right: SearchRelevance): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = right[index] - left[index]
    if (difference !== 0) return difference
  }
  return 0
}

export function compareSearchCandidates(
  left: { relevance?: SearchRelevance },
  right: { relevance?: SearchRelevance },
): number {
  return compareSearchRelevance(left.relevance ?? [0, 0, 0, 0], right.relevance ?? [0, 0, 0, 0])
}

function fieldMatch(token: string, field: SearchableTextField): { tier: number; score: number; matchedBy: string } | null {
  if (!field.value) return null
  const tier = field.name === 'related'
    ? (field.value.includes(token) ? RELATED_TIER : 0)
    : field.value === token
      ? EXACT_TIER
      : field.value.startsWith(token)
        ? PREFIX_TIER
        : field.value.includes(token)
          ? PARTIAL_TIER
          : 0
  if (tier === 0) return null
  return {
    tier,
    score: tier * 100 + field.priority + (field.name === 'related' ? Math.round((field.relatedWeight ?? 1) * 10) : 0),
    matchedBy: `${field.name}-${tier === EXACT_TIER ? 'exact' : tier === PREFIX_TIER ? 'prefix' : tier === PARTIAL_TIER ? 'partial' : 'related'}`,
  }
}

/** All query tokens must match at least one field. */
export function matchParsedSearchText(query: ParsedSearchText, fields: SearchableTextField[]): SearchTextMatch {
  if (!query.compact) {
    return { score: 0, matchedBy: 'empty', relevance: [0, 0, 0, 0], variantSpecific: false, matchedFields: [] }
  }

  const tokenMatches = query.tokens.map((token) => fields
    .map((field) => ({ field, match: fieldMatch(token, field) }))
    .filter((candidate): candidate is { field: SearchableTextField; match: NonNullable<ReturnType<typeof fieldMatch>> } => candidate.match !== null)
    .sort((left, right) => right.match.tier - left.match.tier
      || right.match.score - left.match.score
      || right.field.priority - left.field.priority)[0])
  if (tokenMatches.some((candidate) => !candidate)) {
    return { score: -1, matchedBy: 'none', relevance: [0, 0, 0, 0], variantSpecific: false, matchedFields: [] }
  }

  const completeMatches = tokenMatches as Array<{ field: SearchableTextField; match: NonNullable<ReturnType<typeof fieldMatch>> }>
  const phraseMatches = fields
    .map((field) => ({ field, match: fieldMatch(query.compact, field) }))
    .filter((candidate): candidate is { field: SearchableTextField; match: NonNullable<ReturnType<typeof fieldMatch>> } => candidate.match !== null)
    .sort((left, right) => right.match.tier - left.match.tier
      || right.match.score - left.match.score
      || right.field.priority - left.field.priority)
  const phrase = phraseMatches[0]
  const weakestTokenTier = Math.min(...completeMatches.map(({ match }) => match.tier))
  const tokenTotal = completeMatches.reduce((sum, { match }) => sum + match.score, 0)
  const fieldPriority = completeMatches.reduce((sum, { field }) => sum + field.priority, 0)
  const primary = phrase ?? completeMatches.slice().sort((left, right) => right.match.score - left.match.score)[0]
  return {
    score: tokenTotal,
    matchedBy: query.tokens.length > 1 ? `multi-${primary.match.matchedBy}` : primary.match.matchedBy,
    relevance: [phrase?.match.tier ?? 0, weakestTokenTier, tokenTotal, fieldPriority],
    variantSpecific: completeMatches.some(({ field }) => field.variantSpecific),
    matchedFields: completeMatches.map(({ field }) => field),
  }
}
