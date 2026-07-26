#!/usr/bin/env python3
"""Validate estimator teacher data and create deterministic group splits."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

GENRE_IDS = {
    "baked_sweets", "cake_pastry", "bread", "chocolate", "sugar_confectionery",
    "snack_rice_cracker", "frozen_dessert", "dairy", "drink_jelly_pudding",
    "fried_food", "noodle_flour_dish", "prepared_meal", "sauce_spread",
    "other_unknown",
}
NUTRIENT_KEYS = [
    "energyKcal", "proteinG", "fatG", "carbohydrateG", "fiberG", "calciumMg",
    "ironMg", "vitaminAMcg", "vitaminEMg", "vitaminB1Mg", "vitaminB2Mg",
    "vitaminCMg", "saturatedFatG", "saltG",
]
TARGET_NUTRIENTS = {
    "fiberG", "calciumMg", "ironMg", "vitaminAMcg", "vitaminEMg",
    "vitaminB1Mg", "vitaminB2Mg", "vitaminCMg", "saturatedFatG",
}
BASE_FIELDS = [
    "recordId", "genreId", "productName", "maker", "productFamily", "barcode",
    "ingredientsText", "ingredientsLanguage", "baseAmount", "baseUnit",
    "referenceMassG", "referenceMassSource", "sourceType", "sourceReference",
    "verifiedAt", "notes",
]
NUTRIENT_FIELDS = [
    "displayText", "value", "rangeMin", "rangeMax", "unit", "basis",
    "decimalPlaces", "valueKind",
]
BARCODE_RE = re.compile(r"^[0-9]{8,14}$")
EXPECTED_NUTRIENT_UNITS = {
    "energyKcal": "kcal",
    "proteinG": "g",
    "fatG": "g",
    "carbohydrateG": "g",
    "fiberG": "g",
    "calciumMg": "mg",
    "ironMg": "mg",
    "vitaminAMcg": "mcg",
    "vitaminEMg": "mg",
    "vitaminB1Mg": "mg",
    "vitaminB2Mg": "mg",
    "vitaminCMg": "mg",
    "saturatedFatG": "g",
    "saltG": "g",
}


class ValidationError(ValueError):
    pass


def require_text(record: dict[str, Any], key: str, record_id: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{record_id}: {key} is required")
    return value.strip()


def number(
    value: Any,
    field: str,
    record_id: str,
    *,
    nullable: bool = False,
    positive: bool = False,
) -> float | None:
    if value is None or value == "":
        if nullable:
            return None
        raise ValidationError(f"{record_id}: {field} is required")
    try:
        converted = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{record_id}: {field} must be numeric") from exc
    if not math.isfinite(converted) or converted < 0 or (positive and converted == 0):
        condition = "positive" if positive else "non-negative"
        raise ValidationError(f"{record_id}: {field} must be finite and {condition}")
    return converted


def parse_datetime(value: str, record_id: str) -> str:
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValidationError(f"{record_id}: verifiedAt must be ISO 8601") from exc
    if parsed.tzinfo is None:
        raise ValidationError(f"{record_id}: verifiedAt must include a timezone")
    return value


def normalize_nutrient(raw: Any, key: str, record_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValidationError(f"{record_id}: nutrients.{key} must be an object")
    kind = raw.get("valueKind")
    if kind not in {"fixed", "declared_range", "estimated"}:
        raise ValidationError(f"{record_id}: nutrients.{key}.valueKind is invalid")
    unit = raw.get("unit")
    if unit not in {"kcal", "g", "mg", "mcg"}:
        raise ValidationError(f"{record_id}: nutrients.{key}.unit is invalid")
    if unit != EXPECTED_NUTRIENT_UNITS[key]:
        raise ValidationError(f"{record_id}: nutrients.{key}.unit must be {EXPECTED_NUTRIENT_UNITS[key]}")
    decimal_places = number(raw.get("decimalPlaces"), f"nutrients.{key}.decimalPlaces", record_id)
    if decimal_places is None or not decimal_places.is_integer():
        raise ValidationError(f"{record_id}: nutrients.{key}.decimalPlaces must be an integer")
    result = {
        "displayText": require_text(raw, "displayText", f"{record_id}.nutrients.{key}"),
        "value": number(raw.get("value"), f"nutrients.{key}.value", record_id, nullable=True),
        "rangeMin": number(raw.get("rangeMin"), f"nutrients.{key}.rangeMin", record_id, nullable=True),
        "rangeMax": number(raw.get("rangeMax"), f"nutrients.{key}.rangeMax", record_id, nullable=True),
        "unit": unit,
        "basis": require_text(raw, "basis", f"{record_id}.nutrients.{key}"),
        "decimalPlaces": int(decimal_places),
        "valueKind": kind,
    }
    if result["decimalPlaces"] > 12:
        raise ValidationError(f"{record_id}: nutrients.{key}.decimalPlaces must be <= 12")
    if kind == "declared_range":
        if result["rangeMin"] is None or result["rangeMax"] is None or result["rangeMax"] < result["rangeMin"]:
            raise ValidationError(f"{record_id}: nutrients.{key} requires a valid declared range")
    elif result["value"] is None:
        raise ValidationError(f"{record_id}: nutrients.{key}.value is required for {kind}")
    return result


def normalize_record(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValidationError("each record must be an object")
    record_id = require_text(raw, "recordId", "<unknown>")
    genre_id = require_text(raw, "genreId", record_id)
    if genre_id not in GENRE_IDS:
        raise ValidationError(f"{record_id}: genreId is invalid")
    barcode = raw.get("barcode")
    if barcode in (None, ""):
        barcode = None
    elif not isinstance(barcode, str) or not BARCODE_RE.fullmatch(barcode):
        raise ValidationError(f"{record_id}: barcode must be an 8-14 digit string")
    nutrients_raw = raw.get("nutrients")
    if not isinstance(nutrients_raw, dict):
        raise ValidationError(f"{record_id}: nutrients is required")
    unknown_keys = set(nutrients_raw) - set(NUTRIENT_KEYS)
    if unknown_keys:
        raise ValidationError(f"{record_id}: unknown nutrient keys: {sorted(unknown_keys)}")
    nutrients = {
        key: normalize_nutrient(value, key, record_id)
        for key, value in nutrients_raw.items()
    }
    if not TARGET_NUTRIENTS.intersection(nutrients):
        raise ValidationError(f"{record_id}: at least one target nutrient is required")
    source_type = require_text(raw, "sourceType", record_id)
    if source_type not in {"package", "manufacturer", "public_database", "other"}:
        raise ValidationError(f"{record_id}: sourceType is invalid")
    return {
        "recordId": record_id,
        "genreId": genre_id,
        "productName": require_text(raw, "productName", record_id),
        "maker": require_text(raw, "maker", record_id),
        "productFamily": require_text(raw, "productFamily", record_id),
        "barcode": barcode,
        "ingredientsText": require_text(raw, "ingredientsText", record_id),
        "ingredientsLanguage": require_text(raw, "ingredientsLanguage", record_id),
        "baseAmount": number(raw.get("baseAmount"), "baseAmount", record_id, positive=True),
        "baseUnit": require_text(raw, "baseUnit", record_id),
        "referenceMassG": number(raw.get("referenceMassG"), "referenceMassG", record_id, positive=True),
        "referenceMassSource": require_text(raw, "referenceMassSource", record_id),
        "nutrients": nutrients,
        "sourceType": source_type,
        "sourceReference": require_text(raw, "sourceReference", record_id),
        "verifiedAt": parse_datetime(require_text(raw, "verifiedAt", record_id), record_id),
        "notes": raw.get("notes") if isinstance(raw.get("notes"), str) else None,
    }


def csv_records(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    records: list[dict[str, Any]] = []
    for row in rows:
        nutrients: dict[str, dict[str, Any]] = {}
        for key in NUTRIENT_KEYS:
            fields = {field: row.get(f"{key}.{field}", "") for field in NUTRIENT_FIELDS}
            if any(value not in ("", None) for value in fields.values()):
                nutrients[key] = fields
        records.append({**{key: row.get(key, "") for key in BASE_FIELDS}, "nutrients": nutrients})
    return records


def load_records(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        return csv_records(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("format") != "nutrition-estimator-training-data" or payload.get("formatVersion") != 1:
        raise ValidationError("JSON format or formatVersion is invalid")
    records = payload.get("records")
    if not isinstance(records, list):
        raise ValidationError("JSON records must be an array")
    return records


def normalize_group_component(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def group_key(maker: str, product_family: str) -> str:
    return f"{normalize_group_component(maker)}\0{normalize_group_component(product_family)}"


def split_for_group(maker: str, product_family: str) -> str:
    digest = hashlib.sha256(f"nutrient-estimator-v1\0{group_key(maker, product_family)}".encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:8], "big") / 2**64
    if bucket < 0.70:
        return "train"
    if bucket < 0.85:
        return "calibration"
    return "test"


def build_manifest(records: list[dict[str, Any]], source_path: Path) -> dict[str, Any]:
    normalized = [normalize_record(record) for record in records]
    ids = [record["recordId"] for record in normalized]
    if len(ids) != len(set(ids)):
        raise ValidationError("recordId values must be unique")
    split_records = [
        {
            "recordId": record["recordId"],
            "genreId": record["genreId"],
            "groupKey": group_key(record["maker"], record["productFamily"]),
            "split": split_for_group(record["maker"], record["productFamily"]),
        }
        for record in normalized
    ]
    genre_counts = Counter(record["genreId"] for record in normalized)
    split_counts = Counter(item["split"] for item in split_records)
    independent_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for record in normalized:
        for nutrient_key, label in record["nutrients"].items():
            if nutrient_key in TARGET_NUTRIENTS and label["valueKind"] != "estimated":
                independent_counts[record["genreId"]][nutrient_key] += 1
    canonical = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    warnings: list[str] = []
    for genre_id, count in sorted(genre_counts.items()):
        if count < 50:
            warnings.append(f"{genre_id}: pilot target 50 not reached ({count})")
        maker_counts = Counter(record["maker"] for record in normalized if record["genreId"] == genre_id)
        for maker, maker_count in maker_counts.items():
            if count > 0 and maker_count / count > 0.20:
                warnings.append(f"{genre_id}: maker share exceeds 20% ({maker}: {maker_count}/{count})")
    return {
        "format": "nutrition-estimator-training-manifest",
        "formatVersion": 1,
        "sourceFile": source_path.name,
        "sourceFileSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "normalizedDatasetSha256": hashlib.sha256(canonical).hexdigest(),
        "recordCount": len(normalized),
        "genreCounts": dict(sorted(genre_counts.items())),
        "splitCounts": dict(sorted(split_counts.items())),
        "independentEvaluationCounts": {
            genre: dict(sorted(counts.items()))
            for genre, counts in sorted(independent_counts.items())
        },
        "warnings": warnings,
        "records": split_records,
    }


def write_template(path: Path) -> None:
    headers = BASE_FIELDS + [
        f"{key}.{field}"
        for key in NUTRIENT_KEYS
        for field in NUTRIENT_FIELDS
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        csv.writer(handle).writerow(headers)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, nargs="?")
    parser.add_argument("--output-manifest", type=Path)
    parser.add_argument("--write-template", type=Path)
    args = parser.parse_args()
    if args.write_template:
        write_template(args.write_template)
        return 0
    if not args.input:
        parser.error("input is required unless --write-template is used")
    manifest = build_manifest(load_records(args.input), args.input)
    output = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.output_manifest:
        args.output_manifest.parent.mkdir(parents=True, exist_ok=True)
        args.output_manifest.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
