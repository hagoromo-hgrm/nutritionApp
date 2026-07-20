#!/usr/bin/env python3
"""Convert the confirmed MEXT v2 grouping data into app-facing JSON.

This module only changes field shape and builds deterministic indexes.  It
does not classify foods, rename groups, or infer attributes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import unicodedata
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data/mext/processed"
DEFAULT_OUTPUT_DIR = ROOT / "data/mext/app"

GROUPS_INPUT = PROCESSED / "mext_food_groups_v2.json"
MAPPINGS_INPUT = PROCESSED / "mext_food_group_mappings_v2.json"
REVIEW_INPUT = PROCESSED / "mext_food_group_review_v2.json"
RESOLUTION_LOG_INPUT = PROCESSED / "mext_food_group_resolution_log_v2.json"
SUMMARY_INPUT = PROCESSED / "mext_food_group_summary_v2.json"
MEXT_FOODS_INPUT = PROCESSED / "mext_foods.json"

EXPECTED_GROUP_FIELDS = {
    "food_group_id",
    "canonical_name",
    "display_name",
    "parent_concept",
    "food_form",
    "key_parts",
    "search_terms",
    "fixed_attributes",
    "selectable_attributes",
    "source_count",
    "default_source_id",
    "needs_review",
    "group_warnings",
}
EXPECTED_MAPPING_FIELDS = {
    "source_id",
    "source_name",
    "food_group_id",
    "canonical_name",
    "attribute_values",
    "fixed_attribute_values",
    "variant_key",
}
SELECTABLE_ATTRIBUTE_FIELDS = {
    "attribute_id",
    "source_dimensions",
    "display_name",
    "ui_visibility",
    "required",
    "default_value_id",
    "values",
}
FIXED_ATTRIBUTE_FIELDS = {
    "attribute_id",
    "source_dimensions",
    "display_name",
    "ui_visibility",
    "value_id",
    "canonical_value",
    "value",
    "source_values",
}
ATTRIBUTE_VALUE_FIELDS = {
    "value_id",
    "canonical_value",
    "display_name",
    "source_values",
}
OPTIONAL_ATTRIBUTE_FIELDS = {"subtype"}


class AppDataBuildError(ValueError):
    """Raised when confirmed input cannot be converted without guessing."""


class VariantResolutionError(ValueError):
    """Base class for deterministic variant resolution failures."""


class FoodGroupNotFound(VariantResolutionError):
    pass


class MissingRequiredAttribute(VariantResolutionError):
    pass


class InvalidAttributeValue(VariantResolutionError):
    pass


class FoodVariantNotFound(VariantResolutionError):
    pass


class AmbiguousFoodVariant(VariantResolutionError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AppDataBuildError(f"JSONを読み込めません: {path}: {exc}") from exc


def _expect_exact_fields(
    value: dict[str, Any], expected: set[str], context: str, optional: set[str] | None = None
) -> None:
    optional = optional or set()
    actual = set(value)
    missing = expected - actual
    extra = actual - expected - optional
    if missing or extra:
        raise AppDataBuildError(
            f"{context}のフィールドが不正です: missing={sorted(missing)}, extra={sorted(extra)}"
        )


def validate_input_groups(groups: Any) -> list[dict[str, Any]]:
    if not isinstance(groups, list):
        raise AppDataBuildError("食品グループ入力はJSON配列である必要があります")
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for index, group in enumerate(groups):
        if not isinstance(group, dict):
            raise AppDataBuildError(f"食品グループ[{index}]がオブジェクトではありません")
        context = f"食品グループ[{index}] food_group_id={group.get('food_group_id')}"
        _expect_exact_fields(group, EXPECTED_GROUP_FIELDS, context)
        food_group_id = group["food_group_id"]
        canonical_name = group["canonical_name"]
        if not isinstance(food_group_id, str) or not re.fullmatch(r"fg_\d{6}", food_group_id):
            raise AppDataBuildError(f"{context}のfood_group_idが不正です")
        if food_group_id in seen_ids:
            raise AppDataBuildError(f"food_group_idが重複しています: {food_group_id}")
        if canonical_name in seen_names:
            raise AppDataBuildError(f"canonical_nameが重複しています: {canonical_name}")
        seen_ids.add(food_group_id)
        seen_names.add(canonical_name)
        if group["needs_review"] is not False:
            raise AppDataBuildError(f"要確認グループは本番変換できません: {food_group_id}")
        if not isinstance(group["search_terms"], list) or not all(
            isinstance(term, str) and term for term in group["search_terms"]
        ):
            raise AppDataBuildError(f"search_termsが不正です: {food_group_id}")
        for attribute in group["selectable_attributes"]:
            _expect_exact_fields(
                attribute,
                SELECTABLE_ATTRIBUTE_FIELDS,
                f"選択属性 {food_group_id}/{attribute.get('attribute_id')}",
                OPTIONAL_ATTRIBUTE_FIELDS,
            )
            if not isinstance(attribute["values"], list) or len(attribute["values"]) < 2:
                raise AppDataBuildError(
                    f"選択属性の値が2件未満です: {food_group_id}/{attribute['attribute_id']}"
                )
            for value in attribute["values"]:
                _expect_exact_fields(
                    value,
                    ATTRIBUTE_VALUE_FIELDS,
                    f"属性値 {food_group_id}/{attribute['attribute_id']}/{value.get('value_id')}",
                )
        for attribute in group["fixed_attributes"]:
            _expect_exact_fields(
                attribute,
                FIXED_ATTRIBUTE_FIELDS,
                f"固定属性 {food_group_id}/{attribute.get('attribute_id')}",
                OPTIONAL_ATTRIBUTE_FIELDS,
            )
    return groups


def validate_input_mappings(mappings: Any) -> list[dict[str, Any]]:
    if not isinstance(mappings, list):
        raise AppDataBuildError("マッピング入力はJSON配列である必要があります")
    seen_ids: set[str] = set()
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict):
            raise AppDataBuildError(f"マッピング[{index}]がオブジェクトではありません")
        context = f"マッピング[{index}] source_id={mapping.get('source_id')}"
        _expect_exact_fields(mapping, EXPECTED_MAPPING_FIELDS, context)
        source_id = mapping["source_id"]
        if not isinstance(source_id, str) or not re.fullmatch(r"mext_\d{5}", source_id):
            raise AppDataBuildError(f"{context}のsource_idが不正です")
        if source_id in seen_ids:
            raise AppDataBuildError(f"source_idが重複しています: {source_id}")
        seen_ids.add(source_id)
    return mappings


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().strip()
    return re.sub(r"\s+", " ", normalized)


def compact_search_text(value: str) -> str:
    return normalize_search_text(value).replace(" ", "")


def _deduplicate_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def explicit_search_terms(group: dict[str, Any]) -> list[str]:
    """Use only terms already present in confirmed group fields."""
    values = [
        group["canonical_name"],
        group["display_name"],
        *group["search_terms"],
    ]
    if group["parent_concept"]:
        values.append(group["parent_concept"])
    return _deduplicate_strings(values)


def build_food_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for group in groups:
        result.append(
            {
                "id": group["food_group_id"],
                "canonicalName": group["canonical_name"],
                "displayName": group["display_name"],
                "parentConcept": group["parent_concept"],
                "foodForm": group["food_form"],
                "keyParts": [
                    {"dimension": part["dimension"], "value": part["value"]}
                    for part in group["key_parts"]
                ],
                "searchTerms": explicit_search_terms(group),
                "hasSelectableAttributes": bool(group["selectable_attributes"]),
                "selectableAttributeCount": len(group["selectable_attributes"]),
                "fixedAttributeCount": len(group["fixed_attributes"]),
                "sourceCount": group["source_count"],
                "defaultSourceId": group["default_source_id"],
            }
        )
    return result


def _build_source_values(values: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {"dimension": value["dimension"], "value": value["value"]}
        for value in values
    ]


def build_food_group_attributes(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for group in groups:
        for attribute in group["selectable_attributes"]:
            converted: dict[str, Any] = {
                "foodGroupId": group["food_group_id"],
                "id": attribute["attribute_id"],
                "displayName": attribute["display_name"],
                "required": attribute["required"],
                "visibility": attribute["ui_visibility"],
                "defaultValueId": attribute["default_value_id"],
                "sourceDimensions": list(attribute["source_dimensions"]),
                "values": [
                    {
                        "id": value["value_id"],
                        "canonicalValue": value["canonical_value"],
                        "displayName": value["display_name"],
                        "isUnspecified": value["value_id"] == "unspecified",
                        "isNotApplicable": value["value_id"] == "not_applicable",
                        "isNoFilling": value["value_id"] == "no_filling",
                        "sourceValues": _build_source_values(value["source_values"]),
                    }
                    for value in attribute["values"]
                ],
            }
            if "subtype" in attribute:
                converted["subtype"] = attribute["subtype"]
            result.append(converted)
    return result


def build_food_group_fixed_attributes(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for group in groups:
        if not group["fixed_attributes"]:
            continue
        attributes: list[dict[str, Any]] = []
        for attribute in group["fixed_attributes"]:
            converted: dict[str, Any] = {
                "id": attribute["attribute_id"],
                "displayName": attribute["display_name"],
                "visibility": attribute["ui_visibility"],
                "valueId": attribute["value_id"],
                "canonicalValue": attribute["canonical_value"],
                "valueDisplayName": attribute["value"],
                "sourceDimensions": list(attribute["source_dimensions"]),
                "sourceValues": _build_source_values(attribute["source_values"]),
            }
            if "subtype" in attribute:
                converted["subtype"] = attribute["subtype"]
            attributes.append(converted)
        result.append({"foodGroupId": group["food_group_id"], "attributes": attributes})
    return result


def build_food_variants(mappings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "sourceId": mapping["source_id"],
            "sourceName": mapping["source_name"],
            "foodGroupId": mapping["food_group_id"],
            "canonicalName": mapping["canonical_name"],
            "attributes": dict(mapping["attribute_values"]),
            "fixedAttributes": dict(mapping["fixed_attribute_values"]),
            "variantKey": mapping["variant_key"],
        }
        for mapping in mappings
    ]


def build_search_index(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for group in groups:
        for source_term in explicit_search_terms(group):
            normalized_term = normalize_search_text(source_term)
            if not normalized_term:
                continue
            bucket = buckets.setdefault(
                normalized_term,
                {
                    "normalizedTerm": normalized_term,
                    "compactTerm": compact_search_text(source_term),
                    "sourceTerms": [],
                    "foodGroupIds": [],
                },
            )
            if source_term not in bucket["sourceTerms"]:
                bucket["sourceTerms"].append(source_term)
            if group["food_group_id"] not in bucket["foodGroupIds"]:
                bucket["foodGroupIds"].append(group["food_group_id"])
    return [buckets[key] for key in sorted(buckets)]


def build_variant_key(attributes: Mapping[str, str], attribute_order: Sequence[str]) -> str:
    if not attributes:
        return "default"
    parts = [
        f"{attribute_id}={attributes[attribute_id]}"
        for attribute_id in attribute_order
        if attribute_id in attributes
    ]
    unknown = sorted(set(attributes) - set(attribute_order))
    parts.extend(f"{attribute_id}={attributes[attribute_id]}" for attribute_id in unknown)
    return "|".join(parts)


def resolve_source_id(
    food_group_id: str,
    selected_attributes: Mapping[str, str],
    groups: Sequence[dict[str, Any]],
    attributes: Sequence[dict[str, Any]],
    variants: Sequence[dict[str, Any]],
) -> str:
    group = next((item for item in groups if item["id"] == food_group_id), None)
    if group is None:
        raise FoodGroupNotFound(f"食品グループがありません: food_group_id={food_group_id}")
    definitions = [item for item in attributes if item["foodGroupId"] == food_group_id]
    definitions_by_id = {item["id"]: item for item in definitions}
    unknown = sorted(set(selected_attributes) - set(definitions_by_id))
    if unknown:
        raise InvalidAttributeValue(
            f"未知の属性です: food_group_id={food_group_id}, attributes={unknown}"
        )
    missing = [
        item["id"]
        for item in definitions
        if item["required"] and item["id"] not in selected_attributes
    ]
    if missing:
        raise MissingRequiredAttribute(
            f"必須属性が不足しています: food_group_id={food_group_id}, attributes={missing}"
        )
    for attribute_id, value_id in selected_attributes.items():
        valid_values = {value["id"] for value in definitions_by_id[attribute_id]["values"]}
        if value_id not in valid_values:
            raise InvalidAttributeValue(
                "属性値が不正です: "
                f"food_group_id={food_group_id}, attribute_id={attribute_id}, value_id={value_id}"
            )
    variant_key = build_variant_key(selected_attributes, [item["id"] for item in definitions])
    matches = [
        variant
        for variant in variants
        if variant["foodGroupId"] == food_group_id and variant["variantKey"] == variant_key
    ]
    if not matches:
        raise FoodVariantNotFound(
            "対応する食品成分レコードがありません: "
            f"food_group_id={food_group_id}, variant_key={variant_key}"
        )
    if len(matches) > 1:
        raise AmbiguousFoodVariant(
            "食品成分レコードを一意に決定できません: "
            f"food_group_id={food_group_id}, variant_key={variant_key}"
        )
    return matches[0]["sourceId"]


def validate_output(
    input_groups: list[dict[str, Any]],
    input_mappings: list[dict[str, Any]],
    source_food_ids: set[str],
    food_groups: list[dict[str, Any]],
    attributes: list[dict[str, Any]],
    fixed_attributes: list[dict[str, Any]],
    variants: list[dict[str, Any]],
    search_index: list[dict[str, Any]],
) -> dict[str, int]:
    from validate_mext_food_app_data import validate_app_data

    return validate_app_data(
        input_groups=input_groups,
        input_mappings=input_mappings,
        source_food_ids=source_food_ids,
        food_groups=food_groups,
        attributes=attributes,
        fixed_attributes=fixed_attributes,
        variants=variants,
        search_index=search_index,
    )


def write_json_atomic(output_path: Path, data: Any) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            delete=False,
        ) as temporary_file:
            json.dump(data, temporary_file, ensure_ascii=False, indent=2, sort_keys=False)
            temporary_file.write("\n")
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def build_all(
    groups: list[dict[str, Any]], mappings: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    return {
        "food_groups.json": build_food_groups(groups),
        "food_group_attributes.json": build_food_group_attributes(groups),
        "food_group_fixed_attributes.json": build_food_group_fixed_attributes(groups),
        "food_variants.json": build_food_variants(mappings),
        "food_search_index.json": build_search_index(groups),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--groups", type=Path, default=GROUPS_INPUT)
    parser.add_argument("--mappings", type=Path, default=MAPPINGS_INPUT)
    parser.add_argument("--review", type=Path, default=REVIEW_INPUT)
    parser.add_argument("--resolution-log", type=Path, default=RESOLUTION_LOG_INPUT)
    parser.add_argument("--summary", type=Path, default=SUMMARY_INPUT)
    parser.add_argument("--mext-foods", type=Path, default=MEXT_FOODS_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    groups = validate_input_groups(load_json(args.groups))
    mappings = validate_input_mappings(load_json(args.mappings))
    review = load_json(args.review)
    resolution_log = load_json(args.resolution_log)
    input_summary = load_json(args.summary)
    mext_foods = load_json(args.mext_foods)

    if review != []:
        raise AppDataBuildError("要確認項目が残っているため本番データを生成できません")
    if not isinstance(resolution_log, list) or len(resolution_log) != input_summary["review_item_count_before"]:
        raise AppDataBuildError("解決ログ件数がv2集計と一致しません")
    if not all(item.get("resolved") is True for item in resolution_log):
        raise AppDataBuildError("未解決の解決ログがあります")
    if input_summary["review_item_count_after"] != 0 or input_summary["variant_collision_count"] != 0:
        raise AppDataBuildError("v2集計に要確認またはvariant衝突が残っています")
    if not isinstance(mext_foods, dict) or not isinstance(mext_foods.get("foods"), list):
        raise AppDataBuildError("mext_foods.jsonのfoods配列がありません")
    source_food_ids = {food["id"] for food in mext_foods["foods"]}

    outputs = build_all(groups, mappings)
    metrics = validate_output(
        groups,
        mappings,
        source_food_ids,
        outputs["food_groups.json"],
        outputs["food_group_attributes.json"],
        outputs["food_group_fixed_attributes.json"],
        outputs["food_variants.json"],
        outputs["food_search_index.json"],
    )
    build_summary = {
        "inputFoodGroupCount": len(groups),
        "inputMappingCount": len(mappings),
        "outputFoodGroupCount": len(outputs["food_groups.json"]),
        "outputVariantCount": len(outputs["food_variants.json"]),
        "selectableAttributeGroupCount": metrics["selectable_attribute_group_count"],
        "fixedAttributeOnlyGroupCount": metrics["fixed_attribute_only_group_count"],
        "noAttributeGroupCount": metrics["no_attribute_group_count"],
        "attributeDefinitionCount": len(outputs["food_group_attributes.json"]),
        "fixedAttributeCount": metrics["fixed_attribute_count"],
        "attributeValueCount": metrics["attribute_value_count"],
        "searchTermCount": len(outputs["food_search_index.json"]),
        "variantCollisionCount": metrics["variant_collision_count"],
        "duplicateFoodGroupIdCount": metrics["duplicate_food_group_id_count"],
        "duplicateSourceIdCount": metrics["duplicate_source_id_count"],
        "missingSourceIdCount": metrics["missing_source_id_count"],
        "invalidAttributeReferenceCount": metrics["invalid_attribute_reference_count"],
        "groupsWithoutResolvableVariantCount": metrics["groups_without_resolvable_variant_count"],
        "jsonReloadErrorCount": 0,
        "validationPassed": True,
    }
    for filename, value in outputs.items():
        write_json_atomic(args.output_dir / filename, value)
    write_json_atomic(args.output_dir / "build_summary.json", build_summary)

    for filename in (*outputs, "build_summary.json"):
        load_json(args.output_dir / filename)


if __name__ == "__main__":
    main()
