from __future__ import annotations

from nutrition_estimator.optimizer import optimize
from nutrition_estimator.profiles import IngredientProfile


def _profile(profile_id: str, energy: float, prior_probability: float) -> IngredientProfile:
    return IngredientProfile(
        profile_id=profile_id,
        canonical_name=profile_id,
        nutrients_per_100g={"energyKcal": energy},
        typical_min_ratio=0,
        typical_max_ratio=1,
        prior_probability=prior_probability,
    )


def test_candidate_prior_breaks_equal_fit_tie() -> None:
    likely = _profile("likely", 500, 0.9)
    unlikely = _profile("unlikely", 500, 0.1)

    scenarios = optimize(
        [[unlikely, likely]],
        {"energyKcal": 500},
        100,
        seed=1,
        samples_per_combination=1,
    )

    assert scenarios[0].profiles == (likely,)


def test_nutrient_fit_can_override_candidate_prior() -> None:
    likely_but_mismatched = _profile("likely_but_mismatched", 100, 0.99)
    unlikely_but_matching = _profile("unlikely_but_matching", 500, 0.01)

    scenarios = optimize(
        [[likely_but_mismatched, unlikely_but_matching]],
        {"energyKcal": 500},
        100,
        seed=1,
        samples_per_combination=1,
    )

    assert scenarios[0].profiles == (unlikely_but_matching,)
