#!/usr/bin/env python3
"""Build aggregate genre nutrient priors from the SPU training split."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


TRANSFORM_VERSION = "spu-genre-nutrient-prior-0.1.0"
TARGET_NUTRIENTS = (
    "saturatedFatG",
    "fiberG",
    "calciumMg",
    "ironMg",
    "vitaminAMcg",
    "vitaminEMg",
    "vitaminB1Mg",
    "vitaminB2Mg",
    "vitaminCMg",
)


class PriorBuildError(ValueError):
    """Raised when source data cannot safely produce the aggregate prior."""


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise PriorBuildError(f"{path} must contain a JSON object")
    return value


def _label_center(label: Any) -> float | None:
    if not isinstance(label, dict) or label.get("valueKind") == "estimated":
        return None
    value = label.get("value")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return max(0.0, float(value))
    lower = label.get("rangeMin")
    upper = label.get("rangeMax")
    if (
        isinstance(lower, (int, float))
        and not isinstance(lower, bool)
        and math.isfinite(lower)
        and isinstance(upper, (int, float))
        and not isinstance(upper, bool)
        and math.isfinite(upper)
        and 0 <= lower <= upper
    ):
        return (float(lower) + float(upper)) / 2
    return None


def _weighted_quantile(values: list[tuple[float, float]], quantile: float) -> float:
    if not values:
        raise PriorBuildError("cannot calculate a quantile without observations")
    ordered = sorted(values, key=lambda item: item[0])
    total_weight = sum(weight for _, weight in ordered)
    threshold = total_weight * quantile
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= threshold:
            return round(value, 6)
    return round(ordered[-1][0], 6)


def _distribution(values: list[tuple[float, float]]) -> dict[str, float]:
    return {
        "p05": _weighted_quantile(values, 0.05),
        "median": _weighted_quantile(values, 0.5),
        "p95": _weighted_quantile(values, 0.95),
    }


def build_priors(
    training: dict[str, Any],
    manifest: dict[str, Any],
    *,
    manifest_sha256: str,
    prior_strength: float = 30.0,
    minimum_genre_samples: int = 10,
    minimum_genre_makers: int = 2,
) -> dict[str, Any]:
    if (
        training.get("format") != "nutrition-estimator-training-data"
        or training.get("formatVersion") != 1
        or not isinstance(training.get("records"), list)
    ):
        raise PriorBuildError("training dataset format is invalid")
    if (
        manifest.get("format") != "nutrition-estimator-training-manifest"
        or not isinstance(manifest.get("records"), list)
        or not isinstance(manifest.get("normalizedDatasetSha256"), str)
    ):
        raise PriorBuildError("training manifest format is invalid")
    if prior_strength <= 0 or minimum_genre_samples <= 0 or minimum_genre_makers <= 0:
        raise PriorBuildError("prior parameters must be positive")

    split_by_record = {
        item.get("recordId"): item.get("split")
        for item in manifest["records"]
        if isinstance(item, dict)
    }
    train_records = [
        record
        for record in training["records"]
        if isinstance(record, dict) and split_by_record.get(record.get("recordId")) == "train"
    ]
    if not train_records:
        raise PriorBuildError("training split has no records")

    global_values: dict[str, list[float]] = defaultdict(list)
    genre_values: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    genre_makers: dict[str, Counter[str]] = defaultdict(Counter)
    for record in train_records:
        genre_id = record.get("genreId")
        maker = record.get("maker")
        nutrients = record.get("nutrients")
        reference_mass = record.get("referenceMassG")
        if (
            not isinstance(genre_id, str)
            or not genre_id
            or not isinstance(maker, str)
            or not maker
            or not isinstance(nutrients, dict)
            or not isinstance(reference_mass, (int, float))
            or isinstance(reference_mass, bool)
            or not math.isfinite(reference_mass)
            or reference_mass <= 0
        ):
            continue
        genre_makers[genre_id][maker] += 1
        for nutrient_key in TARGET_NUTRIENTS:
            center = _label_center(nutrients.get(nutrient_key))
            if center is None:
                continue
            per_100g = center * 100 / float(reference_mass)
            if not math.isfinite(per_100g) or per_100g < 0:
                continue
            global_values[nutrient_key].append(per_100g)
            genre_values[genre_id][nutrient_key].append(per_100g)

    missing_global = [
        nutrient_key for nutrient_key in TARGET_NUTRIENTS
        if not global_values[nutrient_key]
    ]
    if missing_global:
        raise PriorBuildError(
            "training split has no observations for: " + ", ".join(missing_global)
        )

    global_priors = {
        nutrient_key: {
            "sampleSize": len(global_values[nutrient_key]),
            "scope": "pooled_nutrient",
            "genreObservationWeight": 0.0,
            **_distribution([(value, 1.0) for value in global_values[nutrient_key]]),
        }
        for nutrient_key in TARGET_NUTRIENTS
    }
    genres: dict[str, Any] = {}
    for genre_id in sorted(genre_makers):
        maker_counts = genre_makers[genre_id]
        product_count = sum(maker_counts.values())
        maximum_maker_share = max(maker_counts.values()) / product_count
        nutrient_priors: dict[str, Any] = {}
        for nutrient_key in TARGET_NUTRIENTS:
            values = genre_values[genre_id][nutrient_key]
            use_genre = (
                genre_id != "other_unknown"
                and len(values) >= minimum_genre_samples
                and len(maker_counts) >= minimum_genre_makers
            )
            if use_genre:
                # 1社への偏りが50%を超えるほど局所標本を弱め、全体分布へ強く縮約する。
                maker_balance = min(1.0, max(0.0, (1 - maximum_maker_share) / 0.5))
                effective_genre_size = len(values) * maker_balance
                pooled_weight = prior_strength / len(global_values[nutrient_key])
                weighted = [
                    *((value, maker_balance) for value in values),
                    *((value, pooled_weight) for value in global_values[nutrient_key]),
                ]
                scope = "genre_nutrient"
                genre_weight = effective_genre_size / (effective_genre_size + prior_strength)
            else:
                weighted = [(value, 1.0) for value in global_values[nutrient_key]]
                scope = "pooled_nutrient"
                genre_weight = 0.0
            nutrient_priors[nutrient_key] = {
                "sampleSize": len(values),
                "pooledSampleSize": len(global_values[nutrient_key]),
                "scope": scope,
                "genreObservationWeight": round(genre_weight, 6),
                **_distribution(weighted),
            }
        genres[genre_id] = {
            "trainingProductCount": product_count,
            "makerCount": len(maker_counts),
            "maximumMakerShare": round(maximum_maker_share, 6),
            "nutrients": nutrient_priors,
        }

    return {
        "format": "nutrition-estimator-spu-genre-nutrient-priors",
        "formatVersion": 1,
        "transformVersion": TRANSFORM_VERSION,
        "source": {
            "provider": "メーカー公式栄養成分表示の集計",
            "datasetSha256": manifest["normalizedDatasetSha256"],
            "manifestSha256": manifest_sha256,
            "split": "train",
            "containsProductRecords": False,
        },
        "methodology": {
            "basis": "per_100g",
            "quantiles": [0.05, 0.5, 0.95],
            "priorStrength": prior_strength,
            "minimumGenreSamples": minimum_genre_samples,
            "minimumGenreMakers": minimum_genre_makers,
            "makerDominanceShrinkageStartsAt": 0.5,
            "otherUnknownUsesPooledDistribution": True,
            "estimatedLabelsExcluded": True,
            "separatedIngredientWeightsUsed": False,
        },
        "trainingRecordCount": len(train_records),
        "global": {
            "nutrients": global_priors,
        },
        "genres": genres,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("training", type=Path)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prior-strength", type=float, default=30.0)
    parser.add_argument("--minimum-genre-samples", type=int, default=10)
    parser.add_argument("--minimum-genre-makers", type=int, default=2)
    args = parser.parse_args()
    artifact = build_priors(
        _load_object(args.training),
        _load_object(args.manifest),
        manifest_sha256=file_sha256(args.manifest),
        prior_strength=args.prior_strength,
        minimum_genre_samples=args.minimum_genre_samples,
        minimum_genre_makers=args.minimum_genre_makers,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
