#!/usr/bin/env python3
"""Build aggregate genre nutrient priors from the SPU training split."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


TRANSFORM_VERSION = "spu-genre-nutrient-prior-0.3.0"
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
RATIO_DEFINITIONS = {
    "saturatedFatToFat": ("saturatedFatG", "fatG"),
}
PRIVATE_ESTIMATOR_ROOT = Path(__file__).resolve().parents[1] / "data" / "estimator" / "private"


class PriorBuildError(ValueError):
    """Raised when source data cannot safely produce the aggregate prior."""


def validate_output_destination(manifest: dict[str, Any], output_path: Path) -> None:
    """Keep non-redistributable source aggregates inside the private data area."""
    if manifest.get("publicTrainingOrAggregateRedistributionPermitted") is not False:
        return
    try:
        output_path.resolve().relative_to(PRIVATE_ESTIMATOR_ROOT.resolve())
    except ValueError as exc:
        raise PriorBuildError(
            "manifest prohibits public redistribution; output must be under data/estimator/private"
        ) from exc


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
    if not isinstance(label, dict):
        return None
    value_kind = label.get("valueKind")
    if value_kind == "estimated":
        return None
    if value_kind == "declared_range":
        lower = label.get("rangeMin")
        upper = label.get("rangeMax")
        if (
            isinstance(lower, (int, float))
            and not isinstance(lower, bool)
            and math.isfinite(lower)
            and lower >= 0
            and isinstance(upper, (int, float))
            and not isinstance(upper, bool)
            and math.isfinite(upper)
            and upper >= lower
        ):
            # A declared range contributes its midpoint as a prior representative,
            # never as a fixed point label.
            return (float(lower) + float(upper)) / 2
        return None
    if value_kind != "fixed":
        return None
    value = label.get("value")
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    ):
        return float(value)
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


def _normalized_family_key(record: dict[str, Any]) -> str | None:
    maker = record.get("maker")
    family = record.get("productFamily")
    if not isinstance(maker, str) or not maker.strip():
        return None
    if not isinstance(family, str) or not family.strip():
        return None
    return f"{_normalize_identity_text(maker)}\0{_normalize_identity_text(family)}"


def _normalize_identity_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _family_weighted_values(
    observations: list[tuple[float, str, str]],
) -> tuple[list[tuple[float, float]], dict[str, float], Counter[str]]:
    """Weight every independent family once, regardless of record variants."""
    family_records: dict[str, list[float]] = defaultdict(list)
    family_makers: dict[str, str] = {}
    for value, maker, family in observations:
        family_records[family].append(value)
        family_makers[family] = maker
    weights: list[tuple[float, float]] = []
    family_totals: dict[str, float] = {}
    maker_family_counts: Counter[str] = Counter()
    for family, values in family_records.items():
        record_weight = 1.0 / len(values)
        weights.extend((value, record_weight) for value in values)
        family_totals[family] = sum(record_weight for _ in values)
        maker_family_counts[family_makers[family]] += family_totals[family]
    return weights, family_totals, maker_family_counts


def _family_metrics(
    family_weights: dict[str, float], maker_weights: Counter[str]
) -> dict[str, Any]:
    total_weight = sum(family_weights.values())
    square_sum = sum(weight * weight for weight in family_weights.values())
    return {
        "independentFamilyCount": len(family_weights),
        "makerCount": len(maker_weights),
        "maximumMakerShare": (
            round(max(maker_weights.values()) / total_weight, 6)
            if total_weight
            else None
        ),
        "maximumFamilyShare": (
            round(max(family_weights.values()) / total_weight, 6)
            if total_weight
            else None
        ),
        "effectiveFamilySampleSize": (
            round(total_weight * total_weight / square_sum, 6)
            if square_sum
            else 0.0
        ),
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

    global_values: dict[str, list[tuple[float, str, str]]] = defaultdict(list)
    genre_values: dict[str, dict[str, list[tuple[float, str, str]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    genre_makers: dict[str, dict[str, Counter[str]]] = defaultdict(
        lambda: defaultdict(Counter)
    )
    genre_record_makers: dict[str, Counter[str]] = defaultdict(Counter)
    global_ratio_values: dict[str, list[tuple[float, str, str]]] = defaultdict(list)
    genre_ratio_values: dict[str, dict[str, list[tuple[float, str, str]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for record in train_records:
        genre_id = record.get("genreId")
        maker = record.get("maker")
        family = _normalized_family_key(record)
        nutrients = record.get("nutrients")
        reference_mass = record.get("referenceMassG")
        if (
            not isinstance(genre_id, str)
            or not genre_id
            or not isinstance(maker, str)
            or not maker
            or family is None
            or not isinstance(nutrients, dict)
            or not isinstance(reference_mass, (int, float))
            or isinstance(reference_mass, bool)
            or not math.isfinite(reference_mass)
            or reference_mass <= 0
        ):
            continue
        maker_identity = _normalize_identity_text(maker)
        genre_record_makers[genre_id][maker_identity] += 1
        for nutrient_key in TARGET_NUTRIENTS:
            center = _label_center(nutrients.get(nutrient_key))
            if center is None:
                continue
            per_100g = center * 100 / float(reference_mass)
            if not math.isfinite(per_100g) or per_100g < 0:
                continue
            observation = (per_100g, maker_identity, family)
            global_values[nutrient_key].append(observation)
            genre_values[genre_id][nutrient_key].append(observation)
            genre_makers[genre_id][nutrient_key][maker_identity] += 1
        for ratio_key, (numerator_key, denominator_key) in RATIO_DEFINITIONS.items():
            numerator = _label_center(nutrients.get(numerator_key))
            denominator = _label_center(nutrients.get(denominator_key))
            if numerator is None or denominator is None or denominator <= 0:
                continue
            ratio = numerator / denominator
            # 表示丸めを逆算せず、物理制約を満たす観測だけを比率分布へ使う。
            if not math.isfinite(ratio) or ratio < 0 or ratio > 1:
                continue
            observation = (ratio, maker_identity, family)
            global_ratio_values[ratio_key].append(observation)
            genre_ratio_values[genre_id][ratio_key].append(observation)

    missing_global = [
        nutrient_key for nutrient_key in TARGET_NUTRIENTS
        if not global_values[nutrient_key]
    ]
    if missing_global:
        raise PriorBuildError(
            "training split has no observations for: " + ", ".join(missing_global)
        )
    missing_global_ratios = [
        ratio_key for ratio_key in RATIO_DEFINITIONS
        if not global_ratio_values[ratio_key]
    ]
    if missing_global_ratios:
        raise PriorBuildError(
            "training split has no ratio observations for: "
            + ", ".join(missing_global_ratios)
        )

    global_prior_values: dict[str, list[tuple[float, float]]] = {}
    global_prior_metrics: dict[str, dict[str, Any]] = {}
    global_priors = {}
    for nutrient_key in TARGET_NUTRIENTS:
        weighted, family_weights, maker_weights = _family_weighted_values(
            global_values[nutrient_key]
        )
        global_prior_values[nutrient_key] = weighted
        global_prior_metrics[nutrient_key] = _family_metrics(family_weights, maker_weights)
        global_priors[nutrient_key] = {
            "sampleSize": len(global_values[nutrient_key]),
            "scope": "pooled_nutrient",
            "genreObservationWeight": 0.0,
            **global_prior_metrics[nutrient_key],
            **_distribution(weighted),
        }
    global_ratio_prior_values: dict[str, list[tuple[float, float]]] = {}
    global_ratio_priors = {}
    for ratio_key in RATIO_DEFINITIONS:
        weighted, family_weights, maker_weights = _family_weighted_values(
            global_ratio_values[ratio_key]
        )
        global_ratio_prior_values[ratio_key] = weighted
        global_ratio_priors[ratio_key] = {
            "sampleSize": len(global_ratio_values[ratio_key]),
            "scope": "pooled_nutrient",
            "genreObservationWeight": 0.0,
            **_family_metrics(family_weights, maker_weights),
            **_distribution(weighted),
        }
    genres: dict[str, Any] = {}
    genre_ids = sorted(set(genre_record_makers) | set(genre_values) | set(genre_ratio_values))
    for genre_id in genre_ids:
        maker_counts = genre_record_makers[genre_id]
        product_count = sum(maker_counts.values())
        maximum_maker_share = max(maker_counts.values()) / product_count if product_count else 0.0
        nutrient_priors: dict[str, Any] = {}
        for nutrient_key in TARGET_NUTRIENTS:
            observations = genre_values[genre_id][nutrient_key]
            values, family_weights, maker_weights = _family_weighted_values(observations)
            metrics = _family_metrics(family_weights, maker_weights)
            use_genre = (
                genre_id != "other_unknown"
                and metrics["independentFamilyCount"] >= minimum_genre_samples
                and metrics["makerCount"] >= minimum_genre_makers
            )
            if use_genre:
                maker_balance = min(
                    1.0,
                    max(0.0, (1 - metrics["maximumMakerShare"]) / 0.5),
                )
                effective_genre_size = sum(family_weights.values()) * maker_balance
                pooled_total_weight = sum(
                    weight for _, weight in global_prior_values[nutrient_key]
                )
                pooled_weight = prior_strength / pooled_total_weight
                weighted = [
                    *((value, weight * maker_balance) for value, weight in values),
                    *((value, weight * pooled_weight) for value, weight in global_prior_values[nutrient_key]),
                ]
                scope = "genre_nutrient"
                genre_weight = effective_genre_size / (effective_genre_size + prior_strength)
            else:
                weighted = global_prior_values[nutrient_key]
                scope = "pooled_nutrient"
                genre_weight = 0.0
            nutrient_priors[nutrient_key] = {
                "sampleSize": len(values),
                "pooledSampleSize": len(global_values[nutrient_key]),
                **metrics,
                "makerBalance": round(maker_balance, 6) if use_genre else 0.0,
                "scope": scope,
                "genreObservationWeight": round(genre_weight, 6),
                **_distribution(weighted),
            }
        ratio_priors: dict[str, Any] = {}
        for ratio_key in RATIO_DEFINITIONS:
            observations = genre_ratio_values[genre_id][ratio_key]
            values, ratio_family_weights, ratio_maker_weights = _family_weighted_values(observations)
            ratio_metrics = _family_metrics(ratio_family_weights, ratio_maker_weights)
            use_genre = (
                genre_id != "other_unknown"
                and ratio_metrics["independentFamilyCount"] >= minimum_genre_samples
                and ratio_metrics["makerCount"] >= minimum_genre_makers
            )
            if use_genre:
                maker_balance = min(
                    1.0,
                    max(0.0, (1 - ratio_metrics["maximumMakerShare"]) / 0.5),
                )
                effective_genre_size = sum(ratio_family_weights.values()) * maker_balance
                pooled_total_weight = sum(weight for _, weight in global_ratio_prior_values[ratio_key])
                pooled_weight = prior_strength / pooled_total_weight
                weighted = [
                    *((value, weight * maker_balance) for value, weight in values),
                    *((value, weight * pooled_weight) for value, weight in global_ratio_prior_values[ratio_key]),
                ]
                scope = "genre_nutrient"
                genre_weight = effective_genre_size / (
                    effective_genre_size + prior_strength
                )
            else:
                weighted = global_ratio_prior_values[ratio_key]
                scope = "pooled_nutrient"
                genre_weight = 0.0
            ratio_priors[ratio_key] = {
                "sampleSize": len(values),
                "pooledSampleSize": len(global_ratio_values[ratio_key]),
                **ratio_metrics,
                "makerBalance": round(maker_balance, 6) if use_genre else 0.0,
                "scope": scope,
                "genreObservationWeight": round(genre_weight, 6),
                **_distribution(weighted),
            }
        genres[genre_id] = {
            "trainingProductCount": product_count,
            "makerCount": len(maker_counts),
            "maximumMakerShare": round(maximum_maker_share, 6),
            "nutrients": nutrient_priors,
            "ratios": ratio_priors,
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
            "minimumGenreSamplesDefinition": "independent_families_with_valid_nutrient_label",
            "minimumGenreMakers": minimum_genre_makers,
            "makerDominanceShrinkageStartsAt": 0.5,
            "otherUnknownUsesPooledDistribution": True,
            "estimatedLabelsExcluded": True,
            "negativeLabelsExcluded": True,
            "declaredRangeRepresentative": "midpoint_of_range_used_as_prior_representative_not_fixed_point_value",
            "familyWeighting": "each_maker_product_family_has_total_weight_1_per_nutrient_or_ratio; records_within_family_share_that_weight_equally",
            "effectiveFamilySampleSizeDefinition": "kish_ess_of_family_total_weights_after_family_record_weights_and_any_maker_balance",
            "sampleSizeDefinition": "number_of_valid_observations_before_family_weighting",
            "separatedIngredientWeightsUsed": False,
            "ratioDefinitions": {
                ratio_key: {
                    "numerator": numerator,
                    "denominator": denominator,
                }
                for ratio_key, (numerator, denominator) in RATIO_DEFINITIONS.items()
            },
            "ratioRequiresPositiveDenominator": True,
            "ratioBounds": [0, 1],
            "invalidRatiosExcluded": True,
        },
        "trainingRecordCount": len(train_records),
        "global": {
            "nutrients": global_priors,
            "ratios": global_ratio_priors,
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
    parser.add_argument("--review-sidecar", type=Path)
    parser.add_argument("--require-strict-review", action="store_true")
    args = parser.parse_args()
    manifest = _load_object(args.manifest)
    try:
        validate_output_destination(manifest, args.output)
    except PriorBuildError as exc:
        parser.error(str(exc))
    try:
        from .nutrient_estimator_integrity import _validate_integrity, _reject_sealed_path, reviewed_teacher_status
    except ImportError:
        from nutrient_estimator_integrity import _validate_integrity, _reject_sealed_path, reviewed_teacher_status
    training = _load_object(args.training)
    _reject_sealed_path(args.training)
    _reject_sealed_path(args.manifest)
    _validate_integrity(training, manifest, args.training, args.manifest)
    review = _load_object(args.review_sidecar) if args.review_sidecar else None
    audit_status = reviewed_teacher_status(review, training, manifest, require_strict=args.require_strict_review)
    artifact = build_priors(
        training,
        manifest,
        manifest_sha256=file_sha256(args.manifest),
        prior_strength=args.prior_strength,
        minimum_genre_samples=args.minimum_genre_samples,
        minimum_genre_makers=args.minimum_genre_makers,
    )
    artifact["teacherAudit"] = audit_status
    artifact["teacherAudit"]["sourceFileSha256"] = manifest["sourceFileSha256"]
    artifact["teacherAudit"]["manifestFileSha256"] = file_sha256(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
