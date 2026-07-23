"""食品成分表をアプリ表示用へ整える共通ルール。

MEXTの栄養値は可食部100g基準のまま保持し、ここでは入力時に使いやすい
単位の初期換算だけを定義する。食品名の部分一致で別食品へ適用されない
よう、状態・食品本体・MEXT分類を確認できる代表項目に限定している。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class InputUnitMeasure:
    """1入力単位がMEXT基準量何gに相当するか。"""

    unit: str
    base_amount: float


@dataclass(frozen=True)
class FoodInputDefaults:
    """食品に自動設定する入力単位と既定入力値。"""

    serving_amount: float | None
    serving_unit: str | None
    input_unit_conversions: tuple[InputUnitMeasure, ...]

    @classmethod
    def empty(cls) -> "FoodInputDefaults":
        return cls(None, None, ())


@dataclass(frozen=True)
class FoodMeasure:
    """旧呼び出し側との互換用の単一換算表現。"""

    amount: float
    unit: str
    reference_grams: float


_CATEGORY_HEADING_RE = re.compile(
    r"^\s*(?:＜(?P<angle>[^＞]+)＞|（(?P<fullwidth>[^）]+)）|\((?P<ascii>[^)]+)\))"
)
_SPACE_RE = re.compile(r"\s+")


# 小さじを初期投入し、大さじは資料値を保持するテスト用の参照値とする。
# 不明な調味料へ一律の重量を割り当てない。
CONDIMENT_REFERENCE_WEIGHTS: dict[str, tuple[float, float]] = {
    "しょうゆ": (6, 18),
    "みそ": (6, 18),
    "食塩": (6, 18),
    "上白糖": (3, 9),
    "グラニュー糖": (4, 12),
    "酢": (5, 15),
    "食酢": (5, 15),
    "料理酒": (5, 15),
    "みりん": (6, 18),
    "ケチャップ": (6, 18),
    "ウスターソース": (6, 18),
    "中濃ソース": (7, 21),
    "マヨネーズ": (4, 12),
    "はちみつ": (7, 21),
    "蜂蜜": (7, 21),
    "ジャム": (7, 21),
    "油": (4, 12),
    "バター": (4, 12),
    "小麦粉": (3, 9),
    "米粉": (3, 9),
    "片栗粉": (3, 9),
    "コーンスターチ": (2, 6),
    "パン粉": (1, 3),
}


def normalize_food_text(value: Any) -> str:
    """全角空白を含む食品名を通常の空白区切りへ正規化する。"""
    text = "" if value is None else str(value)
    return _SPACE_RE.sub(" ", text.replace("　", " ")).strip()


def clean_food_name(value: Any) -> str:
    """成分表の分類見出しだけを食品名から取り除く。

    食品名の途中にある「生」「水煮」などの状態・調理方法や、
    「市販冷凍食品を揚げたもの」のような注記は削除しない。
    """
    text = "" if value is None else str(value).strip()
    text = re.sub(r"^\s*＜[^＞]+＞\s*", "", text)
    while True:
        cleaned = re.sub(r"^\s*（[^）]*）\s*", "", text)
        cleaned = re.sub(r"^\s*\([^)]*\)\s*", "", cleaned)
        if cleaned == text:
            break
        text = cleaned
    return text.strip()


def leading_category(value: Any) -> str:
    """食品名先頭のMEXT分類を返す。表示名からは除去する分類情報。"""
    text = "" if value is None else str(value).strip()
    match = _CATEGORY_HEADING_RE.match(text)
    if not match:
        return ""
    return next(group for group in match.groups() if group is not None).strip()


def _tokens(name: str) -> set[str]:
    return set(name.split())


def _has_token(name: str, *values: str) -> bool:
    tokens = _tokens(name)
    return any(value in tokens for value in values)


def _has_section(name: str, section: str) -> bool:
    return any(
        marker in name
        for marker in (
            f"［{section}］",
            f"[{section}]",
            f"（{section}）",
            f"({section})",
        )
    )


def _measure(unit: str, base_amount: float, serving_amount: float = 1) -> FoodInputDefaults:
    conversion = InputUnitMeasure(unit=unit, base_amount=base_amount)
    return FoodInputDefaults(serving_amount, unit, (conversion,))


def _is_raw(name: str) -> bool:
    """MEXT名の末尾が単独の「生」である食品だけを対象にする。"""
    tokens = name.split()
    if not tokens or tokens[-1] != "生":
        return False
    excluded = ("果汁", "ジュース", "果実飲料", "缶詰", "ジャム", "乾燥", "漬物", "冷凍")
    return not any(marker in name for marker in excluded)


def _condiment_measure(name: str, category: str) -> FoodInputDefaults:
    """資料で対象を特定できる調味料・粉・油の小さじ換算だけを返す。"""
    tokens = _tokens(name)

    if category == "調味料類":
        if any(token.endswith("しょうゆ") for token in tokens):
            return _measure("小さじ", 6)
        if (
            any(token.endswith("みそ") for token in tokens)
            and "粉末タイプ" not in tokens
            and "酢みそ" not in tokens
        ):
            return _measure("小さじ", 6)
        if any(token in {"食酢", "黒酢", "穀物酢", "米酢", "果実酢", "りんご酢", "ぶどう酢", "バルサミコ酢"} for token in tokens):
            return _measure("小さじ", 5)
        if "料理酒" in tokens:
            return _measure("小さじ", 5)
        if "みりん風調味料" in tokens:
            return _measure("小さじ", 6)
        if "トマトケチャップ" in tokens or "ケチャップ" in tokens:
            return _measure("小さじ", 6)
        if "ウスターソース" in tokens:
            return _measure("小さじ", 6)
        if "中濃ソース" in tokens:
            return _measure("小さじ", 7)
        if any("マヨネーズ" in token for token in tokens):
            return _measure("小さじ", 4)
        if any(token.startswith("顆粒") and token.endswith("だし") for token in tokens):
            return _measure("小さじ", 3)

    if "食塩" in tokens or "並塩" in tokens:
        return _measure("小さじ", 6)
    if "上白糖" in tokens:
        return _measure("小さじ", 3)
    if "グラニュー糖" in tokens:
        return _measure("小さじ", 4)
    if "はちみつ" in tokens or "蜂蜜" in tokens:
        return _measure("小さじ", 7)
    if "ジャム" in tokens and "ジャムパン" not in tokens:
        return _measure("小さじ", 7)

    if category == "植物油脂類" and any("油" in token for token in tokens):
        return _measure("小さじ", 4)
    if category == "バター類" and any("バター" in token for token in tokens):
        return _measure("小さじ", 4)
    if any(token in {"小麦粉", "薄力粉", "中力粉", "強力粉"} for token in tokens) or _has_section(name, "小麦粉"):
        if not any(token in {"プレミックス粉", "お好み焼き用", "ホットケーキ用", "から揚げ用", "天ぷら用"} for token in tokens):
            return _measure("小さじ", 3)
    if any(token in {"米粉", "上新粉"} for token in tokens) and "米粉パン" not in tokens:
        return _measure("小さじ", 3)
    if any(token in {"片栗粉", "かたくりこ", "じゃがいもでん粉"} for token in tokens):
        return _measure("小さじ", 3)
    if "コーンスターチ" in tokens or "とうもろこしでん粉" in tokens:
        return _measure("小さじ", 2)
    if "パン粉" in tokens:
        return _measure("小さじ", 1)
    if _has_section(name, "混成酒類") and _has_token(name, "みりん"):
        return _measure("小さじ", 6)
    if category == "マーガリン類" and _has_token(name, "マーガリン"):
        return _measure("小さじ", 4)

    return FoodInputDefaults.empty()


def _staple_measure(name: str) -> FoodInputDefaults:
    if _has_section(name, "水稲穀粒") or _has_section(name, "陸稲穀粒"):
        return _measure("合", 155 if _has_token(name, "もち米") else 150)
    if _has_section(name, "水稲めし") or _has_section(name, "陸稲めし"):
        return _measure("杯", 140)

    if _has_section(name, "うどん・そうめん類") and _has_token(name, "うどん", "干しうどん") and _has_token(name, "ゆで"):
        return _measure("玉", 200)
    if _has_section(name, "うどん・そうめん類") and _has_token(name, "そうめん・ひやむぎ", "手延そうめん・手延ひやむぎ") and _has_token(name, "乾"):
        return _measure("束", 50, serving_amount=2)
    if name.startswith("そば ") and _has_token(name, "ゆで") and not _has_token(name, "そば粉"):
        return _measure("玉", 160)
    if _has_section(name, "マカロニ・スパゲッティ類") and _has_token(name, "乾"):
        return _measure("人前", 100)
    if name == "こむぎ ［中華めん類］ 蒸し中華めん 蒸し中華めん":
        return _measure("玉", 150)
    if name == "こむぎ ［その他］ ぎょうざの皮 生":
        return _measure("枚", 6)
    if name == "こむぎ ［その他］ しゅうまいの皮 生":
        return _measure("枚", 3)
    if name == "こむぎ ［その他］ 春巻きの皮 生":
        return _measure("枚", 12)
    if name == "こめ ［うるち米製品］ ライスペーパー":
        return _measure("枚", 10)

    # 食パンは6/8枚切りをMEXT名から判定できないため自動換算しない。
    if _has_section(name, "パン類") and _has_token(name, "ロールパン", "バターロール"):
        return _measure("個", 30)
    return FoodInputDefaults.empty()


def _egg_and_soy_measure(name: str) -> FoodInputDefaults:
    if name in {"鶏卵 全卵 生", "鶏卵 全卵 ゆで"}:
        return _measure("個", 50)
    if name in {"うずら卵 全卵 生", "うずら卵 水煮缶詰"}:
        return _measure("個", 10)

    if _has_section(name, "豆腐・油揚げ類"):
        if any(token in name for token in ("木綿豆腐", "絹ごし豆腐", "ソフト豆腐", "充てん豆腐", "焼き豆腐")):
            return _measure("丁", 300)
        if _has_token(name, "生揚げ", "絹生揚げ"):
            return _measure("枚", 120)
        if _has_token(name, "油揚げ") and _has_token(name, "生"):
            return _measure("枚", 30)
    if _has_section(name, "納豆類") and _has_token(name, "糸引き納豆", "挽きわり納豆"):
        return _measure("パック", 50)
    return FoodInputDefaults.empty()


def _fresh_vegetable_measure(name: str) -> FoodInputDefaults:
    if not _is_raw(name):
        return FoodInputDefaults.empty()
    if _has_token(name, "ミニトマト", "赤色ミニトマト"):
        return _measure("個", 15)
    if _has_token(name, "トマト", "赤色トマト", "黄色トマト"):
        return _measure("個", 200)
    if _has_token(name, "きゅうり"):
        return _measure("本", 100)
    if _has_token(name, "たまねぎ"):
        return _measure("個", 200)
    if _has_token(name, "にんじん") and _has_token(name, "根") and not _has_token(name, "皮"):
        return _measure("本", 150)
    if _has_token(name, "じゃがいも"):
        return _measure("個", 150)
    if _has_token(name, "さつまいも"):
        return _measure("本", 250)
    if _has_token(name, "さといも", "里芋"):
        return _measure("個", 40)
    if _has_token(name, "なす"):
        return _measure("個", 80)
    if _has_token(name, "青ピーマン"):
        return _measure("個", 30)
    if _has_token(name, "赤ピーマン", "オレンジピーマン", "黄ピーマン"):
        return _measure("個", 100)
    if _has_token(name, "パプリカ"):
        return _measure("個", 100)
    if _has_token(name, "にんにく"):
        return _measure("片", 10)
    if _has_token(name, "しょうが"):
        return _measure("かけ", 15)
    if _has_token(name, "アスパラ", "アスパラガス"):
        return _measure("本", 20)
    if _has_token(name, "オクラ"):
        return _measure("本", 10)
    if _has_token(name, "キャベツ"):
        return _measure("枚", 50)
    if _has_token(name, "レタス"):
        return _measure("枚", 30)
    if _has_token(name, "ブロッコリー") and _has_token(name, "花序"):
        return _measure("房", 15)
    if _has_token(name, "だいこん", "大根") and _has_token(name, "根"):
        return _measure("cm", 25)
    if _has_token(name, "とうもろこし", "スイートコーン") and not _has_token(name, "ヤングコーン"):
        return _measure("本", 200)

    # 袋・パック前提の生鮮品（もやし等）は販売規格差が大きいため除外する。
    if _has_token(name, "しいたけ"):
        return _measure("個", 15)
    if _has_token(name, "マッシュルーム"):
        return _measure("個", 10)
    return FoodInputDefaults.empty()


def _fresh_fruit_measure(name: str, category: str) -> FoodInputDefaults:
    if not _is_raw(name):
        return FoodInputDefaults.empty()
    if _has_token(name, "いちご"):
        return _measure("個", 15)
    if _has_token(name, "バナナ"):
        return _measure("本", 100)
    if _has_token(name, "キウイフルーツ", "キウイ"):
        return _measure("個", 70)
    if _has_token(name, "うんしゅうみかん"):
        return _measure("個", 80)
    # 「もも」は鶏肉・牛肉等の部位にも現れるためMEXTの果物分類を必須にする。
    if category == "もも類" and _has_token(name, "もも", "桃"):
        return _measure("個", 200)
    if _has_token(name, "りんご"):
        return _measure("個", 200)
    if _has_token(name, "日本なし"):
        return _measure("個", 250)
    if _has_token(name, "西洋なし"):
        return _measure("個", 180)
    if _has_token(name, "アボカド"):
        return _measure("個", 100)
    if _has_token(name, "ぶどう"):
        return _measure("粒", 15)
    if _has_token(name, "かき", "柿") and category != "貝類":
        return _measure("個", 180)
    return FoodInputDefaults.empty()


def food_input_defaults(name: str, category: str = "") -> FoodInputDefaults:
    """食品名とMEXT先頭カテゴリから安全な入力単位の初期値を返す。

    未知の食品、食品状態が特定できない食品、調理済み食品には換算を付けず、
    呼び出し側が可食部100g/gを維持できるよう空の値を返す。
    """
    normalized = normalize_food_text(name)
    normalized_category = normalize_food_text(category)
    if not normalized:
        return FoodInputDefaults.empty()

    condiment = _condiment_measure(normalized, normalized_category)
    if condiment.input_unit_conversions:
        return condiment

    staple = _staple_measure(normalized)
    if staple.input_unit_conversions:
        return staple

    egg_and_soy = _egg_and_soy_measure(normalized)
    if egg_and_soy.input_unit_conversions:
        return egg_and_soy

    fresh_vegetable = _fresh_vegetable_measure(normalized)
    if fresh_vegetable.input_unit_conversions:
        return fresh_vegetable

    return _fresh_fruit_measure(normalized, normalized_category)


def get_food_input_defaults(name: str, category: str = "") -> FoodInputDefaults:
    """入力単位初期値の別名。外部変換処理から読みやすい名前で利用する。"""
    return food_input_defaults(name, category)


def preferred_measure(name: str, category: str = "") -> FoodMeasure:
    """旧API互換。判定は新しい厳密なルールへ委譲する。"""
    defaults = food_input_defaults(name, category)
    if not defaults.input_unit_conversions:
        return FoodMeasure(100, "g", 100)
    measure = defaults.input_unit_conversions[0]
    return FoodMeasure(defaults.serving_amount or 1, measure.unit, measure.base_amount)


def add_measure_note(name: str, measure: FoodMeasure) -> str:
    """旧API互換。現在の抽出処理では食品名へ換算値を付加しない。"""
    return name


def scale_value(value: str, factor: float) -> str:
    """数値を指定倍率で変換する旧API。MEXT抽出では100g値をそのまま使う。"""
    text = value.strip()
    if not text or text in {"-", "Tr", "(Tr)"}:
        return ""
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    number = float(text.rstrip("†‡").strip())
    scaled = number * factor
    return f"{scaled:.8g}"
