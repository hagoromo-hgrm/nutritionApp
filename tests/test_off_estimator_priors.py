import json
import re
import tempfile
import unittest
from pathlib import Path

from scripts.build_off_estimator_priors import build_priors, load_profile_map


class OffEstimatorPriorTests(unittest.TestCase):
    def test_reviewed_map_references_current_estimator_profiles(self) -> None:
        profile_map = load_profile_map(Path("data/openfoodfacts/ingredient_profile_map.json"))
        source = Path("src/services/nutrientEstimatorProfiles.ts").read_text(encoding="utf-8")
        profile_ids = set(re.findall(r"profile\('([^']+)'", source))
        profile_ids.update(re.findall(r"reviewedFdcProfile\('([^']+)'", source))
        self.assertEqual(set(profile_map.values()) - profile_ids, set())

    def test_filters_products_and_builds_aggregate_only_priors(self) -> None:
        products = [
            {
                "code": "4900000000001",
                "product_name_ja": "チョコ菓子",
                "countries_tags": ["en:japan"],
                "categories_tags": ["en:chocolates"],
                "ingredients": [{"id": "en:sugar"}, {"id": "en:cocoa-butter"}, {"id": "en:palm-oil"}],
                "unknown_ingredients_n": 0,
                "completeness": 0.9,
            },
            {
                "code": "4900000000002",
                "product_name_ja": "食パン",
                "countries_tags": ["en:japan"],
                "categories_tags": ["en:breads"],
                "ingredients": [{"id": "en:wheat-flour"}, {"id": "en:butter"}, {"id": "en:yeast"}],
                "unknown_ingredients_n": 0,
                "completeness": 0.8,
            },
            {
                "code": "0000000000003",
                "product_name": "US cookie",
                "countries_tags": ["en:united-states"],
                "categories_tags": ["en:biscuits"],
                "ingredients_tags": ["en:wheat-flour", "en:sugar"],
                "completeness": 1,
            },
            {
                "code": "4900000000004",
                "product_name_ja": "不完全商品",
                "countries_tags": ["en:japan"],
                "categories_tags": ["en:biscuits"],
                "ingredients_tags": ["en:wheat-flour", "en:sugar"],
                "completeness": 0.2,
            },
            {
                "code": "4900000000005",
                "product_name_ja": "品質エラー商品",
                "countries_tags": ["en:japan"],
                "categories_tags": ["en:biscuits"],
                "ingredients_tags": ["en:wheat-flour", "en:sugar"],
                "data_quality_errors_tags": ["en:ingredients-are-missing-percent-values"],
                "completeness": 1,
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.jsonl"
            path.write_text(
                "".join(json.dumps(product, ensure_ascii=False) + "\n" for product in products),
                encoding="utf-8",
            )
            profile_map = load_profile_map(Path("data/openfoodfacts/ingredient_profile_map.json"))
            result = build_priors(
                path,
                profile_map,
                country_tag="en:japan",
                min_completeness=0.5,
                max_unknown_ingredients=3,
                prior_strength=20,
                top_limit=50,
            )

        self.assertEqual(result["statistics"]["acceptedProducts"], 2)
        self.assertEqual(result["statistics"]["excludedCountry"], 1)
        self.assertEqual(result["statistics"]["excludedCompleteness"], 1)
        self.assertEqual(result["statistics"]["excludedQualityErrors"], 1)
        self.assertEqual(result["genreProductCounts"], {"bread": 1, "chocolate": 1})
        self.assertIn("fdc_cocoa_butter", result["genres"]["chocolate"]["profileMultipliers"])
        self.assertIn("mext_01015", result["genres"]["bread"]["profileCounts"])
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("4900000000001", serialized)
        self.assertNotIn("チョコ菓子", serialized)


if __name__ == "__main__":
    unittest.main()
