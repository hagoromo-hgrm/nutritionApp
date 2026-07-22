export type VariantConstraintValue = string | null

export interface VariantConstraintCandidate {
  id: string
  values: Readonly<Record<string, VariantConstraintValue>>
}

export interface ReconciledVariantConstraintSelection {
  selection: Record<string, VariantConstraintValue>
  clearedKeys: Set<string>
  matchingCandidateIds: string[]
}

type VariantConstraintSelection = Readonly<Record<string, VariantConstraintValue | undefined>>

function candidateMatches(
  candidate: VariantConstraintCandidate,
  selection: VariantConstraintSelection,
  keys: readonly string[],
): boolean {
  return keys.every((key) => {
    const selectedValue = selection[key]
    return selectedValue === undefined || candidate.values[key] === selectedValue
  })
}

/** 後続項目を固定せず、上位選択から到達できる実在候補だけを有効にする。 */
export function getAvailableConstraintValues(
  candidates: readonly VariantConstraintCandidate[],
  orderedKeys: readonly string[],
  selection: VariantConstraintSelection,
  targetKey: string,
): Set<VariantConstraintValue> {
  const targetIndex = orderedKeys.indexOf(targetKey)
  if (targetIndex < 0) return new Set()
  const precedingKeys = orderedKeys.slice(0, targetIndex)
  return new Set(candidates
    .filter((candidate) => candidateMatches(candidate, selection, precedingKeys))
    .map((candidate) => candidate.values[targetKey]))
}

/** 上位選択を優先し、到達不能になった下位選択だけを解除する。 */
export function reconcileConstraintSelection(
  candidates: readonly VariantConstraintCandidate[],
  orderedKeys: readonly string[],
  selection: VariantConstraintSelection,
): ReconciledVariantConstraintSelection {
  const reconciled: Record<string, VariantConstraintValue> = {}
  const clearedKeys = new Set<string>()
  let matchingCandidates = [...candidates]
  for (const key of orderedKeys) {
    const selectedValue = selection[key]
    if (selectedValue === undefined) continue
    const narrowed = matchingCandidates.filter((candidate) => candidate.values[key] === selectedValue)
    if (narrowed.length === 0) {
      clearedKeys.add(key)
      continue
    }
    reconciled[key] = selectedValue
    matchingCandidates = narrowed
  }
  return {
    selection: reconciled,
    clearedKeys,
    matchingCandidateIds: matchingCandidates.map((candidate) => candidate.id),
  }
}
