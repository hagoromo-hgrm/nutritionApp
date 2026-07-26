from __future__ import annotations

from dataclasses import dataclass

MEXT_SOURCE_VERSION = "文部科学省 日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）"
ZERO_SATURATED_FROM_ZERO_FAT = "MEXTの脂質が0gのため、飽和脂肪酸も0gと導出しました。"

# リポジトリ内の検証・正規化済みMEXT生成物に記録された100g値。
# Noneは元データの欠損をそのまま保持しており、ゼロへ補完しない。
MEXT_MICRONUTRIENTS_BY_FOOD_ID: dict[str, dict[str, float | None]] = {
    "mext_01015": {
        "calciumMg": 20.0,
        "ironMg": 0.5,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 0.3,
        "vitaminB1Mg": 0.11,
        "vitaminB2Mg": 0.03,
        "vitaminCMg": 0.0,
    },
    "mext_03003": {
        "calciumMg": 1.0,
        "ironMg": None,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 0.0,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_03017": {
        "calciumMg": None,
        "ironMg": 0.1,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 0.0,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_03024": {
        "calciumMg": None,
        "ironMg": 0.1,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 0.0,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_12004": {
        "calciumMg": 46.0,
        "ironMg": 1.5,
        "vitaminAMcg": 210.0,
        "vitaminEMg": 1.3,
        "vitaminB1Mg": 0.06,
        "vitaminB2Mg": 0.37,
        "vitaminCMg": 0.0,
    },
    "mext_13009": {
        "calciumMg": 890.0,
        "ironMg": 0.4,
        "vitaminAMcg": 180.0,
        "vitaminEMg": 0.6,
        "vitaminB1Mg": 0.25,
        "vitaminB2Mg": 1.1,
        "vitaminCMg": 5.0,
    },
    "mext_13010": {
        "calciumMg": 1100.0,
        "ironMg": 0.5,
        "vitaminAMcg": 6.0,
        "vitaminEMg": None,
        "vitaminB1Mg": 0.3,
        "vitaminB2Mg": 1.6,
        "vitaminCMg": 5.0,
    },
    "mext_14005": {
        "calciumMg": 0.0,
        "ironMg": 0.0,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 10.0,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_14008": {
        "calciumMg": None,
        "ironMg": 0.0,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 15.0,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_14009": {
        "calciumMg": None,
        "ironMg": 0.0,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 8.6,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_14017": {
        "calciumMg": 15.0,
        "ironMg": 0.1,
        "vitaminAMcg": 520.0,
        "vitaminEMg": 1.5,
        "vitaminB1Mg": 0.01,
        "vitaminB2Mg": 0.03,
        "vitaminCMg": 0.0,
    },
    "mext_14029": {
        "calciumMg": 14.0,
        "ironMg": None,
        "vitaminAMcg": 24.0,
        "vitaminEMg": 15.0,
        "vitaminB1Mg": 0.01,
        "vitaminB2Mg": 0.03,
        "vitaminCMg": 0.0,
    },
    "mext_14030": {
        "calciumMg": 0.0,
        "ironMg": 0.0,
        "vitaminAMcg": 0.0,
        "vitaminEMg": 9.5,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
    "mext_15116": {
        "calciumMg": 240.0,
        "ironMg": 2.4,
        "vitaminAMcg": 66.0,
        "vitaminEMg": 0.7,
        "vitaminB1Mg": 0.19,
        "vitaminB2Mg": 0.41,
        "vitaminCMg": 0.0,
    },
    "mext_16048": {
        "calciumMg": 140.0,
        "ironMg": 14.0,
        "vitaminAMcg": 3.0,
        "vitaminEMg": 0.3,
        "vitaminB1Mg": 0.16,
        "vitaminB2Mg": 0.22,
        "vitaminCMg": 0.0,
    },
    "mext_17012": {
        "calciumMg": 22.0,
        "ironMg": None,
        "vitaminAMcg": 0.0,
        "vitaminEMg": None,
        "vitaminB1Mg": 0.0,
        "vitaminB2Mg": 0.0,
        "vitaminCMg": 0.0,
    },
}


@dataclass(frozen=True)
class IngredientProfile:
    profile_id: str
    canonical_name: str
    nutrients_per_100g: dict[str, float | None]
    typical_min_ratio: float
    typical_max_ratio: float
    prior_probability: float = 1.0
    confidence: str = "medium"
    source_food_ids: tuple[str, ...] = ()
    source_version: str = MEXT_SOURCE_VERSION
    derivation_notes: tuple[str, ...] = ()


def _profile(
    profile_id: str,
    name: str,
    energy: float,
    protein: float,
    fat: float,
    carbohydrate: float,
    salt: float,
    saturated: float | None,
    fiber: float | None,
    low: float,
    high: float,
    source_food_id: str,
    **kwargs: object,
) -> IngredientProfile:
    micronutrients = MEXT_MICRONUTRIENTS_BY_FOOD_ID[source_food_id]
    return IngredientProfile(
        profile_id,
        name,
        {
            "energyKcal": energy,
            "proteinG": protein,
            "fatG": fat,
            "carbohydrateG": carbohydrate,
            "saltG": salt,
            "saturatedFatG": saturated,
            "fiberG": fiber,
            **micronutrients,
        },
        low,
        high,
        source_food_ids=(source_food_id,),
        **kwargs,
    )


# リポジトリ内の検証・正規化済みMEXT生成物から固定した100g値。
# MEXTで飽和脂肪酸が欠損していても脂質が0gの食品だけは、検証済みのゼロ導出規則を明示して用いる。
PROFILES: dict[str, tuple[IngredientProfile, ...]] = {
    "小麦粉": (_profile("mext_01015", "小麦粉", 349, 8.3, 1.5, 75.8, 0.0, 0.34, 2.5, 0.10, 0.75, "mext_01015"),),
    "砂糖": (_profile("mext_03003", "砂糖", 391, 0.0, 0.0, 99.3, 0.0, 0.0, 0.0, 0.03, 0.55, "mext_03003", derivation_notes=(ZERO_SATURATED_FROM_ZERO_FAT,)),),
    "ぶどう糖": (_profile("mext_03017", "ぶどう糖", 342, 0.0, 0.0, 91.0, 0.0, 0.0, 0.0, 0.01, 0.35, "mext_03017", derivation_notes=(ZERO_SATURATED_FROM_ZERO_FAT,)),),
    "水あめ": (_profile("mext_03024", "水あめ", 342, 0.0, 0.0, 85.0, 0.0, 0.0, 0.0, 0.01, 0.35, "mext_03024", derivation_notes=(ZERO_SATURATED_FROM_ZERO_FAT,)),),
    "バター": (_profile("mext_14017", "バター", 700, 0.6, 81.0, 0.2, 1.9, 50.45, 0.0, 0.01, 0.45, "mext_14017"),),
    "マーガリン": (_profile("mext_14029", "マーガリン", 740, 0.3, 84.3, 0.1, 1.3, 39.0, 0.0, 0.01, 0.45, "mext_14029"),),
    "ショートニング": (_profile("mext_14030", "ショートニング", 881, 0.0, 99.9, 0.0, 0.0, 51.13, 0.0, 0.01, 0.45, "mext_14030"),),
    "植物油脂": (
        _profile("mext_14009", "パーム油", 887, 0.0, 100.0, 0.0, 0.0, 47.08, 0.0, 0.01, 0.40, "mext_14009", prior_probability=0.4),
        _profile("mext_14008", "なたね油", 887, 0.0, 100.0, 0.0, 0.0, 7.06, 0.0, 0.01, 0.40, "mext_14008", prior_probability=0.35),
        _profile("mext_14005", "大豆油", 885, 0.0, 100.0, 0.0, 0.0, 14.87, 0.0, 0.01, 0.40, "mext_14005", prior_probability=0.25),
    ),
    "卵": (_profile("mext_12004", "卵", 142, 12.2, 10.2, 0.4, 0.4, 3.12, 0.0, 0.01, 0.30, "mext_12004"),),
    "乳製品": (
        _profile("mext_13010", "脱脂粉乳", 354, 34.0, 1.0, 53.3, 1.4, 0.44, 0.0, 0.01, 0.30, "mext_13010", prior_probability=0.5),
        _profile("mext_13009", "全粉乳", 490, 25.5, 26.2, 39.3, 1.1, 16.28, 0.0, 0.01, 0.30, "mext_13009", prior_probability=0.5),
    ),
    "脱脂粉乳": (_profile("mext_13010", "脱脂粉乳", 354, 34.0, 1.0, 53.3, 1.4, 0.44, 0.0, 0.005, 0.20, "mext_13010"),),
    "全粉乳": (_profile("mext_13009", "全粉乳", 490, 25.5, 26.2, 39.3, 1.1, 16.28, 0.0, 0.005, 0.20, "mext_13009"),),
    "ココア": (_profile("mext_16048", "ココア", 386, 18.5, 21.6, 42.4, 0.0, 12.4, 23.9, 0.005, 0.20, "mext_16048"),),
    "チョコレート": (_profile("mext_15116", "チョコレート", 550, 6.9, 34.1, 55.8, 0.2, 19.88, 3.9, 0.01, 0.40, "mext_15116"),),
    "食塩": (_profile("mext_17012", "食塩", 0, 0.0, 0.0, 0.0, 99.5, 0.0, 0.0, 0.0001, 0.03, "mext_17012", derivation_notes=(ZERO_SATURATED_FROM_ZERO_FAT,)),),
}

NON_CONTRIBUTING_ADDITIVES = frozenset({"膨張剤", "乳化剤", "香料", "着色料"})


def candidates_for(name: str) -> tuple[IngredientProfile, ...]:
    return PROFILES.get(name, ())
