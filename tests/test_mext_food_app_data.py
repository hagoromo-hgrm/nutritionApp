from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_mext_food_app_data import (  # noqa: E402
    FoodGroupNotFound,
    InvalidAttributeValue,
    MissingRequiredAttribute,
    build_all,
    load_json,
    resolve_source_id,
    validate_input_groups,
    validate_input_mappings,
    write_json_atomic,
)
from validate_mext_food_app_data import validate_app_data  # noqa: E402


class MextFoodAppDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        processed = ROOT / "data/mext/processed"
        cls.groups = validate_input_groups(load_json(processed / "mext_food_groups_v2.json"))
        cls.mappings = validate_input_mappings(load_json(processed / "mext_food_group_mappings_v2.json"))
        cls.source_food_ids = {
            food["id"] for food in load_json(processed / "mext_foods.json")["foods"]
        }
        cls.outputs = build_all(cls.groups, cls.mappings)

    def test_input_and_output_counts_match(self) -> None:
        self.assertEqual(len(self.groups), 1494)
        self.assertEqual(len(self.mappings), 2538)
        self.assertEqual(len(self.outputs["food_groups.json"]), 1494)
        self.assertEqual(len(self.outputs["food_variants.json"]), 2538)

    def test_all_source_and_group_ids_are_preserved(self) -> None:
        self.assertEqual(
            {mapping["source_id"] for mapping in self.mappings},
            {variant["sourceId"] for variant in self.outputs["food_variants.json"]},
        )
        self.assertEqual(
            {group["food_group_id"] for group in self.groups},
            {group["id"] for group in self.outputs["food_groups.json"]},
        )

    def test_validation_has_no_collisions_or_broken_references(self) -> None:
        metrics = validate_app_data(
            input_groups=self.groups,
            input_mappings=self.mappings,
            source_food_ids=self.source_food_ids,
            food_groups=self.outputs["food_groups.json"],
            attributes=self.outputs["food_group_attributes.json"],
            fixed_attributes=self.outputs["food_group_fixed_attributes.json"],
            variants=self.outputs["food_variants.json"],
            search_index=self.outputs["food_search_index.json"],
        )
        self.assertEqual(metrics["variant_collision_count"], 0)
        self.assertEqual(metrics["invalid_attribute_reference_count"], 0)
        self.assertEqual(metrics["groups_without_resolvable_variant_count"], 0)

    def test_generation_is_deterministic_and_atomic_json_is_reloadable(self) -> None:
        first = json.dumps(self.outputs, ensure_ascii=False, indent=2)
        second = json.dumps(build_all(self.groups, self.mappings), ensure_ascii=False, indent=2)
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested/output.json"
            write_json_atomic(output, self.outputs["food_groups.json"])
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.outputs["food_groups.json"])

    def test_no_attribute_group_resolves_immediately(self) -> None:
        group = next(
            group
            for group in self.outputs["food_groups.json"]
            if group["selectableAttributeCount"] == 0 and group["fixedAttributeCount"] == 0
        )
        source_id = resolve_source_id(
            group["id"],
            {},
            self.outputs["food_groups.json"],
            self.outputs["food_group_attributes.json"],
            self.outputs["food_variants.json"],
        )
        self.assertEqual(source_id, group["defaultSourceId"])

    def test_selectable_unspecified_and_not_applicable_variants_resolve(self) -> None:
        attributes = self.outputs["food_group_attributes.json"]
        variants = self.outputs["food_variants.json"]
        for target_value in ("unspecified", "not_applicable"):
            attribute = next(
                attribute
                for attribute in attributes
                if any(value["id"] == target_value for value in attribute["values"])
            )
            variant = next(
                variant
                for variant in variants
                if variant["foodGroupId"] == attribute["foodGroupId"]
                and variant["attributes"].get(attribute["id"]) == target_value
            )
            self.assertEqual(
                resolve_source_id(
                    attribute["foodGroupId"],
                    variant["attributes"],
                    self.outputs["food_groups.json"],
                    attributes,
                    variants,
                ),
                variant["sourceId"],
            )

    def test_invalid_missing_and_unknown_selections_raise(self) -> None:
        group = next(
            group for group in self.outputs["food_groups.json"] if group["hasSelectableAttributes"]
        )
        attribute = next(
            item
            for item in self.outputs["food_group_attributes.json"]
            if item["foodGroupId"] == group["id"]
        )
        with self.assertRaises(MissingRequiredAttribute):
            resolve_source_id(
                group["id"],
                {},
                self.outputs["food_groups.json"],
                self.outputs["food_group_attributes.json"],
                self.outputs["food_variants.json"],
            )
        with self.assertRaises(InvalidAttributeValue):
            resolve_source_id(
                group["id"],
                {attribute["id"]: f"{attribute['values'][0]['id']}_invalid"},
                self.outputs["food_groups.json"],
                self.outputs["food_group_attributes.json"],
                self.outputs["food_variants.json"],
            )
        with self.assertRaises(FoodGroupNotFound):
            resolve_source_id(
                f"{group['id']}_missing",
                {},
                self.outputs["food_groups.json"],
                self.outputs["food_group_attributes.json"],
                self.outputs["food_variants.json"],
            )


if __name__ == "__main__":
    unittest.main()
