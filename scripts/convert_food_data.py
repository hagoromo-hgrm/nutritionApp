#!/usr/bin/env python3
"""日本食品標準成分表等の確認済みCSVを、Nutrition PWAの食品JSONへ変換する。

入力CSVの列:
id,official_name,name,maker,barcode,base_amount,base_unit,serving_amount,
serving_unit,input_unit_conversions,energy_kcal,protein_g,fat_g,
carbohydrate_g,fiber_g,salt_g,calcium_mg,iron_mg,vitamin_a_mcg,
vitamin_e_mg,vitamin_b1_mg,vitamin_b2_mg,vitamin_c_mg,saturated_fat_g

元データの版・出典・取得日をコマンド引数で明示し、欠損値は null のまま出力する。
入力単位列は任意で、旧CSVに存在しない場合は未設定として扱う。
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from food_data_rules import clean_food_name


NUTRIENTS = (
    ("energy_kcal", "energyKcal"),
    ("protein_g", "proteinG"),
    ("fat_g", "fatG"),
    ("carbohydrate_g", "carbohydrateG"),
    ("fiber_g", "fiberG"),
    ("salt_g", "saltG"),
    ("calcium_mg", "calciumMg"),
    ("iron_mg", "ironMg"),
    ("vitamin_a_mcg", "vitaminAMcg"),
    ("vitamin_e_mg", "vitaminEMg"),
    ("vitamin_b1_mg", "vitaminB1Mg"),
    ("vitamin_b2_mg", "vitaminB2Mg"),
    ("vitamin_c_mg", "vitaminCMg"),
    ("saturated_fat_g", "saturatedFatG"),
)


def number_or_none(value: str) -> Optional[float]:
    cleaned = value.strip()
    if not cleaned or cleaned in {"-", "Tr", "(Tr)"}:
        return None
    cleaned = cleaned.rstrip("†‡").strip()
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = cleaned[1:-1].strip()
    return float(cleaned)


def _valid_unit(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and value == value.strip()
        and len(value) <= 30
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
    )


def _positive_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label}は正の数で指定してください。") from error
    if not number > 0 or number == float("inf"):
        raise ValueError(f"{label}は正の有限値で指定してください。")
    return number


def parse_input_unit_conversions(raw_value: str, base_unit: str) -> list[dict[str, Any]]:
    text = raw_value.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("input_unit_conversionsはJSON配列で指定してください。") from error
    if not isinstance(parsed, list):
        raise ValueError("input_unit_conversionsはJSON配列で指定してください。")

    conversions: list[dict[str, Any]] = []
    seen_units: set[str] = set()
    for index, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise ValueError(f"input_unit_conversions[{index}]はオブジェクトで指定してください。")
        unit = item.get("unit")
        if not _valid_unit(unit):
            raise ValueError(f"input_unit_conversions[{index}].unitが不正です。")
        if unit == base_unit:
            raise ValueError("入力単位は基準単位と重複できません。")
        if unit in seen_units:
            raise ValueError(f"入力単位{unit!r}が重複しています。")
        seen_units.add(unit)
        conversions.append({
            "unit": unit,
            "baseAmount": _positive_number(
                item.get("baseAmount"),
                f"input_unit_conversions[{index}].baseAmount",
            ),
        })
    return conversions


def convert_row(row: Dict[str, str], source_version: str, processed_at: str) -> Dict[str, Any]:
    created_at = processed_at
    base_amount = _positive_number(row["base_amount"], "base_amount")
    base_unit = row["base_unit"].strip()
    if not _valid_unit(base_unit):
        raise ValueError("base_unitが不正です。")
    conversions = parse_input_unit_conversions(row.get("input_unit_conversions", ""), base_unit)
    serving_amount_text = row.get("serving_amount", "").strip()
    serving_unit_text = row.get("serving_unit", "").strip()
    if bool(serving_amount_text) != bool(serving_unit_text):
        raise ValueError("serving_amountとserving_unitは両方を指定してください。")
    serving_amount = _positive_number(serving_amount_text, "serving_amount") if serving_amount_text else None
    serving_unit = serving_unit_text or None
    allowed_serving_units = {base_unit, *(conversion["unit"] for conversion in conversions)}
    if serving_unit is not None and (
        not _valid_unit(serving_unit)
        or serving_unit not in allowed_serving_units
    ):
        raise ValueError("serving_unitは基準単位または登録済み入力単位を指定してください。")

    return {
        "id": row["id"].strip(),
        "officialName": row.get("official_name", row["name"]).strip(),
        "name": clean_food_name(row["name"]),
        "displayName": clean_food_name(row["name"]),
        "maker": row.get("maker", "").strip(),
        "barcode": row.get("barcode", "").strip(),
        "source": "mext",
        "sourceVersion": source_version,
        "baseAmount": base_amount,
        "baseUnit": base_unit,
        "servingAmount": serving_amount,
        "servingUnit": serving_unit,
        "inputUnitConversions": conversions,
        "nutrients": {target: number_or_none(row.get(source, "")) for source, target in NUTRIENTS},
        "createdAt": created_at,
        "updatedAt": created_at,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="確認済み食品CSVをNutrition PWA JSONへ変換")
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--acquired-date", required=True, help="YYYY-MM-DD")
    args = parser.parse_args()

    processed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        foods = [convert_row(row, args.source_version, processed_at) for row in csv.DictReader(handle)]

    output = {
        "metadata": {
            "source": "文部科学省 日本食品標準成分表",
            "sourceVersion": args.source_version,
            "sourceUrl": args.source_url,
            "acquiredDate": args.acquired_date,
            "processedAt": processed_at,
            "script": "scripts/convert_food_data.py",
        },
        "foods": foods,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"converted foods={len(foods)} output={args.output_json}")


if __name__ == "__main__":
    main()
