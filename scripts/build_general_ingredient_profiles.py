#!/usr/bin/env python3
"""Build the app's broad MEXT-backed ingredient profile catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

NUTRIENT_KEYS = {
    "energyKcal", "proteinG", "fatG", "carbohydrateG", "fiberG", "saltG",
    "calciumMg", "ironMg", "vitaminAMcg", "vitaminEMg", "vitaminB1Mg",
    "vitaminB2Mg", "vitaminCMg", "saturatedFatG",
}
ESTIMATOR_GENRE_IDS = {
    "baked_sweets", "bread", "cake_pastry", "chocolate", "dairy",
    "drink_jelly_pudding", "fried_food", "frozen_dessert",
    "noodle_flour_dish", "other_unknown", "prepared_meal",
    "sauce_spread", "snack_rice_cracker", "sugar_confectionery",
}


class CatalogError(ValueError):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise CatalogError(f"{path}: JSON root must be an object")
    return value


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(f"{field} must be a non-empty string")
    return value.strip()


def derive_nutrients(
    raw: dict[str, Any],
    food: dict[str, Any],
    foods: dict[str, dict[str, Any]],
    field: str,
) -> tuple[dict[str, float | None], list[str], str | None]:
    nutrients = food.get("nutrients")
    if not isinstance(nutrients, dict) or set(nutrients) != NUTRIENT_KEYS:
        raise CatalogError(f"{food.get('id')}: nutrient keys are incomplete")
    derivation = raw.get("derivation")
    if derivation is None:
        return nutrients, [food["id"]], None
    if not isinstance(derivation, dict):
        raise CatalogError(f"{field}.derivation is invalid")
    if derivation.get("type") == "scaleNutrients":
        factor = derivation.get("factor")
        if (
            not isinstance(factor, (int, float))
            or isinstance(factor, bool)
            or not 0 < factor <= 2
        ):
            raise CatalogError(f"{field}.derivation.factor must be between 0 and 2")
        scaled = {
            key: None if value is None else round(value * factor, 6)
            for key, value in nutrients.items()
        }
        warning = (
            f"MEXT参照食品の成分値を固形分濃度の候補倍率{factor:.2f}倍で"
            "スケーリングしています。"
        )
        return scaled, [food["id"]], warning
    if derivation.get("type") != "subtractBaseFraction":
        raise CatalogError(f"{field}.derivation is invalid")
    base_food_id = require_text(
        derivation.get("baseFoodId"),
        f"{field}.derivation.baseFoodId",
    )
    base_food = foods.get(base_food_id)
    if base_food is None:
        raise CatalogError(f"{field}.derivation: unknown MEXT food ID {base_food_id}")
    base_nutrients = base_food.get("nutrients")
    if not isinstance(base_nutrients, dict) or set(base_nutrients) != NUTRIENT_KEYS:
        raise CatalogError(f"{base_food_id}: nutrient keys are incomplete")
    base_fraction = derivation.get("baseMassFraction")
    if (
        not isinstance(base_fraction, (int, float))
        or isinstance(base_fraction, bool)
        or not 0 < base_fraction < 1
    ):
        raise CatalogError(f"{field}.derivation.baseMassFraction must be between 0 and 1")
    result: dict[str, float | None] = {}
    for key in NUTRIENT_KEYS:
        whole_value = nutrients[key]
        base_value = base_nutrients[key]
        if whole_value is None or base_value is None:
            result[key] = None
            continue
        value = (whole_value - base_fraction * base_value) / (1 - base_fraction)
        if value < -1e-9:
            raise CatalogError(
                f"{field}.derivation produces a negative {key}: {value}"
            )
        result[key] = round(max(0, value), 6)
    warning = (
        f"MEXTの添付調味料込み食品から添付調味料なし食品を差し引き、"
        f"麺重量比{base_fraction:.0%}のスープ・かやく集合として導出しています。"
    )
    return result, [food["id"], base_food_id], warning


def build_catalog(
    sources_path: Path,
    mext_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    sources = load_object(sources_path)
    if (
        sources.get("format") != "nutrition-estimator-general-ingredient-sources"
        or sources.get("formatVersion") != 1
        or not isinstance(sources.get("entries"), list)
    ):
        raise CatalogError("general ingredient source format is invalid")
    mext = load_object(mext_path)
    if not isinstance(mext.get("foods"), list) or not isinstance(mext.get("metadata"), dict):
        raise CatalogError("MEXT food data format is invalid")
    foods = {
        food.get("id"): food
        for food in mext["foods"]
        if isinstance(food, dict) and isinstance(food.get("id"), str)
    }

    profiles: list[dict[str, Any]] = []
    seen_profile_ids: set[str] = set()
    alias_counts = Counter()
    category_counts = Counter()
    for index, raw in enumerate(sources["entries"]):
        if not isinstance(raw, dict):
            raise CatalogError(f"entries[{index}] must be an object")
        source_food_id = require_text(raw.get("sourceFoodId"), f"entries[{index}].sourceFoodId")
        food = foods.get(source_food_id)
        if food is None:
            raise CatalogError(f"entries[{index}]: unknown MEXT food ID {source_food_id}")
        profile_id = require_text(
            raw.get("profileId", f"general_{source_food_id}"),
            f"entries[{index}].profileId",
        )
        if profile_id in seen_profile_ids:
            raise CatalogError(f"duplicate profile ID: {profile_id}")
        seen_profile_ids.add(profile_id)
        aliases = raw.get("aliases")
        if (
            not isinstance(aliases, list)
            or not aliases
            or any(not isinstance(alias, str) or not alias.strip() for alias in aliases)
        ):
            raise CatalogError(f"entries[{index}].aliases must contain non-empty strings")
        normalized_aliases = list(dict.fromkeys(alias.strip() for alias in aliases))
        nutrients, source_food_ids, derivation_warning = derive_nutrients(
            raw,
            food,
            foods,
            f"entries[{index}]",
        )
        prior_probability = raw.get("priorProbability", 1)
        if (
            not isinstance(prior_probability, (int, float))
            or isinstance(prior_probability, bool)
            or prior_probability <= 0
        ):
            raise CatalogError(f"entries[{index}].priorProbability must be positive")
        prior_signals = raw.get("priorSignals", [])
        if not isinstance(prior_signals, list):
            raise CatalogError(f"entries[{index}].priorSignals must be an array")
        for signal_index, signal in enumerate(prior_signals):
            if (
                not isinstance(signal, dict)
                or not isinstance(signal.get("terms"), list)
                or not signal["terms"]
                or any(not isinstance(term, str) or not term.strip() for term in signal["terms"])
                or not isinstance(signal.get("multiplier"), (int, float))
                or isinstance(signal.get("multiplier"), bool)
                or signal["multiplier"] <= 0
            ):
                raise CatalogError(
                    f"entries[{index}].priorSignals[{signal_index}] is invalid"
                )
        warning = raw.get("derivationWarning")
        if warning is not None:
            warning = require_text(warning, f"entries[{index}].derivationWarning")
        warnings = [
            item for item in (derivation_warning, warning) if item is not None
        ]
        required_genre_ids = raw.get("requiredGenreIds", [])
        if (
            not isinstance(required_genre_ids, list)
            or any(
                not isinstance(genre_id, str)
                or genre_id not in ESTIMATOR_GENRE_IDS
                for genre_id in required_genre_ids
            )
        ):
            raise CatalogError(f"entries[{index}].requiredGenreIds is invalid")
        category = require_text(raw.get("category"), f"entries[{index}].category")
        category_counts[category] += 1
        alias_counts.update(normalized_aliases)
        profiles.append({
            "profileId": profile_id,
            "canonicalName": require_text(
                raw.get("canonicalName", food.get("name")),
                f"entries[{index}].canonicalName",
            ),
            "aliases": normalized_aliases,
            "category": category,
            "nutrients": nutrients,
            "sourceFoodIds": source_food_ids,
            "priorProbability": prior_probability,
            "ambiguous": bool(raw.get("ambiguous", False) or warnings),
            **({"derivationWarnings": warnings} if warnings else {}),
            **({"priorSignals": prior_signals} if prior_signals else {}),
            **({"requiredGenreIds": required_genre_ids} if required_genre_ids else {}),
        })

    profiles.sort(key=lambda item: item["profileId"])
    artifact = {
        "format": "nutrition-estimator-general-ingredient-profiles",
        "formatVersion": 1,
        "source": {
            "name": mext["metadata"].get("source"),
            "version": mext["metadata"].get("sourceVersion"),
            "url": mext["metadata"].get("sourceUrl"),
            "sourceDataSha256": sha256(mext_path),
            "profileSourcesSha256": sha256(sources_path),
        },
        "profiles": profiles,
    }
    report = {
        "format": "nutrition-estimator-general-ingredient-profile-report",
        "formatVersion": 1,
        "profileCount": len(profiles),
        "aliasCount": sum(len(profile["aliases"]) for profile in profiles),
        "ambiguousAliasCount": sum(1 for count in alias_counts.values() if count > 1),
        "categoryCounts": dict(sorted(category_counts.items())),
    }
    return artifact, report


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--mext", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    artifact, report = build_catalog(args.sources, args.mext)
    write_json(args.output, artifact)
    if args.report:
        write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
