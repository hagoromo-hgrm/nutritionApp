import { describe, expect, it } from 'vitest'
import { parseIngredientDeclaration } from '../src/services/ingredientParser'

describe('ingredient declaration parser', () => {
  it('複合原材料の括弧内を構成原材料として展開する', () => {
    const parsed = parseIngredientDeclaration('ゆず砂糖漬け（ゆず、砂糖）')

    expect(parsed.ingredients).toHaveLength(1)
    expect(parsed.ingredients[0]).toMatchObject({
      normalizedName: 'ゆず砂糖漬け',
      compoundName: 'ゆず砂糖漬け',
    })
    expect(parsed.ingredients[0].components.map((item) => item.normalizedName)).toEqual(['ゆず', '砂糖'])
    expect(parsed.additives).toEqual([])
  })

  it('産地とアレルゲンの括弧書きを複合原材料として誤展開しない', () => {
    const parsed = parseIngredientDeclaration(
      '小麦粉（国内製造）、豚肉（カナダ産、アメリカ産、その他）、バター（乳成分を含む）',
    )

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['小麦粉', '豚肉', 'バター'])
    expect(parsed.ingredients.every((item) => item.components.length === 0)).toBe(true)
  })

  it('独立した括弧内アレルゲン注記を原材料として扱わない', () => {
    const parsed = parseIngredientDeclaration('小麦粉、砂糖、（一部に小麦・乳成分を含む）')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['小麦粉', '砂糖'])
    expect(parsed.additives).toEqual([])
  })

  it('スラッシュ以降を添加物区画として食品原材料から分離する', () => {
    const parsed = parseIngredientDeclaration('小麦粉、はちみつ／増粘剤、香料、酸味料')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['小麦粉', 'はちみつ'])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['増粘剤', '香料', '酸味料'])
    expect(parsed.usedExplicitAdditiveBoundary).toBe(true)
    expect(parsed.inferredAdditiveBoundary).toBe(false)
  })

  it('スラッシュがなくても既知添加物以降を添加物区画として扱う', () => {
    const parsed = parseIngredientDeclaration('砂糖、濃縮果汁、ゲル化剤（ペクチン）、酸化防止剤（ビタミンC）')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['砂糖', '濃縮果汁'])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['ゲル化剤', '酸化防止剤'])
    expect(parsed.inferredAdditiveBoundary).toBe(true)
  })

  it('括弧内のスラッシュだけでは外側の添加物区画へ切り替えない', () => {
    const parsed = parseIngredientDeclaration('チョコレート（砂糖、カカオマス／乳化剤）、小麦粉')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['チョコレート', '小麦粉'])
    expect(parsed.ingredients[0].components.map((item) => item.normalizedName)).toEqual(['砂糖', 'カカオマス'])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['乳化剤'])
    expect(parsed.usedExplicitAdditiveBoundary).toBe(false)
  })

  it('閉じ括弧のない入力は推測で分解しない', () => {
    const parsed = parseIngredientDeclaration('小麦粉、ゆず砂糖漬け（ゆず、砂糖')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['小麦粉', 'ゆず砂糖漬け(ゆず、砂糖'])
    expect(parsed.ingredients[1].components).toEqual([])
  })

  it('商品バリエーション見出しを原材料名から除外する', () => {
    const parsed = parseIngredientDeclaration('<チーズ>生乳、＜レモン味＞砂糖')

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['生乳', '砂糖'])
  })

  it('亀甲括弧の複合原材料を展開する', () => {
    const parsed = parseIngredientDeclaration(
      'めん〔小麦粉（国内製造）、卵粉、植物油脂／かんすい〕、野菜（にんじん、ねぎ）',
    )

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual(['めん', '野菜'])
    expect(parsed.ingredients[0].components.map((item) => item.normalizedName)).toEqual([
      '小麦粉',
      '卵粉',
      '植物油脂',
    ])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['かんすい'])
  })

  it('複数区画の見出しで添加物区画を食品原材料へ戻す', () => {
    const parsed = parseIngredientDeclaration(
      '「めん」小麦粉、植物油脂／かんすい「添付調味料」ポークエキス、砂糖／調味料',
    )

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual([
      '小麦粉',
      '植物油脂',
      'ポークエキス',
      '砂糖',
    ])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['かんすい', '調味料'])
  })

  it('隅付き括弧の商品区画名を原材料名から分離する', () => {
    const parsed = parseIngredientDeclaration(
      '【ミックス】小麦粉、砂糖【ソース】植物油脂、マヨネーズ／調味料',
    )

    expect(parsed.ingredients.map((item) => item.normalizedName)).toEqual([
      '小麦粉',
      '砂糖',
      '植物油脂',
      'マヨネーズ',
    ])
    expect(parsed.additives.map((item) => item.normalizedName)).toEqual(['調味料'])
  })
})
