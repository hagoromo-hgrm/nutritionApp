import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_fdc_ingredient_profiles import (
    build_profile,
    extract_bulk_foods,
    nutrient_amounts,
    validate_allowlist,
)


def nutrient(name: str, unit: str, amount: float) -> dict:
    return {"nutrient": {"name": name, "unitName": unit}, "amount": amount}


class FdcIngredientProfileTests(unittest.TestCase):
    def test_selects_matching_energy_unit_and_converts_sodium_to_salt(self) -> None:
        values = nutrient_amounts({
            "foodNutrients": [
                nutrient("Energy", "kJ", 3700),
                nutrient("Energy", "kcal", 884),
                nutrient("Total lipid (fat)", "g", 100),
                nutrient("Sodium, Na", "mg", 10),
            ],
        })
        self.assertEqual(values["energyKcal"], 884)
        self.assertEqual(values["fatG"], 100)
        self.assertAlmostEqual(values["saltG"], 0.0254)

    def test_builds_reviewed_sr_legacy_profile_with_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "171421.json"
            raw.write_text(json.dumps({
                "fdcId": 171421,
                "description": "Oil, cocoa butter",
                "dataType": "SR Legacy",
                "publicationDate": "4/1/2019",
                "foodNutrients": [
                    nutrient("Energy", "kcal", 884),
                    nutrient("Total lipid (fat)", "g", 100),
                    nutrient("Fatty acids, total saturated", "g", 59.7),
                ],
            }), encoding="utf-8")
            entry = {
                "profileId": "fdc_cocoa_butter",
                "canonicalName": "ココアバター",
                "fdcId": 171421,
                "descriptionIncludes": "Oil, cocoa butter",
                "replaceProfileId": "proxy_cocoa_butter_mext_14030",
                "datasetRelease": "SR Legacy 04/2018",
                "retrievedAt": "2026-07-26T00:00:00Z",
                "reviewedAt": "2026-07-26",
            }

            profile = build_profile(entry, raw, entry["retrievedAt"])

            self.assertEqual(profile["nutrients"]["saturatedFatG"], 59.7)
            self.assertIsNone(profile["nutrients"]["calciumMg"])
            self.assertEqual(profile["source"]["fdcId"], 171421)
            self.assertEqual(profile["source"]["datasetRelease"], "SR Legacy 04/2018")
            self.assertEqual(len(profile["source"]["rawSha256"]), 64)

    def test_rejects_unreviewed_or_duplicate_allowlist_entries(self) -> None:
        valid = {
            "format": "nutrition-estimator-fdc-allowlist",
            "formatVersion": 1,
            "profiles": [{
                "profileId": "fdc_a",
                "canonicalName": "A",
                "fdcId": 1,
                "descriptionIncludes": "A",
                "replaceProfileId": "proxy_a",
                "datasetRelease": "release",
                "retrievedAt": "2026-07-26T00:00:00Z",
                "reviewedAt": "2026-07-26",
            }],
        }
        self.assertEqual(len(validate_allowlist(valid)), 1)
        valid["profiles"].append(dict(valid["profiles"][0]))
        with self.assertRaises(ValueError):
            validate_allowlist(valid)

    def test_extracts_only_reviewed_ids_from_official_bulk_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bulk = Path(directory) / "sr.json"
            bulk.write_text(json.dumps({
                "SRLegacyFoods": [
                    {"fdcId": 10, "description": "A"},
                    {"fdcId": 20, "description": "B"},
                    {"fdcId": 30, "description": "C"},
                ],
            }), encoding="utf-8")

            selected = extract_bulk_foods(bulk, {10, 30})

            self.assertEqual(selected, {
                10: {"fdcId": 10, "description": "A"},
                30: {"fdcId": 30, "description": "C"},
            })


if __name__ == "__main__":
    unittest.main()
