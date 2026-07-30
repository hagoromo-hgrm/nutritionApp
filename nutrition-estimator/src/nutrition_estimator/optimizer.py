from __future__ import annotations

import itertools
import math
import random
from dataclasses import dataclass
from typing import Sequence

from .models import SUPPORTED_NUTRIENTS
from .profiles import IngredientProfile

FIT_NUTRIENTS = ("energyKcal", "proteinG", "fatG", "carbohydrateG", "saltG")
SCALES = {
    "energyKcal": 40.0,
    "proteinG": 2.0,
    "fatG": 3.0,
    "carbohydrateG": 5.0,
    "saltG": 0.15,
}
CANDIDATE_PRIOR_WEIGHT = 0.08


@dataclass(frozen=True)
class Scenario:
    profiles: tuple[IngredientProfile, ...]
    ratios: tuple[float, ...]
    objective_error: float
    nutrients: dict[str, float]


def _ordered_ratios(count: int, rng: random.Random) -> tuple[float, ...]:
    values = sorted((rng.expovariate(1.0) for _ in range(count)), reverse=True)
    total = sum(values)
    return tuple(value / total for value in values)


def _nutrients(
    profiles: Sequence[IngredientProfile],
    ratios: Sequence[float],
    reference_mass_g: float,
) -> dict[str, float]:
    keys = (*FIT_NUTRIENTS, *sorted(SUPPORTED_NUTRIENTS))
    result: dict[str, float] = {}
    for key in keys:
        values = [profile.nutrients_per_100g.get(key) for profile in profiles]
        # 1原材料でも欠損していれば寄与を0扱いせず、そのシナリオでは当該栄養素を算出しない。
        if any(value is None for value in values):
            continue
        result[key] = sum(
            value * ratio * reference_mass_g / 100.0
            for value, ratio in zip(values, ratios, strict=True)
            if value is not None
        )
    return result


def _objective(predicted: dict[str, float], known: dict[str, float | None]) -> float:
    terms: list[float] = []
    for key in FIT_NUTRIENTS:
        target = known.get(key)
        if target is None or key not in predicted:
            continue
        scale = max(SCALES[key], abs(target) * 0.15)
        terms.append(((predicted[key] - target) / scale) ** 2)
    return sum(terms) / len(terms) if terms else 0.25


def optimize(
    candidate_sets: Sequence[Sequence[IngredientProfile]],
    known: dict[str, float | None],
    reference_mass_g: float,
    *,
    seed: int,
    samples_per_combination: int = 900,
) -> list[Scenario]:
    rng = random.Random(seed)
    accepted: list[Scenario] = []
    for profiles in itertools.product(*candidate_sets):
        # 候補の全組合せを同じseed系列で探索し、曖昧原材料の幅を保持する。
        for _ in range(samples_per_combination):
            ratios = _ordered_ratios(len(profiles), rng)
            if any(
                ratio < profile.typical_min_ratio or ratio > profile.typical_max_ratio
                for profile, ratio in zip(profiles, ratios, strict=True)
            ):
                continue
            predicted = _nutrients(profiles, ratios, reference_mass_g)
            prior_penalty = sum(
                ((ratio - (profile.typical_min_ratio + profile.typical_max_ratio) / 2.0) / 0.5) ** 2
                for profile, ratio in zip(profiles, ratios, strict=True)
            ) / max(len(profiles), 1)
            # 食品候補の事前確率は、主要栄養値との整合を覆さない弱い補助根拠に限定する。
            candidate_prior_penalty = -sum(
                math.log(max(profile.prior_probability, 1e-9))
                for profile in profiles
            ) / max(len(profiles), 1)
            error = (
                _objective(predicted, known)
                + 0.03 * prior_penalty
                + CANDIDATE_PRIOR_WEIGHT * candidate_prior_penalty
            )
            if math.isfinite(error):
                accepted.append(Scenario(tuple(profiles), ratios, error, predicted))
    accepted.sort(key=lambda item: (item.objective_error, tuple(p.profile_id for p in item.profiles), item.ratios))
    return accepted
