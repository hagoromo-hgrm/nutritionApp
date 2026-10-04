#!/usr/bin/env python3
"""Audit training-only nutrient coverage and family/manufacturer concentration."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    from . import validate_nutrient_estimator_training as validator
except ImportError:  # pragma: no cover - direct script execution
    import validate_nutrient_estimator_training as validator


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
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
DEFAULT_SEALED_COLLECTION = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "analysis"
    / "nutrient_estimator_sealed_collection.json"
)


try:
    from .nutrient_estimator_integrity import AuditError, file_sha256, canonical_dataset, _read_object, _reject_sealed_path, _validate_integrity
except ImportError:
    from nutrient_estimator_integrity import AuditError, file_sha256, canonical_dataset, _read_object, _reject_sealed_path, _validate_integrity


def _label_center_and_reason(label: Any) -> tuple[float | None, str | None]:
    if label is None:
        return None, "missing"
    if not isinstance(label, dict):
        return None, "invalid_format"
    kind = label.get("valueKind")
    if kind == "estimated":
        return None, "estimated"
    if kind not in {"fixed", "declared_range"}:
        return None, "invalid_value_kind"
    if kind == "declared_range":
        lower = label.get("rangeMin")
        upper = label.get("rangeMax")
        for value in (lower, upper):
            if isinstance(value, bool):
                return None, "invalid_boolean"
            if not isinstance(value, (int, float)):
                return None, "invalid_format"
            if not math.isfinite(value):
                return None, "invalid_nonfinite"
            if value < 0:
                return None, "invalid_negative"
        if upper < lower:
            return None, "invalid_range_order"
        return (float(lower) + float(upper)) / 2, None
    value = label.get("value")
    if value is None:
        return None, "missing"
    if isinstance(value, bool):
        return None, "invalid_boolean"
    if not isinstance(value, (int, float)):
        return None, "invalid_format"
    if not math.isfinite(value):
        return None, "invalid_nonfinite"
    if value < 0:
        return None, "invalid_negative"
    return float(value), None


def audit_training_records(
    records: list[dict[str, Any]],
    split_by_record: dict[str, str],
    sealed_family_hashes: set[str],
    *,
    source_hashes: dict[str, str],
    raw_records_by_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    train_records = [
        record for record in records if split_by_record[record["recordId"]] == "train"
    ]
    if not train_records:
        raise AuditError("training split has no records")
    train_family_hashes = {
        hashlib.sha256(
            validator.group_key(record["maker"], record["productFamily"]).encode("utf-8")
        ).hexdigest()
        for record in train_records
    }
    if train_family_hashes & sealed_family_hashes:
        raise AuditError("training data overlaps a public sealed evaluation family hash")

    genre_records: dict[str, list[dict[str, Any]]] = {
        genre_id: [] for genre_id in validator.GENRE_IDS
    }
    for record in train_records:
        genre_records[record["genreId"]].append(record)
    genres: dict[str, Any] = {}
    for genre_id in sorted(genre_records):
        genre_train_records = genre_records[genre_id]
        nutrient_report: dict[str, Any] = {}
        for nutrient_key in TARGET_NUTRIENTS:
            observed = 0
            accepted = 0
            missing = 0
            estimated = 0
            invalid_reasons: Counter[str] = Counter()
            family_records: dict[str, int] = Counter()
            family_makers: dict[str, str] = {}
            for record in genre_train_records:
                raw_record = (
                    raw_records_by_id.get(record["recordId"], record)
                    if raw_records_by_id is not None
                    else record
                )
                raw_nutrients = raw_record.get("nutrients")
                label = (
                    raw_nutrients.get(nutrient_key)
                    if isinstance(raw_nutrients, dict)
                    else None
                )
                if label is not None:
                    observed += 1
                center, reason = _label_center_and_reason(label)
                if reason == "missing":
                    missing += 1
                    continue
                if reason == "estimated":
                    estimated += 1
                    continue
                if reason is not None:
                    invalid_reasons[reason] += 1
                    continue
                accepted += 1
                group_key = validator.group_key(record["maker"], record["productFamily"])
                family_records[group_key] += 1
                family_makers[group_key] = validator.normalize_group_component(record["maker"])

            # Every independent maker/family receives total weight one. Record variants
            # share that family weight, so they cannot inflate the effective sample size.
            family_weights = {family: 1.0 for family in family_records}
            maker_family_counts: Counter[str] = Counter()
            for family, maker in family_makers.items():
                maker_family_counts[maker] += family_weights[family]
            total_family_weight = sum(family_weights.values())
            maker_share = (
                max(maker_family_counts.values()) / total_family_weight
                if total_family_weight
                else None
            )
            family_share = (
                max(family_weights.values()) / total_family_weight
                if total_family_weight
                else None
            )
            square_sum = sum(weight * weight for weight in family_weights.values())
            effective_family_n = (
                total_family_weight * total_family_weight / square_sum
                if square_sum
                else 0.0
            )
            maker_balance = (
                min(1.0, max(0.0, (1.0 - maker_share) / 0.5))
                if maker_share is not None
                else 0.0
            )
            maker_hash_counts = Counter()
            for maker, count in maker_family_counts.items():
                maker_hash_counts[hashlib.sha256(maker.encode("utf-8")).hexdigest()] = int(count)

            shortage_reasons: list[str] = []
            if effective_family_n < 30:
                shortage_reasons.append("fewer_than_30_independent_families_for_nutrient")
            if len(maker_family_counts) < 3:
                shortage_reasons.append("fewer_than_3_makers_for_nutrient")
            if maker_share is not None and maker_share > 0.50:
                shortage_reasons.append("maximum_maker_share_above_50_percent")
            if maker_share is not None and maker_share > 0.20:
                shortage_reasons.append("preferred_maximum_maker_share_above_20_percent")
            if accepted == 0:
                shortage_reasons.append("no_accepted_nonestimated_label")
            nutrient_report[nutrient_key] = {
                "observedCount": observed,
                "acceptedCount": accepted,
                "independentFamilyCount": len(family_weights),
                "makerCount": len(maker_family_counts),
                "makerFamilyCountsBySha256": dict(sorted(maker_hash_counts.items())),
                "maximumMakerShare": round(maker_share, 6) if maker_share is not None else None,
                "maximumFamilyShare": round(family_share, 6) if family_share is not None else None,
                "effectiveFamilySampleSize": round(effective_family_n, 6),
                "makerBalance": round(maker_balance, 6),
                "missingCount": missing,
                "estimatedExcludedCount": estimated,
                "invalidExcludedCount": sum(invalid_reasons.values()),
                "invalidExclusionReasons": dict(sorted(invalid_reasons.items())),
                "independentFamilyTarget30Achieved": effective_family_n >= 30,
                "makerTarget3Achieved": len(maker_family_counts) >= 3,
                "maximumMakerShare50PercentAchieved": (
                    maker_share is not None and maker_share <= 0.50
                ),
                "preferredMaximumMakerShare20PercentAchieved": (
                    maker_share is not None and maker_share <= 0.20
                ),
                "shortageReasons": shortage_reasons,
            }
        record_count = len(genre_train_records)
        genre_shortages: list[str] = []
        if record_count < 50:
            genre_shortages.append("fewer_than_50_pilot_records")
        if record_count < 100:
            genre_shortages.append("fewer_than_100_formal_records")
        genres[genre_id] = {
            "trainingRecordCount": record_count,
            "pilot50RecordTargetAchieved": record_count >= 50,
            "formal100RecordTargetAchieved": record_count >= 100,
            "genreShortageReasons": genre_shortages,
            "nutrients": nutrient_report,
        }
    return {
        "format": "nutrition-estimator-training-bias-audit",
        "formatVersion": 1,
        "scope": "train_split_only",
        "source": source_hashes,
        "trainingRecordCount": len(train_records),
        "genreCount": len(genres),
        "taxonomyGenreCount": len(validator.GENRE_IDS),
        "observedGenreCount": sum(bool(items) for items in genre_records.values()),
        "thresholds": {
            "pilotRecordsPerGenre": 50,
            "formalRecordsPerGenre": 100,
            "independentFamiliesPerNutrient": 30,
            "minimumMakersPerNutrient": 3,
            "maximumMakerShare": 0.5,
            "preferredMaximumMakerShare": 0.2,
        },
        "definitions": {
            "observedCount": "train records containing this nutrient label, including estimated labels",
            "acceptedCount": "non-estimated fixed values and valid declared ranges accepted for an auxiliary prior",
            "declaredRange": "range midpoint is used only as a prior representative, never represented as a fixed point value",
            "independentFamily": "normalized maker + productFamily group with at least one accepted label for this nutrient",
            "familyWeight": "each independent family has total weight 1 per nutrient; its records share that weight equally",
            "maximumMakerShare": "largest maker share of independent family total weights for this nutrient",
            "maximumFamilyShare": "largest independent family share of total family weights for this nutrient",
            "effectiveFamilySampleSize": "Kish ESS = (sum of family total weights)^2 / sum of squared family total weights, after record weights are aggregated within family",
            "missingCount": "train records without a usable label value or valid declared range",
            "invalidExclusionReasons": "counted label-level exclusions; malformed source structure or integrity failures reject the audit",
            "makerFamilyCountsBySha256": "maker identity is SHA-256 of normalized name; values count independent families",
        },
        "genres": genres,
    }


def build_audit(
    training_path: Path,
    manifest_path: Path,
    sealed_collection_path: Path,
) -> dict[str, Any]:
    for path in (training_path, manifest_path, sealed_collection_path):
        _reject_sealed_path(path)
    training = _read_object(training_path, "training data")
    manifest = _read_object(manifest_path, "training manifest")
    sealed_collection = _read_object(sealed_collection_path, "public sealed collection")
    records, split_by_record, raw_records_by_id = _validate_integrity(
        training, manifest, training_path, manifest_path
    )
    family_hashes = sealed_collection.get("familyHashes")
    family_count = sealed_collection.get("familyCount")
    if (
        not isinstance(family_hashes, list)
        or any(not isinstance(value, str) or not HASH_RE.fullmatch(value) for value in family_hashes)
        or len(set(family_hashes)) != len(family_hashes)
        or type(family_count) is not int
        or family_count != len(family_hashes)
    ):
        raise AuditError("public sealed collection hash/count metadata is invalid")
    training_file_hash = file_sha256(training_path)
    manifest_file_hash = file_sha256(manifest_path)
    return audit_training_records(
        records,
        split_by_record,
        set(family_hashes),
        source_hashes={
            "sourceFileSha256": training_file_hash,
            "normalizedDatasetSha256": manifest["normalizedDatasetSha256"],
            "manifestFileSha256": manifest_file_hash,
            "publicSealedCollectionFileSha256": file_sha256(sealed_collection_path),
            "publicSealedFamilyCount": family_count,
            "excludedSealedFamilyOverlapCount": 0,
        },
        raw_records_by_id=raw_records_by_id,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("training", type=Path)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--sealed-collection", type=Path, default=DEFAULT_SEALED_COLLECTION)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        resolved_inputs = {
            args.training.resolve(), args.manifest.resolve(), args.sealed_collection.resolve()
        }
        if args.output.resolve() in resolved_inputs:
            raise AuditError("audit output must be a distinct path")
        audit = build_audit(args.training, args.manifest, args.sealed_collection)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "output": str(args.output),
            "trainingRecordCount": audit["trainingRecordCount"],
            "observedGenreCount": audit["observedGenreCount"],
            "taxonomyGenreCount": audit["taxonomyGenreCount"],
            "sourceFileSha256": audit["source"]["sourceFileSha256"],
            "normalizedDatasetSha256": audit["source"]["normalizedDatasetSha256"],
        }, ensure_ascii=False))
        return 0
    except (AuditError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
