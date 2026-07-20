#!/usr/bin/env python3
"""Resolve only the review items emitted by build_food_groups_v1.py.

The v1 food-group and mapping objects outside the review scope are treated as
immutable inputs.  Missing attributes are not inferred: the existing
``unspecified`` value is confirmed unless the source name itself makes
non-applicability explicit.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data/mext/processed"

DEFAULT_GROUPS_V1 = PROCESSED / "mext_food_groups_v1.json"
DEFAULT_MAPPINGS_V1 = PROCESSED / "mext_food_group_mappings_v1.json"
DEFAULT_REVIEW_V1 = PROCESSED / "mext_food_group_review_v1.json"
DEFAULT_SUMMARY_V1 = PROCESSED / "mext_food_group_summary_v1.json"

DEFAULT_GROUPS_V2 = PROCESSED / "mext_food_groups_v2.json"
DEFAULT_MAPPINGS_V2 = PROCESSED / "mext_food_group_mappings_v2.json"
DEFAULT_REVIEW_V2 = PROCESSED / "mext_food_group_review_v2.json"
DEFAULT_LOG_V2 = PROCESSED / "mext_food_group_resolution_log_v2.json"
DEFAULT_SUMMARY_V2 = PROCESSED / "mext_food_group_summary_v2.json"

ATTRIBUTE_ORDER = (
    "variety",
    "breed",
    "origin",
    "grade",
    "part",
    "form",
    "processing_state",
    "preservation_state",
    "cooking_state",
    "skin_state",
    "fat_state",
    "bone_state",
    "liquid_state",
    "filling",
    "filling_ingredient",
    "flavor",
    "use",
    "other",
)
ATTRIBUTE_RANK = {value: index for index, value in enumerate(ATTRIBUTE_ORDER)}

ATTRIBUTE_DISPLAY_NAMES = {
    "variety": "種類",
    "breed": "品種",
    "origin": "産地・由来",
    "grade": "等級",
    "part": "部位",
    "form": "形状",
    "processing_state": "加工状態",
    "preservation_state": "保存状態",
    "cooking_state": "調理状態",
    "skin_state": "皮",
    "fat_state": "脂身",
    "bone_state": "骨・殻",
    "liquid_state": "液汁",
    "filling": "中身",
    "filling_ingredient": "中身の材料",
    "flavor": "味",
    "use": "用途",
    "other": "その他",
    "state": "状態",
}

PREDEFINED_VALUE_IDS = {
    "指定なし": "unspecified",
    "該当なし": "not_applicable",
    "中身なし": "no_filling",
}

FILLING_GROUPS = {
    "イーストドーナッツ",
    "ケーキドーナッツ",
    "デニッシュペストリー",
    "生八つ橋",
}

DIMENSION_MERGES: dict[str, tuple[str, tuple[str, ...], str]] = {
    "ビール": ("variety", ("variety", "other"), "種類"),
    "トマトジュース": ("use", ("use", "other"), "食塩の使用"),
    "ミックスジュース": ("use", ("use", "other"), "食塩の使用"),
    "ガーリックパウダー": ("use", ("use", "other"), "食塩の使用"),
    "アイスクリーム": ("form", ("processing_state", "other"), "脂肪区分"),
    "野菜ミックスジュース": ("variety", ("variety", "processing_state"), "種類"),
    "ショートケーキ": ("form", ("form", "other"), "果実"),
    "カレーパン": ("form", ("form", "skin_state", "other"), "構成"),
}

TEA_GROUPS = {"せん茶", "ほうじ茶", "玉露", "番茶", "紅茶"}
FOOD_FORM_GROUPS = {"しょうが", "とうがらし", "にんにく", "わさび", "バジル", "パセリ"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def deduplicate_dicts(values: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, str]] = []
    for value in values:
        key = (value["dimension"], value["value"])
        if key not in seen:
            seen.add(key)
            result.append(copy.deepcopy(value))
    return sorted(result, key=lambda value: (ATTRIBUTE_RANK.get(value["dimension"], 999), value["dimension"], value["value"]))


def axis_from_review(item: dict[str, Any]) -> str | None:
    match = re.match(r"(.+?)が一部レコードにだけ存在", item["description"])
    return match.group(1) if match else None


def recalculate_mapping(group: dict[str, Any], mapping: dict[str, Any]) -> None:
    selectable_ids = [attribute["attribute_id"] for attribute in group["selectable_attributes"]]
    mapping["attribute_values"] = {
        attribute_id: mapping["attribute_values"][attribute_id]
        for attribute_id in selectable_ids
    }
    mapping["variant_key"] = (
        "|".join(
            f"{attribute_id}={mapping['attribute_values'][attribute_id]}"
            for attribute_id in selectable_ids
        )
        if selectable_ids
        else "default"
    )


class ValueIdRegistry:
    """Keep value IDs stable and common within each attribute dimension."""

    def __init__(self, groups: list[dict[str, Any]]) -> None:
        self.by_value: dict[str, dict[str, str]] = defaultdict(dict)
        self.by_id: dict[str, dict[str, str]] = defaultdict(dict)
        self.next_number: dict[str, int] = defaultdict(lambda: 1)
        for group in groups:
            for attribute in group["fixed_attributes"]:
                self._seed(attribute["attribute_id"], attribute["canonical_value"], attribute["value_id"])
            for attribute in group["selectable_attributes"]:
                for value in attribute["values"]:
                    self._seed(attribute["attribute_id"], value["canonical_value"], value["value_id"])

    def _seed(self, dimension: str, canonical_value: str, value_id: str) -> None:
        existing = self.by_value[dimension].get(canonical_value)
        if existing is not None:
            assert existing == value_id, f"inconsistent value ID: {dimension}/{canonical_value}"
        owner = self.by_id[dimension].get(value_id)
        if owner is not None:
            assert owner == canonical_value, f"duplicate value ID: {dimension}/{value_id}"
        self.by_value[dimension][canonical_value] = value_id
        self.by_id[dimension][value_id] = canonical_value
        numeric = re.fullmatch(r"v_(\d+)", value_id)
        if numeric:
            self.next_number[dimension] = max(self.next_number[dimension], int(numeric.group(1)) + 1)

    def get(self, dimension: str, canonical_value: str) -> str:
        existing = self.by_value[dimension].get(canonical_value)
        if existing is not None:
            return existing
        predefined = PREDEFINED_VALUE_IDS.get(canonical_value)
        if predefined and (
            predefined not in self.by_id[dimension]
            or self.by_id[dimension][predefined] == canonical_value
        ):
            self._seed(dimension, canonical_value, predefined)
            return predefined
        while True:
            value_id = f"v_{self.next_number[dimension]:03d}"
            self.next_number[dimension] += 1
            if value_id not in self.by_id[dimension]:
                self._seed(dimension, canonical_value, value_id)
                return value_id


def attribute_snapshot(
    group: dict[str, Any], mappings: list[dict[str, Any]]
) -> dict[str, dict[str, dict[str, Any]]]:
    definitions = {
        attribute["attribute_id"]: attribute for attribute in group["selectable_attributes"]
    }
    values = {
        attribute_id: {value["value_id"]: value for value in attribute["values"]}
        for attribute_id, attribute in definitions.items()
    }
    snapshots: dict[str, dict[str, dict[str, Any]]] = {}
    for mapping in mappings:
        by_axis: dict[str, dict[str, Any]] = {}
        for attribute_id, value_id in mapping["attribute_values"].items():
            value = values[attribute_id][value_id]
            by_axis[attribute_id] = {
                "canonical_value": value["canonical_value"],
                "display_name": value["display_name"],
                "source_values": copy.deepcopy(value.get("source_values", [])),
            }
        snapshots[mapping["source_id"]] = by_axis
    return snapshots


def meaningful_component(
    snapshot: dict[str, dict[str, Any]], source_axes: tuple[str, ...]
) -> tuple[str, list[dict[str, str]]]:
    for source_axis in source_axes:
        component = snapshot.get(source_axis)
        if component and component["canonical_value"] != "指定なし":
            source_values = component["source_values"] or [
                {"dimension": source_axis, "value": component["canonical_value"]}
            ]
            return component["canonical_value"], copy.deepcopy(source_values)
    raise AssertionError(f"no meaningful component in {source_axes}: {snapshot}")


Resolver = Callable[
    [dict[str, Any], dict[str, dict[str, Any]]],
    tuple[str, list[dict[str, str]]],
]


def rebuild_selectable_axis(
    group: dict[str, Any],
    mappings: list[dict[str, Any]],
    registry: ValueIdRegistry,
    target_axis: str,
    source_axes: tuple[str, ...],
    display_name: str,
    resolver: Resolver,
    *,
    ui_visibility: str = "primary",
) -> None:
    old_attributes = group["selectable_attributes"]
    snapshots = attribute_snapshot(group, mappings)
    source_definitions = [
        attribute for attribute in old_attributes if attribute["attribute_id"] in source_axes
    ]
    assert source_definitions, f"missing source axes for {group['canonical_name']}: {source_axes}"
    insertion_index = min(
        index
        for index, attribute in enumerate(old_attributes)
        if attribute["attribute_id"] in source_axes
    )

    resolved: dict[str, tuple[str, list[dict[str, str]]]] = {}
    value_sources: dict[str, list[dict[str, str]]] = defaultdict(list)
    frequencies: Counter[str] = Counter()
    source_dimensions: list[str] = []
    for definition in source_definitions:
        for dimension in definition.get("source_dimensions", []):
            if dimension not in source_dimensions:
                source_dimensions.append(dimension)

    for mapping in mappings:
        canonical_value, source_values = resolver(mapping, snapshots[mapping["source_id"]])
        assert canonical_value
        source_values = deduplicate_dicts(source_values)
        resolved[mapping["source_id"]] = (canonical_value, source_values)
        value_sources[canonical_value].extend(source_values)
        frequencies[canonical_value] += 1
        for source_value in source_values:
            if source_value["dimension"] not in source_dimensions:
                source_dimensions.append(source_value["dimension"])

    def value_sort_key(value: str) -> tuple[int, str]:
        if value == "中身なし":
            return (0, value)
        if value == "該当なし":
            return (8, value)
        if value == "指定なし":
            return (9, value)
        return (1, value)

    canonical_values = sorted(value_sources, key=value_sort_key)
    assert len(canonical_values) > 1, (
        f"single-value selectable attribute generated: {group['canonical_name']}/{target_axis}"
    )
    rendered_values = [
        {
            "value_id": registry.get(target_axis, canonical_value),
            "canonical_value": canonical_value,
            "display_name": canonical_value,
            "source_values": deduplicate_dicts(value_sources[canonical_value]),
        }
        for canonical_value in canonical_values
    ]

    default_value: str | None = None
    if "生" in frequencies:
        default_value = "生"
    elif "指定なし" in frequencies:
        default_value = "指定なし"
    elif frequencies:
        maximum = max(frequencies.values())
        winners = sorted(value for value, count in frequencies.items() if count == maximum)
        if len(winners) == 1:
            default_value = winners[0]

    new_attribute = {
        "attribute_id": target_axis,
        "source_dimensions": sorted(
            source_dimensions,
            key=lambda value: (ATTRIBUTE_RANK.get(value, 999), value),
        ),
        "display_name": display_name,
        "ui_visibility": ui_visibility,
        "required": True,
        "default_value_id": registry.get(target_axis, default_value) if default_value else None,
        "values": rendered_values,
    }
    retained = [
        attribute for attribute in old_attributes if attribute["attribute_id"] not in source_axes
    ]
    retained.insert(insertion_index, new_attribute)
    group["selectable_attributes"] = retained

    for mapping in mappings:
        old_values = mapping["attribute_values"]
        for source_axis in source_axes:
            old_values.pop(source_axis, None)
        canonical_value = resolved[mapping["source_id"]][0]
        old_values[target_axis] = registry.get(target_axis, canonical_value)
        recalculate_mapping(group, mapping)


def replace_unspecified_with_not_applicable(
    group: dict[str, Any],
    mappings: list[dict[str, Any]],
    registry: ValueIdRegistry,
    attribute_id: str,
) -> None:
    attribute = next(
        attribute
        for attribute in group["selectable_attributes"]
        if attribute["attribute_id"] == attribute_id
    )
    unspecified = next(
        value for value in attribute["values"] if value["canonical_value"] == "指定なし"
    )
    old_id = unspecified["value_id"]
    new_id = registry.get(attribute_id, "該当なし")
    unspecified.update(
        {
            "value_id": new_id,
            "canonical_value": "該当なし",
            "display_name": "該当なし",
            "source_values": [],
        }
    )
    if attribute["default_value_id"] == old_id:
        attribute["default_value_id"] = new_id
    for mapping in mappings:
        if mapping["attribute_values"].get(attribute_id) == old_id:
            # In these tea series, the source name explicitly distinguishes
            # the dry tea record (茶) from the infusion record (浸出液).
            assert "浸出液" not in mapping["source_name"]
            mapping["attribute_values"][attribute_id] = new_id
            recalculate_mapping(group, mapping)


def filling_resolver(
    mapping: dict[str, Any], snapshot: dict[str, dict[str, Any]]
) -> tuple[str, list[dict[str, str]]]:
    if "プレーン" in mapping["source_name"]:
        variety = snapshot.get("variety")
        source_values = (
            variety["source_values"]
            if variety and variety["source_values"]
            else [{"dimension": "variety", "value": "プレーン"}]
        )
        return "中身なし", copy.deepcopy(source_values)

    ingredient = snapshot.get("filling_ingredient")
    assert ingredient and ingredient["canonical_value"] != "指定なし", mapping["source_id"]
    canonical_value = ingredient["canonical_value"]
    if canonical_value.endswith("入り"):
        canonical_value = canonical_value[: -len("入り")]
    source_values = copy.deepcopy(ingredient["source_values"])
    filling = snapshot.get("filling")
    if filling and filling["canonical_value"] != "指定なし":
        source_values.extend(filling["source_values"])
    return canonical_value, source_values


def resolve_filling_group(
    group: dict[str, Any],
    mappings: list[dict[str, Any]],
    registry: ValueIdRegistry,
) -> None:
    canonical_name = group["canonical_name"]
    if canonical_name in {"イーストドーナッツ", "ケーキドーナッツ"}:
        source_axes = ("variety", "filling", "filling_ingredient")
    else:
        source_axes = ("filling", "filling_ingredient")
    rebuild_selectable_axis(
        group,
        mappings,
        registry,
        "filling",
        source_axes,
        "中身",
        filling_resolver,
    )

    if canonical_name == "デニッシュペストリー":
        def danish_variety(
            mapping: dict[str, Any], snapshot: dict[str, dict[str, Any]]
        ) -> tuple[str, list[dict[str, str]]]:
            if "アメリカンタイプ" in mapping["source_name"]:
                canonical_value = "アメリカンタイプ"
            elif "デンマークタイプ" in mapping["source_name"]:
                canonical_value = "デンマークタイプ"
            else:
                raise AssertionError(mapping["source_name"])
            component = snapshot["variety"]
            return canonical_value, component["source_values"] or [
                {"dimension": "variety", "value": component["canonical_value"]}
            ]

        rebuild_selectable_axis(
            group,
            mappings,
            registry,
            "variety",
            ("variety",),
            "種類",
            danish_variety,
            ui_visibility="optional",
        )


def merge_dimension_group(
    group: dict[str, Any],
    mappings: list[dict[str, Any]],
    registry: ValueIdRegistry,
    target_axis: str,
    source_axes: tuple[str, ...],
    display_name: str,
) -> None:
    def resolver(
        _mapping: dict[str, Any], snapshot: dict[str, dict[str, Any]]
    ) -> tuple[str, list[dict[str, str]]]:
        return meaningful_component(snapshot, source_axes)

    rebuild_selectable_axis(
        group,
        mappings,
        registry,
        target_axis,
        source_axes,
        display_name,
        resolver,
    )


def remove_resolved_warning(group: dict[str, Any], item: dict[str, Any]) -> None:
    if item["issue_type"] == "food_form_conflict":
        warning = "food_formがグループ内で一致しない"
    else:
        axis = axis_from_review(item)
        assert axis is not None
        warning = f"{axis}の欠落を「指定なし」として保持"
    group["group_warnings"] = [
        existing for existing in group["group_warnings"] if existing != warning
    ]


def resolution_for_item(
    item: dict[str, Any], canonical_name: str
) -> tuple[list[str], str, list[str], str]:
    axis = axis_from_review(item)
    common_changes = ["needs_review", "group_warnings"]
    structural_changes = [
        "selectable_attributes",
        "mappings.attribute_values",
        "mappings.variant_key",
        *common_changes,
    ]
    if item["issue_type"] == "food_form_conflict":
        return (
            ["food_form_mismatch"],
            "normalize_food_form",
            common_changes,
            "グループの既存food_formを採用し、個別の形態差は既存の属性で保持",
        )
    if canonical_name in TEA_GROUPS and axis == "liquid_state":
        return (
            ["partial_attribute_presence"],
            "add_not_applicable_value",
            structural_changes,
            "名称の「茶」と「浸出液」が明示的に区別されるため、茶レコードを「該当なし」に変更",
        )
    if canonical_name in FILLING_GROUPS:
        if axis == "variety":
            return (
                ["partial_attribute_presence", "ui_attribute_merge_issue"],
                "move_attribute_dimension",
                structural_changes,
                "プレーンを種類ではなく「中身なし」として中身属性へ移動",
            )
        return (
            ["partial_attribute_presence", "ui_attribute_merge_issue"],
            "merge_ui_attribute",
            structural_changes,
            "中身と中身の材料を一つの中身選択へ統合し、元次元をsource_dimensionsに保持",
        )
    if canonical_name in DIMENSION_MERGES:
        return (
            ["attribute_dimension_mismatch"],
            "move_attribute_dimension",
            structural_changes,
            "同一の選択軸に分散していた値を標準属性次元へ統合",
        )
    return (
        ["partial_attribute_presence"],
        "add_unspecified_value",
        common_changes,
        "名称から非該当を断定できないため、v1で追加済みの「指定なし」を確定",
    )


def build_summary(
    groups: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
    review_before: list[dict[str, Any]],
    review_after: list[dict[str, Any]],
    resolution_log: list[dict[str, Any]],
    input_source_ids: list[str],
    collision_count: int,
) -> dict[str, Any]:
    groups_with_selectable = sum(bool(group["selectable_attributes"]) for group in groups)
    groups_with_fixed_only = sum(
        not group["selectable_attributes"] and bool(group["fixed_attributes"])
        for group in groups
    )
    groups_without_attributes = sum(
        not group["selectable_attributes"] and not group["fixed_attributes"]
        for group in groups
    )
    before_groups = {item["food_group_id"] for item in review_before}
    after_groups = {item["food_group_id"] for item in review_after}
    mapping_ids = [mapping["source_id"] for mapping in mappings]
    resolution_counts = Counter(item["resolution_type"] for item in resolution_log)
    return {
        "input_record_count": len(input_source_ids),
        "output_mapping_count": len(mappings),
        "food_group_count": len(groups),
        "groups_with_selectable_attributes": groups_with_selectable,
        "groups_with_fixed_attributes_only": groups_with_fixed_only,
        "groups_without_any_attributes": groups_without_attributes,
        "review_group_count_before": len(before_groups),
        "review_item_count_before": len(review_before),
        "review_group_count_after": len(after_groups),
        "review_item_count_after": len(review_after),
        "resolved_review_group_count": len(before_groups - after_groups),
        "resolved_review_item_count": sum(item["resolved"] for item in resolution_log),
        "resolution_type_counts": dict(sorted(resolution_counts.items())),
        "variant_collision_count": collision_count,
        "duplicate_source_id_count": len(mapping_ids) - len(set(mapping_ids)),
        "missing_source_id_count": len(set(input_source_ids) - set(mapping_ids)),
        "food_form_normalization_count": resolution_counts["normalize_food_form"],
        "unspecified_value_addition_count": resolution_counts["add_unspecified_value"],
        "not_applicable_value_addition_count": resolution_counts["add_not_applicable_value"],
        "hidden_attribute_conversion_count": resolution_counts["convert_to_hidden_attribute"],
    }


def validate(
    groups_v1: list[dict[str, Any]],
    mappings_v1: list[dict[str, Any]],
    review_v1: list[dict[str, Any]],
    groups_v2: list[dict[str, Any]],
    mappings_v2: list[dict[str, Any]],
    review_v2: list[dict[str, Any]],
    resolution_log: list[dict[str, Any]],
    summary_v2: dict[str, Any],
) -> None:
    assert len(groups_v1) == len(groups_v2) == 1494
    assert len(mappings_v1) == len(mappings_v2) == 2538
    assert len(review_v1) == len(resolution_log) == 293
    assert len({item["food_group_id"] for item in review_v1}) == 152

    input_ids = [mapping["source_id"] for mapping in mappings_v1]
    output_ids = [mapping["source_id"] for mapping in mappings_v2]
    assert len(output_ids) == len(set(output_ids)), "duplicate source_id"
    assert set(input_ids) == set(output_ids), "missing or extra source_id"

    groups_v1_by_id = {group["food_group_id"]: group for group in groups_v1}
    groups_v2_by_id = {group["food_group_id"]: group for group in groups_v2}
    assert set(groups_v1_by_id) == set(groups_v2_by_id)
    assert {
        (group["food_group_id"], group["canonical_name"]) for group in groups_v1
    } == {
        (group["food_group_id"], group["canonical_name"]) for group in groups_v2
    }

    reviewed_group_ids = {item["food_group_id"] for item in review_v1}
    for food_group_id in set(groups_v1_by_id) - reviewed_group_ids:
        assert groups_v1_by_id[food_group_id] == groups_v2_by_id[food_group_id], (
            f"non-review group changed: {food_group_id}"
        )

    mappings_v1_by_id = {mapping["source_id"]: mapping for mapping in mappings_v1}
    mappings_v2_by_id = {mapping["source_id"]: mapping for mapping in mappings_v2}
    for source_id, mapping in mappings_v1_by_id.items():
        if mapping["food_group_id"] not in reviewed_group_ids:
            assert mapping == mappings_v2_by_id[source_id], (
                f"non-review mapping changed: {source_id}"
            )

    for mapping in mappings_v2:
        group = groups_v2_by_id[mapping["food_group_id"]]
        selectable = {
            attribute["attribute_id"]: {
                value["value_id"] for value in attribute["values"]
            }
            for attribute in group["selectable_attributes"]
        }
        fixed = {
            attribute["attribute_id"]: attribute["value_id"]
            for attribute in group["fixed_attributes"]
        }
        assert set(mapping["attribute_values"]) == set(selectable)
        assert set(mapping["fixed_attribute_values"]) == set(fixed)
        assert all(
            value_id in selectable[attribute_id]
            for attribute_id, value_id in mapping["attribute_values"].items()
        )
        assert all(
            value_id == fixed[attribute_id]
            for attribute_id, value_id in mapping["fixed_attribute_values"].items()
        )
        expected_key = (
            "|".join(
                f"{attribute_id}={mapping['attribute_values'][attribute_id]}"
                for attribute_id in mapping["attribute_values"]
            )
            if mapping["attribute_values"]
            else "default"
        )
        assert mapping["variant_key"] == expected_key

    variant_pairs = [
        (mapping["food_group_id"], mapping["variant_key"]) for mapping in mappings_v2
    ]
    assert len(variant_pairs) == len(set(variant_pairs)), "variant_key collision"
    assert not review_v2, "resolved output unexpectedly contains review items"
    assert all(not group["needs_review"] for group in groups_v2)

    assert sum(
        summary_v2[key]
        for key in (
            "groups_with_selectable_attributes",
            "groups_with_fixed_attributes_only",
            "groups_without_any_attributes",
        )
    ) == summary_v2["food_group_count"] == 1494
    assert summary_v2["variant_collision_count"] == 0
    assert summary_v2["duplicate_source_id_count"] == 0
    assert summary_v2["missing_source_id_count"] == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--groups-v1", type=Path, default=DEFAULT_GROUPS_V1)
    parser.add_argument("--mappings-v1", type=Path, default=DEFAULT_MAPPINGS_V1)
    parser.add_argument("--review-v1", type=Path, default=DEFAULT_REVIEW_V1)
    parser.add_argument("--summary-v1", type=Path, default=DEFAULT_SUMMARY_V1)
    parser.add_argument("--groups-v2", type=Path, default=DEFAULT_GROUPS_V2)
    parser.add_argument("--mappings-v2", type=Path, default=DEFAULT_MAPPINGS_V2)
    parser.add_argument("--review-v2", type=Path, default=DEFAULT_REVIEW_V2)
    parser.add_argument("--log-v2", type=Path, default=DEFAULT_LOG_V2)
    parser.add_argument("--summary-v2", type=Path, default=DEFAULT_SUMMARY_V2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    groups_v1 = read_json(args.groups_v1)
    mappings_v1 = read_json(args.mappings_v1)
    review_v1 = read_json(args.review_v1)
    summary_v1 = read_json(args.summary_v1)
    assert summary_v1["food_group_count"] == len(groups_v1)

    groups_v2 = copy.deepcopy(groups_v1)
    mappings_v2 = copy.deepcopy(mappings_v1)
    groups_by_id = {group["food_group_id"]: group for group in groups_v2}
    mappings_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for mapping in mappings_v2:
        mappings_by_group[mapping["food_group_id"]].append(mapping)
    registry = ValueIdRegistry(groups_v1)
    reviewed_group_ids = {item["food_group_id"] for item in review_v1}

    # Apply each structural correction once per reviewed group.
    for food_group_id in sorted(reviewed_group_ids):
        group = groups_by_id[food_group_id]
        canonical_name = group["canonical_name"]
        group_mappings = mappings_by_group[food_group_id]
        if canonical_name in TEA_GROUPS:
            replace_unspecified_with_not_applicable(
                group, group_mappings, registry, "liquid_state"
            )
        if canonical_name in FILLING_GROUPS:
            resolve_filling_group(group, group_mappings, registry)
        if canonical_name in DIMENSION_MERGES:
            target_axis, source_axes, display_name = DIMENSION_MERGES[canonical_name]
            merge_dimension_group(
                group,
                group_mappings,
                registry,
                target_axis,
                source_axes,
                display_name,
            )

    resolution_log: list[dict[str, Any]] = []
    for item in review_v1:
        group = groups_by_id[item["food_group_id"]]
        original_issue_types, resolution_type, changed_fields, description = resolution_for_item(
            item, group["canonical_name"]
        )
        remove_resolved_warning(group, item)
        resolution_log.append(
            {
                "food_group_id": item["food_group_id"],
                "canonical_name": item["canonical_name"],
                "original_issue_types": original_issue_types,
                "resolution_type": resolution_type,
                "changed_fields": changed_fields,
                "description": description,
                "source_ids": copy.deepcopy(item["source_ids"]),
                "resolved": True,
            }
        )

    for food_group_id in reviewed_group_ids:
        groups_by_id[food_group_id]["needs_review"] = False

    # Every v1 collision was already zero. Any new collision is a programming
    # error in these deterministic review resolutions, not something to hide.
    collision_counter = Counter(
        (mapping["food_group_id"], mapping["variant_key"]) for mapping in mappings_v2
    )
    collisions = [key for key, count in collision_counter.items() if count > 1]
    review_v2: list[dict[str, Any]] = []
    summary_v2 = build_summary(
        groups_v2,
        mappings_v2,
        review_v1,
        review_v2,
        resolution_log,
        [mapping["source_id"] for mapping in mappings_v1],
        len(collisions),
    )
    validate(
        groups_v1,
        mappings_v1,
        review_v1,
        groups_v2,
        mappings_v2,
        review_v2,
        resolution_log,
        summary_v2,
    )

    write_json(args.groups_v2, groups_v2)
    write_json(args.mappings_v2, mappings_v2)
    write_json(args.review_v2, review_v2)
    write_json(args.log_v2, resolution_log)
    write_json(args.summary_v2, summary_v2)

    # Confirm the serialized artifacts can all be loaded again.
    for path in (
        args.groups_v2,
        args.mappings_v2,
        args.review_v2,
        args.log_v2,
        args.summary_v2,
    ):
        read_json(path)


if __name__ == "__main__":
    main()
