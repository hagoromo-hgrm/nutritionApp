from __future__ import annotations

import json
import math
from pathlib import Path

from nutrition_estimator import compute_input_hash, estimate
from nutrition_estimator.models import SUPPORTED_NUTRIENTS
from nutrition_estimator.normalize import normalize_ingredients
from nutrition_estimator.optimizer import optimize
from nutrition_estimator.profiles import candidates_for

CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "estimation-contract"
    / "core-invariants.json"
)


def _contract() -> dict[str, object]:
    with CONTRACT_PATH.open(encoding="utf-8") as source:
        return json.load(source)


def _request(contract: dict[str, object]) -> dict[str, object]:
    scenario = contract["scenario"]
    assert isinstance(scenario, dict)
    payload: dict[str, object] = {
        "requestId": "shared-contract-python",
        "foodId": "shared-contract-food",
        "barcode": None,
        "name": scenario["name"],
        "maker": "shared_contract",
        "estimatorCategoryId": scenario["categoryId"],
        "baseAmount": 1,
        "baseUnit": "袋",
        "referenceMassG": scenario["referenceMassG"],
        "referenceMassSource": "共有推計契約fixture",
        "knownNutrients": {
            **scenario["knownNutrients"],
            **{nutrient: None for nutrient in contract["supportedNutrients"]},
        },
        "missingNutrients": contract["supportedNutrients"],
        "ingredientsText": scenario["ingredientsText"],
        "ingredientsSource": {"provider": "shared_contract", "verified": True},
        "requestedAt": "2026-07-30T00:00:00.000Z",
    }
    payload["inputHash"] = compute_input_hash(payload)
    return payload


def test_shared_contract_roles_nutrients_determinism_ratios_and_bounds() -> None:
    contract = _contract()
    roles = contract["roles"]
    scenario = contract["scenario"]
    invariants = contract["invariants"]
    assert isinstance(roles, dict)
    assert isinstance(scenario, dict)
    assert isinstance(invariants, dict)
    assert roles["validation"] == "python-local"
    assert set(contract["supportedNutrients"]) == SUPPORTED_NUTRIENTS

    normalized = normalize_ingredients(str(scenario["ingredientsText"]))
    assert [item.normalizedName for item in normalized] == scenario["expectedIngredientNames"]
    candidate_sets = [candidates_for(item.normalizedName) for item in normalized]
    scenarios = optimize(
        candidate_sets,
        scenario["knownNutrients"],
        float(scenario["referenceMassG"]),
        seed=int(invariants["seed"]),
        samples_per_combination=600,
    )
    repeated = optimize(
        candidate_sets,
        scenario["knownNutrients"],
        float(scenario["referenceMassG"]),
        seed=int(invariants["seed"]),
        samples_per_combination=600,
    )
    assert scenarios == repeated
    assert scenarios
    ratios = scenarios[0].ratios
    assert math.isclose(
        sum(ratios),
        float(invariants["ratioSum"]),
        abs_tol=float(invariants["ratioTolerance"]),
    )
    assert all(ratio >= 0 for ratio in ratios)
    assert all(left >= right for left, right in zip(ratios, ratios[1:]))

    payload = _request(contract)
    first = estimate(payload, seed=int(invariants["seed"]), samples_per_combination=600)
    second = estimate(payload, seed=int(invariants["seed"]), samples_per_combination=600)
    assert first == second
    for bound in invariants["compositionUpperBounds"]:
        item = first["estimates"][bound["nutrient"]]
        assert item["value"] <= bound["maximum"]
        assert item["range"]["max"] <= bound["maximum"]
