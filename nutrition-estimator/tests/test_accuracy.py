from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass

from nutrition_estimator import compute_input_hash, estimate
from nutrition_estimator.profiles import IngredientProfile, candidates_for

TARGETS = (
    "fiberG",
    "saturatedFatG",
    "calciumMg",
    "ironMg",
    "vitaminAMcg",
    "vitaminEMg",
    "vitaminB1Mg",
    "vitaminB2Mg",
    "vitaminCMg",
)
MACROS = ("energyKcal", "proteinG", "fatG", "carbohydrateG", "saltG")
FIXED_SEED = 20260725
SAMPLES_PER_CASE = 4_000


@dataclass(frozen=True)
class SyntheticRecipe:
    name: str
    category: str
    reference_mass_g: float
    ingredients: tuple[tuple[str, float], ...]


# 比率は合計1かつ降順で、各MEXTプロファイルのtypical_min/max範囲内に固定する。
RECIPES = (
    SyntheticRecipe(
        "人工クッキー01",
        "cookie",
        60,
        (("小麦粉", 0.45), ("ショートニング", 0.25), ("チョコレート", 0.20), ("ココア", 0.10)),
    ),
    SyntheticRecipe(
        "人工クッキー02",
        "cookie",
        72,
        (("小麦粉", 0.50), ("バター", 0.22), ("チョコレート", 0.16), ("卵", 0.12)),
    ),
    SyntheticRecipe(
        "人工ビスケット03",
        "biscuit",
        54,
        (("小麦粉", 0.48), ("全粉乳", 0.20), ("チョコレート", 0.18), ("ココア", 0.14)),
    ),
    SyntheticRecipe(
        "人工クッキー04",
        "cookie",
        80,
        (("小麦粉", 0.55), ("バター", 0.20), ("卵", 0.15), ("ココア", 0.10)),
    ),
    SyntheticRecipe(
        "人工ビスケット05",
        "biscuit",
        48,
        (("小麦粉", 0.50), ("ショートニング", 0.23), ("卵", 0.17), ("ココア", 0.10)),
    ),
    SyntheticRecipe(
        "人工クッキー06",
        "cookie",
        66,
        (("小麦粉", 0.52), ("チョコレート", 0.23), ("卵", 0.15), ("ココア", 0.10)),
    ),
    SyntheticRecipe(
        "人工ビスケット07",
        "biscuit",
        58,
        (("小麦粉", 0.51), ("バター", 0.19), ("チョコレート", 0.17), ("ココア", 0.13)),
    ),
    SyntheticRecipe(
        "人工クッキー08",
        "cookie",
        75,
        (("小麦粉", 0.49), ("ショートニング", 0.21), ("チョコレート", 0.18), ("卵", 0.12)),
    ),
    SyntheticRecipe(
        "人工ビスケット09",
        "biscuit",
        45,
        (("小麦粉", 0.46), ("バター", 0.22), ("卵", 0.17), ("全粉乳", 0.15)),
    ),
    SyntheticRecipe(
        "人工クッキー10",
        "cookie",
        90,
        (("小麦粉", 0.47), ("チョコレート", 0.20), ("卵", 0.18), ("ココア", 0.15)),
    ),
    SyntheticRecipe(
        "人工ビスケット11",
        "biscuit",
        52,
        (("小麦粉", 0.50), ("砂糖", 0.20), ("バター", 0.18), ("卵", 0.12)),
    ),
    SyntheticRecipe(
        "人工クッキー12",
        "cookie",
        64,
        (("小麦粉", 0.50), ("バター", 0.20), ("脱脂粉乳", 0.17), ("ココア", 0.13)),
    ),
    SyntheticRecipe(
        "人工ビスケット13",
        "biscuit",
        70,
        (("小麦粉", 0.51), ("砂糖", 0.24), ("バター", 0.15), ("卵", 0.09), ("食塩", 0.01)),
    ),
    SyntheticRecipe(
        "人工クッキー14",
        "cookie",
        56,
        (("小麦粉", 0.50), ("砂糖", 0.23), ("ショートニング", 0.17), ("ココア", 0.10)),
    ),
    SyntheticRecipe(
        "人工ビスケット15",
        "biscuit",
        68,
        (("小麦粉", 0.49), ("バター", 0.22), ("脱脂粉乳", 0.16), ("ココア", 0.13)),
    ),
)


def _profile(name: str) -> IngredientProfile:
    profiles = candidates_for(name)
    assert len(profiles) == 1, f"人工ベンチマークでは一意なプロファイルだけを使う: {name}"
    return profiles[0]


def _validate_recipe(recipe: SyntheticRecipe) -> None:
    ratios = [ratio for _, ratio in recipe.ingredients]
    assert math.isclose(sum(ratios), 1.0, abs_tol=1e-12)
    assert ratios == sorted(ratios, reverse=True)
    for name, ratio in recipe.ingredients:
        profile = _profile(name)
        assert profile.typical_min_ratio <= ratio <= profile.typical_max_ratio


def _true_nutrients(recipe: SyntheticRecipe) -> dict[str, float | None]:
    result: dict[str, float | None] = {}
    for nutrient in (*MACROS, *TARGETS):
        values = [
            (_profile(name).nutrients_per_100g.get(nutrient), ratio)
            for name, ratio in recipe.ingredients
        ]
        if any(value is None for value, _ in values):
            result[nutrient] = None
            continue
        result[nutrient] = sum(
            value * ratio * recipe.reference_mass_g / 100.0
            for value, ratio in values
            if value is not None
        )
    return result


def _label_macros(truth: dict[str, float | None]) -> dict[str, float | None]:
    # 国内の商品ラベルを模し、熱量は整数、主要栄養素は0.1g、食塩相当量は0.01gへ丸める。
    def known(key: str) -> float:
        value = truth[key]
        assert value is not None
        return value

    return {
        "energyKcal": round(known("energyKcal")),
        "proteinG": round(known("proteinG"), 1),
        "fatG": round(known("fatG"), 1),
        "carbohydrateG": round(known("carbohydrateG"), 1),
        "saltG": round(known("saltG"), 2),
    }


def _request(recipe: SyntheticRecipe, truth: dict[str, float | None]) -> dict[str, object]:
    known = _label_macros(truth)
    known.update({target: None for target in TARGETS})
    payload: dict[str, object] = {
        "requestId": f"accuracy_{recipe.name}",
        "foodId": f"food_{recipe.name}",
        "barcode": None,
        "name": recipe.name,
        "maker": "accuracy_fixture",
        "estimatorCategoryId": recipe.category,
        "baseAmount": 1,
        "baseUnit": "袋",
        "referenceMassG": recipe.reference_mass_g,
        "referenceMassSource": "人工精度ベンチマークの既知重量",
        "knownNutrients": known,
        "missingNutrients": list(TARGETS),
        "ingredientsText": "、".join(name for name, _ in recipe.ingredients),
        "ingredientsSource": {"provider": "synthetic_benchmark", "verified": True},
        "requestedAt": "2026-07-26T00:00:00.000Z",
    }
    payload["inputHash"] = compute_input_hash(payload)
    return payload


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def test_synthetic_accuracy_benchmark() -> None:
    absolute_errors: dict[str, list[float]] = defaultdict(list)
    percentage_errors: dict[str, list[float]] = defaultdict(list)
    coverage_hits: dict[str, int] = defaultdict(int)
    coverage_totals: dict[str, int] = defaultdict(int)
    expected_nulls = 0
    matched_nulls = 0
    missing_known_estimates = 0
    unexpected_null_estimates = 0

    for recipe in RECIPES:
        _validate_recipe(recipe)
        truth = _true_nutrients(recipe)
        result = estimate(
            _request(recipe, truth),
            seed=FIXED_SEED,
            samples_per_combination=SAMPLES_PER_CASE,
        )

        expected_status = (
            "partial" if any(truth[target] is None for target in TARGETS) else "completed"
        )
        assert result["status"] == expected_status, (recipe.name, result)

        for nutrient in TARGETS:
            true_value = truth[nutrient]
            estimate_item = result["estimates"].get(nutrient)
            if true_value is None:
                expected_nulls += 1
                if estimate_item is None:
                    matched_nulls += 1
                else:
                    unexpected_null_estimates += 1
                continue
            if estimate_item is None:
                missing_known_estimates += 1
                continue

            estimated_value = estimate_item["value"]
            error = abs(estimated_value - true_value)
            absolute_errors[nutrient].append(error)
            if true_value != 0:
                percentage_errors[nutrient].append(error / abs(true_value) * 100.0)
            interval = estimate_item["range"]
            coverage_totals[nutrient] += 1
            if interval["min"] <= true_value <= interval["max"]:
                coverage_hits[nutrient] += 1
            assert estimate_item["sourceFoodIds"]

    all_percentage_errors = [
        error for nutrient_errors in percentage_errors.values() for error in nutrient_errors
    ]
    total_coverage_hits = sum(coverage_hits.values())
    total_coverage = sum(coverage_totals.values())
    metrics = {
        "cases": len(RECIPES),
        "fixedSeed": FIXED_SEED,
        "samplesPerCase": SAMPLES_PER_CASE,
        "perNutrient": {
            nutrient: {
                "mae": _mean(absolute_errors[nutrient]),
                "mapeExcludingZeroTruth": (
                    _mean(percentage_errors[nutrient])
                    if percentage_errors[nutrient]
                    else None
                ),
                "rangeCoverage": coverage_hits[nutrient] / coverage_totals[nutrient],
                "evaluated": len(absolute_errors[nutrient]),
            }
            for nutrient in TARGETS
        },
        "overallMapeExcludingZeroTruth": _mean(all_percentage_errors),
        "overallRangeCoverage": total_coverage_hits / total_coverage,
        "nullConsistency": matched_nulls / expected_nulls,
        "expectedNulls": expected_nulls,
        "missingKnownEstimates": missing_known_estimates,
        "unexpectedNullEstimates": unexpected_null_estimates,
    }
    print("\nsynthetic_accuracy_metrics=" + json.dumps(metrics, ensure_ascii=False, sort_keys=True))

    # 現行値（MAPE 5.27%、包含率92.25%）から十分な余裕を持たせた回帰基準。
    assert len(RECIPES) >= 10
    assert missing_known_estimates == 0
    assert unexpected_null_estimates == 0
    assert metrics["nullConsistency"] == 1.0
    assert metrics["overallMapeExcludingZeroTruth"] < 15.0
    assert metrics["overallRangeCoverage"] >= 0.80
    assert all(math.isfinite(item["mae"]) for item in metrics["perNutrient"].values())
