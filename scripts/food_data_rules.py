"""食品成分表をアプリ表示用へ整える共通ルール。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FoodMeasure:
    amount: float
    unit: str
    reference_grams: float


_CATEGORY_HEADING_RE = re.compile(r"^\s*＜([^＞]+)＞")


def clean_food_name(value: Any) -> str:
    """成分表の分類見出しだけを食品名から取り除く。

    食品名の途中にある「生」「水煮」などの状態・調理方法や、
    「市販冷凍食品を揚げたもの」のような注記は削除しない。
    """
    text = "" if value is None else str(value).strip()
    # 例: ＜調味料類＞、＜魚類＞
    text = re.sub(r"^\s*＜[^＞]+＞\s*", "", text)
    # 例: （調味ソース類）、（さつまいも類）、（でん粉製品）、（その他）
    # 分類見出しは食品名の先頭に連続して付くため、先頭だけを対象にする。
    while True:
        cleaned = re.sub(r"^\s*（[^）]*）\s*", "", text)
        cleaned = re.sub(r"^\s*\([^)]*\)\s*", "", cleaned)
        if cleaned == text:
            break
        text = cleaned
    return text.strip()


def leading_category(value: Any) -> str:
    """食品名先頭の成分表分類を返す。表示名からは除去する分類情報。"""
    text = "" if value is None else str(value).strip()
    match = _CATEGORY_HEADING_RE.match(text)
    return match.group(1).strip() if match else ""


def condiment_weight(name: str) -> float:
    """調味料類の小さじ1杯あたりの代表重量(g)。"""
    normalized = name.replace("　", " ")
    if any(token in normalized for token in ("顆粒", "粉末", "ふりかけ", "お茶漬け")):
        return 3
    if "食塩" in normalized or "並塩" in normalized:
        return 6
    if "みそ" in normalized:
        return 6
    if "マヨネーズ" in normalized:
        return 4
    if "ドレッシング" in normalized:
        return 5
    if any(token in normalized for token in ("食酢", "酢", "ポン酢", "ぽん酢")):
        return 5
    if any(token in normalized for token in ("しょうゆ", "ソース", "たれ", "つゆ", "だし", "液")):
        return 6
    if any(token in normalized for token in ("ケチャップ", "トマトピューレー", "トマトペースト")):
        return 5
    if "ルウ" in normalized or "固形" in normalized:
        return 6
    return 5


def preferred_measure(name: str, category: str = "") -> FoodMeasure:
    """重量が一般的に定まる食品だけ、記録しやすい基準単位へ変換する。

    成分表は可食部100g基準のため、reference_gramsは1単位に相当する
    換算重量。調味料類は小さじ1杯の代表重量を使い、それ以外で確定
    できない食品は元データどおり100gを返す。
    """
    normalized = name.replace("　", " ")

    if category == "調味料類":
        return FoodMeasure(1, "小さじ", condiment_weight(name))

    if "うずら卵" in normalized:
        return FoodMeasure(1, "個", 10)
    if "あひる卵" in normalized:
        return FoodMeasure(1, "個", 80)
    if "鶏卵" in normalized:
        return FoodMeasure(1, "個", 50)

    if "［水稲穀粒］" in normalized or "［陸稲穀粒］" in normalized or "［水稲めし］" in normalized or "［陸稲めし］" in normalized:
        return FoodMeasure(1, "合", 150)

    if "食パン" in normalized:
        return FoodMeasure(1, "枚", 60)
    if "ロールパン" in normalized or "バターロール" in normalized:
        return FoodMeasure(1, "個", 30)
    if "おにぎり" in normalized:
        return FoodMeasure(1, "個", 110)
    if "もち" in normalized and "もち米" not in normalized:
        return FoodMeasure(1, "個", 50)

    if "バナナ" in normalized:
        return FoodMeasure(1, "本", 100)
    if "りんご" in normalized and "果汁" not in normalized:
        return FoodMeasure(1, "個", 250)
    if "みかん" in normalized and "果汁" not in normalized:
        return FoodMeasure(1, "個", 80)
    if "いちご" in normalized and "ジャム" not in normalized:
        return FoodMeasure(1, "個", 15)
    if "キウイフルーツ" in normalized and "果汁" not in normalized:
        return FoodMeasure(1, "個", 80)
    if "もも" in normalized and "果汁" not in normalized:
        return FoodMeasure(1, "個", 200)
    if "なし" in normalized and "果汁" not in normalized:
        return FoodMeasure(1, "個", 250)

    if any(token in normalized for token in ("木綿豆腐", "絹ごし豆腐", "ソフト豆腐", "充てん豆腐", "焼き豆腐")):
        return FoodMeasure(1, "丁", 300)

    if "トマト" in normalized and "生" in normalized:
        return FoodMeasure(1, "個", 150)
    if "きゅうり" in normalized and "生" in normalized:
        return FoodMeasure(1, "本", 100)
    if "にんじん" in normalized and "生" in normalized:
        return FoodMeasure(1, "本", 150)
    if "たまねぎ" in normalized and "生" in normalized:
        return FoodMeasure(1, "個", 200)
    if "じゃがいも" in normalized and "生" in normalized:
        return FoodMeasure(1, "個", 150)

    return FoodMeasure(100, "g", 100)


def add_measure_note(name: str, measure: FoodMeasure) -> str:
    """小さじ基準の換算重量を食品名へ明示する。"""
    if measure.unit != "小さじ" or "小さじ1=" in name:
        return name
    grams = int(measure.reference_grams) if float(measure.reference_grams).is_integer() else measure.reference_grams
    return f"{name}（小さじ1={grams}g）"


def scale_value(value: str, factor: float) -> str:
    """100g基準の数値を1基準単位へ変換する。"""
    text = value.strip()
    if not text or text in {"-", "Tr", "(Tr)"}:
        return ""
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    number = float(text.rstrip("†‡").strip())
    scaled = number * factor
    return f"{scaled:.8g}"
