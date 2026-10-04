import { NUTRIENT_KEYS, type ExplicitAdditiveContent, type ExplicitAdditiveProof, type ExplicitAdditiveTrace, type ExplicitCompositionDeferredReason, type ExplicitProcessingEvidenceSource, type NutrientKey } from '../types'

export const ADDITIVE_DEFERRED_REASONS: readonly ExplicitCompositionDeferredReason[] = [
  'additive_unbound', 'additive_path_mismatch', 'additive_mass_unconfirmed', 'additive_mass_conflict', 'additive_raw_stage', 'additive_root_deferred',
]
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) throw new Error('添加物根拠の項目を確認してください。')
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('添加物根拠の文字列を確認してください。')
  return value
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) throw new Error('添加物根拠の数値を確認してください。')
  return value
}
function nutrient(value: unknown): NutrientKey {
  if (!(NUTRIENT_KEYS as readonly unknown[]).includes(value)) throw new Error('添加物の栄養素を確認してください。')
  return value as NutrientKey
}
function source(value: unknown): ExplicitProcessingEvidenceSource {
  if (!record(value)) throw new Error('添加物の出典を確認してください。')
  keys(value, ['kind', 'reference', 'verified', 'checkedAt'], ['version', 'sourceSha256'])
  if (!['manufacturer_recipe', 'user_measurement', 'material_specification'].includes(String(value.kind)) || value.verified !== true) throw new Error('確認済み添加物出典を指定してください。')
  if (typeof value.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt))) throw new Error('出典確認日時を確認してください。')
  if (value.sourceSha256 !== undefined && (typeof value.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(value.sourceSha256))) throw new Error('出典hashを確認してください。')
  return { kind: value.kind as ExplicitProcessingEvidenceSource['kind'], reference: text(value.reference, 1024), verified: true, checkedAt: value.checkedAt,
    ...(value.version === undefined ? {} : { version: text(value.version, 128) }), ...(value.sourceSha256 === undefined ? {} : { sourceSha256: String(value.sourceSha256) }) }
}
function content(value: unknown): ExplicitAdditiveContent {
  if (!record(value)) throw new Error('製剤含有量を確認してください。')
  if (value.kind === 'fixed' || value.kind === 'published_reference') {
    keys(value, ['kind', 'valuePerG']); return { kind: value.kind, valuePerG: number(value.valuePerG) }
  }
  if (value.kind === 'minimum') { keys(value, ['kind', 'minPerG']); return { kind: 'minimum', minPerG: number(value.minPerG) } }
  if (value.kind === 'declared_range') {
    keys(value, ['kind', 'minPerG', 'maxPerG'])
    const min = number(value.minPerG), max = number(value.maxPerG)
    if (min > max) throw new Error('製剤含有範囲が逆転しています。')
    return { kind: 'declared_range', minPerG: min, maxPerG: max }
  }
  throw new Error('製剤含有量の種類を確認してください。')
}
export function validateExplicitAdditiveProofs(value: unknown): ExplicitAdditiveProof[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('添加物根拠は64件以下で指定してください。')
  const ids = new Set<string>(), positions = new Set<string>()
  return value.map((raw) => {
    if (!record(raw)) throw new Error('添加物根拠を確認してください。')
    keys(raw, ['id', 'declaration', 'materialId', 'grade', 'dose', 'contentsPerG', 'doseSource', 'contentSource'])
    const id = text(raw.id, 128)
    if (!record(raw.declaration)) throw new Error('添加物の宣言位置を確認してください。')
    keys(raw.declaration, ['section', 'path', 'expectedName'])
    const section = raw.declaration.section
    if (section !== 'ingredient' && section !== 'additive') throw new Error('添加物の宣言区画を確認してください。')
    const path = raw.declaration.path
    if (!Array.isArray(path) || path.length < 1 || path.length > 16 || path.some((i) => !Number.isSafeInteger(i) || i < 0 || i > 255)) throw new Error('添加物の宣言位置を確認してください。')
    const position = JSON.stringify([section, path])
    if (ids.has(id) || positions.has(position)) throw new Error('添加物根拠IDまたは宣言位置が重複しています。')
    ids.add(id); positions.add(position)
    if (!record(raw.dose)) throw new Error('添加量を確認してください。')
    const stage = raw.dose.stage
    if (stage !== 'raw' && stage !== 'finished') throw new Error('添加量の重量段階を確認してください。')
    const amount = raw.dose.value === null ? null : number(raw.dose.value)
    let dose: ExplicitAdditiveProof['dose']
    if (raw.dose.kind === 'preparation_mass_g') {
      keys(raw.dose, ['kind', 'value', 'stage']); dose = { kind: raw.dose.kind, value: amount, stage }
    } else if (raw.dose.kind === 'active_nutrient_amount') {
      keys(raw.dose, ['kind', 'value', 'stage', 'nutrient']); dose = { kind: raw.dose.kind, value: amount, stage, nutrient: nutrient(raw.dose.nutrient) }
    } else throw new Error('添加量の種類を確認してください。')
    if (!record(raw.contentsPerG)) throw new Error('製剤含有量を確認してください。')
    const contentsPerG: ExplicitAdditiveProof['contentsPerG'] = {}
    for (const [key, value] of Object.entries(raw.contentsPerG)) contentsPerG[nutrient(key)] = content(value)
    const doseSource = source(raw.doseSource)
    if (doseSource.kind === 'material_specification') throw new Error('実添加量は配合表または実測で確認してください。')
    return { id, declaration: { section, path: [...path], expectedName: text(raw.declaration.expectedName) }, materialId: text(raw.materialId), grade: text(raw.grade), dose, contentsPerG, doseSource, contentSource: source(raw.contentSource) }
  })
}
export function additiveTrace(proof: ExplicitAdditiveProof, finishedBatchMassG: number | null): ExplicitAdditiveTrace {
  const traceSource = ({ kind, reference, version, sourceSha256 }: ExplicitProcessingEvidenceSource) => ({ kind, reference, ...(version === undefined ? {} : { version }), ...(sourceSha256 === undefined ? {} : { sourceSha256 }) })
  const points: ExplicitAdditiveTrace['pointsPer100g'] = {}, bounds: ExplicitAdditiveTrace['boundsPer100g'] = {}, referenceOnly: NutrientKey[] = []
  const mass = proof.dose.kind === 'preparation_mass_g' ? proof.dose.value : null
  if (finishedBatchMassG !== null && finishedBatchMassG > 0 && proof.dose.stage === 'finished' && proof.dose.value !== null) {
    const scale = 100 / finishedBatchMassG
    if (proof.dose.kind === 'active_nutrient_amount') points[proof.dose.nutrient] = proof.dose.value * scale
    else for (const key of NUTRIENT_KEYS) {
      const c = proof.contentsPerG[key]
      if (!c) continue
      if (c.kind === 'fixed' || c.kind === 'published_reference') {
        points[key] = proof.dose.value * c.valuePerG * scale
        if (c.kind === 'published_reference') referenceOnly.push(key)
      } else bounds[key] = { min: proof.dose.value * c.minPerG * scale, max: c.kind === 'minimum' ? null : proof.dose.value * c.maxPerG * scale }
    }
  }
  return { additiveId: proof.id, section: proof.declaration.section, path: [...proof.declaration.path], status: 'deferred', reason: 'additive_root_deferred', materialId: proof.materialId, grade: proof.grade, preparationMassG: mass, unknownAdditiveMass: mass === null, pointsPer100g: points, boundsPer100g: bounds, referenceOnlyNutrients: referenceOnly, doseSource: traceSource(proof.doseSource), contentSource: traceSource(proof.contentSource) }
}
export function isExplicitAdditiveTraceArray(value: unknown): value is ExplicitAdditiveTrace[] {
  if (!Array.isArray(value) || value.length > 64) return false
  const ids = new Set<string>()
  return value.every((raw) => {
    try {
      if (!record(raw)) return false
      keys(raw, ['additiveId', 'section', 'path', 'status', 'materialId', 'grade', 'preparationMassG', 'unknownAdditiveMass', 'pointsPer100g', 'boundsPer100g', 'referenceOnlyNutrients', 'doseSource', 'contentSource'], ['reason'])
      text(raw.additiveId, 128); text(raw.materialId); text(raw.grade)
      if (ids.has(String(raw.additiveId))) return false
      ids.add(String(raw.additiveId))
      if (!['ingredient', 'additive'].includes(String(raw.section)) || !Array.isArray(raw.path) || raw.path.length < 1 || raw.path.length > 16 || raw.path.some((i) => !Number.isSafeInteger(i) || i < 0 || i > 255)) return false
      if (!['applied', 'deferred'].includes(String(raw.status)) || (raw.status === 'applied' ? raw.reason !== undefined : !ADDITIVE_DEFERRED_REASONS.includes(raw.reason as ExplicitCompositionDeferredReason))) return false
      if (raw.preparationMassG !== null) number(raw.preparationMassG)
      if (raw.unknownAdditiveMass !== (raw.preparationMassG === null)) return false
      if (!record(raw.pointsPer100g) || !record(raw.boundsPer100g)) return false
      for (const [key, value] of Object.entries(raw.pointsPer100g)) { nutrient(key); number(value) }
      for (const [key, value] of Object.entries(raw.boundsPer100g)) {
        nutrient(key); if (!record(value)) return false; keys(value, ['min', 'max']); const min = number(value.min)
        if (value.max !== null && number(value.max) < min) return false
        if (Object.prototype.hasOwnProperty.call(raw.pointsPer100g, key)) return false
      }
      if (!Array.isArray(raw.referenceOnlyNutrients) || new Set(raw.referenceOnlyNutrients).size !== raw.referenceOnlyNutrients.length || raw.referenceOnlyNutrients.some((key) => { nutrient(key); return !Object.prototype.hasOwnProperty.call(raw.pointsPer100g, key) })) return false
      for (const item of [raw.doseSource, raw.contentSource]) {
        if (!record(item)) return false
        keys(item, ['kind', 'reference'], ['version', 'sourceSha256'])
        source({ ...item, verified: true, checkedAt: '2026-10-04T00:00:00Z' })
      }
      return true
    } catch { return false }
  })
}
