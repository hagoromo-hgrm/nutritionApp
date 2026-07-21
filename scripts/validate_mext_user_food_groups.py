#!/usr/bin/env python3
"""Validate the generated user-facing MEXT food-group layer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from build_mext_user_food_groups import (
    DEFAULT_APP_DIR,
    DEFAULT_DECISIONS_PATH,
    DEFAULT_GROUPS_PATH,
    DEFAULT_MAPPINGS_PATH,
    DEFAULT_PROCESSED_DIR,
    DEFAULT_SUMMARY_PATH,
    UserFoodGroupBuildError,
    build_all,
    load_json,
    validate_outputs,
)


class UserFoodGroupValidationError(ValueError):
    """Raised when generated files diverge from confirmed inputs or deterministic output."""


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise UserFoodGroupValidationError(message)


def validate_generated_data(
    *,
    source_groups: Sequence[Mapping[str, Any]],
    source_mappings: Sequence[Mapping[str, Any]],
    user_groups: Sequence[Mapping[str, Any]],
    user_mappings: Sequence[Mapping[str, Any]],
    reviews: Sequence[Mapping[str, Any]],
    summary: Mapping[str, Any],
    app_groups: Sequence[Mapping[str, Any]],
    app_mappings: Sequence[Mapping[str, Any]],
    search_index: Sequence[Mapping[str, Any]],
) -> dict[str, int]:
    metrics = validate_outputs(source_groups, user_groups, user_mappings, search_index)
    _assert(len(source_groups) == 1494, "入力food_group数が1,494件ではありません")
    _assert(len(source_mappings) == 2538, "入力source_id数が2,538件ではありません")
    _assert(len(user_mappings) == 1494, "ユーザー向けマッピングが1,494件ではありません")
    _assert(len(app_groups) == len(user_groups), "app user_food_groups件数が一致しません")
    _assert(len(app_mappings) == len(user_mappings), "app user_food_group_mappings件数が一致しません")
    _assert(summary.get("input_food_group_count") == 1494, "summaryの入力件数が不正です")
    _assert(summary.get("mapped_food_group_count") == 1494, "summaryのマッピング件数が不正です")
    _assert(summary.get("user_food_group_count") == len(user_groups), "summaryのグループ件数が不正です")
    _assert(summary.get("review_group_count") == len(reviews), "summaryの要確認件数が不正です")
    _assert(summary.get("validation_passed") is True, "validation_passedがtrueではありません")
    _assert(
        summary.get("multi_member_group_count", 0) + summary.get("single_member_group_count", 0)
        == len(user_groups),
        "複数・単一メンバー件数の合計が一致しません",
    )
    _assert(
        summary.get("standalone_group_count") == summary.get("single_member_group_count"),
        "standalone件数と単一メンバー件数が一致しません",
    )
    rice = next((group for group in user_groups if group["canonical_name"] == "ご飯"), None)
    _assert(rice is not None, "ユーザー向け「ご飯」グループがありません")
    rice_labels = {
        value["display_name"]
        for dimension in rice["selection_dimensions"]
        for value in dimension["values"]
    }
    _assert(
        {"白ごはん", "玄米ごはん", "麦ごはん"} <= rice_labels,
        "ご飯に白・玄米・麦の選択肢が揃っていません",
    )
    _assert(
        any(
            target["userFoodGroupId"] == rice["user_food_group_id"]
            and target["presetSelection"].get("rice_type") == "brown_rice"
            for entry in search_index
            if "玄米" in entry["normalizedTerm"]
            for target in entry["targets"]
        ),
        "玄米ごはんの検索ショートカットがありません",
    )
    return metrics


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
    source_groups = load_json(args.groups)
    source_mappings = load_json(args.mappings)
    user_groups = load_json(args.processed_dir / "mext_user_food_groups_v1.json")
    user_mappings = load_json(args.processed_dir / "mext_user_food_group_mappings_v1.json")
    reviews = load_json(args.processed_dir / "mext_user_food_group_review_v1.json")
    generated_summary = load_json(args.processed_dir / "mext_user_food_group_summary_v1.json")
    app_groups = load_json(args.app_dir / "user_food_groups.json")
    app_mappings = load_json(args.app_dir / "user_food_group_mappings.json")
    search_index = load_json(args.app_dir / "user_food_search_index.json")
    metrics = validate_generated_data(
        source_groups=source_groups,
        source_mappings=source_mappings,
        user_groups=user_groups,
        user_mappings=user_mappings,
        reviews=reviews,
        summary=generated_summary,
        app_groups=app_groups,
        app_mappings=app_mappings,
        search_index=search_index,
    )

    expected = build_all(
        source_groups,
        source_mappings,
        load_json(args.summary),
        load_json(args.decisions),
    )
    comparisons = {
        "processed_groups": user_groups,
        "processed_mappings": user_mappings,
        "processed_reviews": reviews,
        "summary": generated_summary,
        "app_groups": app_groups,
        "app_mappings": app_mappings,
        "search_index": search_index,
    }
    for key, actual in comparisons.items():
        _assert(actual == expected[key], f"再生成結果が一致しません: output={key}")

    print(
        "valid "
        f"input_groups={len(source_groups)} user_groups={len(user_groups)} "
        f"mapped={len(user_mappings)} duplicate={metrics['duplicate_food_group_mapping_count']} "
        f"missing={metrics['missing_food_group_mapping_count']} "
        f"invalid_reference={metrics['invalid_reference_count']} review={len(reviews)}"
    )


if __name__ == "__main__":
    try:
        main()
    except (UserFoodGroupBuildError, UserFoodGroupValidationError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
