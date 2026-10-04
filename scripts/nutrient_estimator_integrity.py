"""Shared byte/canonical-hash, split and reviewed-family audit for teacher tools."""
from __future__ import annotations
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any
try:
    from . import validate_nutrient_estimator_training as validator
except ImportError:
    import validate_nutrient_estimator_training as validator
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
class AuditError(ValueError):
    pass
def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_dataset(records: list[dict[str, Any]]) -> bytes:
    return json.dumps(
        records, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AuditError(f"{label} could not be read as JSON") from exc
    if not isinstance(value, dict):
        raise AuditError(f"{label} must contain a JSON object")
    return value


def _reject_sealed_path(path: Path) -> None:
    if "sealed_20261003" in path.resolve().parts:
        raise AuditError("sealed evaluation inputs are not accepted")


def _strict_record_types(raw: Any) -> None:
    if not isinstance(raw, dict):
        raise AuditError("training record must be an object")
    for field in ("baseAmount", "referenceMassG"):
        value = raw.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise AuditError("training record numeric field has an invalid JSON type")
        if not math.isfinite(value):
            raise AuditError("training record numeric field must be finite")
    nutrients = raw.get("nutrients")
    if not isinstance(nutrients, dict):
        raise AuditError("training record nutrients must be an object")
    for label in nutrients.values():
        if not isinstance(label, dict):
            raise AuditError("nutrient label must be an object")
        for field in ("value", "rangeMin", "rangeMax"):
            value = label.get(field)
            if isinstance(value, bool):
                # Keep the raw label for explicit exclusion after canonical hashing.
                continue
            if value is not None and (
                not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise AuditError("nutrient numeric field has an invalid JSON type")
        decimal_places = label.get("decimalPlaces")
        if isinstance(decimal_places, bool) or not isinstance(decimal_places, int):
            raise AuditError("nutrient decimalPlaces must be a JSON integer")


def _strict_manifest_records(manifest: dict[str, Any]) -> list[dict[str, str]]:
    if "seal" in manifest or "sealed" in manifest:
        raise AuditError("sealed evaluation manifest is not accepted")
    if (
        manifest.get("format") != "nutrition-estimator-training-manifest"
        or type(manifest.get("formatVersion")) is not int
        or manifest.get("formatVersion") != 1
    ):
        raise AuditError("training manifest format is invalid")
    for field in ("sourceFileSha256", "normalizedDatasetSha256"):
        value = manifest.get(field)
        if not isinstance(value, str) or not HASH_RE.fullmatch(value):
            raise AuditError(f"training manifest {field} is invalid")
    if type(manifest.get("recordCount")) is not int or manifest["recordCount"] < 0:
        raise AuditError("training manifest recordCount is invalid")
    items = manifest.get("records")
    if not isinstance(items, list):
        raise AuditError("training manifest records must be an array")
    checked: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            raise AuditError("training manifest entry must be an object")
        record_id = item.get("recordId")
        genre_id = item.get("genreId")
        group_key = item.get("groupKey")
        split = item.get("split")
        if any(not isinstance(value, str) or not value for value in (record_id, genre_id, group_key)):
            raise AuditError("training manifest identity fields are invalid")
        if not isinstance(split, str) or split not in {"train", "calibration", "test"}:
            raise AuditError("training manifest split is invalid")
        checked.append({
            "recordId": record_id,
            "genreId": genre_id,
            "groupKey": group_key,
            "split": split,
        })
    return checked


def _validate_integrity(
    training: dict[str, Any],
    manifest: dict[str, Any],
    training_path: Path,
    manifest_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, dict[str, Any]]]:
    if (
        training.get("format") != "nutrition-estimator-training-data"
        or type(training.get("formatVersion")) is not int
        or training.get("formatVersion") != 1
    ):
        raise AuditError("training data format is invalid")
    raw_records = training.get("records")
    if not isinstance(raw_records, list):
        raise AuditError("training data records must be an array")
    manifest_records = _strict_manifest_records(manifest)
    if len(raw_records) != len(manifest_records) or manifest["recordCount"] != len(raw_records):
        raise AuditError("training data and manifest record counts differ")
    if file_sha256(training_path) != manifest["sourceFileSha256"]:
        raise AuditError("training source file SHA-256 does not match the manifest")

    normalized: list[dict[str, Any]] = []
    record_by_id: dict[str, dict[str, Any]] = {}
    raw_by_id: dict[str, dict[str, Any]] = {}
    for raw in raw_records:
        _strict_record_types(raw)
        try:
            record = validator.normalize_record(raw)
        except validator.ValidationError as exc:
            raise AuditError("training record does not pass strict normalization") from exc
        record_id = record["recordId"]
        if record_id in record_by_id:
            raise AuditError("training data contains duplicate record IDs")
        record_by_id[record_id] = record
        raw_by_id[record_id] = raw
        normalized.append(record)
    normalized_hash = hashlib.sha256(canonical_dataset(normalized)).hexdigest()
    if normalized_hash != manifest["normalizedDatasetSha256"]:
        raise AuditError("normalized canonical dataset SHA-256 does not match the manifest")

    split_by_record: dict[str, str] = {}
    group_split: dict[str, str] = {}
    manifest_by_id: dict[str, dict[str, str]] = {}
    for item in manifest_records:
        record_id = item["recordId"]
        if record_id in manifest_by_id:
            raise AuditError("training manifest contains duplicate record IDs")
        manifest_by_id[record_id] = item
        split = item["split"]
        group = item["groupKey"]
        prior_split = group_split.get(group)
        if prior_split is not None and prior_split != split:
            raise AuditError("a maker/product family leaks across dataset splits")
        group_split[group] = split
        split_by_record[record_id] = split
    if set(record_by_id) != set(manifest_by_id):
        raise AuditError("training data and manifest IDs are not a bijection")

    for record_id, record in record_by_id.items():
        entry = manifest_by_id[record_id]
        expected_group = validator.group_key(record["maker"], record["productFamily"])
        if entry["genreId"] != record["genreId"]:
            raise AuditError("training data and manifest genre IDs differ")
        if entry["groupKey"] != expected_group:
            raise AuditError("training data and manifest maker/product family groups differ")
    return normalized, split_by_record, raw_by_id



def reviewed_teacher_status(review: dict[str, Any] | None, training: dict[str, Any], manifest: dict[str, Any], *, require_strict: bool = False) -> dict[str, Any]:
    if review is None:
        if require_strict:
            raise AuditError("formal use requires reviewed label and family sidecar")
        return {"teacherAuditStatus": "legacy_unreviewed", "reviewedFamilyCount": 0}
    if review.get("format") != "nutrition-estimator-teacher-review" or review.get("formatVersion") != 1 or review.get("sourceFileSha256") != manifest["sourceFileSha256"] or review.get("normalizedDatasetSha256") != manifest["normalizedDatasetSha256"]:
        raise AuditError("review sidecar source hashes differ")
    rows = review.get("records")
    if not isinstance(rows, list):
        raise AuditError("review records must be an array")
    records = {r["recordId"]: r for r in training["records"]}
    manifest_rows = {r["recordId"]: r for r in manifest["records"]}
    seen, family_splits, reviewed_families = set(), {}, set()
    all_reviewed = True
    for row in rows:
        if not isinstance(row, dict) or row.get("recordId") not in records or row["recordId"] in seen:
            raise AuditError("review record IDs are not a bijection")
        record_id = row["recordId"]
        seen.add(record_id)
        record = records[record_id]
        family = row.get("canonicalFamilyId")
        if not isinstance(family, str) or not family.strip():
            raise AuditError("reviewed family ID is missing")
        split = manifest_rows[record_id]["split"]
        if family in family_splits and family_splits[family] != split:
            raise AuditError("reviewed family leaks across splits")
        family_splits[family] = split
        complete = row.get("status") == "reviewed" and isinstance(row.get("reviewer"), str) and bool(row["reviewer"].strip()) and isinstance(row.get("rationale"), str) and bool(row["rationale"].strip())
        try:
            reviewed_at = datetime.fromisoformat(row.get("reviewedAt", "").replace("Z", "+00:00"))
            if reviewed_at.tzinfo is None:
                complete = False
        except (ValueError, AttributeError):
            complete = False
        labels = row.get("labels", {})
        if not isinstance(labels, dict):
            raise AuditError("label reviews must be an object")
        for key, label in record["nutrients"].items():
            if label["valueKind"] == "estimated":
                continue
            proof = labels.get(key)
            complete = complete and isinstance(proof, dict) and proof.get("status") == "reviewed" and proof.get("annotationScope") in {"none", "per_nutrient", "whole_panel"} and proof.get("sourceType") in {"manufacturer", "package"} and isinstance(proof.get("sourceReference"), str) and bool(proof["sourceReference"].strip()) and proof.get("basis") == {"amount": record["referenceMassG"], "unit": "g"} and proof.get("stateConfirmed") is True
        if complete:
            reviewed_families.add(family)
        all_reviewed = all_reviewed and complete
    if seen != set(records):
        raise AuditError("review record IDs are not a bijection")
    if require_strict and not all_reviewed:
        raise AuditError("formal use requires all label and family reviews")
    return {"teacherAuditStatus": "strict_reviewed" if all_reviewed else "legacy_unreviewed", "reviewedFamilyCount": len(reviewed_families), "familyReviewSha256": hashlib.sha256(json.dumps(review, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
