#!/usr/bin/env python3
"""Build reviewed FDC ingredient profiles without exposing API keys to the PWA."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRANSFORM_VERSION = "fdc-ingredient-profile-0.2.0"
ALLOWED_DATA_TYPES = {"Foundation", "SR Legacy"}
NUTRIENT_MATCHES: dict[str, tuple[tuple[tuple[int, str], ...], str]] = {
    "energyKcal": (((1008, "Energy"), (2048, "Energy (Atwater Specific Factors)"), (2047, "Energy (Atwater General Factors)")), "kcal"),
    "proteinG": (((1003, "Protein"),), "g"),
    "fatG": (((1004, "Total lipid (fat)"),), "g"),
    "carbohydrateG": (((1005, "Carbohydrate, by difference"),), "g"),
    "fiberG": (((1079, "Fiber, total dietary"),), "g"),
    "calciumMg": (((1087, "Calcium, Ca"),), "mg"),
    "ironMg": (((1089, "Iron, Fe"),), "mg"),
    "vitaminAMcg": (((1106, "Vitamin A, RAE"),), "µg"),
    "vitaminEMg": (((1109, "Vitamin E (alpha-tocopherol)"),), "mg"),
    "vitaminB1Mg": (((1165, "Thiamin"),), "mg"),
    "vitaminB2Mg": (((1166, "Riboflavin"),), "mg"),
    "vitaminCMg": (((1162, "Vitamin C, total ascorbic acid"),), "mg"),
    "saturatedFatG": (((1258, "Fatty acids, total saturated"),), "g"),
    "saltG": (((1093, "Sodium, Na"),), "mg"),
}
SALT_CONVERSION = {
    "formula": "sodium_mg * 2.54 / 1000",
    "multiplier": 0.00254,
    "outputUnit": "g",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_food(fdc_id: int, api_key: str, raw_path: Path) -> None:
    query = urllib.parse.urlencode({"api_key": api_key})
    request = urllib.request.Request(
        f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}?{query}",
        headers={"Accept": "application/json", "User-Agent": "nutrition-pwa-fdc-builder/0.1"},
    )
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw_path.write_bytes(response.read())


def extract_bulk_foods(bulk_path: Path, fdc_ids: set[int]) -> dict[int, dict[str, Any]]:
    """Extract reviewed IDs from USDA's official SR Legacy JSON distribution."""
    payload = load_json(bulk_path)
    foods = payload.get("SRLegacyFoods") if isinstance(payload, dict) else None
    if not isinstance(foods, list):
        raise ValueError("bulk JSON must contain an SRLegacyFoods array")
    selected: dict[int, dict[str, Any]] = {}
    for food in foods:
        if not isinstance(food, dict):
            continue
        fdc_id = food.get("fdcId")
        if type(fdc_id) is not int or fdc_id not in fdc_ids:
            continue
        if fdc_id in selected:
            raise ValueError(f"duplicate FDC ID in bulk JSON: {fdc_id}")
        selected[fdc_id] = food
    missing = fdc_ids - selected.keys()
    if missing:
        raise ValueError(f"reviewed FDC IDs are missing from bulk JSON: {sorted(missing)}")
    return selected


def _normalized_unit(unit: str) -> str:
    return unit.replace("UG", "µg").replace("ug", "µg").lower()


def _source_nutrient(food_nutrients: Any, key: str) -> dict[str, Any] | None:
    expected_candidates, expected_unit = NUTRIENT_MATCHES[key]
    expected_names = dict(expected_candidates)
    matches_by_id: dict[int, list[dict[str, Any]]] = {}
    for item in food_nutrients:
        if not isinstance(item, dict):
            continue
        nutrient = item.get("nutrient")
        if not isinstance(nutrient, dict):
            continue
        nutrient_id = nutrient.get("id")
        if nutrient_id is not None and (not isinstance(nutrient_id, int) or isinstance(nutrient_id, bool)):
            raise ValueError(f"{key}: nutrient ID must be an integer")
        name = nutrient.get("name")
        unit = nutrient.get("unitName")
        if key == "energyKcal" and nutrient_id == 1062 and name == "Energy" and unit == "kJ":
            continue
        recognized_names = set(dict(expected_candidates).values())
        if name in recognized_names and nutrient_id not in expected_names:
            raise ValueError(f"{key}: recognized nutrient name {name!r} has unexpected ID {nutrient_id!r}")
        if nutrient_id not in expected_names:
            continue
        expected_name = expected_names[nutrient_id]
        if name != expected_name:
            raise ValueError(f"{key}: nutrient ID {nutrient_id} has unexpected name {name!r}")
        if not isinstance(unit, str) or _normalized_unit(unit) != _normalized_unit(expected_unit):
            raise ValueError(f"{key}: nutrient ID {nutrient_id} expected unit {expected_unit}, got {unit!r}")
        amount = item.get("amount")
        if amount is None:
            numeric_amount = None
        else:
            if isinstance(amount, bool) or not isinstance(amount, (int, float)):
                raise ValueError(f"{key}: amount must be a finite nonnegative number or null")
            numeric_amount = float(amount)
            if not math.isfinite(numeric_amount) or numeric_amount < 0:
                raise ValueError(f"{key}: amount must be a finite nonnegative number")
        data_points = item.get("dataPoints")
        if data_points is not None and (
            isinstance(data_points, bool) or not isinstance(data_points, int) or data_points < 0
        ):
            raise ValueError(f"{key}: dataPoints must be a nonnegative integer or null")
        derivation = item.get("foodNutrientDerivation")
        derivation_code = derivation.get("code") if isinstance(derivation, dict) else None
        if derivation_code is not None and not isinstance(derivation_code, str):
            raise ValueError(f"{key}: derivation code must be a string or null")
        matches_by_id.setdefault(nutrient_id, []).append({
            "nutrientId": nutrient_id,
            "nutrientName": expected_name,
            "unit": unit,
            "amount": numeric_amount,
            "derivationCode": derivation_code,
            "dataPoints": data_points,
        })
    selected_by_id: dict[int, dict[str, Any]] = {}
    for nutrient_id, matches in matches_by_id.items():
        first = matches[0]
        if any(match != first for match in matches[1:]):
            raise ValueError(f"{key}: conflicting duplicate nutrient ID {nutrient_id}")
        selected_by_id[nutrient_id] = first
    for nutrient_id, _name in expected_candidates:
        match = selected_by_id.get(nutrient_id)
        if match is not None and match["amount"] is not None:
            return match
    return None


def nutrients_with_provenance(food: dict[str, Any]) -> tuple[dict[str, float | None], dict[str, dict[str, Any]]]:
    food_nutrients = food.get("foodNutrients", [])
    if not isinstance(food_nutrients, list):
        raise ValueError("foodNutrients must be an array")
    values: dict[str, float | None] = {}
    provenance: dict[str, dict[str, Any]] = {}
    for key in NUTRIENT_MATCHES:
        source = _source_nutrient(food_nutrients, key)
        if source is None:
            values[key] = None
            continue
        amount = source["amount"]
        values[key] = round(amount * SALT_CONVERSION["multiplier"], 10) if key == "saltG" else amount
        if key == "saltG":
            source["conversion"] = SALT_CONVERSION
        provenance[key] = source
    return values, provenance


def nutrient_amounts(food: dict[str, Any]) -> dict[str, float | None]:
    return nutrients_with_provenance(food)[0]


def validate_allowlist(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or payload.get("format") != "nutrition-estimator-fdc-allowlist" or payload.get("formatVersion") != 1:
        raise ValueError("allowlist format is invalid")
    profiles = payload.get("profiles")
    if not isinstance(profiles, list):
        raise ValueError("allowlist profiles must be an array")
    seen: set[int] = set()
    for profile in profiles:
        if not isinstance(profile, dict):
            raise ValueError("allowlist profile must be an object")
        fdc_id = profile.get("fdcId")
        if type(fdc_id) is not int or fdc_id <= 0 or fdc_id in seen:
            raise ValueError("fdcId must be a unique positive integer")
        seen.add(fdc_id)
        for key in (
            "profileId", "canonicalName", "descriptionIncludes", "replaceProfileId",
            "datasetRelease", "retrievedAt", "reviewedAt",
        ):
            if not isinstance(profile.get(key), str) or not profile[key].strip():
                raise ValueError(f"{fdc_id}: {key} is required")
        archive = profile.get("sourceArchive")
        if archive is not None:
            if not isinstance(archive, dict):
                raise ValueError(f"{fdc_id}: sourceArchive must be an object")
            for archive_key in ("url", "sha256", "retrievedAt", "extractedAt"):
                if not isinstance(archive.get(archive_key), str) or not archive[archive_key].strip():
                    raise ValueError(f"{fdc_id}: sourceArchive.{archive_key} is required")
            archive_hash = archive["sha256"]
            if len(archive_hash) != 64 or any(char not in "0123456789abcdef" for char in archive_hash):
                raise ValueError(f"{fdc_id}: sourceArchive.sha256 must be lowercase SHA-256")
        supplement = profile.get("nullSupplement")
        if supplement is not None:
            if not isinstance(supplement, dict):
                raise ValueError(f"{fdc_id}: nullSupplement must be an object")
            if not isinstance(supplement.get("targetProfileId"), str) or not supplement["targetProfileId"].strip():
                raise ValueError(f"{fdc_id}: nullSupplement.targetProfileId is required")
            keys = supplement.get("nutrientKeys")
            if not isinstance(keys, list) or not keys or any(key not in NUTRIENT_MATCHES for key in keys):
                raise ValueError(f"{fdc_id}: nullSupplement.nutrientKeys must contain known nutrient keys")
    return profiles


def build_profile(entry: dict[str, Any], raw_path: Path, retrieved_at: str) -> dict[str, Any]:
    food = load_json(raw_path)
    if not isinstance(food, dict):
        raise ValueError(f"{entry['fdcId']}: response must be an object")
    if food.get("fdcId") != entry["fdcId"]:
        raise ValueError(f"{entry['fdcId']}: response FDC ID mismatch")
    data_type = food.get("dataType")
    if data_type not in ALLOWED_DATA_TYPES:
        raise ValueError(f"{entry['fdcId']}: dataType must be Foundation or SR Legacy")
    description = str(food.get("description", ""))
    if entry["descriptionIncludes"].casefold() not in description.casefold():
        raise ValueError(f"{entry['fdcId']}: description review token does not match")
    nutrients, nutrient_provenance = nutrients_with_provenance(food)
    source = {
        "provider": "USDA FoodData Central",
        "fdcId": entry["fdcId"],
        "description": description,
        "dataType": data_type,
        "publicationDate": food.get("publicationDate"),
        "datasetRelease": entry["datasetRelease"],
        "sourceUrl": f"https://fdc.nal.usda.gov/fdc-app.html#/food-details/{entry['fdcId']}/nutrients",
        "retrievedAt": retrieved_at,
        "reviewedAt": entry["reviewedAt"],
        "license": "CC0 1.0 / U.S. public domain",
        "rawSha256": sha256(raw_path),
        "transformVersion": TRANSFORM_VERSION,
    }
    if isinstance(entry.get("sourceArchive"), dict):
        source["sourceArchive"] = entry["sourceArchive"]
    profile = {
        "profileId": entry["profileId"],
        "canonicalName": entry["canonicalName"],
        "replaceProfileId": entry["replaceProfileId"],
        "basis": {"amount": 100, "unit": "g"},
        "nutrients": nutrients,
        "nutrientProvenance": nutrient_provenance,
        "source": source,
    }
    if isinstance(entry.get("nullSupplement"), dict):
        profile["nullSupplement"] = entry["nullSupplement"]
    return profile


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allowlist", type=Path, default=Path("data/fdc/ingredient_profile_allowlist.json"))
    parser.add_argument(
        "--raw-dir", type=Path, action="append",
        help="Raw response directory (repeat for multiple locations; defaults to data/fdc/raw)",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument(
        "--bulk-json",
        type=Path,
        help="USDA SR Legacy JSON distribution; extracts only reviewed IDs into raw-dir",
    )
    parser.add_argument(
        "--source-retrieved-at",
        help="Actual source archive acquisition time for --bulk-json when its hash is not in the allowlist",
    )
    args = parser.parse_args()
    raw_dirs = args.raw_dir or [Path("data/fdc/raw")]
    entries = validate_allowlist(load_json(args.allowlist))
    if not entries:
        raise SystemExit("No reviewed FDC profiles. Move reviewed entries from reviewQueue to profiles first.")
    api_key = os.environ.get("FDC_API_KEY")
    if args.fetch and not api_key:
        raise SystemExit("FDC_API_KEY is required with --fetch")
    if args.fetch and args.bulk_json:
        raise SystemExit("--fetch and --bulk-json cannot be used together")
    if args.source_retrieved_at and not args.bulk_json:
        raise SystemExit("--source-retrieved-at can only be used with --bulk-json")
    if args.bulk_json and not args.source_retrieved_at:
        raise SystemExit("--bulk-json requires the source archive's actual --source-retrieved-at timestamp")
    if args.source_retrieved_at:
        try:
            source_retrieved_at = datetime.fromisoformat(args.source_retrieved_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise SystemExit("--source-retrieved-at must be an ISO 8601 timestamp with timezone") from error
        if source_retrieved_at.utcoffset() is None:
            raise SystemExit("--source-retrieved-at must include a timezone")
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    bulk_foods = (
        extract_bulk_foods(args.bulk_json, {entry["fdcId"] for entry in entries})
        if args.bulk_json
        else None
    )
    profiles: list[dict[str, Any]] = []
    for entry in entries:
        raw_path = next(
            (directory / f"{entry['fdcId']}.json" for directory in raw_dirs
             if (directory / f"{entry['fdcId']}.json").exists()),
            raw_dirs[0] / f"{entry['fdcId']}.json",
        )
        entry_for_build = dict(entry)
        if args.fetch:
            fetch_food(entry["fdcId"], api_key or "", raw_path)
            entry_for_build.pop("sourceArchive", None)
            raw_retrieved_at = utc_now()
        elif bulk_foods is not None:
            raw_path = raw_dirs[0] / f"{entry['fdcId']}.json"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_text(
                json.dumps(bulk_foods[entry["fdcId"]], ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            # The --bulk-json argument is the unzipped JSON, so its hash cannot
            # authenticate the allowlisted ZIP. Never copy that archive metadata.
            entry_for_build.pop("sourceArchive", None)
            raw_retrieved_at = args.source_retrieved_at
        else:
            raw_retrieved_at = entry["retrievedAt"]
        if not raw_path.exists():
            raise SystemExit(f"Missing raw FDC response: {raw_path}")
        profiles.append(build_profile(
            entry_for_build,
            raw_path,
            raw_retrieved_at,
        ))
    output = {
        "format": "nutrition-estimator-fdc-profiles",
        "formatVersion": 1,
        "generatedAt": generated_at,
        "transformVersion": TRANSFORM_VERSION,
        "datasetReleases": sorted({entry["datasetRelease"] for entry in entries}),
        "attribution": "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.",
        "profiles": profiles,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
