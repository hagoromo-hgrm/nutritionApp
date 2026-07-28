import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_general_ingredient_profiles import CatalogError, build_catalog


class GeneralIngredientProfileTests(unittest.TestCase):
    def test_checked_artifact_is_reproducible_and_mext_backed(self) -> None:
        artifact, report = build_catalog(
            Path("data/estimator/general_ingredient_profile_sources.json"),
            Path("data/mext/processed/mext_foods.json"),
        )
        checked = json.loads(
            Path("data/estimator/general_ingredient_profiles.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(artifact, checked)
        self.assertGreaterEqual(report["profileCount"], 170)
        self.assertGreaterEqual(report["aliasCount"], 380)
        self.assertEqual(
            {profile["sourceFoodIds"][0] for profile in artifact["profiles"]},
            {
                entry["sourceFoodId"]
                for entry in json.loads(
                    Path(
                        "data/estimator/general_ingredient_profile_sources.json"
                    ).read_text(encoding="utf-8")
                )["entries"]
            },
        )
        by_id = {profile["profileId"]: profile for profile in artifact["profiles"]}
        soup_q75 = by_id["distributed_instant_addon_soy_q75"]
        self.assertAlmostEqual(soup_q75["nutrients"]["energyKcal"], 309)
        self.assertEqual(
            soup_q75["sourceFoodIds"],
            ["mext_01191", "mext_01144"],
        )
        self.assertEqual(
            soup_q75["requiredGenreIds"],
            ["noodle_flour_dish"],
        )
        self.assertAlmostEqual(
            by_id["proxy_malt_extract_dry"]["nutrients"]["energyKcal"],
            378.35,
        )

    def test_unknown_mext_source_is_rejected(self) -> None:
        source = json.loads(
            Path("data/estimator/general_ingredient_profile_sources.json").read_text(
                encoding="utf-8"
            )
        )
        source["entries"][0]["sourceFoodId"] = "mext_missing"
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "sources.json"
            source_path.write_text(
                json.dumps(source, ensure_ascii=False),
                encoding="utf-8",
            )
            with self.assertRaises(CatalogError):
                build_catalog(
                    source_path,
                    Path("data/mext/processed/mext_foods.json"),
                )


if __name__ == "__main__":
    unittest.main()
