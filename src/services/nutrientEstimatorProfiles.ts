import { genreProfileMultiplier } from '../data/nutrientEstimatorGenrePriors'
import type { EstimatorGenreId, Nutrients } from '../types'
import fdcProfilesArtifact from '../../data/fdc/app/ingredient_profiles.json'

export interface IngredientProfile {
  profileId: string
  canonicalName: string
  nutrients: Nutrients
  sourceFoodIds: readonly string[]
  priorProbability: number
  ambiguous?: boolean
  derivationWarnings?: readonly string[]
  requiredProductTerms?: readonly string[]
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

function reviewedFdcProfile(profileId: string): IngredientProfile {
  const item = fdcProfilesArtifact.profiles.find((candidate) => candidate.profileId === profileId)
  if (!item) throw new Error(`レビュー済みFDCプロファイルが見つかりません: ${profileId}`)
  return profile(item.profileId, item.canonicalName, item.nutrients as Nutrients, {
    sourceFoodIds: [`fdc:${item.source.fdcId}`],
    derivationWarnings: [
      `USDA FoodData Central ${item.source.dataType}の直接項目（FDC ID ${item.source.fdcId}）を使用しています。`,
    ],
  })
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
const fructose = profile('mext_03020', '果糖', {
  energyKcal: 375, proteinG: 0, fatG: 0, carbohydrateG: 99.9, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: null, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
})
const glucoseFructoseSyrup = profile('mext_03026', 'ぶどう糖果糖液糖', {
  energyKcal: 283, proteinG: 0, fatG: 0, carbohydrateG: 75, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
})
const fructoseGlucoseSyrup = profile('mext_03027', '果糖ぶどう糖液糖', {
  energyKcal: 283, proteinG: 0, fatG: 0, carbohydrateG: 75, fiberG: 0, saltG: 0,
  calciumMg: null, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
})
const reducedMaltose = profile('mext_03031', '還元麦芽糖', {
  energyKcal: 208, proteinG: 0, fatG: null, carbohydrateG: 100, fiberG: 0.3, saltG: 0,
  calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: null, saturatedFatG: null,
})
const honey = profile('mext_03022', 'はちみつ', {
  energyKcal: 329, proteinG: 0.3, fatG: null, carbohydrateG: 81.9, fiberG: 0, saltG: 0,
  calciumMg: 4, ironMg: 0.2, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: null,
  vitaminB2Mg: 0.01, vitaminCMg: 0, saturatedFatG: null,
})
const lactoseProxy = profile('proxy_lactose_mext_03003', '乳糖（糖類代理）', {
  energyKcal: 391, proteinG: 0, fatG: 0, carbohydrateG: 99.3, fiberG: 0, saltG: 0,
  calciumMg: 1, ironMg: null, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, {
  sourceFoodIds: ['mext_03003'],
  ambiguous: true,
  derivationWarnings: [
    '乳糖の独立したMEXT食品項目がないため、上白糖を糖類の代理参照として使用しています。',
    ZERO_SATURATED_FROM_ZERO_FAT,
  ],
})
const dextrinProxy = profile('proxy_dextrin_mext_02035', 'デキストリン（とうもろこしでん粉代理）', {
  energyKcal: 363, proteinG: 0.1, fatG: 0.7, carbohydrateG: 86.3, fiberG: 0, saltG: 0,
  calciumMg: 3, ironMg: 0.3, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0.13,
}, {
  sourceFoodIds: ['mext_02035'],
  ambiguous: true,
  derivationWarnings: [
    'デキストリンの独立したMEXT食品項目がないため、同じでん粉由来のとうもろこしでん粉を代理参照として使用しています。',
  ],
})
const solubleFiberProxy = profile('proxy_soluble_fiber_mext_09049', '難消化性糖質（粉寒天代理）', {
  energyKcal: 160, proteinG: 0.2, fatG: 0.3, carbohydrateG: 81.7, fiberG: 79, saltG: 0.4,
  calciumMg: null, ironMg: null, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: null,
  vitaminB2Mg: null, vitaminCMg: null, saturatedFatG: null,
}, {
  sourceFoodIds: ['mext_09049'],
  priorProbability: 0.2,
  ambiguous: true,
  requiredProductTerms: ['食物繊維', '食物せんい', 'ファイバー', 'トロメイク', 'とろみ'],
  priorSignals: [
    { terms: ['食物繊維', '食物せんい', 'ファイバー', 'トロメイク', 'とろみ'], multiplier: 12 },
  ],
  derivationWarnings: [
    '難消化性デキストリン等の直接項目がないため、食物繊維の代理参照に粉寒天を使用し、微量栄養素は推計対象外にしています。',
  ],
})
const fructooligosaccharideProxy = profile(
  'proxy_fructooligosaccharide_mext_03020',
  'フラクトオリゴ糖（果糖代理）',
  {
    energyKcal: 375, proteinG: 0, fatG: 0, carbohydrateG: 99.9, fiberG: 0, saltG: 0,
    calciumMg: null, ironMg: null, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
    vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
  },
  {
    sourceFoodIds: ['mext_03020'],
    ambiguous: true,
    derivationWarnings: [
      'フラクトオリゴ糖の独立したMEXT食品項目がないため、構成糖に近い果糖を代理参照として使用しています。',
    ],
  },
)
const declaredSolubleFiberProxy: IngredientProfile = {
  ...solubleFiberProxy,
  requiredProductTerms: undefined,
}

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
}, { priorProbability: 0.15, ambiguous: true })
const cocoaButterFdc = reviewedFdcProfile('fdc_cocoa_butter')
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
const cacaoMassProxy = profile('proxy_cacao_mass_mext_15187', 'カカオマス（高カカオチョコレート代理）', {
  energyKcal: 539, proteinG: 8.9, fatG: 41.3, carbohydrateG: 43.3, fiberG: 13.1, saltG: 0,
  calciumMg: 71, ironMg: 9.3, vitaminAMcg: 3, vitaminEMg: 0.5, vitaminB1Mg: 0.15,
  vitaminB2Mg: 0.11, vitaminCMg: 0, saturatedFatG: 23.3,
}, {
  sourceFoodIds: ['mext_15187'],
  ambiguous: true,
  derivationWarnings: [
    'カカオマスの独立したMEXT食品項目がないため、スイートチョコレート（カカオ増量）を代理参照として使用しています。',
  ],
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
const processedCheese = profile('mext_13040', 'プロセスチーズ', {
  energyKcal: 313, proteinG: 22.7, fatG: 26, carbohydrateG: 1.3, fiberG: 0, saltG: 2.8,
  calciumMg: 630, ironMg: 0.3, vitaminAMcg: 250, vitaminEMg: 1.1, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.38, vitaminCMg: 0, saturatedFatG: 16,
}, { ambiguous: true })
const creamCheese = profile('mext_13035', 'クリームチーズ', {
  energyKcal: 313, proteinG: 8.2, fatG: 33, carbohydrateG: 2.3, fiberG: 0, saltG: 0.7,
  calciumMg: 70, ironMg: 0.1, vitaminAMcg: 250, vitaminEMg: 1.2, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.22, vitaminCMg: 0, saturatedFatG: 20.26,
}, {
  priorProbability: 0.45,
  ambiguous: true,
  priorSignals: [{ terms: ['クリーム', 'レアチーズ', 'チーズケーキ'], multiplier: 4 }],
})
const goudaCheese = profile('mext_13036', 'ゴーダチーズ', {
  energyKcal: 356, proteinG: 25.8, fatG: 29, carbohydrateG: 1.4, fiberG: 0, saltG: 2,
  calciumMg: 680, ironMg: 0.3, vitaminAMcg: 270, vitaminEMg: 0.8, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.33, vitaminCMg: 0, saturatedFatG: 17.75,
}, { priorProbability: 0.35, ambiguous: true })
const mozzarellaCheese = profile('mext_13056', 'モッツァレラチーズ', {
  energyKcal: 269, proteinG: 18.4, fatG: 19.9, carbohydrateG: 4.2, fiberG: 0, saltG: 0.2,
  calciumMg: 330, ironMg: 0.1, vitaminAMcg: 280, vitaminEMg: 0.6, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.19, vitaminCMg: null, saturatedFatG: null,
}, {
  priorProbability: 0.2,
  ambiguous: true,
  priorSignals: [{ terms: ['ピザ', 'モッツァレラ'], multiplier: 5 }],
})
const concentratedMilkProxy = profile('proxy_concentrated_milk_mext_13012', '脱脂濃縮乳（無糖練乳代理）', {
  energyKcal: 135, proteinG: 6.8, fatG: 7.9, carbohydrateG: 11.2, fiberG: 0, saltG: 0.4,
  calciumMg: 270, ironMg: 0.2, vitaminAMcg: 50, vitaminEMg: 0.2, vitaminB1Mg: 0.06,
  vitaminB2Mg: 0.35, vitaminCMg: null, saturatedFatG: 4.88,
}, {
  sourceFoodIds: ['mext_13012'],
  ambiguous: true,
  derivationWarnings: [
    '脱脂濃縮乳の独立したMEXT食品項目がないため、無糖練乳を濃縮乳の代理参照として使用しています。',
  ],
})
const sweetenedCondensedMilk = profile('mext_13013', '加糖練乳', {
  energyKcal: 314, proteinG: 7.7, fatG: 8.5, carbohydrateG: 56, fiberG: 0, saltG: 0.2,
  calciumMg: 260, ironMg: 0.1, vitaminAMcg: 120, vitaminEMg: 0.2, vitaminB1Mg: 0.08,
  vitaminB2Mg: 0.37, vitaminCMg: 2, saturatedFatG: 5.59,
})
const milkProteinProxy = profile('proxy_milk_protein_mext_13010', '乳たんぱく（脱脂粉乳代理）', {
  energyKcal: 354, proteinG: 34, fatG: 1, carbohydrateG: 53.3, fiberG: 0, saltG: 1.4,
  calciumMg: 1100, ironMg: 0.5, vitaminAMcg: 6, vitaminEMg: null, vitaminB1Mg: 0.3,
  vitaminB2Mg: 1.6, vitaminCMg: 5, saturatedFatG: 0.44,
}, {
  sourceFoodIds: ['mext_13010'],
  ambiguous: true,
  derivationWarnings: [
    '乳清・乳たんぱくの独立したMEXT食品項目がないため、脱脂粉乳を乳由来たんぱく原料の代理参照として使用しています。',
  ],
})
const yogurt = profile('mext_13025', '発酵乳（全脂無糖ヨーグルト）', {
  energyKcal: 56, proteinG: 3.6, fatG: 3, carbohydrateG: 4.9, fiberG: 0, saltG: 0.1,
  calciumMg: 120, ironMg: null, vitaminAMcg: 33, vitaminEMg: 0.1, vitaminB1Mg: 0.04,
  vitaminB2Mg: 0.14, vitaminCMg: 1, saturatedFatG: 1.83,
}, { ambiguous: true })

const concentratedSoyProtein = profile('mext_04056', '濃縮大豆たんぱく', {
  energyKcal: 313, proteinG: 58.2, fatG: 1.7, carbohydrateG: 27.9, fiberG: 20.9, saltG: 1.4,
  calciumMg: 280, ironMg: 9.2, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.37,
  vitaminB2Mg: 0.11, vitaminCMg: null, saturatedFatG: 0.21,
}, { priorProbability: 0.55, ambiguous: true })
const isolatedSoyProtein = profile('mext_04057', '分離大豆たんぱく', {
  energyKcal: 335, proteinG: 79.1, fatG: 3, carbohydrateG: 7.5, fiberG: 4.2, saltG: 3.3,
  calciumMg: 57, ironMg: 9.4, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.11,
  vitaminB2Mg: 0.14, vitaminCMg: null, saturatedFatG: 0.41,
}, { priorProbability: 0.45, ambiguous: true })

const powderedAgar = profile('mext_09049', '粉寒天', {
  energyKcal: 160, proteinG: 0.2, fatG: 0.3, carbohydrateG: 81.7, fiberG: 79, saltG: 0.4,
  calciumMg: 120, ironMg: 7.3, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: null, vitaminCMg: 0, saturatedFatG: 0.05,
}, { ambiguous: true })
const gelatin = profile('mext_11198', 'ゼラチン', {
  energyKcal: 347, proteinG: 87.6, fatG: 0.3, carbohydrateG: 0, fiberG: 0, saltG: 0.7,
  calciumMg: 16, ironMg: 0.7, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: null,
})
const rawRice = profile('mext_01083', '精白米（うるち米）', {
  energyKcal: 342, proteinG: 6.1, fatG: 0.9, carbohydrateG: 77.6, fiberG: 0.5, saltG: 0,
  calciumMg: 5, ironMg: 0.8, vitaminAMcg: 0, vitaminEMg: 0.1, vitaminB1Mg: 0.08,
  vitaminB2Mg: 0.02, vitaminCMg: 0, saturatedFatG: 0.29,
})
const dryPasta = profile('mext_01063', 'マカロニ・スパゲッティ（乾）', {
  energyKcal: 347, proteinG: 12.9, fatG: 1.8, carbohydrateG: 73.1, fiberG: 5.4, saltG: 0,
  calciumMg: 18, ironMg: 1.4, vitaminAMcg: 1, vitaminEMg: 0.3, vitaminB1Mg: 0.19,
  vitaminB2Mg: 0.06, vitaminCMg: 0, saturatedFatG: 0.39,
})
const onion = profile('mext_06153', 'たまねぎ', {
  energyKcal: 33, proteinG: 1, fatG: 0.1, carbohydrateG: 8.4, fiberG: 1.5, saltG: 0,
  calciumMg: 17, ironMg: 0.3, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0.04,
  vitaminB2Mg: 0.01, vitaminCMg: 7, saturatedFatG: 0.01,
})
const tomatoPaste = profile('mext_17035', 'トマトペースト', {
  energyKcal: 94, proteinG: 3.8, fatG: 0.1, carbohydrateG: 22, fiberG: 4.7, saltG: 0.1,
  calciumMg: 46, ironMg: 1.6, vitaminAMcg: 85, vitaminEMg: 6.2, vitaminB1Mg: 0.21,
  vitaminB2Mg: 0.14, vitaminCMg: 15, saturatedFatG: 0.02,
})
const driedMashedPotato = profile('mext_02021', '乾燥マッシュポテト', {
  energyKcal: 347, proteinG: 6.6, fatG: 0.6, carbohydrateG: 82.8, fiberG: 6.6, saltG: 0.2,
  calciumMg: 24, ironMg: 3.1, vitaminAMcg: 0, vitaminEMg: 0.2, vitaminB1Mg: 0.25,
  vitaminB2Mg: 0.05, vitaminCMg: 5, saturatedFatG: 0.3,
})
const driedKombu = profile('mext_09017', 'まこんぶ（素干し）', {
  energyKcal: 170, proteinG: 5.8, fatG: 1.3, carbohydrateG: 64.3, fiberG: 32.1, saltG: 6.6,
  calciumMg: 780, ironMg: 3.2, vitaminAMcg: 130, vitaminEMg: 2.6, vitaminB1Mg: 0.26,
  vitaminB2Mg: 0.31, vitaminCMg: 29, saturatedFatG: 0.35,
})
const shrimp = profile('mext_10328', 'しばえび（生）', {
  energyKcal: 78, proteinG: 18.7, fatG: 0.4, carbohydrateG: 0.1, fiberG: 0, saltG: 0.6,
  calciumMg: 56, ironMg: 1, vitaminAMcg: 4, vitaminEMg: 1.7, vitaminB1Mg: 0.02,
  vitaminB2Mg: 0.06, vitaminCMg: 2, saturatedFatG: 0.06,
}, {
  ambiguous: true,
  derivationWarnings: ['えびの種類・加工状態が不明なため、MEXTのしばえび（生）を代表参照として使用しています。'],
})
const blackPepper = profile('mext_17063', '黒こしょう（粉）', {
  energyKcal: 362, proteinG: 11, fatG: 6, carbohydrateG: 66.6, fiberG: null, saltG: 0.2,
  calciumMg: 410, ironMg: 20, vitaminAMcg: 15, vitaminEMg: null, vitaminB1Mg: 0.1,
  vitaminB2Mg: 0.24, vitaminCMg: 0, saturatedFatG: 2.56,
}, { priorProbability: 0.65, ambiguous: true })
const curryPowder = profile('mext_17061', 'カレー粉', {
  energyKcal: 338, proteinG: 13, fatG: 12.2, carbohydrateG: 63.3, fiberG: 36.9, saltG: 0.1,
  calciumMg: 540, ironMg: 29, vitaminAMcg: 32, vitaminEMg: 4.4, vitaminB1Mg: 0.41,
  vitaminB2Mg: 0.25, vitaminCMg: 2, saturatedFatG: 1.28,
}, {
  priorProbability: 0.35,
  ambiguous: true,
  priorSignals: [{ terms: ['カレー'], multiplier: 8 }],
})
const instantCoffee = profile('mext_16046', 'インスタントコーヒー', {
  energyKcal: 287, proteinG: 14.7, fatG: 0.3, carbohydrateG: 56.5, fiberG: null, saltG: 0.1,
  calciumMg: 140, ironMg: 3, vitaminAMcg: 0, vitaminEMg: 0.1, vitaminB1Mg: 0.02,
  vitaminB2Mg: 0.14, vitaminCMg: 0, saturatedFatG: 0.09,
})
const blackTeaLeaf = profile('mext_16043', '紅茶（茶葉）', {
  energyKcal: 234, proteinG: 20.3, fatG: 2.5, carbohydrateG: 51.7, fiberG: 38.1, saltG: 0,
  calciumMg: 470, ironMg: 17, vitaminAMcg: 75, vitaminEMg: 9.8, vitaminB1Mg: 0.1,
  vitaminB2Mg: 0.8, vitaminCMg: 0, saturatedFatG: null,
}, {
  ambiguous: true,
  derivationWarnings: ['紅茶エキス粉末の濃縮度が不明なため、MEXTの紅茶茶葉を代表参照として使用しています。'],
})
const whiteSauce = profile('mext_17109', 'ホワイトソース', {
  energyKcal: 99, proteinG: 1.8, fatG: 6.2, carbohydrateG: 9.2, fiberG: 0.4, saltG: 1,
  calciumMg: 34, ironMg: 0.1, vitaminAMcg: null, vitaminEMg: 0.6, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.05, vitaminCMg: 0, saturatedFatG: 1.97,
}, {
  ambiguous: true,
  derivationWarnings: ['ホワイトルウの濃縮度が不明なため、MEXTのホワイトソースを代表参照として使用しています。'],
})
const curryRoux = profile('mext_17051', 'カレールウ', {
  energyKcal: 474, proteinG: 6.5, fatG: 34.1, carbohydrateG: 44.7, fiberG: 6.4, saltG: 10.6,
  calciumMg: 90, ironMg: 3.5, vitaminAMcg: 6, vitaminEMg: 2, vitaminB1Mg: 0.09,
  vitaminB2Mg: 0.06, vitaminCMg: 0, saturatedFatG: 14.84,
})
const demiGlaceSauce = profile('mext_17105', 'デミグラスソース', {
  energyKcal: 82, proteinG: 2.9, fatG: 3, carbohydrateG: 11, fiberG: null, saltG: 1.3,
  calciumMg: 11, ironMg: 0.3, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: 0.04,
  vitaminB2Mg: 0.07, vitaminCMg: null, saturatedFatG: null,
})
const leanBeef = profile('mext_11006', '和牛かた赤肉（生）', {
  energyKcal: 183, proteinG: 20.2, fatG: 12.2, carbohydrateG: 0.3, fiberG: 0, saltG: 0.1,
  calciumMg: 4, ironMg: 2.7, vitaminAMcg: 0, vitaminEMg: 0.3, vitaminB1Mg: 0.09,
  vitaminB2Mg: 0.24, vitaminCMg: 1, saturatedFatG: 4.01,
}, {
  ambiguous: true,
  derivationWarnings: ['牛肉の部位・品種が不明なため、MEXTの和牛かた赤肉（生）を代表参照として使用しています。'],
})
const dryBreadcrumbs = profile('mext_01079', '乾燥パン粉', {
  energyKcal: 349, proteinG: 14.9, fatG: 4.1, carbohydrateG: 67.4, fiberG: 6.5, saltG: 1.4,
  calciumMg: 25, ironMg: 1.1, vitaminAMcg: null, vitaminEMg: 0.4, vitaminB1Mg: 0.16,
  vitaminB2Mg: 0.05, vitaminCMg: null, saturatedFatG: 1.48,
})
const strawberry = profile('mext_07012', 'いちご', {
  energyKcal: 31, proteinG: 0.9, fatG: 0.1, carbohydrateG: 8.5, fiberG: 1.4, saltG: 0,
  calciumMg: 17, ironMg: 0.3, vitaminAMcg: 1, vitaminEMg: 0.4, vitaminB1Mg: 0.03,
  vitaminB2Mg: 0.02, vitaminCMg: 62, saturatedFatG: 0.01,
}, {
  priorProbability: 0.4,
  ambiguous: true,
  priorSignals: [{ terms: ['いちご', '苺', 'ストロベリー'], multiplier: 8 }],
})
const driedStrawberry = profile('mext_07160', '乾燥いちご', {
  energyKcal: 329, proteinG: 0.5, fatG: 0.2, carbohydrateG: 82.8, fiberG: 3, saltG: 0.7,
  calciumMg: 140, ironMg: 0.4, vitaminAMcg: 2, vitaminEMg: 0.7, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0.02,
})
const peach = profile('mext_07136', 'もも', {
  energyKcal: 38, proteinG: 0.6, fatG: 0.1, carbohydrateG: 10.2, fiberG: 1.3, saltG: 0,
  calciumMg: 4, ironMg: 0.1, vitaminAMcg: null, vitaminEMg: 0.7, vitaminB1Mg: 0.01,
  vitaminB2Mg: 0.01, vitaminCMg: 8, saturatedFatG: 0.01,
}, {
  priorProbability: 0.3,
  ambiguous: true,
  priorSignals: [{ terms: ['もも', '桃', 'ピーチ'], multiplier: 8 }],
})
const grapeJuice = profile('mext_07118', 'ぶどうストレートジュース', {
  energyKcal: 54, proteinG: 0.3, fatG: 0.2, carbohydrateG: 14.3, fiberG: 0.1, saltG: 0,
  calciumMg: 3, ironMg: 0.1, vitaminAMcg: 0, vitaminEMg: 0, vitaminB1Mg: 0.02,
  vitaminB2Mg: 0.01, vitaminCMg: null, saturatedFatG: 0.03,
}, {
  priorProbability: 0.35,
  ambiguous: true,
  priorSignals: [{ terms: ['ぶどう', '葡萄', 'グレープ'], multiplier: 8 }],
})
const lemonJuice = profile('mext_07156', 'レモン果汁', {
  energyKcal: 24, proteinG: 0.4, fatG: 0.2, carbohydrateG: 8.6, fiberG: null, saltG: 0,
  calciumMg: 7, ironMg: 0.1, vitaminAMcg: 1, vitaminEMg: 0.1, vitaminB1Mg: 0.04,
  vitaminB2Mg: 0.02, vitaminCMg: 50, saturatedFatG: 0.02,
}, {
  priorProbability: 0.35,
  ambiguous: true,
  priorSignals: [{ terms: ['レモン', '檸檬'], multiplier: 8 }],
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
const compressedYeast = profile('mext_17082', 'パン酵母（圧搾）', {
  energyKcal: 105, proteinG: 16.5, fatG: 1.5, carbohydrateG: 12.1, fiberG: 10.3, saltG: 0.1,
  calciumMg: 16, ironMg: 2.2, vitaminAMcg: null, vitaminEMg: null, vitaminB1Mg: 2.21,
  vitaminB2Mg: 1.78, vitaminCMg: 0, saturatedFatG: 0.19,
}, { priorProbability: 0.15, ambiguous: true })
const dryYeast = profile('mext_17083', 'パン酵母（乾燥）', {
  energyKcal: 307, proteinG: 37.1, fatG: 6.8, carbohydrateG: 43.1, fiberG: 32.6, saltG: 0.3,
  calciumMg: 19, ironMg: 13, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 8.81,
  vitaminB2Mg: 3.72, vitaminCMg: 1, saturatedFatG: 0.79,
}, { priorProbability: 0.85, ambiguous: true })
const salt = profile('mext_17012', '食塩', {
  energyKcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0, fiberG: 0, saltG: 99.5,
  calciumMg: 22, ironMg: null, vitaminAMcg: 0, vitaminEMg: null, vitaminB1Mg: 0,
  vitaminB2Mg: 0, vitaminCMg: 0, saturatedFatG: 0,
}, { derivationWarnings: [ZERO_SATURATED_FROM_ZERO_FAT] })

const GROUPS: readonly IngredientProfileGroup[] = [
  { aliases: ['小麦全粒粉', '全粒粉'], candidates: [wholeWheat] },
  { aliases: ['オートミール', 'オーツ麦', 'オート麦', 'オーツ麦フレーク'], candidates: [oatmeal] },
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
  { aliases: ['果糖'], candidates: [fructose] },
  { aliases: ['ぶどう糖果糖液糖', '砂糖混合ぶどう糖果糖液糖'], candidates: [glucoseFructoseSyrup] },
  { aliases: ['果糖ぶどう糖液糖'], candidates: [fructoseGlucoseSyrup] },
  { aliases: ['異性化液糖'], candidates: [glucoseFructoseSyrup, fructoseGlucoseSyrup] },
  { aliases: ['還元麦芽糖', '還元麦芽糖水あめ'], candidates: [reducedMaltose] },
  { aliases: ['還元水あめ', '粉あめ', 'でん粉糖化物'], candidates: [starchSyrup] },
  { aliases: ['はちみつ', '蜂蜜'], candidates: [honey] },
  { aliases: ['乳糖', 'ラクトース'], candidates: [lactoseProxy] },
  {
    aliases: ['難消化性デキストリン', 'イソマルトデキストリン', 'ポリデキストロース', 'イヌリン'],
    candidates: [declaredSolubleFiberProxy],
  },
  { aliases: ['フラクトオリゴ糖', 'オリゴ糖'], candidates: [fructooligosaccharideProxy] },
  { aliases: ['デキストリン'], candidates: [dextrinProxy, solubleFiberProxy] },
  { aliases: ['液状デキストリン', 'マルトデキストリン'], candidates: [dextrinProxy] },
  { aliases: ['ショートニング'], candidates: [shortening] },
  { aliases: ['ココアバター', 'カカオバター'], candidates: [cocoaButterFdc] },
  { aliases: ['マーガリン', 'ファットスプレッド'], candidates: [margarine] },
  { aliases: ['バター', '発酵バター', 'バターオイル', 'バター加工品'], candidates: [butter] },
  { aliases: ['パーム油'], candidates: [palmOil] },
  { aliases: ['なたね油', '菜種油', 'キャノーラ油'], candidates: [canolaOil] },
  { aliases: ['大豆油'], candidates: [soyOil] },
  {
    aliases: [
      '植物油脂', '植物油', '食用植物油脂', '食用油脂', '調整食用油脂',
      '食用加工油脂', '粉末植物油脂',
    ],
    candidates: [palmOil, canolaOil, soyOil, shortening],
  },
  { aliases: ['チョコレート', 'チョコ', 'チョコチップ', '準チョコレート'], candidates: [chocolate] },
  { aliases: ['ココアパウダー', 'ココア', 'カカオエキス', 'カカオエキスパウダー'], candidates: [cocoa] },
  { aliases: ['カカオマス', 'ココアマス', 'カカオペースト'], candidates: [cacaoMassProxy] },
  { aliases: ['アーモンド', 'アーモンドパウダー', 'アーモンドプードル'], candidates: [almond] },
  { aliases: ['ごま', 'ゴマ', '胡麻'], candidates: [sesame] },
  { aliases: ['大豆粉', 'きな粉', 'きなこ'], candidates: [kinako] },
  { aliases: ['くるみ', 'クルミ', '胡桃'], candidates: [walnut] },
  { aliases: ['落花生', 'ピーナッツ'], candidates: [peanut] },
  { aliases: ['ココナッツ', 'ココナッツパウダー'], candidates: [coconut] },
  { aliases: ['脱脂粉乳', '脱脂乳粉'], candidates: [skimMilkPowder] },
  { aliases: ['全粉乳'], candidates: [wholeMilkPowder] },
  { aliases: ['普通牛乳', '牛乳', '生乳'], candidates: [milk] },
  {
    aliases: [
      '乳清たんぱく', '乳清たんぱく質', 'ホエイたんぱく', 'ホエイパウダー',
      'たんぱく質濃縮ホエイパウダー', '乳清たんぱく質分解物', '乳たんぱく',
      '乳たんぱく質', 'カルシウムカゼイネート', 'カゼインカルシウム',
    ],
    candidates: [milkProteinProxy],
  },
  { aliases: ['バターミルク', 'バターミルクパウダー'], candidates: [skimMilkPowder, wholeMilkPowder] },
  { aliases: ['脱脂濃縮乳'], candidates: [concentratedMilkProxy] },
  { aliases: ['加糖練乳', '加糖脱脂練乳', '調製練乳'], candidates: [sweetenedCondensedMilk] },
  { aliases: ['発酵乳'], candidates: [yogurt] },
  { aliases: ['乳製品', '乳等を主要原料とする食品'], candidates: [wholeMilkPowder, skimMilkPowder, dairyCream] },
  { aliases: ['クリーミングパウダー'], candidates: [wholeMilkPowder, skimMilkPowder, plantCream] },
  { aliases: ['乳脂肪クリーム', '生クリーム'], candidates: [dairyCream] },
  { aliases: ['植物性クリーム'], candidates: [plantCream] },
  { aliases: ['クリーム', 'ホイップクリーム'], candidates: [dairyCream, mixedCream, plantCream] },
  { aliases: ['クリームチーズ'], candidates: [creamCheese] },
  { aliases: ['ゴーダチーズ'], candidates: [goudaCheese] },
  { aliases: ['モッツァレラチーズ'], candidates: [mozzarellaCheese] },
  { aliases: ['プロセスチーズ'], candidates: [processedCheese] },
  { aliases: ['ナチュラルチーズ', 'チーズ'], candidates: [creamCheese, goudaCheese, mozzarellaCheese] },
  { aliases: ['卵', '鶏卵', '全卵', '液卵'], candidates: [egg] },
  { aliases: ['大豆たんぱく', '脱脂大豆たんぱく'], candidates: [concentratedSoyProtein, isolatedSoyProtein] },
  { aliases: ['大豆パフ'], candidates: [kinako, concentratedSoyProtein] },
  { aliases: ['濃縮大豆たんぱく'], candidates: [concentratedSoyProtein] },
  { aliases: ['分離大豆たんぱく'], candidates: [isolatedSoyProtein] },
  { aliases: ['寒天', '粉寒天'], candidates: [powderedAgar] },
  { aliases: ['ゼラチン'], candidates: [gelatin] },
  { aliases: ['魚コラーゲンペプチド', 'コラーゲンペプチド'], candidates: [gelatin] },
  { aliases: ['精白米', 'うるち米'], candidates: [rawRice] },
  { aliases: ['ペンネマカロニ', 'マカロニ', 'スパゲッティ'], candidates: [dryPasta] },
  { aliases: ['たまねぎ', '玉ねぎ', 'ソテーオニオン'], candidates: [onion] },
  { aliases: ['トマトペースト'], candidates: [tomatoPaste] },
  { aliases: ['乾燥じゃがいも', '乾燥マッシュポテト'], candidates: [driedMashedPotato] },
  { aliases: ['こんぶパウダー', '昆布パウダー'], candidates: [driedKombu] },
  { aliases: ['えび'], candidates: [shrimp] },
  { aliases: ['えびエキス'], candidates: [shrimp] },
  { aliases: ['ホワイトルウ'], candidates: [whiteSauce] },
  { aliases: ['カレールウ'], candidates: [curryRoux] },
  { aliases: ['デミグラスソース'], candidates: [demiGlaceSauce] },
  { aliases: ['牛肉'], candidates: [leanBeef] },
  { aliases: ['パン粉'], candidates: [dryBreadcrumbs] },
  { aliases: ['こしょう', '黒こしょう', 'ブラックペッパー'], candidates: [blackPepper] },
  { aliases: ['カレー粉'], candidates: [curryPowder] },
  { aliases: ['香辛料'], candidates: [blackPepper, curryPowder] },
  { aliases: ['インスタントコーヒー', 'コーヒー', 'コーヒーエキス'], candidates: [instantCoffee] },
  { aliases: ['紅茶エキスパウダー'], candidates: [blackTeaLeaf] },
  { aliases: ['ゆず果皮'], candidates: [yuzuPeel] },
  { aliases: ['ゆず果汁'], candidates: [yuzuJuice] },
  { aliases: ['ゆず', '柚子'], candidates: [yuzuPeel, yuzuJuice] },
  { aliases: ['干しぶどう', 'レーズン'], candidates: [raisin] },
  { aliases: ['いちご', '苺', 'いちご果肉'], candidates: [strawberry] },
  { aliases: ['いちごパウダー'], candidates: [driedStrawberry] },
  { aliases: ['バナナ'], candidates: [banana] },
  { aliases: ['もも', '桃'], candidates: [peach] },
  { aliases: ['りんご', 'リンゴ'], candidates: [apple] },
  { aliases: ['ぶどう果汁', 'グレープ果汁'], candidates: [grapeJuice] },
  { aliases: ['レモン果汁', '濃縮レモン果汁'], candidates: [lemonJuice] },
  { aliases: ['果汁'], candidates: [grapeJuice, lemonJuice, yuzuJuice] },
  { aliases: ['果肉'], candidates: [strawberry, peach, banana, apple] },
  { aliases: ['ドライイースト', '乾燥酵母'], candidates: [dryYeast] },
  { aliases: ['生イースト', '圧搾酵母'], candidates: [compressedYeast] },
  { aliases: ['イースト', 'パン酵母', '酵母'], candidates: [dryYeast, compressedYeast] },
  { aliases: ['食塩', '塩'], candidates: [salt] },
] as const

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ja-JP')
}

function adjustedPrior(profileItem: IngredientProfile, productName: string, genreId?: EstimatorGenreId | null): number {
  const normalizedProductName = normalize(productName)
  const nameAdjusted = (profileItem.priorSignals ?? []).reduce((prior, signal) => (
    signal.terms.some((term) => normalizedProductName.includes(normalize(term)))
      ? prior * signal.multiplier
      : prior
  ), profileItem.priorProbability)
  return nameAdjusted * genreProfileMultiplier(genreId, profileItem.profileId)
}

export function resolveIngredientCandidates(
  ingredientName: string,
  productName: string | null | undefined,
  genreId?: EstimatorGenreId | null,
): IngredientProfile[] {
  const normalizedIngredient = normalize(ingredientName)
  const group = GROUPS.find((item) => item.aliases.some((alias) => normalize(alias) === normalizedIngredient))
  if (!group) return []

  const normalizedProductName = normalize(productName ?? '')
  const eligible = group.candidates.filter((candidate) => (
    !candidate.requiredProductTerms
    || candidate.requiredProductTerms.some((term) => normalizedProductName.includes(normalize(term)))
  ))
  const adjusted = eligible.map((candidate) => ({
    ...candidate,
    priorProbability: adjustedPrior(candidate, productName ?? '', genreId),
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
