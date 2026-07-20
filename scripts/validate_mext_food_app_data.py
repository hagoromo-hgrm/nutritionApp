#!/usr/bin/env python3
"""Validate production MEXT food-group data and its confirmed v2 inputs."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data/mext/processed"
APP_DATA = ROOT / "data/mext/app"


class AppDataValidationError(ValueError):
    """Raised with the relevant group/source ID when app data is invalid."""


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AppDataValidationError(f"JSONを読み込めません: {path}: {exc}") from exc


def _duplicate_count(values: list[str]) -> int:
    return len(values) - len(set(values))


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AppDataValidationError(message)


def validate_app_data(
    *,
    input_groups: list[dict[str, Any]],
    input_mappings: list[dict[str, Any]],
    source_food_ids: set[str],
    food_groups: list[dict[str, Any]],
    attributes: list[dict[str, Any]],
    fixed_attributes: list[dict[str, Any]],
    variants: list[dict[str, Any]],
    search_index: list[dict[str, Any]],
) -> dict[str, int]:
    _assert(len(input_groups) == len(food_groups) == 1494, "食品グループ数が1,494件ではありません")
    _assert(len(input_mappings) == len(variants) == 2538, "variant数が2,538件ではありません")

    input_groups_by_id = {group["food_group_id"]: group for group in input_groups}
    input_mappings_by_id = {mapping["source_id"]: mapping for mapping in input_mappings}
    group_ids = [group["id"] for group in food_groups]
    source_ids = [variant["sourceId"] for variant in variants]
    duplicate_group_ids = _duplicate_count(group_ids)
    duplicate_source_ids = _duplicate_count(source_ids)
    _assert(duplicate_group_ids == 0, f"food_group_idが重複しています: {duplicate_group_ids}件")
    _assert(duplicate_source_ids == 0, f"source_idが重複しています: {duplicate_source_ids}件")
    _assert(set(group_ids) == set(input_groups_by_id), "入力から欠落・追加されたfood_group_idがあります")
    _assert(set(source_ids) == set(input_mappings_by_id), "入力から欠落・追加されたsource_idがあります")
    missing_source_ids = set(input_mappings_by_id) - source_food_ids
    extra_source_ids = source_food_ids - set(input_mappings_by_id)
    _assert(
        not missing_source_ids and not extra_source_ids,
        "元食品成分レコードとのsource_id集合が一致しません: "
        f"missing_food_records={sorted(missing_source_ids)[:5]}, "
        f"missing_mappings={sorted(extra_source_ids)[:5]}",
    )

    groups_by_id = {group["id"]: group for group in food_groups}
    attributes_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attribute in attributes:
        food_group_id = attribute["foodGroupId"]
        _assert(food_group_id in groups_by_id, f"選択属性の参照先がありません: food_group_id={food_group_id}")
        attributes_by_group[food_group_id].append(attribute)
    fixed_by_group: dict[str, dict[str, Any]] = {}
    for record in fixed_attributes:
        food_group_id = record["foodGroupId"]
        _assert(food_group_id in groups_by_id, f"固定属性の参照先がありません: food_group_id={food_group_id}")
        _assert(food_group_id not in fixed_by_group, f"固定属性レコードが重複しています: food_group_id={food_group_id}")
        fixed_by_group[food_group_id] = record

    variants_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    variant_pairs: list[tuple[str, str]] = []
    invalid_attribute_references = 0
    for variant in variants:
        source_id = variant["sourceId"]
        food_group_id = variant["foodGroupId"]
        _assert(food_group_id in groups_by_id, f"variantの食品グループがありません: source_id={source_id}, food_group_id={food_group_id}")
        input_mapping = input_mappings_by_id[source_id]
        _assert(variant["sourceName"] == input_mapping["source_name"], f"source_nameが変化しています: source_id={source_id}")
        _assert(food_group_id == input_mapping["food_group_id"], f"food_group_idが変化しています: source_id={source_id}")
        _assert(variant["canonicalName"] == input_mapping["canonical_name"], f"canonical_nameが変化しています: source_id={source_id}")
        _assert(variant["variantKey"] == input_mapping["variant_key"], f"variant_keyが変化しています: source_id={source_id}")
        _assert(variant["attributes"] == input_mapping["attribute_values"], f"選択属性が変化しています: source_id={source_id}")
        _assert(variant["fixedAttributes"] == input_mapping["fixed_attribute_values"], f"固定属性が変化しています: source_id={source_id}")

        definitions = attributes_by_group[food_group_id]
        definitions_by_id = {attribute["id"]: attribute for attribute in definitions}
        fixed_definitions = {
            attribute["id"]: attribute
            for attribute in fixed_by_group.get(food_group_id, {"attributes": []})["attributes"]
        }
        if set(variant["attributes"]) != set(definitions_by_id):
            invalid_attribute_references += 1
            raise AppDataValidationError(
                f"variantの属性次元が定義と一致しません: source_id={source_id}, food_group_id={food_group_id}"
            )
        if set(variant["fixedAttributes"]) != set(fixed_definitions):
            invalid_attribute_references += 1
            raise AppDataValidationError(
                f"variantの固定属性が定義と一致しません: source_id={source_id}, food_group_id={food_group_id}"
            )
        for attribute in definitions:
            attribute_id = attribute["id"]
            if attribute["required"] and attribute_id not in variant["attributes"]:
                invalid_attribute_references += 1
                raise AppDataValidationError(
                    f"required属性がありません: source_id={source_id}, attribute_id={attribute_id}"
                )
            valid_values = {value["id"] for value in attribute["values"]}
            if variant["attributes"][attribute_id] not in valid_values:
                invalid_attribute_references += 1
                raise AppDataValidationError(
                    f"属性値参照が不正です: source_id={source_id}, attribute_id={attribute_id}, "
                    f"value_id={variant['attributes'][attribute_id]}"
                )
        for attribute_id, value_id in variant["fixedAttributes"].items():
            if fixed_definitions[attribute_id]["valueId"] != value_id:
                invalid_attribute_references += 1
                raise AppDataValidationError(
                    f"固定属性値参照が不正です: source_id={source_id}, attribute_id={attribute_id}, value_id={value_id}"
                )
        expected_key = (
            "|".join(
                f"{attribute['id']}={variant['attributes'][attribute['id']]}"
                for attribute in definitions
            )
            if definitions
            else "default"
        )
        _assert(expected_key == variant["variantKey"], f"属性順またはvariant_keyが不正です: source_id={source_id}")
        variant_pairs.append((food_group_id, variant["variantKey"]))
        variants_by_group[food_group_id].append(variant)

    variant_collision_count = _duplicate_count([f"{group_id}\0{key}" for group_id, key in variant_pairs])
    _assert(variant_collision_count == 0, f"variant衝突があります: {variant_collision_count}件")

    groups_without_resolvable_variant = 0
    for group in food_groups:
        food_group_id = group["id"]
        input_group = input_groups_by_id[food_group_id]
        _assert(group["canonicalName"] == input_group["canonical_name"], f"canonical_nameが変化しています: food_group_id={food_group_id}")
        _assert(group["displayName"] == input_group["display_name"], f"display_nameが変化しています: food_group_id={food_group_id}")
        _assert(group["parentConcept"] == input_group["parent_concept"], f"parent_conceptが変化しています: food_group_id={food_group_id}")
        _assert(group["foodForm"] == input_group["food_form"], f"food_formが変化しています: food_group_id={food_group_id}")
        _assert(group["defaultSourceId"] == input_group["default_source_id"], f"default_source_idが変化しています: food_group_id={food_group_id}")
        allowed_search_terms: list[str] = []
        for term in [input_group["canonical_name"], input_group["display_name"], *input_group["search_terms"], input_group["parent_concept"]]:
            if term and term not in allowed_search_terms:
                allowed_search_terms.append(term)
        _assert(group["searchTerms"] == allowed_search_terms, f"入力にない検索語または順序変更があります: food_group_id={food_group_id}")
        _assert(group["sourceCount"] == len(variants_by_group[food_group_id]), f"sourceCountが不正です: food_group_id={food_group_id}")
        definitions = attributes_by_group[food_group_id]
        fixed = fixed_by_group.get(food_group_id, {"attributes": []})["attributes"]
        _assert(group["selectableAttributeCount"] == len(definitions), f"選択属性数が不正です: food_group_id={food_group_id}")
        _assert(group["fixedAttributeCount"] == len(fixed), f"固定属性数が不正です: food_group_id={food_group_id}")
        if not definitions:
            group_variants = variants_by_group[food_group_id]
            if len(group_variants) != 1:
                groups_without_resolvable_variant += 1
                raise AppDataValidationError(
                    f"選択属性なしグループを一意に解決できません: food_group_id={food_group_id}, variants={len(group_variants)}"
                )
            _assert(
                group["defaultSourceId"] == group_variants[0]["sourceId"],
                f"defaultSourceIdが不正です: food_group_id={food_group_id}",
            )
        elif group["defaultSourceId"] is not None:
            _assert(
                any(variant["sourceId"] == group["defaultSourceId"] for variant in variants_by_group[food_group_id]),
                f"defaultSourceIdのvariantがありません: food_group_id={food_group_id}",
            )

    for attribute in attributes:
        food_group_id = attribute["foodGroupId"]
        value_ids = [value["id"] for value in attribute["values"]]
        _assert(len(value_ids) == len(set(value_ids)), f"属性値IDが重複しています: food_group_id={food_group_id}, attribute_id={attribute['id']}")
        _assert(len(value_ids) >= 2, f"単一値が選択属性に残っています: food_group_id={food_group_id}, attribute_id={attribute['id']}")
        if attribute["defaultValueId"] is not None:
            _assert(attribute["defaultValueId"] in value_ids, f"defaultValueIdが不正です: food_group_id={food_group_id}, attribute_id={attribute['id']}")
        for value in attribute["values"]:
            _assert(value["isUnspecified"] == (value["id"] == "unspecified"), f"指定なしフラグが不正です: food_group_id={food_group_id}, attribute_id={attribute['id']}, value_id={value['id']}")
            _assert(value["isNotApplicable"] == (value["id"] == "not_applicable"), f"該当なしフラグが不正です: food_group_id={food_group_id}, attribute_id={attribute['id']}, value_id={value['id']}")
            _assert(value["isNoFilling"] == (value["id"] == "no_filling"), f"中身なしフラグが不正です: food_group_id={food_group_id}, attribute_id={attribute['id']}, value_id={value['id']}")

    allowed_terms_by_group = {
        group["id"]: set(group["searchTerms"]) for group in food_groups
    }
    normalized_terms: list[str] = []
    for entry in search_index:
        normalized_term = entry["normalizedTerm"]
        normalized_terms.append(normalized_term)
        _assert(normalized_term, "空の検索語があります")
        for food_group_id in entry["foodGroupIds"]:
            _assert(food_group_id in groups_by_id, f"検索インデックスの食品グループがありません: food_group_id={food_group_id}")
        for source_term in entry["sourceTerms"]:
            matching_groups = [
                food_group_id
                for food_group_id in entry["foodGroupIds"]
                if source_term in allowed_terms_by_group[food_group_id]
            ]
            _assert(bool(matching_groups), f"入力にない検索語です: term={source_term}")
    _assert(len(normalized_terms) == len(set(normalized_terms)), "検索インデックスのnormalizedTermが重複しています")

    selectable_groups = sum(bool(attributes_by_group[group["id"]]) for group in food_groups)
    fixed_only_groups = sum(
        not attributes_by_group[group["id"]] and bool(fixed_by_group.get(group["id"], {"attributes": []})["attributes"])
        for group in food_groups
    )
    no_attribute_groups = sum(
        not attributes_by_group[group["id"]] and not fixed_by_group.get(group["id"], {"attributes": []})["attributes"]
        for group in food_groups
    )
    _assert(
        (selectable_groups, fixed_only_groups, no_attribute_groups) == (478, 403, 613),
        "属性分類件数が不正です: "
        f"selectable={selectable_groups}, fixed_only={fixed_only_groups}, none={no_attribute_groups}",
    )
    _assert(selectable_groups + fixed_only_groups + no_attribute_groups == 1494, "属性分類の合計が不正です")

    return {
        "selectable_attribute_group_count": selectable_groups,
        "fixed_attribute_only_group_count": fixed_only_groups,
        "no_attribute_group_count": no_attribute_groups,
        "fixed_attribute_count": sum(len(record["attributes"]) for record in fixed_attributes),
        "attribute_value_count": sum(len(attribute["values"]) for attribute in attributes),
        "variant_collision_count": variant_collision_count,
        "duplicate_food_group_id_count": duplicate_group_ids,
        "duplicate_source_id_count": duplicate_source_ids,
        "missing_source_id_count": len(set(input_mappings_by_id) - set(source_ids)),
        "invalid_attribute_reference_count": invalid_attribute_references,
        "groups_without_resolvable_variant_count": groups_without_resolvable_variant,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--groups-input", type=Path, default=PROCESSED / "mext_food_groups_v2.json")
    parser.add_argument("--mappings-input", type=Path, default=PROCESSED / "mext_food_group_mappings_v2.json")
    parser.add_argument("--mext-foods", type=Path, default=PROCESSED / "mext_foods.json")
    parser.add_argument("--app-data", type=Path, default=APP_DATA)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_groups = load_json(args.groups_input)
    input_mappings = load_json(args.mappings_input)
    mext_foods = load_json(args.mext_foods)
    food_groups = load_json(args.app_data / "food_groups.json")
    attributes = load_json(args.app_data / "food_group_attributes.json")
    fixed_attributes = load_json(args.app_data / "food_group_fixed_attributes.json")
    variants = load_json(args.app_data / "food_variants.json")
    search_index = load_json(args.app_data / "food_search_index.json")
    summary = load_json(args.app_data / "build_summary.json")
    metrics = validate_app_data(
        input_groups=input_groups,
        input_mappings=input_mappings,
        source_food_ids={food["id"] for food in mext_foods["foods"]},
        food_groups=food_groups,
        attributes=attributes,
        fixed_attributes=fixed_attributes,
        variants=variants,
        search_index=search_index,
    )
    expected_summary_values = {
        "inputFoodGroupCount": 1494,
        "inputMappingCount": 2538,
        "outputFoodGroupCount": 1494,
        "outputVariantCount": 2538,
        "selectableAttributeGroupCount": 478,
        "fixedAttributeOnlyGroupCount": 403,
        "noAttributeGroupCount": 613,
        "variantCollisionCount": 0,
        "duplicateFoodGroupIdCount": 0,
        "duplicateSourceIdCount": 0,
        "missingSourceIdCount": 0,
        "invalidAttributeReferenceCount": 0,
        "groupsWithoutResolvableVariantCount": 0,
        "jsonReloadErrorCount": 0,
        "validationPassed": True,
    }
    for key, expected in expected_summary_values.items():
        _assert(summary.get(key) == expected, f"build_summaryが不正です: {key}={summary.get(key)!r}, expected={expected!r}")
    _assert(summary["attributeDefinitionCount"] == len(attributes), "選択属性定義数が不正です")
    _assert(summary["fixedAttributeCount"] == metrics["fixed_attribute_count"], "固定属性数が不正です")
    _assert(summary["attributeValueCount"] == metrics["attribute_value_count"], "属性値数が不正です")
    _assert(summary["searchTermCount"] == len(search_index), "検索インデックス件数が不正です")
    print(json.dumps({"validationPassed": True, **metrics}, ensure_ascii=False))


if __name__ == "__main__":
    main()
