#!/usr/bin/env python3
"""Build the user-facing food-group layer without changing confirmed MEXT data."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GROUPS_PATH = PROJECT_ROOT / "data/mext/processed/mext_food_groups_v2.json"
DEFAULT_MAPPINGS_PATH = PROJECT_ROOT / "data/mext/processed/mext_food_group_mappings_v2.json"
DEFAULT_SUMMARY_PATH = PROJECT_ROOT / "data/mext/processed/mext_food_group_summary_v2.json"
DEFAULT_DECISIONS_PATH = PROJECT_ROOT / "data/mext/user_food_group_decisions_v1.json"
DEFAULT_PROCESSED_DIR = PROJECT_ROOT / "data/mext/processed"
DEFAULT_APP_DIR = PROJECT_ROOT / "data/mext/app"

EXPECTED_FOOD_GROUP_COUNT = 1494
EXPECTED_SOURCE_COUNT = 2538
GROUPING_LEVELS = {"strong", "moderate", "weak", "standalone"}


class UserFoodGroupBuildError(ValueError):
    """Raised when confirmed input or a curated grouping decision is inconsistent."""


class UserFoodGroupNotFound(ValueError):
    pass


class MissingRequiredUserSelection(ValueError):
    pass


class InvalidUserSelectionValue(ValueError):
    pass


class AmbiguousUserFoodSelection(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        raise UserFoodGroupBuildError(f"JSONを読み込めません: path={path}: {error}") from error


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
        ) as temporary_file:
            json.dump(data, temporary_file, ensure_ascii=False, indent=2, sort_keys=False)
            temporary_file.write("\n")
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().strip()
    return re.sub(r"\s+", " ", normalized)


def compact_search_text(value: str) -> str:
    return normalize_search_text(value).replace(" ", "")


def unique_strings(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        stripped = value.strip()
        if stripped and stripped not in seen:
            result.append(stripped)
            seen.add(stripped)
    return result


def require_string(record: Mapping[str, Any], field: str, *, context: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value:
        raise UserFoodGroupBuildError(f"文字列フィールドが不正です: {context}, field={field}")
    return value


def validate_confirmed_inputs(
    groups: Sequence[Mapping[str, Any]],
    mappings: Sequence[Mapping[str, Any]],
    summary: Mapping[str, Any],
) -> None:
    if len(groups) != EXPECTED_FOOD_GROUP_COUNT:
        raise UserFoodGroupBuildError(
            f"食品グループ件数が不正です: expected={EXPECTED_FOOD_GROUP_COUNT}, actual={len(groups)}"
        )
    if len(mappings) != EXPECTED_SOURCE_COUNT:
        raise UserFoodGroupBuildError(
            f"元食品マッピング件数が不正です: expected={EXPECTED_SOURCE_COUNT}, actual={len(mappings)}"
        )
    group_ids = [require_string(group, "food_group_id", context="food_group") for group in groups]
    source_ids = [require_string(mapping, "source_id", context="mapping") for mapping in mappings]
    if len(group_ids) != len(set(group_ids)):
        raise UserFoodGroupBuildError("確定済み食品グループに重複food_group_idがあります")
    if len(source_ids) != len(set(source_ids)):
        raise UserFoodGroupBuildError("確定済みマッピングに重複source_idがあります")
    known_group_ids = set(group_ids)
    invalid_mapping_groups = sorted(
        {mapping.get("food_group_id") for mapping in mappings if mapping.get("food_group_id") not in known_group_ids}
    )
    if invalid_mapping_groups:
        raise UserFoodGroupBuildError(
            f"確定済みマッピングのfood_group_id参照が不正です: ids={invalid_mapping_groups[:5]}"
        )
    if summary.get("food_group_count") != EXPECTED_FOOD_GROUP_COUNT:
        raise UserFoodGroupBuildError("確定済み集計のfood_group_countが一致しません")
    if summary.get("output_mapping_count") != EXPECTED_SOURCE_COUNT:
        raise UserFoodGroupBuildError("確定済み集計のoutput_mapping_countが一致しません")
    if summary.get("variant_collision_count") != 0:
        raise UserFoodGroupBuildError("確定済み集計にvariant衝突があります")


def derive_category(group: Mapping[str, Any]) -> str:
    name = str(group.get("display_name") or group.get("canonical_name") or "")
    parent = str(group.get("parent_concept") or "")
    food_form = str(group.get("food_form") or "")
    if "パン" in name or parent == "パン":
        return "パン"
    if any(term in name for term in ("うどん", "そば", "パスタ", "めん", "スパゲッティ")):
        return "麺類"
    if any(term in name for term in ("牛乳", "ヨーグルト", "チーズ", "乳")):
        return "乳製品"
    if any(term in name for term in ("豆腐", "納豆", "豆乳")):
        return "豆・大豆製品"
    if any(term in name for term in ("鶏", "牛", "豚", "卵")):
        return "肉・魚・卵"
    if food_form == "confectionery":
        return "菓子"
    if food_form == "beverage":
        return "飲料"
    if food_form == "seasoning":
        return "調味料"
    if food_form == "dish":
        return "料理"
    return "その他"


def extract_group_features(group: Mapping[str, Any]) -> dict[str, Any]:
    """Stage 1: retain only confirmed features used to propose candidate clusters."""
    return {
        "food_group_id": group["food_group_id"],
        "canonical_name": group["canonical_name"],
        "display_name": group["display_name"],
        "parent_concept": group.get("parent_concept"),
        "food_form": group["food_form"],
        "key_parts": group.get("key_parts", []),
        "search_terms": group.get("search_terms", []),
        "selectable_attributes": group.get("selectable_attributes", []),
        "fixed_attributes": group.get("fixed_attributes", []),
        "source_count": group["source_count"],
    }


def build_mechanical_candidate_sets(features: Sequence[Mapping[str, Any]]) -> list[list[str]]:
    """Stage 2: mechanically propose clusters; this never commits a grouping decision."""
    buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
    for feature in features:
        parent = feature.get("parent_concept")
        if isinstance(parent, str) and parent:
            buckets[(parent, str(feature["food_form"]))].append(str(feature["food_group_id"]))
    return [sorted(ids) for ids in buckets.values() if len(ids) > 1]


def validate_decisions(decisions: Mapping[str, Any], groups_by_id: Mapping[str, Mapping[str, Any]]) -> None:
    assigned: dict[str, str] = {}
    names: set[str] = set()
    for index, decision in enumerate(decisions.get("group_decisions", [])):
        context = f"group_decisions[{index}]"
        name = require_string(decision, "canonical_name", context=context)
        if name in names:
            raise UserFoodGroupBuildError(f"ユーザー向けcanonical_nameが重複しています: name={name}")
        names.add(name)
        if decision.get("grouping_level") not in GROUPING_LEVELS - {"standalone"}:
            raise UserFoodGroupBuildError(f"統合グループのgrouping_levelが不正です: name={name}")
        members = decision.get("members")
        if not isinstance(members, list) or len(members) < 2:
            raise UserFoodGroupBuildError(f"統合グループには2件以上のmembersが必要です: name={name}")
        dimension = decision.get("selection_dimension")
        if not isinstance(dimension, dict):
            raise UserFoodGroupBuildError(f"selection_dimensionがありません: name={name}")
        require_string(dimension, "dimension_id", context=f"{context}.selection_dimension")
        require_string(dimension, "display_name", context=f"{context}.selection_dimension")
        if not isinstance(decision.get("large_selection_reviewed", False), bool):
            raise UserFoodGroupBuildError(f"large_selection_reviewedが真偽値ではありません: name={name}")
        value_ids: set[str] = set()
        for member in members:
            group_id = require_string(member, "food_group_id", context=f"{context}.members")
            value_id = require_string(member, "value_id", context=f"{context}.members")
            require_string(member, "display_name", context=f"{context}.members")
            if group_id not in groups_by_id:
                raise UserFoodGroupBuildError(f"統合判断が未知のfood_group_idを参照しています: id={group_id}")
            if group_id in assigned:
                raise UserFoodGroupBuildError(
                    f"food_group_idが複数の統合判断に所属しています: id={group_id}, groups={assigned[group_id]},{name}"
                )
            if value_id in value_ids:
                raise UserFoodGroupBuildError(f"属性値IDが統合グループ内で重複しています: name={name}, value={value_id}")
            assigned[group_id] = name
            value_ids.add(value_id)
        default_group_id = decision.get("default_food_group_id")
        if default_group_id is not None and default_group_id not in {member["food_group_id"] for member in members}:
            raise UserFoodGroupBuildError(f"default_food_group_idがmembersにありません: name={name}")

    override_ids: set[str] = set()
    for index, override in enumerate(decisions.get("standalone_overrides", [])):
        context = f"standalone_overrides[{index}]"
        group_id = require_string(override, "food_group_id", context=context)
        require_string(override, "canonical_name", context=context)
        if group_id not in groups_by_id:
            raise UserFoodGroupBuildError(f"standalone overrideが未知のfood_group_idを参照しています: id={group_id}")
        if group_id in assigned:
            raise UserFoodGroupBuildError(f"統合済みfood_group_idへstandalone overrideがあります: id={group_id}")
        if group_id in override_ids:
            raise UserFoodGroupBuildError(f"standalone overrideが重複しています: id={group_id}")
        override_ids.add(group_id)


def _name_evidence(member_ids: Sequence[str], groups_by_id: Mapping[str, Mapping[str, Any]]) -> list[str]:
    return unique_strings(str(groups_by_id[group_id]["display_name"]) for group_id in member_ids)


def build_contextual_groups(
    decisions: Mapping[str, Any],
    groups_by_id: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], set[str]]:
    """Stage 3: apply only the explicitly reviewed contextual grouping decisions."""
    results: list[dict[str, Any]] = []
    assigned: set[str] = set()
    for decision in decisions.get("group_decisions", []):
        dimension = decision["selection_dimension"]
        member_ids = [member["food_group_id"] for member in decision["members"]]
        values = [
            {
                "value_id": member["value_id"],
                "display_name": member["display_name"],
                "food_group_id": member["food_group_id"],
                "search_shortcut": True,
            }
            for member in decision["members"]
        ]
        default_group_id = decision.get("default_food_group_id")
        default_value_id = next(
            (member["value_id"] for member in decision["members"] if member["food_group_id"] == default_group_id),
            None,
        )
        food_forms = {groups_by_id[group_id]["food_form"] for group_id in member_ids}
        review_reasons: list[str] = []
        if len(member_ids) >= 20:
            review_reasons.append("member_countが20件以上です")
        if len(values) >= 15 and not decision.get("large_selection_reviewed", False):
            review_reasons.append("一つの選択次元に15値以上あります")
        if len(food_forms) >= 3:
            review_reasons.append("異なるfood_formが3種類以上混在します")
        results.append(
            {
                "canonical_name": decision["canonical_name"],
                "display_name": decision["display_name"],
                "grouping_level": decision["grouping_level"],
                "category": decision["category"],
                "search_terms": unique_strings(decision.get("search_terms", [])),
                "default_food_group_id": default_group_id,
                "selection_dimensions": [
                    {
                        "dimension_id": dimension["dimension_id"],
                        "display_name": dimension["display_name"],
                        "required": True,
                        "default_value_id": default_value_id,
                        "values": values,
                    }
                ],
                "member_food_group_ids": member_ids,
                "member_count": len(member_ids),
                "has_direct_selection": default_group_id is not None,
                "generated_user_name": bool(decision.get("generated_user_name", False)),
                "name_evidence": _name_evidence(member_ids, groups_by_id),
                "grouping_reason": decision["grouping_reason"],
                "separation_reason": None,
                "confidence": decision["confidence"],
                "needs_review": bool(review_reasons),
                "review_reasons": review_reasons,
            }
        )
        assigned.update(member_ids)
    return results, assigned


def build_standalone_groups(
    groups: Sequence[Mapping[str, Any]],
    assigned: set[str],
    decisions: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Stage 4: every confirmed group not explicitly merged remains standalone."""
    overrides = {override["food_group_id"]: override for override in decisions.get("standalone_overrides", [])}
    results: list[dict[str, Any]] = []
    for source_group in groups:
        group_id = str(source_group["food_group_id"])
        if group_id in assigned:
            continue
        override = overrides.get(group_id, {})
        canonical_name = str(override.get("canonical_name") or source_group["canonical_name"])
        display_name = str(override.get("display_name") or source_group["display_name"])
        generated = bool(override.get("generated_user_name", False))
        search_terms = unique_strings(
            [
                canonical_name,
                display_name,
                *override.get("search_terms", []),
                str(source_group["canonical_name"]),
                str(source_group["display_name"]),
                *[str(term) for term in source_group.get("search_terms", [])],
            ]
        )
        results.append(
            {
                "canonical_name": canonical_name,
                "display_name": display_name,
                "grouping_level": "standalone",
                "category": str(override.get("category") or derive_category(source_group)),
                "search_terms": search_terms,
                "default_food_group_id": group_id,
                "selection_dimensions": [],
                "member_food_group_ids": [group_id],
                "member_count": 1,
                "has_direct_selection": True,
                "generated_user_name": generated,
                "name_evidence": [str(source_group["display_name"])],
                "grouping_reason": None,
                "separation_reason": str(
                    override.get("separation_reason")
                    or "既存の食品グループだけで元食品を一意に選択できるため"
                ),
                "confidence": float(override.get("confidence", 0.9)),
                "needs_review": False,
                "review_reasons": [],
            }
        )
    return results


def assign_user_food_group_ids(groups: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        groups,
        key=lambda group: (
            group["category"],
            group["canonical_name"],
            min(group["member_food_group_ids"]),
        ),
    )
    return [
        {"user_food_group_id": f"ufg_{index:06d}", **group}
        for index, group in enumerate(ordered, start=1)
    ]


def build_mappings(
    user_groups: Sequence[Mapping[str, Any]],
    groups_by_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    mappings: list[dict[str, Any]] = []
    for user_group in user_groups:
        preset_by_group: dict[str, dict[str, str]] = {}
        for dimension in user_group["selection_dimensions"]:
            for value in dimension["values"]:
                preset_by_group.setdefault(value["food_group_id"], {})[dimension["dimension_id"]] = value["value_id"]
        for group_id in user_group["member_food_group_ids"]:
            mappings.append(
                {
                    "food_group_id": group_id,
                    "canonical_name": groups_by_id[group_id]["canonical_name"],
                    "user_food_group_id": user_group["user_food_group_id"],
                    "user_food_group_name": user_group["canonical_name"],
                    "preset_selection": preset_by_group.get(group_id, {}),
                    "is_default": group_id == user_group["default_food_group_id"],
                }
            )
    return sorted(mappings, key=lambda mapping: mapping["food_group_id"])


def build_review_items(
    user_groups: Sequence[Mapping[str, Any]],
    decisions: Mapping[str, Any],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for group in user_groups:
        if group["needs_review"]:
            items.append(
                {
                    "user_food_group_id": group["user_food_group_id"],
                    "candidate_name": group["canonical_name"],
                    "food_group_ids": group["member_food_group_ids"],
                    "reason": "、".join(group["review_reasons"]),
                    "candidate_resolution": "統合範囲または選択次元を人間が確認する",
                }
            )
    for candidate in decisions.get("review_candidates", []):
        items.append(dict(candidate))
    return items


def to_app_groups(groups: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": group["user_food_group_id"],
            "canonicalName": group["canonical_name"],
            "displayName": group["display_name"],
            "groupingLevel": group["grouping_level"],
            "category": group["category"],
            "searchTerms": group["search_terms"],
            "defaultFoodGroupId": group["default_food_group_id"],
            "selectionDimensions": [
                {
                    "id": dimension["dimension_id"],
                    "displayName": dimension["display_name"],
                    "required": dimension["required"],
                    "defaultValueId": dimension["default_value_id"],
                    "values": [
                        {
                            "id": value["value_id"],
                            "displayName": value["display_name"],
                            "foodGroupId": value["food_group_id"],
                            "searchShortcut": value["search_shortcut"],
                        }
                        for value in dimension["values"]
                    ],
                }
                for dimension in group["selection_dimensions"]
            ],
            "memberFoodGroupIds": group["member_food_group_ids"],
            "memberCount": group["member_count"],
            "hasDirectSelection": group["has_direct_selection"],
            "generatedUserName": group["generated_user_name"],
            "nameEvidence": group["name_evidence"],
            "groupingReason": group["grouping_reason"],
            "separationReason": group["separation_reason"],
            "confidence": group["confidence"],
            "needsReview": group["needs_review"],
            "reviewReasons": group["review_reasons"],
        }
        for group in groups
    ]


def to_app_mappings(mappings: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "foodGroupId": mapping["food_group_id"],
            "canonicalName": mapping["canonical_name"],
            "userFoodGroupId": mapping["user_food_group_id"],
            "userFoodGroupName": mapping["user_food_group_name"],
            "presetSelection": mapping["preset_selection"],
            "isDefault": mapping["is_default"],
        }
        for mapping in mappings
    ]


def _add_search_target(
    index: dict[str, dict[str, Any]],
    term: str,
    target: Mapping[str, Any],
) -> None:
    normalized = normalize_search_text(term)
    if not normalized:
        return
    entry = index.setdefault(
        normalized,
        {"normalizedTerm": normalized, "compactTerm": compact_search_text(term), "targets": []},
    )
    signature = (
        target["targetType"],
        target["userFoodGroupId"],
        target.get("foodGroupId"),
        tuple(sorted(target.get("presetSelection", {}).items())),
        target["matchSource"],
    )
    existing_signatures = {
        (
            item["targetType"],
            item["userFoodGroupId"],
            item.get("foodGroupId"),
            tuple(sorted(item.get("presetSelection", {}).items())),
            item["matchSource"],
        )
        for item in entry["targets"]
    }
    if signature not in existing_signatures:
        entry["targets"].append({**target, "sourceTerm": term})


def build_search_index(
    user_groups: Sequence[Mapping[str, Any]],
    groups_by_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for group in user_groups:
        base_target = {
            "targetType": "user_food_group",
            "userFoodGroupId": group["user_food_group_id"],
            "presetSelection": {},
            "foodGroupId": group["default_food_group_id"] if group["has_direct_selection"] else None,
        }
        for term in unique_strings([group["canonical_name"], group["display_name"]]):
            _add_search_target(index, term, {**base_target, "matchSource": "group_name"})
        for term in group["search_terms"]:
            _add_search_target(index, term, {**base_target, "matchSource": "group_term"})

        for dimension in group["selection_dimensions"]:
            for value in dimension["values"]:
                if not value["search_shortcut"]:
                    continue
                food_group = groups_by_id[value["food_group_id"]]
                shortcut_target = {
                    "targetType": "user_food_variant",
                    "userFoodGroupId": group["user_food_group_id"],
                    "presetSelection": {dimension["dimension_id"]: value["value_id"]},
                    "foodGroupId": value["food_group_id"],
                    "matchSource": "shortcut",
                }
                _add_search_target(index, value["display_name"], shortcut_target)
                member_terms = unique_strings(
                    [str(food_group["canonical_name"]), str(food_group["display_name"]), *food_group.get("search_terms", [])]
                )
                for term in member_terms:
                    member_target = {**shortcut_target, "matchSource": "member_canonical"}
                    _add_search_target(index, term, member_target)

    for entry in index.values():
        entry["targets"].sort(
            key=lambda target: (
                target["userFoodGroupId"],
                target["targetType"],
                target["sourceTerm"],
                target.get("foodGroupId") or "",
            )
        )
    return [index[key] for key in sorted(index)]


def resolve_food_group_id(
    user_food_group_id: str,
    selected_values: Mapping[str, str],
    app_groups: Sequence[Mapping[str, Any]],
) -> str:
    group = next((item for item in app_groups if item["id"] == user_food_group_id), None)
    if group is None:
        raise UserFoodGroupNotFound(f"ユーザー向け食品グループがありません: id={user_food_group_id}")
    dimensions = {dimension["id"]: dimension for dimension in group["selectionDimensions"]}
    unknown_dimensions = sorted(set(selected_values) - set(dimensions))
    if unknown_dimensions:
        raise InvalidUserSelectionValue(
            f"未知の選択次元です: user_food_group_id={user_food_group_id}, dimensions={unknown_dimensions}"
        )
    if not dimensions:
        food_group_id = group.get("defaultFoodGroupId")
        if not isinstance(food_group_id, str):
            raise AmbiguousUserFoodSelection(f"食品グループを一意に解決できません: id={user_food_group_id}")
        return food_group_id

    resolved_group_ids: set[str] = set()
    missing: list[str] = []
    for dimension_id, dimension in dimensions.items():
        value_id = selected_values.get(dimension_id)
        if value_id is None and not selected_values and group.get("hasDirectSelection"):
            value_id = dimension.get("defaultValueId")
        if value_id is None:
            if dimension.get("required"):
                missing.append(dimension_id)
            continue
        value = next((item for item in dimension["values"] if item["id"] == value_id), None)
        if value is None:
            raise InvalidUserSelectionValue(
                "上位属性値が不正です: "
                f"user_food_group_id={user_food_group_id}, dimension={dimension_id}, value={value_id}"
            )
        resolved_group_ids.add(str(value["foodGroupId"]))
    if missing:
        raise MissingRequiredUserSelection(
            f"必須の上位属性が不足しています: user_food_group_id={user_food_group_id}, dimensions={missing}"
        )
    if len(resolved_group_ids) != 1:
        raise AmbiguousUserFoodSelection(
            f"食品グループを一意に解決できません: id={user_food_group_id}, groups={sorted(resolved_group_ids)}"
        )
    return next(iter(resolved_group_ids))


def search_user_food_groups(
    query: str,
    app_groups: Sequence[Mapping[str, Any]],
    search_index: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    normalized_query = normalize_search_text(query)
    compact_query = compact_search_text(query)
    if not normalized_query:
        return []
    groups_by_id = {group["id"]: group for group in app_groups}
    best_by_group: dict[str, dict[str, Any]] = {}
    for entry in search_index:
        term = str(entry["normalizedTerm"])
        compact_term = str(entry["compactTerm"])
        is_exact = term == normalized_query or compact_term == compact_query
        is_prefix = term.startswith(normalized_query) or compact_term.startswith(compact_query)
        is_partial = normalized_query in term or compact_query in compact_term
        if not (is_exact or is_prefix or is_partial):
            continue
        for target in entry["targets"]:
            source = target["matchSource"]
            if is_exact and source == "group_name":
                score = 600
            elif is_exact and source == "shortcut":
                score = 550
            elif source in {"group_name", "group_term"} and (is_exact or is_prefix):
                score = 500
            elif source == "shortcut" and is_prefix:
                score = 450
            elif source == "member_canonical":
                score = 200
            else:
                score = 300
            user_group_id = target["userFoodGroupId"]
            candidate = {
                "group": groups_by_id[user_group_id],
                "presetSelection": target["presetSelection"],
                "foodGroupId": target.get("foodGroupId"),
                "targetType": target["targetType"],
                "matchedTerm": target["sourceTerm"],
                "score": score,
            }
            current = best_by_group.get(user_group_id)
            candidate_key = (-score, candidate["matchedTerm"], json.dumps(candidate["presetSelection"], sort_keys=True))
            current_key = (
                -current["score"],
                current["matchedTerm"],
                json.dumps(current["presetSelection"], sort_keys=True),
            ) if current else None
            if current is None or candidate_key < current_key:
                best_by_group[user_group_id] = candidate
    return sorted(
        best_by_group.values(),
        key=lambda result: (-result["score"], result["group"]["displayName"], result["group"]["id"]),
    )


def validate_outputs(
    source_groups: Sequence[Mapping[str, Any]],
    user_groups: Sequence[Mapping[str, Any]],
    mappings: Sequence[Mapping[str, Any]],
    search_index: Sequence[Mapping[str, Any]],
) -> dict[str, int]:
    source_group_ids = {str(group["food_group_id"]) for group in source_groups}
    user_group_ids = [str(group["user_food_group_id"]) for group in user_groups]
    mapped_group_ids = [str(mapping["food_group_id"]) for mapping in mappings]
    duplicate_mapping_count = len(mapped_group_ids) - len(set(mapped_group_ids))
    missing_mapping_count = len(source_group_ids - set(mapped_group_ids))
    unknown_mapping_count = len(set(mapped_group_ids) - source_group_ids)
    invalid_reference_count = 0
    if len(user_group_ids) != len(set(user_group_ids)):
        invalid_reference_count += len(user_group_ids) - len(set(user_group_ids))
    user_groups_by_id = {group["user_food_group_id"]: group for group in user_groups}
    for mapping in mappings:
        user_group = user_groups_by_id.get(mapping["user_food_group_id"])
        if user_group is None or mapping["food_group_id"] not in user_group["member_food_group_ids"]:
            invalid_reference_count += 1
    for group in user_groups:
        members = set(group["member_food_group_ids"])
        if not members <= source_group_ids:
            invalid_reference_count += len(members - source_group_ids)
        default_group_id = group["default_food_group_id"]
        if default_group_id is not None and default_group_id not in members:
            invalid_reference_count += 1
        if group["grouping_level"] == "standalone" and group["member_count"] != 1:
            invalid_reference_count += 1
        if group["member_count"] > 1 and not group["selection_dimensions"]:
            invalid_reference_count += 1
        for dimension in group["selection_dimensions"]:
            value_ids: set[str] = set()
            referenced_members: set[str] = set()
            for value in dimension["values"]:
                if value["value_id"] in value_ids or value["food_group_id"] not in members:
                    invalid_reference_count += 1
                value_ids.add(value["value_id"])
                referenced_members.add(value["food_group_id"])
            if referenced_members != members:
                invalid_reference_count += 1
            if dimension["default_value_id"] is not None and dimension["default_value_id"] not in value_ids:
                invalid_reference_count += 1
    for entry in search_index:
        for target in entry["targets"]:
            user_group = user_groups_by_id.get(target["userFoodGroupId"])
            if user_group is None:
                invalid_reference_count += 1
                continue
            food_group_id = target.get("foodGroupId")
            if food_group_id is not None and food_group_id not in user_group["member_food_group_ids"]:
                invalid_reference_count += 1
            dimension_values = {
                dimension["dimension_id"]: {value["value_id"] for value in dimension["values"]}
                for dimension in user_group["selection_dimensions"]
            }
            for dimension_id, value_id in target.get("presetSelection", {}).items():
                if value_id not in dimension_values.get(dimension_id, set()):
                    invalid_reference_count += 1

    if duplicate_mapping_count or missing_mapping_count or unknown_mapping_count or invalid_reference_count:
        raise UserFoodGroupBuildError(
            "ユーザー向け食品グループの検証に失敗しました: "
            f"duplicate={duplicate_mapping_count}, missing={missing_mapping_count}, "
            f"unknown={unknown_mapping_count}, invalid_reference={invalid_reference_count}"
        )
    return {
        "duplicate_food_group_mapping_count": duplicate_mapping_count,
        "missing_food_group_mapping_count": missing_mapping_count,
        "invalid_reference_count": invalid_reference_count,
    }


def build_summary(
    user_groups: Sequence[Mapping[str, Any]],
    mappings: Sequence[Mapping[str, Any]],
    reviews: Sequence[Mapping[str, Any]],
    validation: Mapping[str, int],
    candidate_set_count: int,
) -> dict[str, Any]:
    level_counts = Counter(str(group["grouping_level"]) for group in user_groups)
    multi_groups = [group for group in user_groups if group["member_count"] > 1]
    dimensions = [dimension for group in user_groups for dimension in group["selection_dimensions"]]
    return {
        "input_food_group_count": EXPECTED_FOOD_GROUP_COUNT,
        "mapped_food_group_count": len(mappings),
        "user_food_group_count": len(user_groups),
        "strong_group_count": level_counts["strong"],
        "moderate_group_count": level_counts["moderate"],
        "weak_group_count": level_counts["weak"],
        "standalone_group_count": level_counts["standalone"],
        "multi_member_group_count": len(multi_groups),
        "single_member_group_count": len(user_groups) - len(multi_groups),
        "groups_with_direct_selection": sum(bool(group["has_direct_selection"]) for group in user_groups),
        "groups_requiring_selection": sum(not bool(group["has_direct_selection"]) for group in user_groups),
        "selection_dimension_count": len(dimensions),
        "selection_value_count": sum(len(dimension["values"]) for dimension in dimensions),
        "search_shortcut_count": sum(
            bool(value["search_shortcut"])
            for dimension in dimensions
            for value in dimension["values"]
        ),
        "review_group_count": len(reviews),
        "mechanical_candidate_set_count": candidate_set_count,
        **validation,
        "validation_passed": True,
    }


def build_all(
    groups: Sequence[Mapping[str, Any]],
    mappings: Sequence[Mapping[str, Any]],
    summary: Mapping[str, Any],
    decisions: Mapping[str, Any],
) -> dict[str, Any]:
    validate_confirmed_inputs(groups, mappings, summary)
    groups_by_id = {str(group["food_group_id"]): group for group in groups}
    validate_decisions(decisions, groups_by_id)
    features = [extract_group_features(group) for group in groups]
    candidate_sets = build_mechanical_candidate_sets(features)
    contextual, assigned = build_contextual_groups(decisions, groups_by_id)
    standalone = build_standalone_groups(groups, assigned, decisions)
    user_groups = assign_user_food_group_ids([*contextual, *standalone])
    user_mappings = build_mappings(user_groups, groups_by_id)
    reviews = build_review_items(user_groups, decisions)
    search_index = build_search_index(user_groups, groups_by_id)
    validation = validate_outputs(groups, user_groups, user_mappings, search_index)
    result_summary = build_summary(
        user_groups,
        user_mappings,
        reviews,
        validation,
        len(candidate_sets),
    )
    return {
        "processed_groups": user_groups,
        "processed_mappings": user_mappings,
        "processed_reviews": reviews,
        "summary": result_summary,
        "app_groups": to_app_groups(user_groups),
        "app_mappings": to_app_mappings(user_mappings),
        "search_index": search_index,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--groups", type=Path, default=DEFAULT_GROUPS_PATH)
    parser.add_argument("--mappings", type=Path, default=DEFAULT_MAPPINGS_PATH)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY_PATH)
    parser.add_argument("--decisions", type=Path, default=DEFAULT_DECISIONS_PATH)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--app-dir", type=Path, default=DEFAULT_APP_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = build_all(
        load_json(args.groups),
        load_json(args.mappings),
        load_json(args.summary),
        load_json(args.decisions),
    )
    output_paths = {
        args.processed_dir / "mext_user_food_groups_v1.json": result["processed_groups"],
        args.processed_dir / "mext_user_food_group_mappings_v1.json": result["processed_mappings"],
        args.processed_dir / "mext_user_food_group_review_v1.json": result["processed_reviews"],
        args.processed_dir / "mext_user_food_group_summary_v1.json": result["summary"],
        args.app_dir / "user_food_groups.json": result["app_groups"],
        args.app_dir / "user_food_group_mappings.json": result["app_mappings"],
        args.app_dir / "user_food_search_index.json": result["search_index"],
    }
    for path, data in output_paths.items():
        write_json_atomic(path, data)
    print(
        "valid "
        f"input_groups={result['summary']['input_food_group_count']} "
        f"user_groups={result['summary']['user_food_group_count']} "
        f"multi={result['summary']['multi_member_group_count']} "
        f"standalone={result['summary']['standalone_group_count']} "
        f"review={result['summary']['review_group_count']}"
    )


if __name__ == "__main__":
    main()
