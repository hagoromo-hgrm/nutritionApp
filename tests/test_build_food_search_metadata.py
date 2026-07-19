import unittest
import json
from pathlib import Path

from scripts.build_food_search_metadata import build_first_token_review_groups, build_llm_confirmed_groups, first_token_for_review


class ReviewCandidateGroupingTest(unittest.TestCase):
    def test_first_token_uses_exact_match(self) -> None:
        foods = [
            {"id": "aa-bb", "officialName": "＜分類＞ AA BB", "displayName": "AA BB"},
            {"id": "aa-cc", "officialName": "AA CC", "displayName": "AA CC"},
            {"id": "aab-bb", "officialName": "AAB BB", "displayName": "AAB BB"},
        ]
        group_by_food_id = {food["id"]: f"food:{food['id']}" for food in foods}
        groups_by_id = {
            group_id: {"id": group_id, "displayName": food["displayName"]}
            for food, group_id in ((food, group_by_food_id[food["id"]]) for food in foods)
        }

        review_groups = build_first_token_review_groups(foods, group_by_food_id, groups_by_id, {})
        grouped_ids = {item["firstToken"]: item["foodIds"] for item in review_groups}

        self.assertEqual(first_token_for_review("＜分類＞ AA BB"), "AA")
        self.assertEqual(grouped_ids["AA"], ["aa-bb", "aa-cc"])
        self.assertEqual(grouped_ids["AAB"], ["aab-bb"])
        self.assertTrue(next(item for item in review_groups if item["firstToken"] == "AA")["isCandidateGroup"])
        self.assertFalse(next(item for item in review_groups if item["firstToken"] == "AAB")["isCandidateGroup"])

    def test_eggplant_pickles_are_explicitly_separate_groups(self) -> None:
        known_good = json.loads((Path(__file__).parents[1] / "data/mext/food_group_known_good.json").read_text(encoding="utf-8"))
        groups = {group["id"]: group for group in known_good["groups"]}

        self.assertEqual(groups["vegetable:eggplant"]["foodIds"], ["mext_06191", "mext_06192", "mext_06342", "mext_06343"])
        self.assertEqual(groups["vegetable:eggplant:beinasu"]["foodIds"], ["mext_06193", "mext_06194"])
        pickle_group_ids = [group_id for group_id in groups if group_id.startswith("vegetable:eggplant:pickle:")]
        self.assertEqual(len(pickle_group_ids), 5)
        self.assertEqual(sorted(groups[group_id]["foodIds"][0] for group_id in pickle_group_ids), [f"mext_{food_number:05d}" for food_number in range(6195, 6200)])

    def test_llm_confirmed_family_decisions_are_present(self) -> None:
        known_good = json.loads((Path(__file__).parents[1] / "data/mext/food_group_known_good.json").read_text(encoding="utf-8"))
        groups = {group["id"]: group for group in known_good["groups"]}
        self.assertEqual(groups["bean:azuki:an"]["foodIds"], ["mext_04004", "mext_04005", "mext_04101", "mext_04102", "mext_04103", "mext_04111", "mext_04006"])
        self.assertEqual(groups["seasoning:mustard:karashi"]["foodIds"], ["mext_17057", "mext_17058"])
        self.assertEqual(groups["seasoning:mustard:mustard"]["foodIds"], ["mext_17059", "mext_17060"])
        self.assertEqual(groups["sweets:manju:castella"]["foodIds"], ["mext_15029", "mext_15159"])
        self.assertEqual(groups["sweets:danish"]["foodIds"], ["mext_15182", "mext_15076", "mext_15183", "mext_15184", "mext_15171", "mext_15172", "mext_15185", "mext_15173"])
        self.assertEqual(groups["sweets:donut"]["foodIds"], ["mext_15077", "mext_15174", "mext_15175", "mext_15176", "mext_15078", "mext_15177", "mext_15178", "mext_15179"])
        self.assertEqual(groups["seasoning:dressing:semi-solid"]["foodIds"], ["mext_17042", "mext_17043", "mext_17118"])

    def test_llm_clear_decisions_are_imported_and_ambiguous_ids_are_left_for_known_good(self) -> None:
        root = Path(__file__).parents[1]
        foods = json.loads((root / "data/mext/processed/mext_foods.json").read_text(encoding="utf-8"))["foods"]
        llm_review = json.loads((root / "data/mext/food_group_llm_review.json").read_text(encoding="utf-8"))
        known_good = json.loads((root / "data/mext/food_group_known_good.json").read_text(encoding="utf-8"))
        assigned = {food_id for group in known_good["groups"] for food_id in group["foodIds"]}
        attributes = {food["id"]: {} for food in foods}

        groups, imported_ids, food_group_by_food_id = build_llm_confirmed_groups(llm_review, {food["id"]: food for food in foods}, assigned, attributes)

        self.assertEqual(len(groups), 1583)
        self.assertEqual(len(imported_ids), 1691)
        self.assertEqual(attributes["mext_15069"]["nameSpecification"], "こしあん入り")
        self.assertEqual(attributes["mext_15141"]["nameSpecification"], "クリーム入り")
        self.assertEqual(food_group_by_food_id["mext_15069"], food_group_by_food_id["mext_15168"])
        self.assertNotIn("mext_04004", imported_ids)


if __name__ == "__main__":
    unittest.main()
