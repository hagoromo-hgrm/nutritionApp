#!/usr/bin/env python3
"""日本食品標準成分表等の確認済みCSVを、Nutrition PWAの食品JSONへ変換する。

入力CSVの列:
id,official_name,name,maker,barcode,base_amount,base_unit,energy_kcal,protein_g,fat_g,carbohydrate_g,fiber_g,salt_g,calcium_mg,iron_mg,vitamin_a_mcg,vitamin_e_mg,vitamin_b1_mg,vitamin_b2_mg,vitamin_c_mg,saturated_fat_g

元データの版・出典・取得日をコマンド引数で明示し、欠損値は null のまま出力する。
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


def convert_row(row: Dict[str, str], source_version: str, processed_at: str) -> Dict[str, Any]:
    created_at = processed_at
    return {
        "id": row["id"].strip(),
        "officialName": row.get("official_name", row["name"]).strip(),
        "name": clean_food_name(row["name"]),
        "displayName": clean_food_name(row["name"]),
        "maker": row.get("maker", "").strip(),
        "barcode": row.get("barcode", "").strip(),
        "source": "mext",
        "sourceVersion": source_version,
        "baseAmount": float(row["base_amount"]),
        "baseUnit": row["base_unit"].strip(),
        "servingAmount": None,
        "servingUnit": None,
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
