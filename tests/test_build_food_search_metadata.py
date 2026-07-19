import json
import unittest
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

    def test_classification_reset_artifacts_are_unassigned(self) -> None:
        root = Path(__file__).parents[1]
        known_good = json.loads((root / "data/mext/food_group_known_good.json").read_text(encoding="utf-8"))
        metadata = json.loads((root / "data/mext/processed/mext_search_metadata.json").read_text(encoding="utf-8"))
        review = json.loads((root / "data/mext/food_group_review.json").read_text(encoding="utf-8"))
        foods = json.loads((root / "data/mext/processed/mext_foods.json").read_text(encoding="utf-8"))["foods"]

        self.assertEqual(known_good["groups"], [])
        self.assertTrue(metadata["metadata"]["classificationReset"])
        self.assertEqual(len(metadata["groups"]), len(foods))
        self.assertTrue(all(group["needsReview"] for group in metadata["groups"]))
        self.assertEqual(len(metadata["aliases"]), 0)
        self.assertEqual(len(metadata["relatedTerms"]), 0)
        self.assertEqual(review["metadata"]["reviewFoodCount"], len(foods))
        self.assertEqual(review["metadata"]["fallbackGroupCount"], len(foods))
        self.assertIsNone(metadata["variantAttributesByFoodId"]["mext_04004"]["variety"])
        self.assertIsNone(metadata["variantAttributesByFoodId"]["mext_17057"]["processing"])


if __name__ == "__main__":
    unittest.main()
