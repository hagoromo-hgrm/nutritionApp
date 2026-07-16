#!/usr/bin/env python3
"""文部科学省の食品成分表Excelから、アプリ変換用CSVを作成する。

Excelの記号は、未測定・微量を空欄、括弧付きの推定値は数値として保持する。
"-"や"Tr"をゼロに置き換えないのは、データ不足を摂取ゼロと混同しないためである。
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

import openpyxl


CSV_COLUMNS = (
    "id", "name", "maker", "barcode", "base_amount", "base_unit",
    "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g", "salt_g",
    "calcium_mg", "iron_mg", "vitamin_a_mcg", "vitamin_e_mg", "vitamin_b1_mg",
    "vitamin_b2_mg", "vitamin_c_mg", "saturated_fat_g",
)


def clean_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text in {"-", "Tr", "(Tr)"}:
        return ""
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    return text


def food_id(value: Any) -> str:
    code = clean_value(value)
    return f"mext_{code.zfill(5)}"


def main() -> None:
    parser = argparse.ArgumentParser(description="MEXT食品成分表Excelを変換用CSVへ抽出")
    parser.add_argument("input_xlsx", type=Path)
    parser.add_argument("output_csv", type=Path)
    args = parser.parse_args()

    book = openpyxl.load_workbook(args.input_xlsx, read_only=True, data_only=True)
    sheet = book["表全体"]
    data_start = None
    for row_number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
        if len(row) > 3 and clean_value(row[3]) == "成分識別子":
            data_start = row_number + 1
            break
    if data_start is None:
        raise RuntimeError("食品データの開始行を特定できません。")

    rows: list[dict[str, str]] = []
    for row in sheet.iter_rows(min_row=data_start, values_only=True):
        if len(row) < 61 or not clean_value(row[1]) or not clean_value(row[3]):
            continue
        rows.append({
            "id": food_id(row[1]),
            "name": clean_value(row[3]),
            "maker": "",
            "barcode": "",
            "base_amount": "100",
            "base_unit": "g",
            "energy_kcal": clean_value(row[6]),
            "protein_g": clean_value(row[9]),
            "fat_g": clean_value(row[12]),
            "carbohydrate_g": clean_value(row[20]),
            "fiber_g": clean_value(row[18]),
            "salt_g": clean_value(row[60]),
            "calcium_mg": clean_value(row[25]),
            "iron_mg": clean_value(row[28]),
            "vitamin_a_mcg": clean_value(row[42]),
            "vitamin_e_mg": clean_value(row[44]),
            "vitamin_b1_mg": clean_value(row[49]),
            "vitamin_b2_mg": clean_value(row[50]),
            "vitamin_c_mg": clean_value(row[58]),
            "saturated_fat_g": "",
        })

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.output_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"extracted foods={len(rows)} output={args.output_csv}")


if __name__ == "__main__":
    main()
