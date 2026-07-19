import unittest
import json
from pathlib import Path

from scripts.build_food_search_metadata import build_first_token_review_groups, first_token_for_review


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


if __name__ == "__main__":
    unittest.main()
