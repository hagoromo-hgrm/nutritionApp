import {
  parseIngredientDeclaration,
  type ParsedIngredient,
  type ParsedIngredientDeclaration,
} from './ingredientParser'
import {
  type ExplicitCompositionChildBinding,
  type ExplicitCompositionDeferredReason,
  type ExplicitCompositionEvidenceSource,
  type ExplicitCompositionGroup,
  type ExplicitEstimationEvidence,
} from '../types'
import {
  REVIEWED_COMPOSITION_STATE_REGISTRY_VERSION,
  reviewedCompositionDeclaredNameMatches,
  reviewedCompositionProfile,
} from './reviewedCompositionStates'

export const EXPLICIT_ESTIMATION_EVIDENCE_SCHEMA_VERSION = 1 as const
export const INGREDIENT_DECLARATION_FINGERPRINT_VERSION = 'ingredient-parser-path-v1'
export const EXPLICIT_COMPOSITION_DEFERRED_REASONS: readonly ExplicitCompositionDeferredReason[] = Object.freeze([
  'declaration_stale', 'parent_path_mismatch', 'child_names_mismatch', 'partial_group', 'raw_stage',
  'unknown_amount', 'profile_binding_missing', 'profile_state_unconfirmed', 'profile_state_mismatch',
  'profile_registry_stale', 'zero_weight_branch', 'root_group_missing', 'nested_binding_missing',
  'nested_parent_mismatch', 'parent_mass_unconfirmed', 'product_denominator_not_supported',
  'batch_mass_mismatch', 'additives_present',
])
const MAX_GROUPS = 64
const MAX_CHILDREN = 64
const MAX_PATH_DEPTH = 16
const MAX_INDEX = 255
const MAX_AMOUNT_G = 1_000_000_000
const SUM_ROUNDING_ULPS = 8

export interface PreparedCompositionGroup {
  group: ExplicitCompositionGroup
  status: 'applied' | 'deferred'
  reason?: ExplicitCompositionDeferredReason
  fixedChildRatios: number[]
  zeroWeightChildIndices: number[]
}

export interface PreparedExplicitCompositionEvidence {
  evidence: ExplicitEstimationEvidence
  declaration: ParsedIngredientDeclaration
  currentDeclarationFingerprint: string
  stale: boolean
  groups: PreparedCompositionGroup[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label}の字段を確認してください。`)
  }
}

function boundedString(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label}は1〜${max}文字で指定してください。`)
  }
  return value
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false
  return Number.isFinite(Date.parse(value))
}

export function isExplicitCompositionDeferredReason(value: unknown): value is ExplicitCompositionDeferredReason {
  return typeof value === 'string'
    && EXPLICIT_COMPOSITION_DEFERRED_REASONS.includes(value as ExplicitCompositionDeferredReason)
}

function validateSource(value: unknown, label: string): ExplicitCompositionEvidenceSource {
  if (!isRecord(value)) throw new Error(`${label}の出典を確認してください。`)
  assertKeys(value, ['kind', 'reference', 'verified', 'checkedAt'], ['version', 'sourceSha256'], label)
  if (value.kind !== 'manufacturer_recipe' && value.kind !== 'user_measurement') {
    throw new Error(`${label}の出典種別は製造者配合表またはユーザー実測に限定されます。`)
  }
  if (value.verified !== true) throw new Error(`${label}の出典は確認済みにしてください。`)
  const reference = boundedString(value.reference, `${label}の参照`, 1024)
  if (!isIsoDateTime(value.checkedAt)) throw new Error(`${label}の確認日時はISO 8601形式で指定してください。`)
  const version = value.version === undefined ? undefined : boundedString(value.version, `${label}の版`, 128)
  const sourceSha256 = value.sourceSha256 === undefined ? undefined : value.sourceSha256
  if (sourceSha256 !== undefined && (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(sourceSha256))) {
    throw new Error(`${label}のSHA-256を確認してください。`)
  }
  return {
    kind: value.kind,
    reference,
    verified: true,
    checkedAt: value.checkedAt,
    ...(version === undefined ? {} : { version }),
    ...(sourceSha256 === undefined ? {} : { sourceSha256 }),
  }
}

function validatePath(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length > MAX_PATH_DEPTH) throw new Error(`${label}の階層を確認してください。`)
  return value.map((index) => {
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) > MAX_INDEX) {
      throw new Error(`${label}の位置を確認してください。`)
    }
    return Number(index)
  })
}

function validateAmounts(value: unknown, expectedChildCount: number): ExplicitCompositionGroup['amounts'] {
  if (!isRecord(value)) throw new Error('配合量の形式を確認してください。')
  if (value.kind === 'fractions') {
    assertKeys(value, ['kind', 'children'], [], '割合配合')
    if (!Array.isArray(value.children) || value.children.length > MAX_CHILDREN) throw new Error('割合配合の項目数を確認してください。')
    const seen = new Set<number>()
    const children = value.children.map((child, index) => {
      if (!isRecord(child)) throw new Error(`割合配合の${index + 1}項目を確認してください。`)
      assertKeys(child, ['index', 'value'], [], '割合配合の項目')
      const childIndex = child.index
      if (!Number.isInteger(childIndex) || Number(childIndex) < 0 || Number(childIndex) >= expectedChildCount || seen.has(Number(childIndex))) {
        throw new Error('割合配合の位置が重複または範囲外です。')
      }
      seen.add(Number(childIndex))
      const amount = child.value
      if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1)) {
        throw new Error('割合は0〜1の有限値で指定してください。')
      }
      return { index: Number(childIndex), value: amount as number | null }
    })
    if (children.length === expectedChildCount && children.every((child) => child.value === 0)) {
      throw new Error('配合群の全材料重量が0です。')
    }
    return { kind: 'fractions', children }
  }
  if (value.kind === 'masses_g') {
    assertKeys(value, ['kind', 'denominatorMassG', 'children'], [], '重量配合')
    const denominatorMassG = value.denominatorMassG
    if (typeof denominatorMassG !== 'number' || !Number.isFinite(denominatorMassG) || denominatorMassG <= 0 || denominatorMassG > MAX_AMOUNT_G) {
      throw new Error('重量配合の分母は0より大きい有限重量で指定してください。')
    }
    if (!Array.isArray(value.children) || value.children.length > MAX_CHILDREN) throw new Error('重量配合の項目数を確認してください。')
    const seen = new Set<number>()
    const children = value.children.map((child, index) => {
      if (!isRecord(child)) throw new Error(`重量配合の${index + 1}項目を確認してください。`)
      assertKeys(child, ['index', 'value'], [], '重量配合の項目')
      const childIndex = child.index
      if (!Number.isInteger(childIndex) || Number(childIndex) < 0 || Number(childIndex) >= expectedChildCount || seen.has(Number(childIndex))) {
        throw new Error('重量配合の位置が重複または範囲外です。')
      }
      seen.add(Number(childIndex))
      const amount = child.value
      if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT_G)) {
        throw new Error('配合重量は0以上の有限値で指定してください。')
      }
      return { index: Number(childIndex), value: amount as number | null }
    })
    if (children.length === expectedChildCount && children.every((child) => child.value === 0)) {
      throw new Error('配合群の全材料重量が0です。')
    }
    return { kind: 'masses_g', denominatorMassG, children }
  }
  throw new Error('配合量の種別を確認してください。')
}

function validateBinding(value: unknown, childCount: number): ExplicitCompositionChildBinding {
  if (!isRecord(value) || !Number.isInteger(value.index) || Number(value.index) < 0 || Number(value.index) >= childCount) {
    throw new Error('配合の参照位置を確認してください。')
  }
  if (value.kind === 'profile') {
    assertKeys(value, ['kind', 'index', 'expectedProfileId', 'expectedProfileStateId', 'finishedIngredientStateId', 'stateSource'], [], '直接profile結合')
    return {
      kind: 'profile',
      index: Number(value.index),
      expectedProfileId: boundedString(value.expectedProfileId, '期待profile ID', 128),
      expectedProfileStateId: boundedString(value.expectedProfileStateId, '期待profile状態', 128),
      finishedIngredientStateId: boundedString(value.finishedIngredientStateId, '配合後材料状態', 128),
      stateSource: validateSource(value.stateSource, '材料状態の根拠'),
    }
  }
  if (value.kind === 'composition') {
    assertKeys(value, ['kind', 'index', 'compositionId'], [], '子配合結合')
    return { kind: 'composition', index: Number(value.index), compositionId: boundedString(value.compositionId, '子配合ID', 128) }
  }
  throw new Error('配合profileの結合種別を確認してください。')
}

function validateGroup(value: unknown): ExplicitCompositionGroup {
  if (!isRecord(value)) throw new Error('配合群を確認してください。')
  assertKeys(value, ['id', 'parent', 'expectedChildNames', 'denominator', 'weightStage', 'amounts', 'source'], ['childBindings'], '配合群')
  const id = boundedString(value.id, '配合群ID', 128)
  if (!isRecord(value.parent)) throw new Error('配合親pathを確認してください。')
  assertKeys(value.parent, ['section', 'path'], [], '配合親')
  if (value.parent.section !== 'ingredient') throw new Error('Step8の配合親は原材料区画に限定されます。')
  const path = validatePath(value.parent.path, '配合親path')
  const expectedChildNames = value.expectedChildNames
  if (!Array.isArray(expectedChildNames) || expectedChildNames.length === 0 || expectedChildNames.length > MAX_CHILDREN) {
    throw new Error('配合対象の子原材料数を確認してください。')
  }
  const childNames = expectedChildNames.map((name) => boundedString(name, '期待原材料名', 256))
  if (value.denominator !== 'product' && value.denominator !== 'parent') throw new Error('配合比率の分母を確認してください。')
  if (value.weightStage !== 'raw' && value.weightStage !== 'finished') throw new Error('配合重量段階を確認してください。')
  const amounts = validateAmounts(value.amounts, childNames.length)
  let childBindings: ExplicitCompositionChildBinding[] | undefined
  if (value.childBindings !== undefined) {
    if (!Array.isArray(value.childBindings) || value.childBindings.length > MAX_CHILDREN) throw new Error('配合参照の項目数を確認してください。')
    const seen = new Set<number>()
    childBindings = value.childBindings.map((binding) => {
      const validated = validateBinding(binding, childNames.length)
      if (seen.has(validated.index)) throw new Error('同じ原材料位置に複数のprofileを結合できません。')
      seen.add(validated.index)
      return validated
    })
  }
  return {
    id,
    parent: { section: 'ingredient', path },
    expectedChildNames: childNames,
    denominator: value.denominator,
    weightStage: value.weightStage,
    ...(childBindings === undefined ? {} : { childBindings }),
    amounts,
    source: validateSource(value.source, '配合根拠'),
  }
}

/** Strict Step8 boundary. Unknown keys (including Step9/10 fields) are rejected and all arrays are copied. */
export function validateExplicitEstimationEvidence(value: unknown): ExplicitEstimationEvidence {
  if (!isRecord(value)) throw new Error('明示推計根拠の形式を確認してください。')
  assertKeys(value, ['schemaVersion', 'declarationFingerprint'], ['compositions'], '明示推計根拠')
  if (value.schemaVersion !== EXPLICIT_ESTIMATION_EVIDENCE_SCHEMA_VERSION) throw new Error('明示推計根拠のschemaVersionに対応していません。')
  const declarationFingerprint = boundedString(value.declarationFingerprint, '原材料宣言fingerprint', 128)
  if (value.compositions !== undefined && !Array.isArray(value.compositions)) {
    throw new Error('配合群は配列で指定してください。')
  }
  const rawGroups = value.compositions ?? []
  if (!Array.isArray(rawGroups) || rawGroups.length > MAX_GROUPS) throw new Error('配合群は64件以下で指定してください。')
  const compositions = rawGroups.map(validateGroup)
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const group of compositions) {
    const path = JSON.stringify(group.parent.path)
    if (ids.has(group.id) || paths.has(path)) throw new Error('配合群IDまたは親pathが重複しています。')
    ids.add(group.id)
    paths.add(path)
  }
  return {
    schemaVersion: EXPLICIT_ESTIMATION_EVIDENCE_SCHEMA_VERSION,
    declarationFingerprint,
    ...(value.compositions === undefined ? {} : { compositions }),
  }
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function fingerprintNode(node: ParsedIngredient, path: readonly number[]): unknown {
  return {
    section: node.section,
    path,
    rawName: node.rawName.normalize('NFKC'),
    normalizedName: node.normalizedName,
    notes: node.notes.map((note) => note.normalize('NFKC')),
    components: node.components.map((child, index) => fingerprintNode(child, [...path, index])),
  }
}

export function createIngredientDeclarationFingerprint(ingredientsText: string): string {
  const declaration = parseIngredientDeclaration(ingredientsText)
  const payload = JSON.stringify({
    version: INGREDIENT_DECLARATION_FINGERPRINT_VERSION,
    ingredients: declaration.ingredients.map((node, index) => fingerprintNode(node, [index])),
    additives: declaration.additives.map((node, index) => fingerprintNode(node, [index])),
  })
  return `ingredient-declaration:${INGREDIENT_DECLARATION_FINGERPRINT_VERSION}:${fnv1a64(payload)}`
}

function childrenAtPath(declaration: ParsedIngredientDeclaration, path: readonly number[]): ParsedIngredient[] | null {
  if (path.length === 0) return declaration.ingredients
  const rootIndex = path[0]
  let node = declaration.ingredients[rootIndex]
  if (!node) return null
  for (const componentIndex of path.slice(1)) {
    node = node.components[componentIndex]
    if (!node) return null
  }
  return node.components
}

function compositionWeights(group: ExplicitCompositionGroup): {
  ratios: number[]
  zeroIndices: number[]
  reason?: ExplicitCompositionDeferredReason
} {
  const amountByIndex = new Map(group.amounts.children.map(({ index, value }) => [index, value]))
  if (amountByIndex.size !== group.expectedChildNames.length) return { ratios: [], zeroIndices: [], reason: 'partial_group' }
  if ([...amountByIndex.values()].some((value) => value === null)) return { ratios: [], zeroIndices: [], reason: 'unknown_amount' }
  const values = group.expectedChildNames.map((_name, index) => amountByIndex.get(index) as number)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (values.every((value) => value === 0)) return { ratios: [], zeroIndices: [], reason: 'partial_group' }
  if (!Number.isFinite(total) || total <= 0) return { ratios: [], zeroIndices: [], reason: 'partial_group' }
  const expectedTotal = group.amounts.kind === 'fractions' ? 1 : group.amounts.denominatorMassG
  const tolerance = Math.max(1, Math.abs(expectedTotal)) * Number.EPSILON * Math.max(1, values.length) * SUM_ROUNDING_ULPS
  if (Math.abs(total - expectedTotal) > tolerance) {
    return { ratios: [], zeroIndices: [], reason: total < expectedTotal ? 'partial_group' : 'batch_mass_mismatch' }
  }
  const denominator = group.amounts.kind === 'fractions' ? 1 : group.amounts.denominatorMassG
  return {
    ratios: values.map((value) => value / denominator),
    zeroIndices: values.flatMap((value, index) => value === 0 ? [index] : []),
  }
}

function childBindingReason(
  group: ExplicitCompositionGroup,
  ratios: readonly number[],
  groupsById: ReadonlyMap<string, ExplicitCompositionGroup>,
  children: readonly ParsedIngredient[],
): ExplicitCompositionDeferredReason | undefined {
  const bindings = new Map((group.childBindings ?? []).map((binding) => [binding.index, binding]))
  for (let index = 0; index < ratios.length; index += 1) {
    if (ratios[index] <= 0) continue
    const binding = bindings.get(index)
    if (!binding) return 'profile_binding_missing'
    if (binding.kind === 'profile') {
      if ((children[index]?.components.length ?? 0) > 0) return 'nested_binding_missing'
      if (binding.stateSource.verified !== true || !binding.stateSource.reference.trim()) return 'profile_state_unconfirmed'
      const reviewed = reviewedCompositionProfile(binding.expectedProfileId)
      if (!reviewed) return 'profile_registry_stale'
      if (binding.stateSource.reference.trim() === reviewed.state.officialSourceUrl) return 'profile_state_unconfirmed'
      if (!reviewedCompositionDeclaredNameMatches(binding.expectedProfileId, children[index]?.normalizedName ?? '')) {
        return 'profile_state_mismatch'
      }
      if (
        reviewed.state.profileStateId !== binding.expectedProfileStateId
        || reviewed.state.finishedIngredientStateId !== binding.finishedIngredientStateId
      ) return 'profile_state_mismatch'
    } else {
      const child = groupsById.get(binding.compositionId)
      if (!child) return 'nested_binding_missing'
      const expectedPath = [...group.parent.path, index]
      if (JSON.stringify(child.parent.path) !== JSON.stringify(expectedPath)) return 'nested_parent_mismatch'
    }
  }
  return undefined
}

/** Validate freshness and the bounded structural conditions before estimation. */
export function prepareExplicitCompositionEvidence(
  value: unknown,
  ingredientsText: string,
): PreparedExplicitCompositionEvidence {
  const evidence = validateExplicitEstimationEvidence(value)
  const declaration = parseIngredientDeclaration(ingredientsText)
  const currentDeclarationFingerprint = createIngredientDeclarationFingerprint(ingredientsText)
  const stale = evidence.declarationFingerprint !== currentDeclarationFingerprint
  const groupsById = new Map((evidence.compositions ?? []).map((group) => [group.id, group]))
  const groups = (evidence.compositions ?? []).map((group): PreparedCompositionGroup => {
    if (stale) return { group, status: 'deferred', reason: 'declaration_stale', fixedChildRatios: [], zeroWeightChildIndices: [] }
    if (declaration.additives.length > 0) return { group, status: 'deferred', reason: 'additives_present', fixedChildRatios: [], zeroWeightChildIndices: [] }
    if (group.weightStage !== 'finished') return { group, status: 'deferred', reason: 'raw_stage', fixedChildRatios: [], zeroWeightChildIndices: [] }
    const children = childrenAtPath(declaration, group.parent.path)
    if (!children) return { group, status: 'deferred', reason: 'parent_path_mismatch', fixedChildRatios: [], zeroWeightChildIndices: [] }
    if (JSON.stringify(children.map((child) => child.normalizedName)) !== JSON.stringify(group.expectedChildNames)) {
      return { group, status: 'deferred', reason: 'child_names_mismatch', fixedChildRatios: [], zeroWeightChildIndices: [] }
    }
    const weights = compositionWeights(group)
    if (weights.reason) return { group, status: 'deferred', reason: weights.reason, fixedChildRatios: [], zeroWeightChildIndices: [] }
    const reason = childBindingReason(group, weights.ratios, groupsById, children)
    if (reason) return { group, status: 'deferred', reason, fixedChildRatios: weights.ratios, zeroWeightChildIndices: weights.zeroIndices }
    return { group, status: 'applied', fixedChildRatios: weights.ratios, zeroWeightChildIndices: weights.zeroIndices }
  })
  return { evidence, declaration, currentDeclarationFingerprint, stale, groups }
}

export const EXPLICIT_COMPOSITION_STATE_REGISTRY_VERSION = REVIEWED_COMPOSITION_STATE_REGISTRY_VERSION
