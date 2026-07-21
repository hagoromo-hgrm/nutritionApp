import { describe, expect, it } from 'vitest'
import { normalizeSearchText, searchFoodResults } from '../src/services/foodSearch'
import { isCommercialFood } from '../src/services/foodClassification'
import type { Food, FoodAlias, FoodGroup, FoodRelatedTerm, FoodUsageStat } from '../src/types'

const nutrients = { energyKcal: 100, proteinG: 1, fatG: 1, carbohydrateG: 1, fiberG: 1, saltG: 0, calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null, vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null }
const food = (id: string, name: string, groupId: string): Food => ({ id, name, displayName: name, officialName: name, reading: null, maker: '', barcode: '', source: 'mext', sourceVersion: 'test', baseAmount: 100, baseUnit: 'g', servingAmount: null, servingUnit: null, foodGroupId: groupId, nutrients, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' })
const group = (id: string, displayName: string, defaultVariantId: string): FoodGroup => ({ id, displayName, reading: null, category: '主菜', representativeScore: 0, defaultVariantId, isActive: true, metadataSource: 'manual', generationVersion: 'test', needsReview: false, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' })

describe('local food search', () => {
  it('幅・大小・かな・区切りを正規化し、バーコードを検索語として解釈しない', () => {
    expect(normalizeSearchText(' トリムネ・肉 ')).toBe('とりむね肉')
    expect(normalizeSearchText('ＡＢＣ－１２３')).toBe('abc123')
    const barcodeFood = { ...food('barcode-food', 'バーコード食品', 'barcode'), barcode: '4901234567890' }
    const result = searchFoodResults('4901234567890', { foods: [barcodeFood], groups: [group('barcode', 'バーコード食品', 'barcode-food')], aliases: [], relatedTerms: [], usageStats: [] })
    expect(result.results).toHaveLength(0)
  })

  it('別名と関連語を分け、別名を関連語より上位にする', () => {
    const foods = [food('salt', '食塩', 'salt'), food('oil', '植物油', 'oil')]
    const groups = [group('salt', '食塩', 'salt'), group('oil', '植物油', 'oil')]
    const aliases: FoodAlias[] = [{ id: 'a1', foodGroupId: 'salt', foodVariantId: null, alias: '塩', normalizedAlias: '塩', aliasType: 'synonym', priority: 100, isActive: true, metadataSource: 'manual' }]
    const relatedTerms: FoodRelatedTerm[] = [{ id: 'r1', foodGroupId: 'oil', term: '塩味', normalizedTerm: '塩味', weight: 1, isActive: true, metadataSource: 'manual' }]
    const result = searchFoodResults('塩', { foods, groups, aliases, relatedTerms, usageStats: [] }, { now: new Date('2026-07-15T00:00:00Z') })
    expect(result.results[0].group.id).toBe('salt')
    expect(result.results[0].matchedBy).toBe('alias-exact')
  })

  it('グループを重複表示せず、既定バリエーションを選択する', () => {
    const foods = [food('chicken-raw', '鶏むね肉 生', 'chicken'), food('chicken-grilled', '鶏むね肉 焼き', 'chicken')]
    const result = searchFoodResults('鶏むね', { foods, groups: [group('chicken', '鶏むね肉', 'chicken-grilled')], aliases: [], relatedTerms: [], usageStats: [] })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].food.id).toBe('chicken-grilled')
    expect(result.results[0].variants).toHaveLength(2)
  })

  it('個人利用回数と最近の利用を順位へ反映する', () => {
    const foods = [food('a', '食品A', 'a'), food('b', '食品B', 'b')]
    const usageStats: FoodUsageStat[] = [{ foodId: 'b', selectionCount: 4, lastSelectedAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' }]
    const result = searchFoodResults('食品', { foods, groups: [group('a', '食品A', 'a'), group('b', '食品B', 'b')], aliases: [], relatedTerms: [], usageStats }, { now: new Date('2026-07-15T00:00:00Z') })
    expect(result.results[0].food.id).toBe('b')
    expect(result.results[0].recentlyUsed).toBe(true)
  })

  it('明示指定またはJANを持つ食品を外食・市販として判定する', () => {
    expect(isCommercialFood({ ...food('general', '一般食品', 'general') })).toBe(false)
    expect(isCommercialFood({ ...food('checked', '外食', 'checked'), isCommercial: true })).toBe(true)
    expect(isCommercialFood({ ...food('jan', '市販品', 'jan'), barcode: '4901234567890' })).toBe(true)
    expect(isCommercialFood({ ...food('external', '外部由来', 'external'), source: 'open_food_facts' })).toBe(false)
  })

  it('分類してからページングし、混在familyでは一致するバリエーションだけを返す', () => {
    const general = food('mixed-general', 'ミックス食品 一般', 'mixed')
    const commercial = { ...food('mixed-commercial', 'ミックス食品 市販', 'mixed'), isCommercial: true }
    const jan = { ...food('jan-commercial', 'JAN食品', 'jan'), barcode: '4901234567890' }
    const data = {
      foods: [general, commercial, jan],
      groups: [group('mixed', 'ミックス食品', 'mixed-general'), group('jan', 'JAN食品', 'jan-commercial')],
      aliases: [], relatedTerms: [], usageStats: [],
    }

    const generalPage = searchFoodResults('', data, { category: 'general', limit: 1 })
    expect(generalPage.results).toHaveLength(1)
    expect(generalPage.results[0].variants.map((item) => item.id)).toEqual(['mixed-general'])
    expect(generalPage.nextCursor).toBeNull()

    const commercialPage = searchFoodResults('', data, { category: 'commercial', limit: 1 })
    expect(commercialPage.results).toHaveLength(1)
    expect(commercialPage.results[0].variants).toHaveLength(1)
    expect(commercialPage.nextCursor).toBe('1')
  })
})
