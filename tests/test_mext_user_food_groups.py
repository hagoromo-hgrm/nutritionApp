from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_mext_food_app_data import resolve_source_id  # noqa: E402
from build_mext_user_food_groups import (  # noqa: E402
    InvalidUserSelectionValue,
    MissingRequiredUserSelection,
    UserFoodGroupNotFound,
    build_all,
    load_json,
    resolve_food_group_id,
    search_user_food_groups,
)
from validate_mext_user_food_groups import validate_generated_data  # noqa: E402


class MextUserFoodGroupsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        processed = ROOT / "data/mext/processed"
        app = ROOT / "data/mext/app"
        cls.source_groups = load_json(processed / "mext_food_groups_v2.json")
        cls.source_mappings = load_json(processed / "mext_food_group_mappings_v2.json")
        cls.confirmed_summary = load_json(processed / "mext_food_group_summary_v2.json")
        cls.decisions = load_json(ROOT / "data/mext/user_food_group_decisions_v1.json")
        cls.outputs = build_all(
            cls.source_groups,
            cls.source_mappings,
            cls.confirmed_summary,
            cls.decisions,
        )
        cls.user_groups = cls.outputs["app_groups"]
        cls.search_index = cls.outputs["search_index"]
        cls.lower_groups = load_json(app / "food_groups.json")
        cls.lower_attributes = load_json(app / "food_group_attributes.json")
        cls.lower_variants = load_json(app / "food_variants.json")

    def test_all_food_groups_are_mapped_exactly_once(self) -> None:
        mappings = self.outputs["processed_mappings"]
        source_ids = {group["food_group_id"] for group in self.source_groups}
        mapped_ids = [mapping["food_group_id"] for mapping in mappings]
        self.assertEqual(len(mapped_ids), 1494)
        self.assertEqual(len(set(mapped_ids)), 1494)
        self.assertEqual(set(mapped_ids), source_ids)

    def test_generated_files_pass_independent_validation(self) -> None:
        metrics = validate_generated_data(
            source_groups=self.source_groups,
            source_mappings=self.source_mappings,
            user_groups=self.outputs["processed_groups"],
            user_mappings=self.outputs["processed_mappings"],
            reviews=self.outputs["processed_reviews"],
            summary=self.outputs["summary"],
            app_groups=self.outputs["app_groups"],
            app_mappings=self.outputs["app_mappings"],
            search_index=self.outputs["search_index"],
        )
        self.assertEqual(metrics["duplicate_food_group_mapping_count"], 0)
        self.assertEqual(metrics["missing_food_group_mapping_count"], 0)
        self.assertEqual(metrics["invalid_reference_count"], 0)

    def test_rice_search_returns_the_user_group_once(self) -> None:
        results = search_user_food_groups("ご飯", self.user_groups, self.search_index)
        rice_results = [result for result in results if result["group"]["canonicalName"] == "ご飯"]
        self.assertEqual(len(rice_results), 1)
        self.assertEqual(rice_results[0]["presetSelection"], {})

    def test_brown_rice_search_returns_a_preset_shortcut(self) -> None:
        result = next(
            item
            for item in search_user_food_groups("玄米", self.user_groups, self.search_index)
            if item["group"]["canonicalName"] == "ご飯"
        )
        self.assertEqual(result["presetSelection"], {"rice_type": "brown_rice"})
        self.assertEqual(result["foodGroupId"], "fg_001282")

    def test_user_selection_resolves_existing_food_group_and_source(self) -> None:
        rice = next(group for group in self.user_groups if group["canonicalName"] == "ご飯")
        food_group_id = resolve_food_group_id(rice["id"], {"rice_type": "white_rice"}, self.user_groups)
        self.assertEqual(food_group_id, "fg_000435")
        variant = next(item for item in self.lower_variants if item["foodGroupId"] == food_group_id)
        source_id = resolve_source_id(
            food_group_id,
            variant["attributes"],
            self.lower_groups,
            self.lower_attributes,
            self.lower_variants,
        )
        self.assertEqual(source_id, variant["sourceId"])

    def test_standalone_food_resolves_directly(self) -> None:
        group = next(item for item in self.user_groups if item["groupingLevel"] == "standalone")
        self.assertEqual(resolve_food_group_id(group["id"], {}, self.user_groups), group["memberFoodGroupIds"][0])

    def test_invalid_upper_selection_is_rejected(self) -> None:
        rice = next(group for group in self.user_groups if group["canonicalName"] == "ご飯")
        with self.assertRaises(InvalidUserSelectionValue):
            resolve_food_group_id(rice["id"], {"rice_type": "missing"}, self.user_groups)
        with self.assertRaises(InvalidUserSelectionValue):
            resolve_food_group_id(rice["id"], {"unknown": "white_rice"}, self.user_groups)
        with self.assertRaises(UserFoodGroupNotFound):
            resolve_food_group_id(f"{rice['id']}_missing", {}, self.user_groups)

    def test_required_selection_without_default_is_not_guessed(self) -> None:
        cheese = next(group for group in self.user_groups if group["canonicalName"] == "チーズ")
        self.assertIsNone(cheese["defaultFoodGroupId"])
        with self.assertRaises(MissingRequiredUserSelection):
            resolve_food_group_id(cheese["id"], {}, self.user_groups)

    def test_search_results_do_not_duplicate_user_groups(self) -> None:
        for query in ("ご飯", "玄米", "チーズ", "肉", "パン"):
            results = search_user_food_groups(query, self.user_groups, self.search_index)
            ids = [result["group"]["id"] for result in results]
            self.assertEqual(len(ids), len(set(ids)), query)

    def test_generation_is_deterministic(self) -> None:
        first = json.dumps(self.outputs, ensure_ascii=False, indent=2)
        second = json.dumps(
            build_all(
                self.source_groups,
                self.source_mappings,
                self.confirmed_summary,
                self.decisions,
            ),
            ensure_ascii=False,
            indent=2,
        )
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
