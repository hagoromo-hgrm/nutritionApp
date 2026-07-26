from __future__ import annotations

import copy
from typing import Any

import pytest

from nutrition_estimator import compute_input_hash


@pytest.fixture
def cookie_request() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "requestId": "estimate_cookie_fixture",
        "foodId": "food_cookie_fixture",
        "barcode": "04901234567890",
        "name": "検証用バタークッキー",
        "maker": "fixture",
        "estimatorCategoryId": "cookie",
        "baseAmount": 1,
        "baseUnit": "袋",
        "inputUnitConversions": [],
        "referenceMassG": 60,
        "referenceMassSource": "検証fixtureのパッケージ内容量",
        "knownNutrients": {
            "energyKcal": 276.0,
            "proteinG": 3.4,
            "fatG": 7.6,
            "carbohydrateG": 46.2,
            "saltG": 0.34,
            "fiberG": None,
            "saturatedFatG": None,
        },
        "missingNutrients": ["fiberG", "saturatedFatG"],
        "ingredientsText": "小麦粉（国内製造）、砂糖、バター、卵、食塩／膨張剤、香料",
        "ingredientsSource": {"provider": "test_fixture", "version": "1", "verified": True},
        "source": {"provider": "test_fixture", "version": "1"},
        "requestedAt": "2026-07-25T00:00:00.000Z",
    }
    payload["inputHash"] = compute_input_hash(payload)
    return copy.deepcopy(payload)
