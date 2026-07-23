#!/usr/bin/env python3
"""ユーザー提供の食品DB JSONをNutrition PWA用JSONへ正規化する。"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set


NUTRIENT_KEYS = (
    "energyKcal",
    "proteinG",
    "fatG",
    "carbohydrateG",
    "fiberG",
    "calciumMg",
    "ironMg",
    "vitaminAMcg",
    "vitaminEMg",
    "vitaminB1Mg",
    "vitaminB2Mg",
    "vitaminCMg",
    "saturatedFatG",
    "saltG",
)

FOOD_UNITS = {
    "g",
    "ml",
    "個",
    "合",
    "袋",
    "本",
    "枚",
    "食",
    "丁",
    "小さじ",
    "杯",
    "その他",
}
SPECIAL_PACKAGING_UNIT = "包装"
VARIANT_ATTRIBUTE_KEYS = (
    "species",
    "part",
    "cultivation",
    "sourceBean",
    "skin",
    "preparation",
    "processing",
    "variety",
    "nameSpecification",
)
TOP_LEVEL_KEYS = {"format", "formatVersion", "metadata", "foods"}
FOOD_REQUIRED_KEYS = {"id", "name", "baseAmount", "baseUnit", "nutrients"}
BARCODE_PATTERN = re.compile(r"^[0-9]{8,14}$")
MAX_AMOUNT = 100_000
MAX_QUANTITY_UNIT_LENGTH = 30


class FoodDatabaseImportError(ValueError):
    """入力DBを安全に変換できない場合のエラー。"""


def _error(path: str, message: str) -> FoodDatabaseImportError:
    return FoodDatabaseImportError(f"{path}: {message}")


def _require_string(value: Any, path: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise _error(path, "文字列が必要です")
    result = value.strip()
    if not allow_empty and not result:
        raise _error(path, "空でない文字列が必要です")
    return result


def _nullable_string(value: Any, path: str) -> Optional[str]:
    if value is None:
        return None
    result = _require_string(value, path, allow_empty=True)
    return result or None


def _number(value: Any, path: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _error(path, "有限数が必要です")
    try:
        finite = math.isfinite(float(value))
    except (OverflowError, ValueError):
        finite = False
    if not finite:
        raise _error(path, "有限数が必要です")
    if positive and value <= 0:
        raise _error(path, "正の数が必要です")
    if not positive and value < 0:
        raise _error(path, "0以上の数が必要です")
    if value > MAX_AMOUNT:
        raise _error(path, f"{MAX_AMOUNT}以下の数が必要です")
    return value


def _quantity_unit(value: Any, path: str) -> str:
    unit = _require_string(value, path)
    if len(unit) > MAX_QUANTITY_UNIT_LENGTH or any(ord(character) <= 0x1F or ord(character) == 0x7F for character in unit):
        raise _error(path, "入力単位の文字列が不正です")
    return unit


def _iso_datetime(value: Any, path: str) -> str:
    raw = _require_string(value, path)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise _error(path, "ISO 8601日時が必要です") from exc
    if parsed.tzinfo is None:
        raise _error(path, "タイムゾーン付きISO 8601日時が必要です")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _normalise_id(value: Any, path: str) -> str:
    raw = _require_string(value, path)
    if raw.startswith("user:"):
        suffix = raw[len("user:") :]
    elif raw.startswith("imported:"):
        suffix = raw[len("imported:") :]
    else:
        suffix = raw
    if not suffix:
        raise _error(path, "名前空間を除いたIDが空です")
    return f"imported:{suffix}"


def _metadata_fallback(metadata: Mapping[str, Any], key: str, path: str) -> str:
    value = metadata.get(key)
    if not isinstance(value, str) or not value.strip():
        raise _error(path, f"{key}が不足しているためfallbackに使えません")
    return value.strip()


def _with_fallback(value: Any, metadata: Mapping[str, Any], key: str, path: str) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return _metadata_fallback(metadata, key, "metadata")
    return _require_string(value, path)


def _normalise_nutrients(value: Any, path: str) -> Dict[str, Optional[float]]:
    if not isinstance(value, dict):
        raise _error(path, "オブジェクトが必要です")
    if set(value) != set(NUTRIENT_KEYS):
        missing = sorted(set(NUTRIENT_KEYS) - set(value))
        extra = sorted(set(value) - set(NUTRIENT_KEYS))
        details = []
        if missing:
            details.append(f"不足={','.join(missing)}")
        if extra:
            details.append(f"余分={','.join(extra)}")
        raise _error(path, "栄養素キーが不正です (" + "; ".join(details) + ")")

    result: Dict[str, Optional[float]] = {}
    for key in NUTRIENT_KEYS:
        nutrient = value[key]
        result[key] = None if nutrient is None else _number(nutrient, f"{path}.{key}")
    if result["energyKcal"] is None:
        raise _error(f"{path}.energyKcal", "採用食品ではnullにできません")
    return result


def _normalise_conversions(
    value: Any,
    base_unit: str,
    original_base_unit: str,
    base_amount: float,
    path: str,
) -> List[Dict[str, Any]]:
    if value is None:
        value = []
    if not isinstance(value, list):
        raise _error(path, "配列が必要です")

    conversions: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, dict) or set(item) != {"unit", "baseAmount"}:
            raise _error(item_path, "unitとbaseAmountだけを持つオブジェクトが必要です")
        unit = _quantity_unit(item["unit"], f"{item_path}.unit")
        amount = _number(item["baseAmount"], f"{item_path}.baseAmount", positive=True)
        if unit == base_unit:
            continue
        if unit in seen:
            raise _error(item_path, f"単位{unit!r}が重複しています")
        seen.add(unit)
        conversions.append({"unit": unit, "baseAmount": amount})

    if original_base_unit == SPECIAL_PACKAGING_UNIT:
        if SPECIAL_PACKAGING_UNIT in seen:
            raise _error(path, f"単位{SPECIAL_PACKAGING_UNIT!r}が重複しています")
        conversions.insert(0, {"unit": SPECIAL_PACKAGING_UNIT, "baseAmount": base_amount})
    return conversions


def _normalise_variant_attributes(value: Any, path: str) -> Optional[Dict[str, Optional[str]]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _error(path, "オブジェクトまたはnullが必要です")
    unknown = set(value) - set(VARIANT_ATTRIBUTE_KEYS)
    if unknown:
        raise _error(path, "未知の属性があります: " + ",".join(sorted(unknown)))
    result: Dict[str, Optional[str]] = {}
    for key in VARIANT_ATTRIBUTE_KEYS:
        if key in value:
            result[key] = _nullable_string(value[key], f"{path}.{key}")
    return result


def _normalise_food(
    raw: Any,
    index: int,
    metadata: Mapping[str, Any],
    used_ids: Set[str],
    used_barcodes: Set[str],
) -> Optional[Dict[str, Any]]:
    path = f"foods[{index}]"
    if not isinstance(raw, dict):
        raise _error(path, "オブジェクトが必要です")
    missing = FOOD_REQUIRED_KEYS - set(raw)
    if missing:
        raise _error(path, "必須項目が不足しています: " + ",".join(sorted(missing)))

    food_id = _normalise_id(raw["id"], f"{path}.id")
    if food_id in used_ids:
        raise _error(f"{path}.id", f"正規化後のIDが重複しています: {food_id}")
    used_ids.add(food_id)

    barcode_value = raw.get("barcode")
    barcode = "" if barcode_value is None else _require_string(barcode_value, f"{path}.barcode", allow_empty=True)
    if barcode and not BARCODE_PATTERN.fullmatch(barcode):
        raise _error(f"{path}.barcode", "JAN/GTINは8〜14桁の数字が必要です")
    if barcode and barcode in used_barcodes:
        raise _error(f"{path}.barcode", f"バーコードが重複しています: {barcode}")
    if barcode:
        used_barcodes.add(barcode)

    name = _require_string(raw["name"], f"{path}.name")
    nutrients_raw = raw["nutrients"]
    if not isinstance(nutrients_raw, dict) or set(nutrients_raw) != set(NUTRIENT_KEYS):
        nutrients = _normalise_nutrients(nutrients_raw, f"{path}.nutrients")
    elif all(value is None for value in nutrients_raw.values()):
        return None
    else:
        nutrients = _normalise_nutrients(nutrients_raw, f"{path}.nutrients")

    base_amount = _number(raw["baseAmount"], f"{path}.baseAmount", positive=True)
    input_base_unit = _require_string(raw["baseUnit"], f"{path}.baseUnit")
    if input_base_unit == SPECIAL_PACKAGING_UNIT:
        base_unit = "その他"
    elif input_base_unit in FOOD_UNITS:
        base_unit = input_base_unit
    else:
        raise _error(f"{path}.baseUnit", f"許可されていない単位です: {input_base_unit}")

    serving_amount = raw.get("servingAmount")
    if serving_amount is not None:
        serving_amount = _number(serving_amount, f"{path}.servingAmount", positive=True)
    serving_unit_value = raw.get("servingUnit")
    serving_unit = None if serving_unit_value is None else _quantity_unit(serving_unit_value, f"{path}.servingUnit")
    if (serving_amount is None) != (serving_unit is None):
        raise _error(path, "servingAmountとservingUnitは両方を設定するか両方nullにしてください")

    source_version = _with_fallback(raw.get("sourceVersion"), metadata, "sourceVersion", f"{path}.sourceVersion")
    created_at = _iso_datetime(_with_fallback(raw.get("createdAt"), metadata, "processedAt", f"{path}.createdAt"), f"{path}.createdAt")
    updated_at = _iso_datetime(_with_fallback(raw.get("updatedAt"), metadata, "processedAt", f"{path}.updatedAt"), f"{path}.updatedAt")

    maker_value = raw.get("maker")
    maker = "" if maker_value is None else _require_string(maker_value, f"{path}.maker", allow_empty=True)
    reading = _nullable_string(raw.get("reading"), f"{path}.reading")
    official_name = _nullable_string(raw.get("officialName"), f"{path}.officialName")
    display_name = _nullable_string(raw.get("displayName"), f"{path}.displayName")

    commercial_value = raw.get("isCommercial", False)
    if commercial_value is None:
        commercial_value = False
    if not isinstance(commercial_value, bool):
        raise _error(f"{path}.isCommercial", "booleanが必要です")

    conversions = _normalise_conversions(
        raw.get("inputUnitConversions"),
        base_unit,
        input_base_unit,
        base_amount,
        f"{path}.inputUnitConversions",
    )
    if serving_unit is not None and serving_unit != base_unit and not any(item["unit"] == serving_unit for item in conversions):
        raise _error(f"{path}.servingUnit", "基準単位または登録済み入力単位が必要です")

    output: Dict[str, Any] = {
        "id": food_id,
        "name": name,
        "maker": maker,
        "barcode": barcode,
        "isCommercial": commercial_value,
        "source": "imported",
        "sourceVersion": source_version,
        "baseAmount": base_amount,
        "baseUnit": base_unit,
        "servingAmount": serving_amount,
        "servingUnit": serving_unit,
        "inputUnitConversions": conversions,
        "foodGroupId": f"food:{food_id}",
        "nutrients": nutrients,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }
    if official_name is not None:
        output["officialName"] = official_name
    if display_name is not None:
        output["displayName"] = display_name
    output["reading"] = reading
    variant_attributes = _normalise_variant_attributes(raw.get("variantAttributes"), f"{path}.variantAttributes")
    if variant_attributes is not None:
        output["variantAttributes"] = variant_attributes
    return output


def convert_database(data: Any) -> Dict[str, Any]:
    """入力辞書を検証し、再現可能なアプリ用辞書へ変換する。"""
    if not isinstance(data, dict):
        raise _error("root", "オブジェクトが必要です")
    if set(data) != TOP_LEVEL_KEYS:
        missing = sorted(TOP_LEVEL_KEYS - set(data))
        extra = sorted(set(data) - TOP_LEVEL_KEYS)
        details = []
        if missing:
            details.append("不足=" + ",".join(missing))
        if extra:
            details.append("余分=" + ",".join(extra))
        raise _error("root", "トップレベル項目が不正です (" + "; ".join(details) + ")")
    if data["format"] != "nutrition-pwa-food-db":
        raise _error("format", "nutrition-pwa-food-dbである必要があります")
    if type(data["formatVersion"]) is not int or data["formatVersion"] != 1:
        raise _error("formatVersion", "1である必要があります")
    metadata = data["metadata"]
    if not isinstance(metadata, dict):
        raise _error("metadata", "オブジェクトが必要です")
    foods = data["foods"]
    if not isinstance(foods, list):
        raise _error("foods", "配列が必要です")

    converted: List[Dict[str, Any]] = []
    used_ids: Set[str] = set()
    used_barcodes: Set[str] = set()
    excluded_placeholder_count = 0
    for index, raw_food in enumerate(foods):
        food = _normalise_food(raw_food, index, metadata, used_ids, used_barcodes)
        if food is None:
            excluded_placeholder_count += 1
        else:
            converted.append(food)
    converted.sort(key=lambda food: food["id"])

    output_metadata = dict(metadata)
    output_metadata["conversionScript"] = "scripts/import_food_database.py"
    return {
        "format": "nutrition-pwa-imported-food-db",
        "formatVersion": 1,
        "metadata": output_metadata,
        "summary": {
            "inputCount": len(foods),
            "outputCount": len(converted),
            "excludedPlaceholderCount": excluded_placeholder_count,
        },
        "foods": converted,
    }


def convert_file(input_path: Path, output_path: Path) -> Dict[str, Any]:
    """ファイルを読み込み、出力JSONを書き出す。入力と出力の同一指定は拒否する。"""
    if input_path.resolve() == output_path.resolve():
        raise FoodDatabaseImportError("入力ファイルと出力ファイルは別にしてください")
    try:
        with input_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise FoodDatabaseImportError(f"入力JSONが不正です: {exc}") from exc
    output = convert_database(data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_path.parent, delete=False) as handle:
        temporary_path = Path(handle.name)
        handle.write(serialized)
        handle.flush()
    temporary_path.replace(output_path)
    return output


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="食品DB JSONをNutrition PWA用JSONへ正規化")
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args(argv)
    try:
        output = convert_file(args.input_json, args.output_json)
    except (FoodDatabaseImportError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(
        f"converted input={output['summary']['inputCount']} "
        f"output={output['summary']['outputCount']} "
        f"placeholders={output['summary']['excludedPlaceholderCount']} "
        f"path={args.output_json}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
