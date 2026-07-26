#!/usr/bin/env python3
"""Build local-only estimator priors from an Open Food Facts JSONL export."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Iterator, TextIO

TRANSFORM_VERSION = "off-estimator-prior-0.1.0"
GENRE_CATEGORY_TERMS: dict[str, tuple[str, ...]] = {
    "chocolate": ("chocolates", "chocolate-products", "cocoa-and-chocolate-powders"),
    "baked_sweets": ("biscuits", "cookies", "shortbread", "crackers"),
    "cake_pastry": ("cakes", "pastries", "doughnuts", "donuts"),
    "bread": ("breads", "bread-products", "sweet-breads", "brioches"),
    "snack_rice_cracker": ("snacks", "chips", "crisps", "rice-crackers"),
    "frozen_dessert": ("ice-creams", "frozen-desserts", "sorbets"),
    "dairy": ("dairies", "milks", "cheeses", "yogurts", "fermented-milk-products"),
    "sugar_confectionery": ("candies", "gummies", "confectioneries", "traditional-sweets"),
    "drink_jelly_pudding": ("beverages", "drinks", "jellies", "puddings", "dessert-creams"),
    "fried_food": ("fried-foods", "fritters", "tempura"),
    "noodle_flour_dish": ("noodles", "pastas", "pizzas", "pancakes"),
    "prepared_meal": ("meals", "prepared-meals", "soups", "sandwiches"),
    "sauce_spread": ("sauces", "spreads", "condiments", "dressings"),
}
TOKEN_RE = re.compile(r"[\w\u3040-\u30ff\u3400-\u9fff]{2,}", re.UNICODE)


def open_text(path: Path) -> TextIO:
    if path.suffix.lower() == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("r", encoding="utf-8")


def iter_products(path: Path) -> Iterator[dict[str, Any]]:
    with open_text(path) as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: each line must be an object")
            yield value


def load_profile_map(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(payload, dict)
        or payload.get("format") != "nutrition-estimator-off-ingredient-profile-map"
        or payload.get("formatVersion") != 1
        or not isinstance(payload.get("ingredientTags"), dict)
    ):
        raise ValueError("OFF ingredient profile map is invalid")
    result: dict[str, str] = {}
    for tag, profile_id in payload["ingredientTags"].items():
        if not isinstance(tag, str) or not tag or not isinstance(profile_id, str) or not profile_id:
            raise ValueError("OFF ingredient profile map contains an invalid entry")
        result[tag.casefold()] = profile_id
    return result


def string_list(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def infer_genre(categories: list[str]) -> str:
    normalized = " ".join(categories).casefold()
    for genre_id, terms in GENRE_CATEGORY_TERMS.items():
        if any(term in normalized for term in terms):
            return genre_id
    return "other_unknown"


def ingredient_tags(product: dict[str, Any]) -> list[str]:
    structured = product.get("ingredients")
    if isinstance(structured, list):
        tags = [
            item.get("id")
            for item in structured
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
        if tags:
            return tags
    return string_list(product.get("ingredients_tags"))


def position_band(index: int, total: int) -> str:
    fraction = index / max(total, 1)
    if fraction < 1 / 3:
        return "first"
    if fraction < 2 / 3:
        return "middle"
    return "last"


def product_name(product: dict[str, Any]) -> str:
    for key in ("product_name_ja", "product_name"):
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def name_tokens(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return set(TOKEN_RE.findall(normalized))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def smoothed_multipliers(
    genre_counts: Counter[str],
    global_counts: Counter[str],
    prior_strength: float,
) -> dict[str, float]:
    global_total = sum(global_counts.values())
    genre_total = sum(genre_counts.values())
    if global_total == 0 or genre_total == 0:
        return {}
    profile_count = max(len(global_counts), 1)
    result: dict[str, float] = {}
    for profile_id in sorted(global_counts):
        global_probability = (global_counts[profile_id] + 1) / (global_total + profile_count)
        conditional = (
            genre_counts[profile_id] + prior_strength * global_probability
        ) / (genre_total + prior_strength)
        result[profile_id] = round(min(4.0, max(0.25, conditional / global_probability)), 6)
    return result


def top_counter(counter: Counter[Any], limit: int, min_count: int = 1) -> list[dict[str, Any]]:
    return [
        {"key": list(key) if isinstance(key, tuple) else key, "count": count}
        for key, count in sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))
        if count >= min_count
    ][:limit]


def build_priors(
    input_path: Path,
    profile_map: dict[str, str],
    *,
    country_tag: str,
    min_completeness: float,
    max_unknown_ingredients: int,
    prior_strength: float,
    top_limit: int,
    min_token_count: int = 5,
) -> dict[str, Any]:
    stats = Counter()
    genre_products = Counter()
    global_profiles: Counter[str] = Counter()
    genre_profiles: dict[str, Counter[str]] = defaultdict(Counter)
    genre_positions: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
    genre_pairs: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
    token_profiles: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)

    for product in iter_products(input_path):
        stats["inputProducts"] += 1
        countries = [item.casefold() for item in string_list(product.get("countries_tags"))]
        if country_tag and country_tag.casefold() not in countries:
            stats["excludedCountry"] += 1
            continue
        completeness = product.get("completeness")
        if isinstance(completeness, (int, float)) and math.isfinite(completeness) and completeness < min_completeness:
            stats["excludedCompleteness"] += 1
            continue
        if string_list(product.get("data_quality_errors_tags")):
            stats["excludedQualityErrors"] += 1
            continue
        unknown_count = product.get("unknown_ingredients_n")
        if isinstance(unknown_count, (int, float)) and unknown_count > max_unknown_ingredients:
            stats["excludedUnknownIngredients"] += 1
            continue
        tags = ingredient_tags(product)
        if not tags:
            stats["excludedNoIngredients"] += 1
            continue
        mapped = [
            (index, profile_map[tag.casefold()])
            for index, tag in enumerate(tags)
            if tag.casefold() in profile_map
        ]
        if not mapped:
            stats["excludedNoMappedIngredients"] += 1
            continue

        genre_id = infer_genre(string_list(product.get("categories_tags")))
        stats["acceptedProducts"] += 1
        genre_products[genre_id] += 1
        unique_profiles = sorted({profile_id for _, profile_id in mapped})
        global_profiles.update(unique_profiles)
        genre_profiles[genre_id].update(unique_profiles)
        for index, profile_id in mapped:
            genre_positions[genre_id][(position_band(index, len(tags)), profile_id)] += 1
        genre_pairs[genre_id].update(combinations(unique_profiles, 2))
        for token in name_tokens(product_name(product)):
            token_profiles[genre_id].update((token, profile_id) for profile_id in unique_profiles)

    return {
        "statistics": dict(sorted(stats.items())),
        "genreProductCounts": dict(sorted(genre_products.items())),
        "globalProfileCounts": dict(sorted(global_profiles.items())),
        "genres": {
            genre_id: {
                "productCount": genre_products[genre_id],
                "profileCounts": dict(sorted(genre_profiles[genre_id].items())),
                "profileMultipliers": smoothed_multipliers(
                    genre_profiles[genre_id], global_profiles, prior_strength,
                ),
                "positionCounts": top_counter(genre_positions[genre_id], top_limit),
                "cooccurrenceCounts": top_counter(genre_pairs[genre_id], top_limit),
                "nameTokenProfileCounts": top_counter(token_profiles[genre_id], top_limit, min_token_count),
            }
            for genre_id in sorted(genre_products)
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--profile-map", type=Path, default=Path("data/openfoodfacts/ingredient_profile_map.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset-release", required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--country-tag", default="en:japan")
    parser.add_argument("--min-completeness", type=float, default=0.5)
    parser.add_argument("--max-unknown-ingredients", type=int, default=3)
    parser.add_argument("--prior-strength", type=float, default=20.0)
    parser.add_argument("--top-limit", type=int, default=200)
    parser.add_argument("--min-token-count", type=int, default=5)
    args = parser.parse_args()
    if not 0 <= args.min_completeness <= 1:
        parser.error("--min-completeness must be between 0 and 1")
    if (
        args.max_unknown_ingredients < 0
        or args.prior_strength <= 0
        or args.top_limit <= 0
        or args.min_token_count <= 0
    ):
        parser.error("numeric options must be positive")

    payload = {
        "format": "nutrition-estimator-off-priors",
        "formatVersion": 1,
        "transformVersion": TRANSFORM_VERSION,
        "source": {
            "provider": "Open Food Facts",
            "datasetRelease": args.dataset_release,
            "retrievedAt": args.retrieved_at,
            "inputSha256": file_sha256(args.input),
            "license": "Open Database License (ODbL) 1.0 / Database Contents License",
            "distributionStatus": "local_validation_only",
        },
        "filters": {
            "countryTag": args.country_tag,
            "minimumCompleteness": args.min_completeness,
            "maximumUnknownIngredients": args.max_unknown_ingredients,
            "excludeProductsWithQualityErrors": True,
            "priorStrength": args.prior_strength,
            "minimumNameTokenCount": args.min_token_count,
        },
        **build_priors(
            args.input,
            load_profile_map(args.profile_map),
            country_tag=args.country_tag,
            min_completeness=args.min_completeness,
            max_unknown_ingredients=args.max_unknown_ingredients,
            prior_strength=args.prior_strength,
            top_limit=args.top_limit,
            min_token_count=args.min_token_count,
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
