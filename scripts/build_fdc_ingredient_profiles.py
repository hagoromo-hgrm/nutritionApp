#!/usr/bin/env python3
"""Build reviewed FDC ingredient profiles without exposing API keys to the PWA."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRANSFORM_VERSION = "fdc-ingredient-profile-0.1.0"
ALLOWED_DATA_TYPES = {"Foundation", "SR Legacy"}
NUTRIENT_MATCHES: dict[str, tuple[tuple[str, ...], str]] = {
    "energyKcal": (("Energy", "Energy (Atwater Specific Factors)", "Energy (Atwater General Factors)"), "kcal"),
    "proteinG": (("Protein",), "g"),
    "fatG": (("Total lipid (fat)",), "g"),
    "carbohydrateG": (("Carbohydrate, by difference",), "g"),
    "fiberG": (("Fiber, total dietary",), "g"),
    "calciumMg": (("Calcium, Ca",), "mg"),
    "ironMg": (("Iron, Fe",), "mg"),
    "vitaminAMcg": (("Vitamin A, RAE",), "µg"),
    "vitaminEMg": (("Vitamin E (alpha-tocopherol)",), "mg"),
    "vitaminB1Mg": (("Thiamin",), "mg"),
    "vitaminB2Mg": (("Riboflavin",), "mg"),
    "vitaminCMg": (("Vitamin C, total ascorbic acid",), "mg"),
    "saturatedFatG": (("Fatty acids, total saturated",), "g"),
    "saltG": ((), "g"),
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch_food(fdc_id: int, api_key: str, raw_path: Path) -> None:
    query = urllib.parse.urlencode({"api_key": api_key})
    request = urllib.request.Request(
        f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}?{query}",
        headers={"Accept": "application/json", "User-Agent": "nutrition-pwa-fdc-builder/0.1"},
    )
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw_path.write_bytes(response.read())


def nutrient_amounts(food: dict[str, Any]) -> dict[str, float | None]:
    values: list[tuple[str, float, str]] = []
    for item in food.get("foodNutrients", []):
        if not isinstance(item, dict):
            continue
        nutrient = item.get("nutrient")
        if not isinstance(nutrient, dict):
            continue
        name = nutrient.get("name")
        unit = nutrient.get("unitName")
        amount = item.get("amount")
        if isinstance(name, str) and isinstance(unit, str) and isinstance(amount, (int, float)):
            values.append((name, float(amount), unit))
    result: dict[str, float | None] = {}
    for key, (names, expected_unit) in NUTRIENT_MATCHES.items():
        if key == "saltG":
            sodium = next(
                ((amount, unit) for name, amount, unit in values if name == "Sodium, Na" and unit.lower() == "mg"),
                None,
            )
            result[key] = sodium[0] * 2.54 / 1000 if sodium else None
            continue
        match: tuple[float, str] | None = None
        for expected_name in names:
            match = next(
                (
                    (amount, unit)
                    for name, amount, unit in values
                    if name == expected_name
                    and unit.replace("UG", "µg").replace("ug", "µg").lower() == expected_unit.lower()
                ),
                None,
            )
            if match:
                break
        if not match:
            result[key] = None
            continue
        amount, unit = match
        normalized_unit = unit.replace("UG", "µg").replace("ug", "µg")
        if normalized_unit.lower() != expected_unit.lower():
            raise ValueError(f"{key}: expected {expected_unit}, got {unit}")
        result[key] = amount
    return result


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
        if not isinstance(fdc_id, int) or fdc_id <= 0 or fdc_id in seen:
            raise ValueError("fdcId must be a unique positive integer")
        seen.add(fdc_id)
        for key in (
            "profileId", "canonicalName", "descriptionIncludes", "replaceProfileId",
            "datasetRelease", "retrievedAt", "reviewedAt",
        ):
            if not isinstance(profile.get(key), str) or not profile[key].strip():
                raise ValueError(f"{fdc_id}: {key} is required")
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
    return {
        "profileId": entry["profileId"],
        "canonicalName": entry["canonicalName"],
        "replaceProfileId": entry["replaceProfileId"],
        "basis": {"amount": 100, "unit": "g"},
        "nutrients": nutrient_amounts(food),
        "source": {
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
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allowlist", type=Path, default=Path("data/fdc/ingredient_profile_allowlist.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("data/fdc/raw"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    entries = validate_allowlist(load_json(args.allowlist))
    if not entries:
        raise SystemExit("No reviewed FDC profiles. Move reviewed entries from reviewQueue to profiles first.")
    api_key = os.environ.get("FDC_API_KEY")
    if args.fetch and not api_key:
        raise SystemExit("FDC_API_KEY is required with --fetch")
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    profiles: list[dict[str, Any]] = []
    for entry in entries:
        raw_path = args.raw_dir / f"{entry['fdcId']}.json"
        if args.fetch:
            fetch_food(entry["fdcId"], api_key or "", raw_path)
        if not raw_path.exists():
            raise SystemExit(f"Missing raw FDC response: {raw_path}")
        profiles.append(build_profile(entry, raw_path, generated_at if args.fetch else entry["retrievedAt"]))
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
