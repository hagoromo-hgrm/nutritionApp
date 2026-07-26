from __future__ import annotations

import copy

from nutrition_estimator import compute_input_hash, estimate


def _rehash(payload: dict[str, object]) -> None:
    payload["inputHash"] = compute_input_hash(payload)


def test_known_fixture_returns_both_initial_nutrients(cookie_request: dict[str, object]) -> None:
    result = estimate(cookie_request, seed=42, samples_per_combination=1200)

    assert result["status"] == "completed"
    assert result["inputHash"] == cookie_request["inputHash"]
    assert result["basis"]["baseUnit"] == "袋"
    for nutrient in ("fiberG", "saturatedFatG"):
        item = result["estimates"][nutrient]
        assert item["value"] >= 0
        assert item["range"]["min"] <= item["value"] <= item["range"]["max"]
        assert item["confidence"] in {"high", "medium", "low"}
        assert item["warnings"] is not None
    assert result["optimization"]["converged"] is True
    assert result["optimization"]["seed"] == 42
    assert "mext_01015" in result["candidateTrace"]["sourceFoodIds"]
    assert "日本食品標準成分表" in result["candidateTrace"]["sourceVersion"]
    assert all(item["sourceFoodIds"] for item in result["estimates"].values())


def test_same_input_model_seed_is_fully_reproducible(cookie_request: dict[str, object]) -> None:
    first = estimate(cookie_request, seed=17, samples_per_combination=300)
    second = estimate(copy.deepcopy(cookie_request), seed=17, samples_per_combination=300)

    assert first == second


def test_missing_ingredients_returns_japanese_cause_and_action(cookie_request: dict[str, object]) -> None:
    cookie_request["ingredientsText"] = None
    _rehash(cookie_request)

    result = estimate(cookie_request)

    assert result["status"] == "failed"
    assert result["error"]["code"] == "INGREDIENTS_UNAVAILABLE"
    assert "原材料" in result["error"]["message"]
    assert "入力" in result["error"]["nextAction"]


def test_missing_reference_mass_does_not_guess_units(cookie_request: dict[str, object]) -> None:
    cookie_request["referenceMassG"] = None
    cookie_request["referenceMassSource"] = None
    _rehash(cookie_request)

    result = estimate(cookie_request)

    assert result["status"] == "failed"
    assert result["error"]["code"] == "REFERENCE_MASS_UNAVAILABLE"
    assert "質量" in result["error"]["message"]
    assert "g重量" in result["error"]["nextAction"]


def test_unverified_ingredient_source_is_not_used(cookie_request: dict[str, object]) -> None:
    cookie_request["ingredientsSource"] = {"provider": "external", "verified": False}
    _rehash(cookie_request)

    result = estimate(cookie_request)

    assert result["status"] == "failed"
    assert result["error"]["code"] == "INGREDIENT_SOURCE_UNVERIFIED"


def test_numeric_zero_is_known_and_not_overwritten(cookie_request: dict[str, object]) -> None:
    cookie_request["knownNutrients"]["fiberG"] = 0
    cookie_request["missingNutrients"] = ["fiberG"]
    _rehash(cookie_request)

    result = estimate(cookie_request)

    assert result["status"] == "failed"
    assert result["error"]["code"] == "TARGET_ALREADY_KNOWN"


def test_null_is_missing(cookie_request: dict[str, object]) -> None:
    cookie_request["missingNutrients"] = ["fiberG"]
    _rehash(cookie_request)

    result = estimate(cookie_request, seed=9, samples_per_combination=400)

    assert result["status"] == "completed"
    assert set(result["estimates"]) == {"fiberG"}


def test_modified_input_hash_is_rejected(cookie_request: dict[str, object]) -> None:
    cookie_request["name"] = "変更後"

    result = estimate(cookie_request)

    assert result["status"] == "failed"
    assert result["error"]["code"] == "INPUT_HASH_MISMATCH"


def test_zero_saturated_fat_derivation_is_explicit(cookie_request: dict[str, object]) -> None:
    result = estimate(cookie_request, seed=42, samples_per_combination=800)

    warnings = result["estimates"]["saturatedFatG"]["warnings"]
    assert any("脂質が0g" in warning for warning in warnings)
