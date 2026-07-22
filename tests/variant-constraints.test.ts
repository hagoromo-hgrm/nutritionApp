import { describe, expect, it } from 'vitest'
import { getAvailableConstraintValues, reconcileConstraintSelection, type VariantConstraintCandidate } from '../src/services/variantConstraints'

const candidates: VariantConstraintCandidate[] = [
  { id: 'raw-with', values: { kind: 'young', state: 'raw', skin: 'with' } },
  { id: 'raw-without', values: { kind: 'young', state: 'raw', skin: 'without' } },
  { id: 'grilled-with', values: { kind: 'young', state: 'grilled', skin: 'with' } },
  { id: 'parent-raw', values: { kind: 'parent', state: 'raw', skin: 'with' } },
]

describe('variant constraints', () => {
  const order = ['kind', 'state', 'skin']

  it('上位選択から到達できる値だけを返し、後続選択では上位候補を塞がない', () => {
    expect(getAvailableConstraintValues(candidates, order, { kind: 'parent' }, 'state')).toEqual(new Set(['raw']))
    expect(getAvailableConstraintValues(candidates, order, { state: 'grilled' }, 'kind')).toEqual(new Set(['young', 'parent']))
  })

  it('上位選択を維持し、到達不能になった下位選択だけを解除する', () => {
    const reconciled = reconcileConstraintSelection(candidates, order, { kind: 'parent', state: 'grilled', skin: 'with' })
    expect(reconciled.selection).toEqual({ kind: 'parent', skin: 'with' })
    expect(reconciled.clearedKeys).toEqual(new Set(['state']))
    expect(reconciled.matchingCandidateIds).toEqual(['parent-raw'])
  })
})
