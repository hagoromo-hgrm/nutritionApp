#!/usr/bin/env python3
"""Aggregate reviewed food identities into app-facing food groups.

Grouping is intentionally strict: only records with exactly the same reviewed
``identity_candidate.canonical_name`` are placed in one group.  No fuzzy name
matching or cross-name merging is performed at this stage.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data/mext/processed"
DEFAULT_INPUT = PROCESSED / "mext_food_identity_candidates_v1.json"
DEFAULT_GROUPS = PROCESSED / "mext_food_groups_v1.json"
DEFAULT_MAPPINGS = PROCESSED / "mext_food_group_mappings_v1.json"
DEFAULT_REVIEW = PROCESSED / "mext_food_group_review_v1.json"
DEFAULT_SUMMARY = PROCESSED / "mext_food_group_summary_v1.json"

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
STANDARD_DIMENSIONS = set(ATTRIBUTE_ORDER)
STATE_SOURCE_DIMENSIONS = ("processing_state", "preservation_state", "cooking_state")

ATTRIBUTE_DISPLAY_NAMES = {
    "state": "状態",
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
}

VISIBILITY_RANK = {"primary": 0, "optional": 1, "advanced": 2, "hidden": 3}

VALUE_NORMALIZATION = {
    "茹で": "ゆで",
    "フライ": "揚げ",
    "皮無し": "皮なし",
    "皮付き": "皮つき",
    "脂身付き": "脂身つき",
    "赤身": "赤肉",
    "骨付き": "骨つき",
}

PREDEFINED_VALUE_IDS = {
    "生": "raw",
    "生鮮": "fresh",
    "水戻し": "rehydrated",
    "ゆで": "boiled",
    "蒸し": "steamed",
    "焼き": "grilled",
    "炒め": "stir_fried",
    "油いため": "stir_fried_in_oil",
    "煮": "simmered",
    "水煮": "boiled_in_water",
    "揚げ": "fried",
    "フライ": "fried",
    "電子レンジ調理": "microwaved",
    "調理済み": "cooked",
    "乾": "dry",
    "冷蔵": "chilled",
    "冷凍": "frozen",
    "缶詰": "canned",
    "瓶詰": "bottled",
    "皮つき": "with_skin",
    "皮なし": "without_skin",
    "皮のみ": "skin_only",
    "脂身つき": "with_fat",
    "脂身なし": "without_fat",
    "赤肉": "lean_meat",
    "脂身": "fat_only",
    "骨つき": "with_bone",
    "骨なし": "boneless",
    "骨を除く": "bone_removed",
    "殻つき": "with_shell",
    "殻なし": "without_shell",
    "液汁を含む": "with_liquid",
    "液汁を除く": "without_liquid",
    "煮汁を含む": "with_cooking_liquid",
    "煮汁を除く": "without_cooking_liquid",
    "固形物のみ": "solids_only",
    "国産": "domestic",
    "輸入": "imported",
    "天然": "wild",
    "養殖": "farmed",
    "指定なし": "unspecified",
    "該当なし": "not_applicable",
}

VALUE_ORDERS = {
    "state": (
        "生",
        "生鮮",
        "水戻し",
        "ゆで",
        "蒸し",
        "焼き",
        "炒め",
        "油いため",
        "煮",
        "水煮",
        "揚げ",
        "フライ",
        "電子レンジ調理",
        "調理済み",
        "冷蔵",
        "冷凍",
        "乾",
        "缶詰",
        "瓶詰",
        "指定なし",
    ),
    "cooking_state": (
        "生",
        "水戻し",
        "ゆで",
        "蒸し",
        "焼き",
        "炒め",
        "油いため",
        "煮",
        "水煮",
        "揚げ",
        "フライ",
        "電子レンジ調理",
        "調理済み",
        "指定なし",
    ),
    "skin_state": ("皮つき", "皮なし", "皮のみ", "指定なし"),
    "fat_state": ("脂身つき", "脂身なし", "赤肉", "脂身", "指定なし"),
    "preservation_state": (
        "生鮮",
        "冷蔵",
        "冷凍",
        "乾",
        "缶詰",
        "瓶詰",
        "指定なし",
    ),
}


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("　", " ")).strip()


def mode_value(values: Iterable[Any]) -> Any:
    counts = Counter(values)
    return min(counts, key=lambda value: (-counts[value], "" if value is None else str(value)))


def axis_order_key(attribute_id: str, source_dimensions: Iterable[str] = ()) -> tuple[int, str]:
    if attribute_id == "state":
        ranks = [ATTRIBUTE_RANK[dimension] for dimension in source_dimensions]
        return (min(ranks) if ranks else ATTRIBUTE_RANK["processing_state"], attribute_id)
    return (ATTRIBUTE_RANK.get(attribute_id, 999), attribute_id)


def visibility_choice(values: Iterable[str], attribute_id: str, selectable: bool) -> str:
    unique = set(values) or {"hidden"}
    selected = min(unique, key=lambda value: VISIBILITY_RANK[value])
    if attribute_id == "grade":
        return "advanced"
    if (
        selectable
        and attribute_id in {"state", "cooking_state", "skin_state", "fat_state", "filling", "flavor"}
        and unique != {"hidden"}
    ):
        return "primary"
    return selected


def normalize_value(dimension: str, value: str) -> str:
    value = normalize_space(value)
    if ":" in value:
        base, suffix = value.rsplit(":", 1)
        if suffix in {"入り", "なし"}:
            value = f"{base}{suffix}"
    return VALUE_NORMALIZATION.get(value, value)


def canonical_attribute_dimension(attribute: dict[str, Any]) -> str:
    source_field = attribute["source_field"]
    if source_field == "filling_ingredient":
        return "filling_ingredient"
    if source_field == "anatomical_part" and attribute["dimension"] == "other":
        return "part"
    dimension = attribute["dimension"]
    return dimension if dimension in STANDARD_DIMENSIONS else "other"


def encoded_attribute_value(attribute: dict[str, Any]) -> str:
    value = attribute["value"]
    presence = attribute.get("presence")
    return f"{value}:{presence}" if presence else value


def infer_other_subtype(attribute: dict[str, Any] | None, value: str) -> str:
    if value.endswith("栽培"):
        return "cultivation_method"
    if value in {"主品目", "副品目"}:
        return "table_item_class"
    if value in {"通年平均", "市販品"}:
        return "source_condition"
    if attribute and attribute["source_field"] == "other_descriptors":
        return "product_specification"
    return "source_descriptor"


def best_matching_attribute(
    record: dict[str, Any],
    dimension: str,
    signature_value: str,
    used_indexes: set[int],
) -> tuple[int | None, dict[str, Any] | None]:
    attributes = record["variant_attributes"]
    exact = [
        (index, attribute)
        for index, attribute in enumerate(attributes)
        if index not in used_indexes
        and canonical_attribute_dimension(attribute) == dimension
        and encoded_attribute_value(attribute) == signature_value
    ]
    if exact:
        return exact[0]
    normalized_signature = normalize_value(dimension, signature_value)
    fallback = [
        (index, attribute)
        for index, attribute in enumerate(attributes)
        if index not in used_indexes
        and canonical_attribute_dimension(attribute) == dimension
        and normalize_value(dimension, encoded_attribute_value(attribute)) == normalized_signature
    ]
    return fallback[0] if fallback else (None, None)


def merge_axis_components(components: list[dict[str, Any]]) -> dict[str, Any]:
    canonical_values = sorted({component["canonical_value"] for component in components})
    source_values = {
        (item["dimension"], item["value"])
        for component in components
        for item in component["source_values"]
    }
    return {
        "canonical_value": "・".join(canonical_values),
        "display_name": "・".join(canonical_values),
        "source_values": [
            {"dimension": dimension, "value": value}
            for dimension, value in sorted(
                source_values,
                key=lambda item: (ATTRIBUTE_RANK.get(item[0], 999), item[0], item[1]),
            )
        ],
        "visibilities": [
            visibility for component in components for visibility in component["visibilities"]
        ],
        "subtypes": sorted(
            {subtype for component in components for subtype in component.get("subtypes", [])}
        ),
        "synthetic": False,
    }


def build_source_axes(record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    used_attribute_indexes: set[int] = set()
    by_dimension: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for signature in record["variant_signature"]:
        dimension = signature["dimension"]
        if dimension not in STANDARD_DIMENSIONS:
            dimension = "other"
        index, attribute = best_matching_attribute(
            record, dimension, signature["value"], used_attribute_indexes
        )
        if index is not None:
            used_attribute_indexes.add(index)
        canonical_value = normalize_value(dimension, signature["value"])
        component = {
            "canonical_value": canonical_value,
            "source_values": [
                {"dimension": signature["dimension"], "value": signature["value"]}
            ],
            "visibilities": [attribute["ui_visibility"] if attribute else "hidden"],
            "subtypes": [],
        }
        if dimension == "other":
            component["subtypes"].append(infer_other_subtype(attribute, canonical_value))
        by_dimension[dimension].append(component)

    axes = {
        dimension: merge_axis_components(components)
        for dimension, components in by_dimension.items()
    }

    # The same literal state must not survive in two internal dimensions.
    state_by_value: dict[str, list[str]] = defaultdict(list)
    for dimension in STATE_SOURCE_DIMENSIONS:
        if dimension in axes:
            state_by_value[axes[dimension]["canonical_value"]].append(dimension)
    for value, dimensions in state_by_value.items():
        if len(dimensions) < 2:
            continue
        if value in {"乾", "冷蔵", "冷凍", "缶詰", "瓶詰"}:
            target = "preservation_state"
        elif value in {
            "生",
            "水戻し",
            "ゆで",
            "蒸し",
            "焼き",
            "炒め",
            "油いため",
            "煮",
            "水煮",
            "揚げ",
            "フライ",
            "電子レンジ調理",
            "調理済み",
        }:
            target = "cooking_state"
        else:
            target = "processing_state"
        components = [axes.pop(dimension) for dimension in dimensions]
        axes[target] = merge_axis_components(
            [
                {
                    "canonical_value": component["canonical_value"],
                    "source_values": component["source_values"],
                    "visibilities": component["visibilities"],
                    "subtypes": component["subtypes"],
                }
                for component in components
            ]
        )
    return axes


def can_merge_state_axes(source_axes: dict[str, dict[str, dict[str, Any]]]) -> bool:
    dimensions = {
        dimension
        for axes in source_axes.values()
        for dimension in STATE_SOURCE_DIMENSIONS
        if dimension in axes
    }
    if len(dimensions) < 2:
        return False
    return all(sum(dimension in axes for dimension in dimensions) <= 1 for axes in source_axes.values())


def merge_state_axes(source_axes: dict[str, dict[str, dict[str, Any]]]) -> None:
    if not can_merge_state_axes(source_axes):
        return
    for axes in source_axes.values():
        present = [dimension for dimension in STATE_SOURCE_DIMENSIONS if dimension in axes]
        if present:
            axes["state"] = axes.pop(present[0])


def semantic_key_parts(record: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"dimension": part["dimension"], "value": part["value"]}
        for part in record["identity_candidate"]["key_parts"]
    ]


def choose_display_name(records: list[dict[str, Any]], canonical_name: str) -> str:
    display_names = [record["identity_candidate"]["display_name"] for record in records]
    if len(set(display_names)) == 1:
        return display_names[0]
    if canonical_name in display_names:
        return canonical_name
    original_names = [
        record["identity_candidate"]["display_name"]
        for record in records
        if not record["identity_candidate"].get("generated_display_name", False)
    ]
    candidates = original_names or display_names
    return min(candidates, key=lambda value: (len(value), value)) if candidates else canonical_name


def is_wrapper_term(value: str) -> bool:
    pairs = (("＜", "＞"), ("［", "］"), ("[", "]"), ("（", "）"), ("(", ")"))
    return any(value.startswith(opening) and value.endswith(closing) for opening, closing in pairs)


def build_search_terms(
    records: list[dict[str, Any]], canonical_name: str, display_name: str
) -> list[str]:
    terms: list[str] = []

    def add(value: str | None) -> None:
        if not value:
            return
        value = normalize_space(value)
        if value and not is_wrapper_term(value) and value not in terms:
            terms.append(value)

    add(canonical_name)
    add(display_name)
    for record in records:
        for part in record["identity_candidate"]["key_parts"]:
            add(part["value"])
            for raw in part.get("raw_evidence", []):
                add(raw)
    head = terms[:2]
    return head + sorted(terms[2:])


def issue(
    issue_type: str,
    description: str,
    source_ids: Iterable[str],
    candidate_resolutions: list[str],
    *,
    variant_key: str | None = None,
) -> dict[str, Any]:
    result = {
        "issue_type": issue_type,
        "description": description,
        "source_ids": sorted(set(source_ids)),
        "candidate_resolutions": candidate_resolutions,
    }
    if variant_key is not None:
        result["variant_key"] = variant_key
    return result


def build_group_models(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_canonical: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_canonical[record["identity_candidate"]["canonical_name"]].append(record)

    models: list[dict[str, Any]] = []
    for canonical_name, group_records in by_canonical.items():
        group_records = sorted(group_records, key=lambda record: record["source_id"])
        warnings: list[str] = []
        issues: list[dict[str, Any]] = []
        display_name = choose_display_name(group_records, canonical_name)
        display_names = {
            record["identity_candidate"]["display_name"] for record in group_records
        }
        if len(display_names) > 1:
            warnings.append("display_nameが複数あるため優先規則で選択")

        parent_values = [record["identity_candidate"]["parent_concept"] for record in group_records]
        parent_concept = mode_value(parent_values)
        if len(set(parent_values)) > 1:
            warnings.append("parent_conceptが複数あるため最頻値を採用")

        food_forms = [record["identity_candidate"]["food_form"] for record in group_records]
        food_form = mode_value(food_forms)
        if len(set(food_forms)) > 1:
            warnings.append("food_formがグループ内で一致しない")
            issues.append(
                issue(
                    "food_form_conflict",
                    "同じcanonical_name内でfood_formが一致しません",
                    [record["source_id"] for record in group_records],
                    ["入力候補のfood_formを再確認する"],
                )
            )

        key_parts_by_signature: dict[str, list[dict[str, str]]] = {}
        key_part_counts: Counter[str] = Counter()
        for record in group_records:
            parts = semantic_key_parts(record)
            signature = json.dumps(parts, ensure_ascii=False, sort_keys=True)
            key_parts_by_signature[signature] = parts
            key_part_counts[signature] += 1
        selected_key_signature = min(
            key_part_counts,
            key=lambda value: (-key_part_counts[value], value),
        )
        key_parts = key_parts_by_signature[selected_key_signature]
        if len(key_part_counts) > 1:
            warnings.append("key_partsがグループ内で一致しない")
            issues.append(
                issue(
                    "key_parts_conflict",
                    "同じcanonical_name内でkey_partsが一致しません",
                    [record["source_id"] for record in group_records],
                    ["食品本体要素を再確認する", "属性へ移すべき要素がないか確認する"],
                )
            )

        input_review_records = [record for record in group_records if record["needs_review"]]
        if input_review_records:
            issues.append(
                issue(
                    "input_requires_review",
                    "入力候補にneeds_reviewが含まれています",
                    [record["source_id"] for record in input_review_records],
                    ["前工程のreview_reasonsを確認する"],
                )
            )

        source_axes = {
            record["source_id"]: build_source_axes(record) for record in group_records
        }
        merge_state_axes(source_axes)

        axis_ids = sorted(
            {axis for axes in source_axes.values() for axis in axes},
            key=lambda axis: axis_order_key(
                axis,
                {
                    source_value["dimension"]
                    for axes in source_axes.values()
                    for source_value in axes.get(axis, {}).get("source_values", [])
                },
            ),
        )
        for axis_id in axis_ids:
            missing_ids = [
                record["source_id"]
                for record in group_records
                if axis_id not in source_axes[record["source_id"]]
            ]
            if not missing_ids:
                continue
            for source_id in missing_ids:
                source_axes[source_id][axis_id] = {
                    "canonical_value": "指定なし",
                    "display_name": "指定なし",
                    "source_values": [],
                    "visibilities": ["hidden"],
                    "subtypes": [],
                    "synthetic": True,
                }
            warnings.append(f"{axis_id}の欠落を「指定なし」として保持")
            issues.append(
                issue(
                    "missing_attribute_semantics",
                    f"{axis_id}が一部レコードにだけ存在するため「指定なし」を追加しました",
                    [record["source_id"] for record in group_records],
                    ["欠落が省略か非該当か確認する", "必要なら「該当なし」へ変更する"],
                )
            )

        axis_definitions: dict[str, dict[str, Any]] = {}
        for axis_id in axis_ids:
            value_data: dict[str, dict[str, Any]] = {}
            for source_id, axes in source_axes.items():
                axis_value = axes[axis_id]
                canonical_value = axis_value["canonical_value"]
                aggregate = value_data.setdefault(
                    canonical_value,
                    {
                        "canonical_value": canonical_value,
                        "display_name": axis_value["display_name"],
                        "source_values": set(),
                        "visibilities": [],
                        "subtypes": set(),
                        "source_ids": [],
                    },
                )
                aggregate["source_values"].update(
                    (item["dimension"], item["value"])
                    for item in axis_value["source_values"]
                )
                aggregate["visibilities"].extend(axis_value["visibilities"])
                aggregate["subtypes"].update(axis_value["subtypes"])
                aggregate["source_ids"].append(source_id)
            source_dimensions = {
                dimension
                for value in value_data.values()
                for dimension, _ in value["source_values"]
            }
            if not source_dimensions:
                source_dimensions = {axis_id}
            axis_definitions[axis_id] = {
                "attribute_id": axis_id,
                "source_dimensions": sorted(
                    source_dimensions,
                    key=lambda dimension: (ATTRIBUTE_RANK.get(dimension, 999), dimension),
                ),
                "values": value_data,
                "selectable": len(value_data) > 1,
                "required": True,
                "subtypes": {
                    subtype for value in value_data.values() for subtype in value["subtypes"]
                },
            }

        models.append(
            {
                "canonical_name": canonical_name,
                "display_name": display_name,
                "parent_concept": parent_concept,
                "food_form": food_form,
                "key_parts": key_parts,
                "search_terms": build_search_terms(group_records, canonical_name, display_name),
                "records": group_records,
                "source_axes": source_axes,
                "axis_definitions": axis_definitions,
                "warnings": warnings,
                "issues": issues,
                "minimum_source_id": group_records[0]["source_id"],
            }
        )

    models.sort(
        key=lambda model: (
            model["food_form"],
            model["parent_concept"] or "",
            model["canonical_name"],
            model["minimum_source_id"],
        )
    )
    for index, model in enumerate(models, start=1):
        model["food_group_id"] = f"fg_{index:06d}"
    return models


def build_value_registry(models: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    values_by_axis: dict[str, set[str]] = defaultdict(set)
    for model in models:
        for axis_id, definition in model["axis_definitions"].items():
            values_by_axis[axis_id].update(definition["values"])

    registry: dict[str, dict[str, str]] = {}
    for axis_id, values in sorted(values_by_axis.items()):
        mapping: dict[str, str] = {}
        used_ids: set[str] = set()
        fallback_values: list[str] = []
        for value in sorted(values):
            predefined = PREDEFINED_VALUE_IDS.get(value)
            if predefined and predefined not in used_ids:
                mapping[value] = predefined
                used_ids.add(predefined)
            else:
                fallback_values.append(value)
        sequence = 1
        for value in fallback_values:
            while f"v_{sequence:03d}" in used_ids:
                sequence += 1
            value_id = f"v_{sequence:03d}"
            mapping[value] = value_id
            used_ids.add(value_id)
            sequence += 1
        registry[axis_id] = mapping
    return registry


def value_order_key(attribute_id: str, canonical_value: str) -> tuple[int, str]:
    order = VALUE_ORDERS.get(attribute_id)
    if order and canonical_value in order:
        return (order.index(canonical_value), canonical_value)
    if canonical_value == "指定なし":
        return (10_000, canonical_value)
    return (1_000, canonical_value)


def serialize_source_values(values: set[tuple[str, str]]) -> list[dict[str, str]]:
    return [
        {"dimension": dimension, "value": value}
        for dimension, value in sorted(
            values,
            key=lambda item: (ATTRIBUTE_RANK.get(item[0], 999), item[0], item[1]),
        )
    ]


def serialize_value(
    axis_id: str,
    value: dict[str, Any],
    value_registry: dict[str, dict[str, str]],
) -> dict[str, Any]:
    canonical_value = value["canonical_value"]
    return {
        "value_id": value_registry[axis_id][canonical_value],
        "canonical_value": canonical_value,
        "display_name": value["display_name"],
        "source_values": serialize_source_values(value["source_values"]),
    }


def attribute_subtype(definition: dict[str, Any]) -> str | None:
    if definition["attribute_id"] != "other":
        return None
    subtypes = sorted(definition["subtypes"])
    return subtypes[0] if len(subtypes) == 1 else "multiple"


def render_attribute(
    definition: dict[str, Any],
    value_registry: dict[str, dict[str, str]],
) -> dict[str, Any]:
    axis_id = definition["attribute_id"]
    selectable = definition["selectable"]
    all_visibilities = [
        visibility
        for value in definition["values"].values()
        for visibility in value["visibilities"]
    ]
    base: dict[str, Any] = {
        "attribute_id": axis_id,
        "source_dimensions": definition["source_dimensions"],
        "display_name": ATTRIBUTE_DISPLAY_NAMES[axis_id],
        "ui_visibility": visibility_choice(all_visibilities, axis_id, selectable),
    }
    subtype = attribute_subtype(definition)
    if subtype:
        base["subtype"] = subtype

    sorted_values = sorted(
        definition["values"].values(),
        key=lambda value: value_order_key(axis_id, value["canonical_value"]),
    )
    if not selectable:
        value = sorted_values[0]
        base.update(
            {
                "value_id": value_registry[axis_id][value["canonical_value"]],
                "canonical_value": value["canonical_value"],
                "value": value["display_name"],
                "source_values": serialize_source_values(value["source_values"]),
            }
        )
        return base

    frequencies = Counter(
        {
            value["canonical_value"]: len(value["source_ids"])
            for value in sorted_values
        }
    )
    default_value: str | None = None
    if "生" in definition["values"]:
        default_value = "生"
    elif "指定なし" in definition["values"]:
        default_value = "指定なし"
    elif frequencies:
        maximum = max(frequencies.values())
        winners = [value for value, count in frequencies.items() if count == maximum]
        if len(winners) == 1:
            default_value = winners[0]
    base.update(
        {
            "required": definition["required"],
            "default_value_id": (
                value_registry[axis_id][default_value] if default_value is not None else None
            ),
            "values": [
                serialize_value(axis_id, value, value_registry) for value in sorted_values
            ],
        }
    )
    return base


def render_outputs(
    models: list[dict[str, Any]],
    value_registry: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups: list[dict[str, Any]] = []
    mappings: list[dict[str, Any]] = []
    for model in models:
        definitions = model["axis_definitions"]
        ordered_definitions = sorted(
            definitions.values(),
            key=lambda definition: axis_order_key(
                definition["attribute_id"], definition["source_dimensions"]
            ),
        )
        fixed_definitions = [definition for definition in ordered_definitions if not definition["selectable"]]
        selectable_definitions = [definition for definition in ordered_definitions if definition["selectable"]]
        fixed_attributes = [
            render_attribute(definition, value_registry) for definition in fixed_definitions
        ]
        selectable_attributes = [
            render_attribute(definition, value_registry) for definition in selectable_definitions
        ]
        group = {
            "food_group_id": model["food_group_id"],
            "canonical_name": model["canonical_name"],
            "display_name": model["display_name"],
            "parent_concept": model["parent_concept"],
            "food_form": model["food_form"],
            "key_parts": model["key_parts"],
            "search_terms": model["search_terms"],
            "fixed_attributes": fixed_attributes,
            "selectable_attributes": selectable_attributes,
            "source_count": len(model["records"]),
            "default_source_id": (
                model["records"][0]["source_id"]
                if len(model["records"]) == 1 and not selectable_attributes
                else None
            ),
            "needs_review": bool(model["issues"]),
            "group_warnings": model["warnings"],
        }
        groups.append(group)

        selectable_ids = [definition["attribute_id"] for definition in selectable_definitions]
        fixed_ids = [definition["attribute_id"] for definition in fixed_definitions]
        for record in model["records"]:
            axes = model["source_axes"][record["source_id"]]
            attribute_values = {
                axis_id: value_registry[axis_id][axes[axis_id]["canonical_value"]]
                for axis_id in selectable_ids
            }
            fixed_values = {
                axis_id: value_registry[axis_id][axes[axis_id]["canonical_value"]]
                for axis_id in fixed_ids
            }
            variant_key = (
                "|".join(f"{axis_id}={attribute_values[axis_id]}" for axis_id in selectable_ids)
                if selectable_ids
                else "default"
            )
            mappings.append(
                {
                    "source_id": record["source_id"],
                    "source_name": record["source_name"],
                    "food_group_id": model["food_group_id"],
                    "canonical_name": model["canonical_name"],
                    "attribute_values": attribute_values,
                    "fixed_attribute_values": fixed_values,
                    "variant_key": variant_key,
                }
            )
    mappings.sort(key=lambda mapping: mapping["source_id"])
    return groups, mappings


def add_collision_issues(
    models: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    collisions: list[dict[str, Any]] = []
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for mapping in mappings:
        by_key[(mapping["food_group_id"], mapping["variant_key"])].append(mapping)
    model_by_id = {model["food_group_id"]: model for model in models}
    group_by_id = {group["food_group_id"]: group for group in groups}
    for (food_group_id, variant_key), matched in by_key.items():
        if len(matched) < 2:
            continue
        source_ids = [mapping["source_id"] for mapping in matched]
        collision_issue = issue(
            "variant_collision",
            "属性値の組合せが重複しています",
            source_ids,
            ["hidden属性を追加する", "入力の意味要素抽出を再確認する"],
            variant_key=variant_key,
        )
        model_by_id[food_group_id]["issues"].append(collision_issue)
        group = group_by_id[food_group_id]
        group["needs_review"] = True
        warning = f"variant_key={variant_key}が重複"
        if warning not in group["group_warnings"]:
            group["group_warnings"].append(warning)
        collisions.append(
            {
                "food_group_id": food_group_id,
                "variant_key": variant_key,
                "source_ids": source_ids,
            }
        )
    return collisions


def build_review(models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    review: list[dict[str, Any]] = []
    for model in models:
        for item in model["issues"]:
            entry = {
                "food_group_id": model["food_group_id"],
                "canonical_name": model["canonical_name"],
                **copy.deepcopy(item),
            }
            review.append(entry)
    return sorted(
        review,
        key=lambda item: (
            item["food_group_id"],
            item["issue_type"],
            item.get("variant_key", ""),
            item["source_ids"],
        ),
    )


def count_nested(counter: Counter[str]) -> dict[str, int]:
    return dict(sorted(counter.items(), key=lambda item: (-item[1], item[0])))


def build_summary(
    source: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
    review: list[dict[str, Any]],
    collisions: list[dict[str, Any]],
) -> dict[str, Any]:
    dimensions = Counter()
    values: dict[str, Counter[str]] = defaultdict(Counter)
    visibility = Counter()
    fixed_count = 0
    selectable_count = 0
    for group in groups:
        for attribute in group["fixed_attributes"]:
            fixed_count += 1
            dimensions[attribute["attribute_id"]] += 1
            values[attribute["attribute_id"]][attribute["canonical_value"]] += 1
            visibility[attribute["ui_visibility"]] += 1
        for attribute in group["selectable_attributes"]:
            selectable_count += 1
            dimensions[attribute["attribute_id"]] += 1
            visibility[attribute["ui_visibility"]] += 1
            for value in attribute["values"]:
                values[attribute["attribute_id"]][value["canonical_value"]] += 1

    source_ids = [record["source_id"] for record in source]
    mapping_ids = [mapping["source_id"] for mapping in mappings]
    review_group_ids = {item["food_group_id"] for item in review}
    review_source_ids = {source_id for item in review for source_id in item["source_ids"]}
    return {
        "input_record_count": len(source),
        "output_mapping_count": len(mappings),
        "food_group_count": len(groups),
        "single_record_group_count": sum(group["source_count"] == 1 for group in groups),
        "multi_record_group_count": sum(group["source_count"] > 1 for group in groups),
        "groups_with_selectable_attributes": sum(
            bool(group["selectable_attributes"]) for group in groups
        ),
        "groups_without_selectable_attributes": sum(
            not group["selectable_attributes"] for group in groups
        ),
        "groups_without_any_attributes": sum(
            not group["selectable_attributes"] and not group["fixed_attributes"]
            for group in groups
        ),
        "selectable_attribute_count": selectable_count,
        "fixed_attribute_count": fixed_count,
        "attribute_dimension_counts": count_nested(dimensions),
        "attribute_value_counts": {
            dimension: count_nested(counter) for dimension, counter in sorted(values.items())
        },
        "ui_visibility_counts": count_nested(visibility),
        "variant_collision_count": len(collisions),
        "review_group_count": len(review_group_ids),
        "review_record_count": len(review_source_ids),
        "review_issue_count": len(review),
        "duplicate_source_id_count": len(source_ids) - len(set(source_ids)),
        "missing_source_id_count": len(set(source_ids) - set(mapping_ids)),
        "extra_source_id_count": len(set(mapping_ids) - set(source_ids)),
        "variant_collisions": collisions,
    }


def validate(
    source: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
    review: list[dict[str, Any]],
    summary: dict[str, Any],
) -> None:
    source_ids = [record["source_id"] for record in source]
    mapping_ids = [mapping["source_id"] for mapping in mappings]
    assert len(source) == len(mappings), "input/mapping record count mismatch"
    assert len(source_ids) == len(set(source_ids)), "duplicate source_id in input"
    assert len(mapping_ids) == len(set(mapping_ids)), "duplicate source_id in mappings"
    assert set(source_ids) == set(mapping_ids), "mapping source_id set mismatch"

    group_ids = [group["food_group_id"] for group in groups]
    assert len(group_ids) == len(set(group_ids)), "duplicate food_group_id"
    assert all(re.fullmatch(r"fg_\d{6}", food_group_id) for food_group_id in group_ids)
    assert all(mapping["food_group_id"] in set(group_ids) for mapping in mappings)

    input_canonical = {
        record["identity_candidate"]["canonical_name"] for record in source
    }
    output_canonical = [group["canonical_name"] for group in groups]
    assert len(output_canonical) == len(set(output_canonical)), "canonical_name split"
    assert input_canonical == set(output_canonical), "canonical_name set mismatch"

    groups_by_id = {group["food_group_id"]: group for group in groups}
    source_by_id = {record["source_id"]: record for record in source}
    mapping_counts = Counter(mapping["food_group_id"] for mapping in mappings)
    assert all(
        group["source_count"] == mapping_counts[group["food_group_id"]]
        for group in groups
    )
    for group in groups:
        fixed_ids = [attribute["attribute_id"] for attribute in group["fixed_attributes"]]
        selectable_ids = [
            attribute["attribute_id"] for attribute in group["selectable_attributes"]
        ]
        assert len(fixed_ids) == len(set(fixed_ids))
        assert len(selectable_ids) == len(set(selectable_ids))
        assert not set(fixed_ids) & set(selectable_ids)
        assert all(len(attribute["values"]) > 1 for attribute in group["selectable_attributes"])
        assert all(
            re.fullmatch(r"(?:[a-z][a-z0-9_]*|v_\d{3})", attribute["value_id"])
            for attribute in group["fixed_attributes"]
        )
        assert all(
            re.fullmatch(r"(?:[a-z][a-z0-9_]*|v_\d{3})", value["value_id"])
            for attribute in group["selectable_attributes"]
            for value in attribute["values"]
        )
        if group["source_count"] == 1 and not group["selectable_attributes"]:
            assert group["default_source_id"] is not None
        else:
            assert group["default_source_id"] is None
    for mapping in mappings:
        group = groups_by_id[mapping["food_group_id"]]
        source_record = source_by_id[mapping["source_id"]]
        assert mapping["source_name"] == source_record["source_name"]
        assert (
            mapping["canonical_name"]
            == source_record["identity_candidate"]["canonical_name"]
            == group["canonical_name"]
        )
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

    duplicate_variants = Counter(
        (mapping["food_group_id"], mapping["variant_key"]) for mapping in mappings
    )
    duplicate_keys = {key for key, count in duplicate_variants.items() if count > 1}
    listed_keys = {
        (item["food_group_id"], item["variant_key"])
        for item in summary["variant_collisions"]
    }
    assert duplicate_keys == listed_keys, "variant collisions are not fully listed"
    assert summary["variant_collision_count"] == len(duplicate_keys)

    review_group_ids = {item["food_group_id"] for item in review}
    assert review_group_ids == {
        group["food_group_id"] for group in groups if group["needs_review"]
    }
    assert summary["input_record_count"] == len(source)
    assert summary["output_mapping_count"] == len(mappings)
    assert summary["food_group_count"] == len(groups)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--groups", type=Path, default=DEFAULT_GROUPS)
    parser.add_argument("--mappings", type=Path, default=DEFAULT_MAPPINGS)
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    return parser.parse_args()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    models = build_group_models(source)
    value_registry = build_value_registry(models)
    groups, mappings = render_outputs(models, value_registry)
    collisions = add_collision_issues(models, groups, mappings)
    review = build_review(models)
    summary = build_summary(source, groups, mappings, review, collisions)
    validate(source, groups, mappings, review, summary)

    write_json(args.groups, groups)
    write_json(args.mappings, mappings)
    write_json(args.review, review)
    write_json(args.summary, summary)
    for path in (args.groups, args.mappings, args.review, args.summary):
        json.loads(path.read_text(encoding="utf-8"))
    print(
        f"records={len(source)} groups={len(groups)} "
        f"selectable_groups={summary['groups_with_selectable_attributes']} "
        f"collisions={len(collisions)} review_groups={summary['review_group_count']}"
    )


if __name__ == "__main__":
    main()
