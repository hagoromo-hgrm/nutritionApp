import { describe, expect, it } from 'vitest'
import { filterVariantsBySelection, getVariantAttributes, getVariantOptionGroups, getVariantSelection, resolveVariantForSelection } from '../src/services/foodVariants'
import type { Food } from '../src/types'

const nutrients = { energyKcal: 100, proteinG: 10, fatG: 5, carbohydrateG: 1, fiberG: 0, saltG: 0, calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }
const food = (id: string, skin: '皮つき' | '皮なし', preparation: '生' | 'ゆで' | '焼き'): Food => ({ id, name: `鶏もも肉 ${skin} ${preparation}`, officialName: `＜鳥肉類＞ にわとり ［若どり・主品目］ もも ${skin} ${preparation}`, displayName: '鶏もも肉', maker: '', barcode: '', source: 'mext', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null, variantAttributes: { species: '鶏', part: 'もも', skin, preparation, variety: '若どり' }, nutrients, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' })

describe('food variation option selection', () => {
  const variants = [food('raw-skin', '皮つき', '生'), food('grilled-skin', '皮つき', '焼き'), food('raw-no-skin', '皮なし', '生'), food('boiled-no-skin', '皮なし', 'ゆで')]

  it('皮と調理方法を独立した選択グループとして作る', () => {
    const groups = getVariantOptionGroups(variants)
    expect(groups.map((group) => group.key)).toEqual(['skin', 'preparation'])
    expect(groups.find((group) => group.key === 'skin')?.options.map((option) => option.label)).toEqual(['皮つき', '皮なし'])
    expect(groups.find((group) => group.key === 'preparation')?.options.map((option) => option.label)).toEqual(['生', '焼き', 'ゆで'])
  })

  it('各ボタンの組み合わせから対象食品を決定する', () => {
    const groups = getVariantOptionGroups(variants)
    const defaultSelection = getVariantSelection(variants[0], groups)
    const selection = { ...defaultSelection, skin: '皮なし', preparation: 'ゆで' as const }
    expect(filterVariantsBySelection(variants, selection).map((item) => item.id)).toEqual(['boiled-no-skin'])
    expect(resolveVariantForSelection(variants, selection, variants[0].id)?.id).toBe('boiled-no-skin')
  })

  it('単独の「皮」を皮つき属性として扱い、部位に残さない', () => {
    const carrot: Food = { ...food('carrot', '皮つき', '生'), name: 'にんじん 根 皮 生', officialName: 'にんじん 根 皮 生', displayName: 'にんじん', variantAttributes: undefined }
    expect(getVariantAttributes(carrot)).toMatchObject({ part: '根', skin: '皮つき', preparation: '生' })
  })
})
