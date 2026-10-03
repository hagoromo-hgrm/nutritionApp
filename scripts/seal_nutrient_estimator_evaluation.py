#!/usr/bin/env python3
"""Seal a held-out set of real package labels for a later estimator evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from . import validate_nutrient_estimator_training as validator
except ImportError:
    import validate_nutrient_estimator_training as validator


PRIVATE_ROOT = Path(__file__).resolve().parents[1] / "data" / "estimator" / "private"
MAJOR_NUTRIENTS = {"energyKcal", "proteinG", "fatG", "carbohydrateG", "saltG"}


def normalized_maker(value: str) -> str:
    return validator.normalize_group_component(value)


def family_hash(maker: str, family: str) -> str:
    return hashlib.sha256(validator.group_key(maker, family).encode("utf-8")).hexdigest()


def canonical_dataset(records: list[dict[str, Any]]) -> bytes:
    return json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def strict_numeric_fields(raw: dict[str, Any]) -> None:
    record_id = str(raw.get("recordId", "<unknown>"))
    nutrients = raw.get("nutrients")
    for field in ("baseAmount", "referenceMassG"):
        if isinstance(raw.get(field), bool):
            raise validator.ValidationError(f"{record_id}: {field} must not be boolean")
    if not isinstance(nutrients, dict):
        return  # The validator reports the structural error.
    for key, label in nutrients.items():
        if not isinstance(label, dict):
            continue
        for field in ("value", "rangeMin", "rangeMax", "decimalPlaces"):
            value = label.get(field)
            if isinstance(value, bool):
                raise validator.ValidationError(f"{record_id}: nutrients.{key}.{field} must not be boolean")


def normalize_and_validate(
    raw_records: list[Any], exclusions: Any
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    if not raw_records:
        raise validator.ValidationError("evaluation record collection must not be empty")
    if not isinstance(exclusions, dict):
        raise validator.ValidationError("exclusion JSON must be an object")
    excluded_hashes = exclusions.get("familyHashes")
    blocked_makers = exclusions.get("blockedMakers")
    if not isinstance(excluded_hashes, list) or any(not isinstance(x, str) or not re.fullmatch(r"[0-9a-f]{64}", x) for x in excluded_hashes):
        raise validator.ValidationError("familyHashes must be an array of lowercase SHA256 strings")
    if len(set(excluded_hashes)) != len(excluded_hashes):
        raise validator.ValidationError("familyHashes contains duplicates")
    if not isinstance(blocked_makers, list) or any(not isinstance(x, str) or not x.strip() for x in blocked_makers):
        raise validator.ValidationError("blockedMakers must be an array of non-empty strings")
    blocked = {normalized_maker(x) for x in blocked_makers}

    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_groups: set[str] = set()
    hashes: list[str] = []
    group_keys: list[str] = []
    for raw in raw_records:
        if isinstance(raw, dict):
            strict_numeric_fields(raw)
        record = validator.normalize_record(raw)
        if record["recordId"] in seen_ids:
            raise validator.ValidationError("recordId values must be unique")
        seen_ids.add(record["recordId"])
        key = validator.group_key(record["maker"], record["productFamily"])
        if key in seen_groups:
            raise validator.ValidationError("duplicate normalized maker/productFamily group")
        seen_groups.add(key)
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        if digest in excluded_hashes:
            raise validator.ValidationError("evaluation family overlaps excluded training/calibration family")
        if normalized_maker(record["maker"]) in blocked:
            raise validator.ValidationError("evaluation maker is blocked by training/calibration metadata")
        if record["sourceType"] not in {"manufacturer", "package"}:
            raise validator.ValidationError(f"{record['recordId']}: sourceType must be manufacturer or package")
        parsed = urlparse(record["sourceReference"])
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise validator.ValidationError(f"{record['recordId']}: sourceReference must be an http(s) URL")
        if not math.isfinite(record["referenceMassG"]) or record["referenceMassG"] <= 0:
            raise validator.ValidationError(f"{record['recordId']}: referenceMassG must be finite and positive")
        if record["baseUnit"].strip().casefold() == "g" and not math.isclose(
            record["baseAmount"], record["referenceMassG"], rel_tol=1e-12, abs_tol=1e-12
        ):
            raise validator.ValidationError(f"{record['recordId']}: baseAmount and referenceMassG must match for g basis")
        nutrients = record["nutrients"]
        if not MAJOR_NUTRIENTS.issubset(nutrients):
            raise validator.ValidationError(f"{record['recordId']}: all major nutrients are required")
        bases = {label["basis"] for label in nutrients.values()}
        if len(bases) != 1:
            raise validator.ValidationError(f"{record['recordId']}: all nutrient bases must match")
        nonestimated_targets = [
            key for key in validator.TARGET_NUTRIENTS
            if key in nutrients and nutrients[key]["valueKind"] != "estimated"
        ]
        if not nonestimated_targets:
            raise validator.ValidationError(f"{record['recordId']}: at least one target must be non-estimated")
        # Normalize all labels through the shared validator, then reject values that its
        # coercive numeric helper would otherwise accept from booleans.
        for key, label in nutrients.items():
            for field in ("value", "rangeMin", "rangeMax"):
                value = label[field]
                if value is not None and not math.isfinite(value):
                    raise validator.ValidationError(f"{record['recordId']}: nutrients.{key}.{field} must be finite")
            if label["rangeMin"] is not None and label["rangeMax"] is not None and label["rangeMax"] < label["rangeMin"]:
                raise validator.ValidationError(f"{record['recordId']}: nutrients.{key} range order is invalid")
            if (
                label["valueKind"] == "declared_range"
                and label["value"] is not None
                and (label["value"] < label["rangeMin"] or label["value"] > label["rangeMax"])
            ):
                raise validator.ValidationError(f"{record['recordId']}: nutrients.{key}.value is outside declared range")
            if not isinstance(label["decimalPlaces"], int) or not 0 <= label["decimalPlaces"] <= 12:
                raise validator.ValidationError(f"{record['recordId']}: nutrients.{key}.decimalPlaces is invalid")
        normalized.append(record)
        hashes.append(digest)
        group_keys.append(key)

    maker_counts = Counter(normalized_maker(r["maker"]) for r in normalized)
    genre_counts = Counter(r["genreId"] for r in normalized)
    target_counts = Counter(
        key for r in normalized for key in validator.TARGET_NUTRIENTS
        if key in r["nutrients"] and r["nutrients"][key]["valueKind"] != "estimated"
    )
    max_share = max(maker_counts.values(), default=0) / len(normalized) if normalized else 0.0
    warnings: list[str] = []
    adequate = len(hashes) >= 30 and len(maker_counts) >= 3 and max_share <= 0.5
    if len(hashes) < 30:
        warnings.append(f"independent families below target: {len(hashes)}/30")
    if len(maker_counts) < 3:
        warnings.append(f"makers below target: {len(maker_counts)}/3")
    if max_share > 0.5:
        warnings.append(f"maximum maker share exceeds 0.5: {max_share:.6f}")
    report = {
        "format": "nutrition-estimator-sealed-evaluation-report",
        "formatVersion": 1,
        "familyCount": len(hashes),
        "makerCount": len(maker_counts),
        "makerFamilyCounts": dict(sorted(maker_counts.items())),
        "genreFamilyCounts": dict(sorted(genre_counts.items())),
        "nonEstimatedTargetCounts": dict(sorted(target_counts.items())),
        "maxMakerShare": max_share,
        "adequacy": adequate,
        "adequacyScope": "collection_family_and_maker_targets_only",
        "independentEvaluationMinimumPerNutrient": 30,
        "nutrientsBelowEvaluationMinimum": sorted(
            key for key in validator.TARGET_NUTRIENTS if target_counts[key] < 30
        ),
        "warnings": warnings,
        "familyHashes": sorted(hashes),
        "sourceFileSha256": None,
        "normalizedDatasetSha256": hashlib.sha256(canonical_dataset(normalized)).hexdigest(),
    }
    return normalized, group_keys, report


def build_sealed_manifest(
    normalized: list[dict[str, Any]], group_keys: list[str], source_path: Path,
    exclusions_sha256: str, sealed_at: str,
) -> dict[str, Any]:
    canonical = canonical_dataset(normalized)
    records = [
        {"recordId": r["recordId"], "genreId": r["genreId"], "groupKey": key, "split": "test"}
        for r, key in zip(normalized, group_keys, strict=True)
    ]
    return {
        "format": "nutrition-estimator-training-manifest",
        "formatVersion": 1,
        "seal": True,
        "sealed": True,
        "sealedAt": sealed_at,
        "sourceFile": source_path.name,
        "sourceFileSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "exclusionsFileSha256": exclusions_sha256,
        "normalizedDatasetSha256": hashlib.sha256(canonical).hexdigest(),
        "recordCount": len(normalized),
        "genreCounts": dict(sorted(Counter(r["genreId"] for r in normalized).items())),
        "splitCounts": {"test": len(normalized)},
        "records": records,
    }


def is_private_path(path: Path) -> bool:
    try:
        path.resolve().relative_to(PRIVATE_ROOT.resolve())
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="training JSON kept in the private estimator area")
    parser.add_argument("--excluded-family-hashes", type=Path, required=True)
    parser.add_argument("--output-manifest", type=Path, required=True)
    parser.add_argument("--public-report", type=Path)
    args = parser.parse_args()
    try:
        if not all(is_private_path(path) for path in (args.input, args.excluded_family_hashes, args.output_manifest)):
            raise validator.ValidationError("input, exclusions, and manifest must be under a private estimator directory")
        if args.output_manifest.exists():
            raise validator.ValidationError("sealed manifest already exists; refusing to overwrite")
        if args.public_report:
            resolved_paths = {args.input.resolve(), args.excluded_family_hashes.resolve(), args.output_manifest.resolve()}
            if args.public_report.resolve() in resolved_paths:
                raise validator.ValidationError("public report path must be distinct from private inputs and manifest")
            if args.public_report.exists():
                raise validator.ValidationError("public report already exists; refusing to overwrite")
        exclusions = json.loads(args.excluded_family_hashes.read_text(encoding="utf-8"))
        exclusions_sha256 = hashlib.sha256(args.excluded_family_hashes.read_bytes()).hexdigest()
        sealed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        raw_records = validator.load_records(args.input)
        normalized, group_keys, report = normalize_and_validate(raw_records, exclusions)
        report["sourceFileSha256"] = hashlib.sha256(args.input.read_bytes()).hexdigest()
        report["exclusionsFileSha256"] = exclusions_sha256
        report["sealedAt"] = sealed_at
        manifest = build_sealed_manifest(normalized, group_keys, args.input, exclusions_sha256, sealed_at)
        args.output_manifest.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents accidental replacement, including races.
        with args.output_manifest.open("x", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        if args.public_report:
            args.public_report.parent.mkdir(parents=True, exist_ok=True)
            args.public_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"manifest": str(args.output_manifest), "adequacy": report["adequacy"], "warnings": report["warnings"]}, ensure_ascii=False))
        return 0
    except (validator.ValidationError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
