#!/usr/bin/env python3
"""Normalize manufacturer-published CSVs into private estimator teacher data."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRANSFORM_VERSION = "spu-estimator-training-0.1.0"
FILENAME_RE = re.compile(
    r"^(?P<maker>[^_]+)_(?P<source>[^_]+)_(?P<date>\d{6})\.csv$",
    re.IGNORECASE,
)
REQUIRED_COLUMNS = {"カテゴリ", "商品名", "栄養素", "原材料"}
TARGET_NUTRIENTS = {
    "fiberG", "calciumMg", "ironMg", "vitaminAMcg", "vitaminEMg",
    "vitaminB1Mg", "vitaminB2Mg", "vitaminCMg", "saturatedFatG",
}
SOURCE_CONFIG: dict[str, dict[str, str]] = {
    "meiji": {
        "maker": "明治",
        "url": "https://www.meiji.co.jp/products/",
    },
    "morinaga": {
        "maker": "森永製菓",
        "url": "https://www.morinaga.co.jp/products/",
    },
    "nichireifoods": {
        "maker": "ニチレイフーズ",
        "url": "https://www.nichireifoods.co.jp/product/",
    },
}
NUTRIENT_SPECS: dict[str, dict[str, Any]] = {
    "energyKcal": {"labels": ("エネルギー", "熱量"), "unit": "kcal"},
    "proteinG": {"labels": ("たんぱく質", "たん白質", "タンパク質"), "unit": "g"},
    "fatG": {"labels": ("脂質",), "unit": "g"},
    "carbohydrateG": {"labels": ("炭水化物",), "unit": "g"},
    "fiberG": {"labels": ("食物繊維",), "unit": "g"},
    "calciumMg": {"labels": ("カルシウム",), "unit": "mg"},
    "ironMg": {"labels": ("鉄",), "unit": "mg"},
    "vitaminAMcg": {"labels": ("ビタミンA",), "unit": "mcg"},
    "vitaminEMg": {"labels": ("ビタミンE",), "unit": "mg"},
    "vitaminB1Mg": {"labels": ("ビタミンB1",), "unit": "mg"},
    "vitaminB2Mg": {"labels": ("ビタミンB2",), "unit": "mg"},
    "vitaminCMg": {"labels": ("ビタミンC",), "unit": "mg"},
    "saturatedFatG": {"labels": ("飽和脂肪酸",), "unit": "g"},
    "saltG": {"labels": ("食塩相当量",), "unit": "g"},
}
UNIT_PATTERN = r"(?:kcal|g|mg|μg|µg|ug|mcg)"
NUMBER_PATTERN = r"[0-9]+(?:\.[0-9]+)?"
RANGE_SEPARATOR_PATTERN = r"[~〜～]"

NAME_GENRE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("chocolate", ("チョコ", "ショコラ", "カカオ")),
    ("baked_sweets", ("クッキー", "ビスケット", "サブレ", "クラッカー", "ウエハース", "フィナンシェ", "マドレーヌ")),
    ("cake_pastry", ("ケーキ", "ドーナツ", "シュークリーム", "パイ", "タルト", "カステラ")),
    ("bread", ("パン", "ベーグル", "ブリオッシュ", "クロワッサン")),
    ("snack_rice_cracker", ("スナック", "ポテトチップ", "せんべい", "煎餅", "あられ", "おかき")),
    ("frozen_dessert", ("アイス", "ジェラート", "シャーベット", "氷菓")),
    ("dairy", ("ヨーグルト", "チーズ", "乳飲料")),
    ("sugar_confectionery", ("キャンディ", "あめ", "飴", "グミ", "キャラメル", "羊羹", "ようかん", "まんじゅう", "大福")),
    ("drink_jelly_pudding", ("ジュース", "ドリンク", "飲料", "ゼリー", "プリン")),
    ("fried_food", ("フライ", "揚げ", "天ぷら", "唐揚げ", "コロッケ")),
    ("noodle_flour_dish", ("麺", "うどん", "そば", "ラーメン", "パスタ", "ピザ", "お好み焼き", "たこ焼き")),
    ("prepared_meal", ("弁当", "惣菜", "スープ", "カレー", "シチュー", "リゾット", "おにぎり")),
    ("sauce_spread", ("ソース", "ドレッシング", "たれ", "ケチャップ", "マヨネーズ", "ジャム", "スプレッド")),
)
CATEGORY_GENRE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("chocolate", ("チョコレート",)),
    ("baked_sweets", ("ビスケット", "焼き菓子", "inバープロテイン")),
    ("cake_pastry", ("ケーキミックス", "ケーキ",)),
    ("bread", ("パン",)),
    ("sugar_confectionery", ("キャンディ", "キャラメル", "グミ")),
    ("snack_rice_cracker", ("スナック", "米菓")),
    ("frozen_dessert", ("アイス",)),
    ("dairy", ("ヨーグルト", "チーズ", "牛乳", "乳飲料", "発酵乳", "バター", "マーガリン", "クリーム", "粉ミルク")),
    ("drink_jelly_pudding", ("inゼリー", "飲料", "ココア", "流動食", "水分・電解質補給", "とろみ調整食品")),
    ("noodle_flour_dish", ("麺",)),
    ("prepared_meal", ("冷凍食品", "食卓用おかず", "小さなおかず", "米飯", "グラタン", "ドリア", "レトルト食品", "everyONe meal", "カレー・スープ")),
)
INGREDIENT_GENRE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("chocolate", ("カカオマス", "ココアバター", "カカオバター")),
    ("bread", ("パン酵母", "ドライイースト", "イーストフード")),
    ("dairy", ("生乳", "乳製品", "脱脂濃縮乳")),
    ("sauce_spread", ("醸造酢", "しょうゆ", "味噌")),
)
NAME_EXCLUSIONS: dict[str, tuple[str, ...]] = {
    "パン": ("フライパン", "パンツ", "パンフレット", "パンダ", "パンチ"),
    "フライ": ("フライパン",),
}


class SpuDataError(ValueError):
    pass


def normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def compact_text(value: str) -> str:
    return normalize_text(value).casefold().replace(" ", "")


def decimal_places(value: str) -> int:
    return len(value.partition(".")[2]) if "." in value else 0


def parse_verified_at(raw: str) -> str:
    datetime.strptime(raw, "%y%m%d")
    return f"20{raw[:2]}-{raw[2:4]}-{raw[4:6]}T00:00:00+09:00"


def first_nutrient_offset(text: str) -> int | None:
    positions = [
        text.find(label)
        for spec in NUTRIENT_SPECS.values()
        for label in spec["labels"]
        if text.find(label) >= 0
    ]
    return min(positions) if positions else None


def parse_basis(text: str) -> tuple[str, float, str, float] | None:
    offset = first_nutrient_offset(text)
    if offset is None:
        return None
    basis = text[:offset].rstrip(" :;；")
    gram_values = [
        float(value)
        for value in re.findall(rf"({NUMBER_PATTERN})\s*g", basis, re.IGNORECASE)
    ]
    if len(gram_values) != 1 or not math.isfinite(gram_values[0]) or gram_values[0] <= 0:
        return None
    reference_mass = gram_values[0]
    if re.search(rf"{NUMBER_PATTERN}\s*g\s*(?:当たり|あたり)", basis, re.IGNORECASE):
        return basis, reference_mass, "g", reference_mass
    quantity_match = re.search(
        rf"({NUMBER_PATTERN})\s*(個|袋|本|枚|食|包|粒|カップ|箱|缶|瓶|杯)",
        basis,
    )
    if quantity_match:
        return basis, float(quantity_match.group(1)), "その他", reference_mass
    return basis, 1.0, "その他", reference_mass


def parse_nutrient(text: str, key: str, basis: str, estimated: bool) -> dict[str, Any] | None:
    spec = NUTRIENT_SPECS[key]
    labels = "|".join(re.escape(label) for label in spec["labels"])
    match = re.search(
        rf"(?:{labels})(?:[^\d]{{0,20}})"
        rf"(?P<first>{NUMBER_PATTERN})"
        rf"(?:\s*(?P<separator>{RANGE_SEPARATOR_PATTERN})\s*(?P<second>{NUMBER_PATTERN}))?"
        rf"\s*(?P<unit>{UNIT_PATTERN})",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    between = text[match.start():match.end()]
    if "/" in between:
        return None
    raw_unit = match.group("unit").casefold()
    unit = "mcg" if raw_unit in {"μg", "µg", "ug", "mcg"} else raw_unit
    if unit != spec["unit"]:
        return None
    first = float(match.group("first"))
    second_text = match.group("second")
    display_text = match.group(0).strip()
    places = decimal_places(match.group("first"))
    if second_text is not None:
        second = float(second_text)
        places = max(places, decimal_places(second_text))
        if estimated:
            return {
                "displayText": display_text,
                "value": (first + second) / 2,
                "rangeMin": None,
                "rangeMax": None,
                "unit": unit,
                "basis": basis,
                "decimalPlaces": places,
                "valueKind": "estimated",
            }
        return {
            "displayText": display_text,
            "value": None,
            "rangeMin": min(first, second),
            "rangeMax": max(first, second),
            "unit": unit,
            "basis": basis,
            "decimalPlaces": places,
            "valueKind": "declared_range",
        }
    return {
        "displayText": display_text,
        "value": first,
        "rangeMin": None,
        "rangeMax": None,
        "unit": unit,
        "basis": basis,
        "decimalPlaces": places,
        "valueKind": "estimated" if estimated else "fixed",
    }


def has_multiple_values(text: str) -> bool:
    for spec in NUTRIENT_SPECS.values():
        for label in spec["labels"]:
            offset = text.find(label)
            if offset < 0:
                continue
            segment = text[offset:offset + 100].split("；", 1)[0]
            if re.search(rf"{NUMBER_PATTERN}\s*/\s*{NUMBER_PATTERN}", segment):
                return True
    return False


def matches_rule(value: str, terms: tuple[str, ...]) -> bool:
    compact = compact_text(value)
    for term in terms:
        normalized_term = compact_text(term)
        if normalized_term not in compact:
            continue
        if any(compact_text(excluded) in compact for excluded in NAME_EXCLUSIONS.get(term, ())):
            continue
        return True
    return False


def infer_genre(product_name: str, category: str, ingredients_text: str) -> str:
    for genre_id, terms in NAME_GENRE_RULES:
        if matches_rule(product_name, terms):
            return genre_id
    for genre_id, terms in CATEGORY_GENRE_RULES:
        if matches_rule(category, terms):
            return genre_id
    for genre_id, terms in INGREDIENT_GENRE_RULES:
        if matches_rule(ingredients_text, terms):
            return genre_id
    return "other_unknown"


def product_family(product_name: str) -> str:
    value = normalize_text(product_name)
    value = re.sub(r"[<＜][^>＞]+[>＞]", "", value)
    value = re.sub(
        r"\s*[（(]?\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\b[^）)]*[）)]?",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\s*\d+\s*(?:個|袋|本|枚|食|包|粒|カップ|箱|缶|瓶|杯)\s*入(?:り)?", "", value)
    value = re.sub(r"[®™]", "", value)
    return normalize_text(value).strip(" -_/") or normalize_text(product_name)


def record_id(maker: str, product_name: str, nutrition_text: str, ingredients_text: str) -> str:
    digest = hashlib.sha256(
        "\0".join((maker, normalize_text(product_name), nutrition_text, ingredients_text)).encode("utf-8")
    ).hexdigest()
    return f"spu-{digest[:24]}"


def normalize_row(
    row: dict[str, str],
    *,
    filename: str,
    row_number: int,
    source_config: dict[str, str],
    verified_at: str,
) -> tuple[dict[str, Any] | None, str | None]:
    category = normalize_text(row.get("カテゴリ", ""))
    product_name = normalize_text(row.get("商品名", ""))
    nutrition_text = normalize_text(row.get("栄養素", ""))
    ingredients_text = normalize_text(row.get("原材料", ""))
    if not product_name:
        return None, "missing_product_name"
    if not ingredients_text or "掲載なし" in ingredients_text:
        return None, "missing_ingredients"
    if not nutrition_text or "掲載なし" in nutrition_text or "情報はありません" in nutrition_text:
        return None, "missing_nutrition"
    if has_multiple_values(nutrition_text):
        return None, "multiple_products_in_one_row"
    parsed_basis = parse_basis(nutrition_text)
    if parsed_basis is None:
        return None, "missing_explicit_reference_mass"
    basis, base_amount, base_unit, reference_mass = parsed_basis
    estimated = "推定値" in nutrition_text
    nutrients = {
        key: parsed
        for key in NUTRIENT_SPECS
        if (parsed := parse_nutrient(nutrition_text, key, basis, estimated)) is not None
    }
    for required_key in ("energyKcal", "proteinG", "fatG", "carbohydrateG", "saltG"):
        if required_key not in nutrients:
            return None, f"missing_required_nutrient:{required_key}"
    if not TARGET_NUTRIENTS.intersection(nutrients):
        return None, "no_target_nutrient"
    maker = source_config["maker"]
    return {
        "recordId": record_id(maker, product_name, nutrition_text, ingredients_text),
        "genreId": infer_genre(product_name, category, ingredients_text),
        "productName": product_name,
        "maker": maker,
        "productFamily": product_family(product_name),
        "barcode": None,
        "ingredientsText": ingredients_text,
        "ingredientsLanguage": "ja",
        "baseAmount": base_amount,
        "baseUnit": base_unit,
        "referenceMassG": reference_mass,
        "referenceMassSource": f"メーカー公表の栄養成分表示基準「{basis}」",
        "nutrients": nutrients,
        "sourceType": "manufacturer",
        "sourceReference": f"{source_config['url']} ({filename})",
        "verifiedAt": verified_at,
        "notes": json.dumps({
            "manufacturerCategory": category,
            "sourceFile": filename,
            "sourceRow": row_number,
            "transformVersion": TRANSFORM_VERSION,
        }, ensure_ascii=False, separators=(",", ":")),
    }, None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_dataset(input_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    files = sorted(input_dir.glob("*.csv"))
    if not files:
        raise SpuDataError(f"No CSV files found in {input_dir}")
    records: list[dict[str, Any]] = []
    exclusions = Counter()
    category_genre_counts = Counter()
    file_reports: list[dict[str, Any]] = []
    seen_records: set[str] = set()
    for path in files:
        match = FILENAME_RE.fullmatch(path.name)
        if not match:
            raise SpuDataError(f"{path.name}: expected maker_source_YYMMDD.csv")
        maker_key = match.group("maker").casefold()
        source_config = SOURCE_CONFIG.get(maker_key)
        if source_config is None:
            raise SpuDataError(f"{path.name}: unknown maker key {maker_key}")
        verified_at = parse_verified_at(match.group("date"))
        file_counts = Counter()
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None or set(reader.fieldnames) != REQUIRED_COLUMNS:
                raise SpuDataError(
                    f"{path.name}: columns must be {sorted(REQUIRED_COLUMNS)}"
                )
            for row_number, row in enumerate(reader, 2):
                file_counts["inputRows"] += 1
                record, reason = normalize_row(
                    row,
                    filename=path.name,
                    row_number=row_number,
                    source_config=source_config,
                    verified_at=verified_at,
                )
                if reason is not None:
                    exclusions[reason] += 1
                    file_counts[f"excluded:{reason}"] += 1
                    continue
                assert record is not None
                if record["recordId"] in seen_records:
                    exclusions["exact_duplicate"] += 1
                    file_counts["excluded:exact_duplicate"] += 1
                    continue
                seen_records.add(record["recordId"])
                records.append(record)
                category = normalize_text(row.get("カテゴリ", ""))
                category_genre_counts[
                    f"{source_config['maker']}:{category} -> {record['genreId']}"
                ] += 1
                file_counts["acceptedRows"] += 1
        file_reports.append({
            "file": path.name,
            "sha256": sha256(path),
            **dict(sorted(file_counts.items())),
        })
    dataset = {
        "format": "nutrition-estimator-training-data",
        "formatVersion": 1,
        "records": records,
    }
    genre_counts = Counter(record["genreId"] for record in records)
    nutrient_counts = Counter(
        key
        for record in records
        for key in record["nutrients"]
        if key in TARGET_NUTRIENTS
    )
    independent_counts = Counter(
        key
        for record in records
        for key, nutrient in record["nutrients"].items()
        if key in TARGET_NUTRIENTS and nutrient["valueKind"] != "estimated"
    )
    report = {
        "format": "nutrition-estimator-spu-normalization-report",
        "formatVersion": 1,
        "transformVersion": TRANSFORM_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "inputDirectory": input_dir.name,
        "inputRows": sum(report["inputRows"] for report in file_reports),
        "acceptedRows": len(records),
        "excludedRows": sum(exclusions.values()),
        "exclusions": dict(sorted(exclusions.items())),
        "genreCounts": dict(sorted(genre_counts.items())),
        "targetNutrientCounts": dict(sorted(nutrient_counts.items())),
        "independentTargetNutrientCounts": dict(sorted(independent_counts.items())),
        "manufacturerCategoryGenreCounts": dict(sorted(category_genre_counts.items())),
        "files": file_reports,
    }
    return dataset, report


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    dataset, report = build_dataset(args.input_dir)
    write_json(args.output, dataset)
    write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
