import type { Nutrients } from '../types'

export interface IngredientProfile {
  profileId: string
  canonicalName: string
  nutrients: Nutrients
  sourceFoodIds: readonly string[]
  priorProbability: number
  ambiguous?: boolean
  derivationWarnings?: readonly string[]
  priorSignals?: readonly {
    terms: readonly string[]
    multiplier: number
  }[]
}

interface IngredientProfileGroup {
  aliases: readonly string[]
  candidates: readonly IngredientProfile[]
}

const ZERO_SATURATED_FROM_ZERO_FAT = 'MEXTの脂質が0gのため、飽和脂肪酸を0gと導出しています。'

function profile(
  profileId: string,
  canonicalName: string,
  nutrients: Nutrients,
  options: Omit<IngredientProfile, 'profileId' | 'canonicalName' | 'nutrients' | 'sourceFoodIds' | 'priorProbability'> & {
    sourceFoodIds?: readonly string[]
    priorProbability?: number
  } = {},
): IngredientProfile {
  return {
    profileId,
    canonicalName,
    nutrients,
    sourceFoodIds: options.sourceFoodIds ?? [profileId],
    priorProbability: options.priorProbability ?? 1,
    ...options,
  }
}

const wheatWeak = profile('mext_01015', '小麦薄力粉', {
  energyKcal: 349, proteinG: 8.3, fatG: 1.5, carbohydrateG: 75.8, fiberG: 2.5, saltG: 0,
  calciumMg: 20, ironMg: 0.5, vitaminAMcg: 0, vitaminEMg: 0.3, vitaminB1Mg: 0.11,
  vitaminB2Mg: 0.03, vitaminCMg: 0, saturatedFatG: 0.34,
}, {
  priorProbability: 0.65,
  priorSignals: [
    { terms: ['クッキー', 'ビスケット', 'サブレ', 'ケーキ', '菓子', '天ぷら'], multiplier: 3 },
  ],
})
const wheatMedium = profile('mext_01018', '小麦中力粉', {
  energyKcal: 337, proteinG: 9, fatG: 1.6, carbohydrateG: 75.1, fiberG: 2.8, saltG: 0,
  calciumMg: 17, ironMg: 0.5, vitaminAMcg: 0, vitaminEMg: 0.3, vitaminB1Mg: 0.1,
  vitaminB2Mg: 0.03, vitaminCMg: 0, saturatedFatG: 0.36,
}, {
  priorProbability: 0.2,
  priorSignals: [
    { terms: ['うどん', '麺', 'そうめん', 'お好み焼き', 'たこ焼き'], multiplier: 4 },
  ],
})
const wheatStrong = profile('mext_01020', '小麦強力粉', {
  energyKcal: 337, proteinG: 11.8, fatG: 1.5, carbohydrateG: 71.7, fiberG: 2.7, saltG: 0,
  calciumMg: 17, ironMg: 0.9, vitaminAMcg: 0, vitaminEMg: 0.3, vitaminB1Mg: 0.09,
  vitaminB2Mg: 0.04, vitaminCMg: 0, saturatedFatG: 0.35,
}, {
  priorProbability: 0.15,
  priorSignals: [
    { terms: ['パン', 'ピザ', 'ベーグル'], multiplier: 5 },
  ],
})
const wholeWheat = profile('mext_01023', '小麦全粒粉', {
  energyKcal: 320, proteinG: 12.8, fatG: 2.9, carbohydrateG: 68.2, fiberG: 11.2, saltG: 0,
  calciumMg: 26, ironMg: 3.1, vitaminAMcg: 0, vitaminEMg: 1, vitaminB1Mg: 0.34,
  vitaminB2Mg: 0.09, vitaminCMg: 0, saturatedFatG: 0.53,
})
const oatmeal = profile('mext_01004', 'オートミール', {
  energyKcal: 350, proteinG: 13.7, fatG: 5.7, carbohydrateG: 69.1, fiberG: 9.4, saltG: 0,
  calciumMg: 47, ironMg: 3.9, vitaminAMcg: 0, vitaminEMg: 0.6, vitaminB1Mg: 0.2,
  vitaminB2Mg: 0.08, vitaminCMg: 0, saturatedFatG: 1.01,
})
const riceFlour = profile('mext_01158', '米粉', {
  energyKcal: 356, proteinG: 6, fatG: 0.7, carbohydrateG: 81.9, fiberG: 0.6, saltG: 0,
  calciumMg: 6, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.01, vitaminCMg: 0, saturatedFatG: 0.25,
})

const wheatStarch = profile('mext_02031', '小麦でん粉', {
  energyKcal: 360, proteinG: 0.2, fatG: 0.5, carbohydrateG: 86, fiberG: 0, saltG: 0,
  calciumMg: 14, ironMg: 0.6, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
}, { priorProbability: 0.2 })
const potatoStarch = profile('mext_02034', 'じゃがいもでん粉', {
  energyKcal: 338, proteinG: 0.1, fatG: 0.1, carbohydrateG: 81.6, fiberG: 0, saltG: 0,
  calciumMg: 10, ironMg: 0.6, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
}, {
  priorProbability: 0.35,
  priorSignals: [{ terms: ['片栗', 'ポテト', 'じゃがいも'], multiplier: 5 }],
})
const cornStarch = profile('mext_02035', 'とうもろこしでん粉', {
  energyKcal: 363, proteinG: 0.1, fatG: 0.7, carbohydrateG: 86.3, fiberG: 0, saltG: 0,
  calciumMg: 3, ironMg: 0.3, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0.13,
}, {
  priorProbability: 0.45,
  priorSignals: [{ terms: ['コーン', 'カスタード'], multiplier: 4 }],
})

const whiteSugar = profile('mext_03003', '上白糖', {
  energyKcal: 391, proteinG: 0, fatG: 0, carbohydrateG: 99.3, fiberG: 0, saltG: 0,
  calciumMg: 1, ironMg: null, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, { derivationWarnings: [ZERO_SATURATED_FROM_ZERO_FAT] })
const blackSugar = profile('mext_03001', '黒砂糖', {
  energyKcal: 352, proteinG: 1.7, fatG: null, carbohydrateG: 90.3, fiberG: 0, saltG: 0.1,
  calciumMg: 240, ironMg: 4.7, vitaminAMcg: 1, vitaminEMg: 0, vitaminB1Mg: 0.05,
  vitaminB2Mg: 0.07, vitaminCMg: 0, saturatedFatG: null,
})
const glucose = profile('mext_03017', 'ぶどう糖', {
  energyKcal: 342, proteinG: 0, fatG: 0, carbohydrateG: 91, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, { derivationWarnings: [ZERO_SATURATED_FROM_ZERO_FAT] })
const starchSyrup = profile('mext_03024', '水あめ', {
  energyKcal: 342, proteinG: 0, fatG: 0, carbohydrateG: 85, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, { derivationWarnings: [ZERO_SATURATED_FROM_ZERO_FAT] })
const honey = profile('mext_03022', 'はちみつ', {
  energyKcal: 329, proteinG: 0.3, fatG: null, carbohydrateG: 81.9, fiberG: 0, saltG: 0,
  calciumMg: 4, ironMg: 0.2, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: null,
  vitaminB2Mg: 0.01, vitaminCMg: 0, saturatedFatG: null,
})

const butter = profile('mext_14017', 'バター', {
  energyKcal: 700, proteinG: 0.6, fatG: 81, carbohydrateG: 0.2, fiberG: 0, saltG: 1.9,
  calciumMg: 15, ironMg: 0.1, vitaminAMcg: 520, vitaminEMg: 1.5, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.03, vitaminCMg: 0, saturatedFatG: 50.45,
})
const margarine = profile('mext_14029', 'マーガリン', {
  energyKcal: 740, proteinG: 0.3, fatG: 84.3, carbohydrateG: 0.1, fiberG: 0, saltG: 1.3,
  calciumMg: 14, ironMg: null, vitaminAMcg: 24, vitaminEMg: 15, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.03, vitaminCMg: 0, saturatedFatG: 39,
}, { ambiguous: true })
const shortening = profile('mext_14030', 'ショートニング', {
  energyKcal: 881, proteinG: 0, fatG: 99.9, carbohydrateG: 0, fiberG: 0, saltG: 0,
  calciumMg: 0, ironMg: 0, vitaminAMcg: 0, vitaminEMg: 9.5, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 51.13,
}, { ambiguous: true })
const palmOil = profile('mext_14009', 'パーム油', {
  energyKcal: 887, proteinG: 0, fatG: 100, carbohydrateG: 0, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0, vitaminAMcg: 0, vitaminEMg: 8.6, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 47.08,
}, {
  priorProbability: 0.5,
  ambiguous: true,
  priorSignals: [
    { terms: ['チョコ', 'ココア', 'クッキー', 'ビスケット', 'ウエハース', 'アイス'], multiplier: 2.5 },
    { terms: ['ドレッシング', 'マヨネーズ', 'サラダ'], multiplier: 0.35 },
  ],
})
const canolaOil = profile('mext_14008', 'なたね油', {
  energyKcal: 887, proteinG: 0, fatG: 100, carbohydrateG: 0, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0, vitaminAMcg: 0, vitaminEMg: 15, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 7.06,
}, {
  priorProbability: 0.3,
  ambiguous: true,
  priorSignals: [{ terms: ['ドレッシング', 'マヨネーズ', 'サラダ', '揚げ'], multiplier: 3 }],
})
const soyOil = profile('mext_14005', '大豆油', {
  energyKcal: 885, proteinG: 0, fatG: 100, carbohydrateG: 0, fiberG: 0, saltG: 0,
  calciumMg: 0, ironMg: 0, vitaminAMcg: 0, vitaminEMg: 10, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 14.87,
}, {
  priorProbability: 0.2,
  ambiguous: true,
  priorSignals: [{ terms: ['大豆', 'スナック', '揚げ'], multiplier: 2 }],
})

const chocolate = profile('mext_15116', 'チョコレート', {
  energyKcal: 550, proteinG: 6.9, fatG: 34.1, carbohydrateG: 55.8, fiberG: 3.9, saltG: 0.2,
  calciumMg: 240, ironMg: 2.4, vitaminAMcg: 66, vitaminEMg: 0.7, vitaminB1Mg: 0.19,
  vitaminB2Mg: 0.41, vitaminCMg: 0, saturatedFatG: 19.88,
}, { ambiguous: true })
const cocoa = profile('mext_16048', 'ココアパウダー', {
  energyKcal: 386, proteinG: 18.5, fatG: 21.6, carbohydrateG: 42.4, fiberG: 23.9, saltG: 0,
  calciumMg: 140, ironMg: 14, vitaminAMcg: 3, vitaminEMg: 0.3, vitaminB1Mg: 0.16,
  vitaminB2Mg: 0.22, vitaminCMg: 0, saturatedFatG: 12.4,
})
const almond = profile('mext_05001', 'アーモンド', {
  energyKcal: 609, proteinG: 19.6, fatG: 51.8, carbohydrateG: 20.9, fiberG: 10.1, saltG: 0,
  calciumMg: 250, ironMg: 3.6, vitaminAMcg: 1, vitaminEMg: 30, vitaminB1Mg: 0.2,
  vitaminB2Mg: 1.06, vitaminCMg: 0, saturatedFatG: 3.95,
})
const sesame = profile('mext_05017', 'ごま', {
  energyKcal: 604, proteinG: 19.8, fatG: 53.8, carbohydrateG: 16.5, fiberG: 10.8, saltG: 0,
  calciumMg: 1200, ironMg: 9.6, vitaminAMcg: 1, vitaminEMg: 0.1, vitaminB1Mg: 0.95,
  vitaminB2Mg: 0.25, vitaminCMg: null, saturatedFatG: 7.8,
}, { ambiguous: true })
const kinako = profile('mext_04029', 'きな粉', {
  energyKcal: 451, proteinG: 36.7, fatG: 25.7, carbohydrateG: 28.5, fiberG: 18.1, saltG: 0,
  calciumMg: 190, ironMg: 8, vitaminAMcg: null, vitaminEMg: 1.7, vitaminB1Mg: 0.07,
  vitaminB2Mg: 0.24, vitaminCMg: 1, saturatedFatG: 3.59,
}, { ambiguous: true })
const walnut = profile('mext_05014', 'くるみ', {
  energyKcal: 713, proteinG: 14.6, fatG: 68.8, carbohydrateG: 11.7, fiberG: 7.5, saltG: 0,
  calciumMg: 85, ironMg: 2.6, vitaminAMcg: 2, vitaminEMg: 1.2, vitaminB1Mg: 0.26,
  vitaminB2Mg: 0.15, vitaminCMg: 0, saturatedFatG: 6.87,
})
const peanut = profile('mext_05035', '落花生', {
  energyKcal: 613, proteinG: 25, fatG: 49.6, carbohydrateG: 21.3, fiberG: 11.4, saltG: 0,
  calciumMg: 50, ironMg: 1.7, vitaminAMcg: 1, vitaminEMg: 10, vitaminB1Mg: 0.24,
  vitaminB2Mg: 0.13, vitaminCMg: 0, saturatedFatG: 9,
})
const coconut = profile('mext_05016', 'ココナッツパウダー', {
  energyKcal: 676, proteinG: 6.1, fatG: 65.8, carbohydrateG: 23.7, fiberG: 14.1, saltG: 0,
  calciumMg: 15, ironMg: 2.8, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.03, vitaminCMg: 0, saturatedFatG: 55.25,
})

const egg = profile('mext_12004', '鶏卵', {
  energyKcal: 142, proteinG: 12.2, fatG: 10.2, carbohydrateG: 0.4, fiberG: 0, saltG: 0.4,
  calciumMg: 46, ironMg: 1.5, vitaminAMcg: 210, vitaminEMg: 1.3, vitaminB1Mg: 0.06,
  vitaminB2Mg: 0.37, vitaminCMg: 0, saturatedFatG: 3.12,
}, { ambiguous: true })
const milk = profile('mext_13003', '普通牛乳', {
  energyKcal: 61, proteinG: 3.3, fatG: 3.8, carbohydrateG: 4.8, fiberG: 0, saltG: 0.1,
  calciumMg: 110, ironMg: 0.02, vitaminAMcg: 38, vitaminEMg: 0.1, vitaminB1Mg: 0.04,
  vitaminB2Mg: 0.15, vitaminCMg: 1, saturatedFatG: 2.33,
})
const wholeMilkPowder = profile('mext_13009', '全粉乳', {
  energyKcal: 490, proteinG: 25.5, fatG: 26.2, carbohydrateG: 39.3, fiberG: 0, saltG: 1.1,
  calciumMg: 890, ironMg: 0.4, vitaminAMcg: 180, vitaminEMg: 0.6, vitaminB1Mg: 0.25,
  vitaminB2Mg: 1.1, vitaminCMg: 5, saturatedFatG: 16.28,
}, {
  priorProbability: 0.55,
  ambiguous: true,
  priorSignals: [{ terms: ['ミルク', 'チョコ', '濃厚'], multiplier: 2 }],
})
const skimMilkPowder = profile('mext_13010', '脱脂粉乳', {
  energyKcal: 354, proteinG: 34, fatG: 1, carbohydrateG: 53.3, fiberG: 0, saltG: 1.4,
  calciumMg: 1100, ironMg: 0.5, vitaminAMcg: 6, vitaminEMg: null, vitaminB1Mg: 0.3,
  vitaminB2Mg: 1.6, vitaminCMg: 5, saturatedFatG: 0.44,
}, {
  priorProbability: 0.35,
  priorSignals: [{ terms: ['脱脂', '低脂肪', '高たんぱく'], multiplier: 5 }],
})
const dairyCream = profile('mext_13014', '乳脂肪クリーム', {
  energyKcal: 404, proteinG: 1.9, fatG: 43, carbohydrateG: 6.5, fiberG: 0, saltG: 0.1,
  calciumMg: 49, ironMg: 0.1, vitaminAMcg: 160, vitaminEMg: 0.4, vitaminB1Mg: 0.02,
  vitaminB2Mg: 0.13, vitaminCMg: 0, saturatedFatG: 26.28,
}, {
  priorProbability: 0.5,
  ambiguous: true,
  priorSignals: [{ terms: ['生クリーム', '乳脂肪', '純乳脂肪'], multiplier: 5 }],
})
const mixedCream = profile('mext_13015', '乳脂肪・植物性脂肪クリーム', {
  energyKcal: 388, proteinG: 4.4, fatG: 42.1, carbohydrateG: 3, fiberG: 0, saltG: 0.4,
  calciumMg: 47, ironMg: 0.2, vitaminAMcg: 200, vitaminEMg: 0.4, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.07, vitaminCMg: null, saturatedFatG: 18.32,
}, { priorProbability: 0.25, ambiguous: true })
const plantCream = profile('mext_13016', '植物性脂肪クリーム', {
  energyKcal: 353, proteinG: 1.3, fatG: 39.5, carbohydrateG: 3.3, fiberG: 0, saltG: 0.1,
  calciumMg: 50, ironMg: 0, vitaminAMcg: 9, vitaminEMg: 4, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.07, vitaminCMg: 0, saturatedFatG: 26.61,
}, {
  priorProbability: 0.25,
  ambiguous: true,
  priorSignals: [{ terms: ['植物性', '豆乳', '乳不使用'], multiplier: 6 }],
})

const yuzuPeel = profile('mext_07142', 'ゆず果皮', {
  energyKcal: 50, proteinG: 1.2, fatG: 0.5, carbohydrateG: 14.2, fiberG: 6.9, saltG: 0,
  calciumMg: 41, ironMg: 0.3, vitaminAMcg: 20, vitaminEMg: 3.4, vitaminB1Mg: 0.07,
  vitaminB2Mg: 0.1, vitaminCMg: 160, saturatedFatG: 0.03,
}, {
  priorProbability: 0.75,
  ambiguous: true,
  priorSignals: [{ terms: ['砂糖漬け', 'ピール', 'マーマレード', '果皮'], multiplier: 6 }],
})
const yuzuJuice = profile('mext_07143', 'ゆず果汁', {
  energyKcal: 30, proteinG: 0.5, fatG: 0.1, carbohydrateG: 7, fiberG: 0.4, saltG: 0,
  calciumMg: 20, ironMg: 0.1, vitaminAMcg: 1, vitaminEMg: 0.2, vitaminB1Mg: 0.05,
  vitaminB2Mg: 0.02, vitaminCMg: 40, saturatedFatG: null,
}, {
  priorProbability: 0.25,
  ambiguous: true,
  priorSignals: [{ terms: ['果汁', 'ジュース', 'ドリンク', '飲料', 'ゼリー'], multiplier: 5 }],
})
const raisin = profile('mext_07117', '干しぶどう', {
  energyKcal: 324, proteinG: 2.7, fatG: 0.2, carbohydrateG: 80.3, fiberG: 4.1, saltG: 0,
  calciumMg: 65, ironMg: 2.3, vitaminAMcg: 1, vitaminEMg: 0.5, vitaminB1Mg: 0.12,
  vitaminB2Mg: 0.03, vitaminCMg: null, saturatedFatG: 0.03,
})
const banana = profile('mext_07107', 'バナナ', {
  energyKcal: 93, proteinG: 1.1, fatG: 0.2, carbohydrateG: 22.5, fiberG: 1.1, saltG: 0,
  calciumMg: 6, ironMg: 0.3, vitaminAMcg: 5, vitaminEMg: 0.5, vitaminB1Mg: 0.05,
  vitaminB2Mg: 0.04, vitaminCMg: 16, saturatedFatG: 0.07,
})
const apple = profile('mext_07176', 'りんご', {
  energyKcal: 56, proteinG: 0.2, fatG: 0.3, carbohydrateG: 16.2, fiberG: 1.9, saltG: 0,
  calciumMg: 4, ironMg: 0.1, vitaminAMcg: 2, vitaminEMg: 0.4, vitaminB1Mg: 0.02,
  vitaminB2Mg: 0.01, vitaminCMg: 6, saturatedFatG: 0.04,
}, { ambiguous: true })
const salt = profile('mext_17012', '食塩', {
  energyKcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0, fiberG: 0, saltG: 99.5,
  calciumMg: 22, ironMg: null, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, { derivationWarnings: [ZERO_SATURATED_FROM_ZERO_FAT] })

const GROUPS: readonly IngredientProfileGroup[] = [
  { aliases: ['小麦全粒粉', '全粒粉'], candidates: [wholeWheat] },
  { aliases: ['オートミール', 'オーツ麦', 'オート麦'], candidates: [oatmeal] },
  { aliases: ['薄力粉'], candidates: [wheatWeak] },
  { aliases: ['中力粉'], candidates: [wheatMedium] },
  { aliases: ['強力粉'], candidates: [wheatStrong] },
  { aliases: ['小麦粉', '小麦'], candidates: [wheatWeak, wheatMedium, wheatStrong] },
  { aliases: ['米粉', '上新粉'], candidates: [riceFlour] },
  { aliases: ['小麦でん粉'], candidates: [wheatStarch] },
  { aliases: ['じゃがいもでん粉', '馬鈴薯でん粉', '片栗粉'], candidates: [potatoStarch] },
  { aliases: ['とうもろこしでん粉', 'コーンスターチ'], candidates: [cornStarch] },
  { aliases: ['でん粉', '澱粉', '加工でん粉'], candidates: [cornStarch, potatoStarch, wheatStarch] },
  { aliases: ['黒砂糖', '黒糖'], candidates: [blackSugar] },
  { aliases: ['砂糖', '上白糖', 'グラニュー糖', 'ショ糖'], candidates: [whiteSugar] },
  { aliases: ['ぶどう糖', 'ブドウ糖', 'グルコース'], candidates: [glucose] },
  { aliases: ['水あめ', '水飴'], candidates: [starchSyrup] },
  { aliases: ['はちみつ', '蜂蜜'], candidates: [honey] },
  { aliases: ['ショートニング'], candidates: [shortening] },
  { aliases: ['マーガリン', 'ファットスプレッド'], candidates: [margarine] },
  { aliases: ['バター', '発酵バター'], candidates: [butter] },
  { aliases: ['パーム油'], candidates: [palmOil] },
  { aliases: ['なたね油', '菜種油', 'キャノーラ油'], candidates: [canolaOil] },
  { aliases: ['大豆油'], candidates: [soyOil] },
  { aliases: ['植物油脂', '植物油', '食用植物油脂'], candidates: [palmOil, canolaOil, soyOil] },
  { aliases: ['チョコレート', 'チョコ', 'チョコチップ', '準チョコレート'], candidates: [chocolate] },
  { aliases: ['ココアパウダー', 'ココア'], candidates: [cocoa] },
  { aliases: ['アーモンド', 'アーモンドパウダー', 'アーモンドプードル'], candidates: [almond] },
  { aliases: ['ごま', 'ゴマ', '胡麻'], candidates: [sesame] },
  { aliases: ['大豆粉', 'きな粉', 'きなこ'], candidates: [kinako] },
  { aliases: ['くるみ', 'クルミ', '胡桃'], candidates: [walnut] },
  { aliases: ['落花生', 'ピーナッツ'], candidates: [peanut] },
  { aliases: ['ココナッツ', 'ココナッツパウダー'], candidates: [coconut] },
  { aliases: ['脱脂粉乳', '脱脂乳粉'], candidates: [skimMilkPowder] },
  { aliases: ['全粉乳'], candidates: [wholeMilkPowder] },
  { aliases: ['普通牛乳', '牛乳', '生乳'], candidates: [milk] },
  { aliases: ['乳製品', '乳等を主要原料とする食品'], candidates: [wholeMilkPowder, skimMilkPowder, dairyCream] },
  { aliases: ['乳脂肪クリーム', '生クリーム'], candidates: [dairyCream] },
  { aliases: ['植物性クリーム'], candidates: [plantCream] },
  { aliases: ['クリーム', 'ホイップクリーム'], candidates: [dairyCream, mixedCream, plantCream] },
  { aliases: ['卵', '鶏卵', '全卵', '液卵'], candidates: [egg] },
  { aliases: ['ゆず果皮'], candidates: [yuzuPeel] },
  { aliases: ['ゆず果汁'], candidates: [yuzuJuice] },
  { aliases: ['ゆず', '柚子'], candidates: [yuzuPeel, yuzuJuice] },
  { aliases: ['干しぶどう', 'レーズン'], candidates: [raisin] },
  { aliases: ['バナナ'], candidates: [banana] },
  { aliases: ['りんご', 'リンゴ'], candidates: [apple] },
  { aliases: ['食塩', '塩'], candidates: [salt] },
] as const

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ja-JP')
}

function adjustedPrior(profileItem: IngredientProfile, productName: string): number {
  const normalizedProductName = normalize(productName)
  return (profileItem.priorSignals ?? []).reduce((prior, signal) => (
    signal.terms.some((term) => normalizedProductName.includes(normalize(term)))
      ? prior * signal.multiplier
      : prior
  ), profileItem.priorProbability)
}

export function resolveIngredientCandidates(
  ingredientName: string,
  productName: string | null | undefined,
): IngredientProfile[] {
  const normalizedIngredient = normalize(ingredientName)
  const group = GROUPS.find((item) => item.aliases.some((alias) => normalize(alias) === normalizedIngredient))
  if (!group) return []

  const adjusted = group.candidates.map((candidate) => ({
    ...candidate,
    priorProbability: adjustedPrior(candidate, productName ?? ''),
  }))
  const total = adjusted.reduce((sum, candidate) => sum + candidate.priorProbability, 0)
  return adjusted
    .map((candidate) => ({
      ...candidate,
      priorProbability: total > 0 ? candidate.priorProbability / total : 1 / adjusted.length,
    }))
    .sort((left, right) => (
      right.priorProbability - left.priorProbability
      || left.profileId.localeCompare(right.profileId)
    ))
}
