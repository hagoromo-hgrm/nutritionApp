import json
import math
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from scripts.build_fdc_ingredient_profiles import (
    build_profile,
    extract_bulk_foods,
    main,
    nutrient_amounts,
    nutrients_with_provenance,
    validate_allowlist,
)


NUTRIENT_IDS = {
    "Energy": 1008,
    "Protein": 1003,
    "Total lipid (fat)": 1004,
    "Carbohydrate, by difference": 1005,
    "Fiber, total dietary": 1079,
    "Calcium, Ca": 1087,
    "Iron, Fe": 1089,
    "Vitamin A, RAE": 1106,
    "Vitamin E (alpha-tocopherol)": 1109,
    "Thiamin": 1165,
    "Riboflavin": 1166,
    "Vitamin C, total ascorbic acid": 1162,
    "Fatty acids, total saturated": 1258,
    "Sodium, Na": 1093,
}


def nutrient(name: str, unit: str, amount: float | None, *, nutrient_id: int | None = None,
             data_points: int = 1, derivation_code: str | None = None) -> dict:
    return {
        "nutrient": {"id": nutrient_id if nutrient_id is not None else NUTRIENT_IDS[name], "name": name, "unitName": unit},
        "amount": amount,
        "dataPoints": data_points,
        "foodNutrientDerivation": ({"code": derivation_code} if derivation_code else None),
    }


class FdcIngredientProfileTests(unittest.TestCase):
    def test_matches_ids_and_units_and_converts_sodium_with_provenance(self) -> None:
        values, provenance = nutrients_with_provenance({
            "foodNutrients": [
                nutrient("Energy", "kJ", 3700, nutrient_id=1062),
                nutrient("Energy", "kcal", 884),
                nutrient("Total lipid (fat)", "g", 100),
                nutrient("Sodium, Na", "mg", 10, data_points=0),
            ],
        })
        self.assertEqual(values["energyKcal"], 884)
        self.assertEqual(values["fatG"], 100)
        self.assertAlmostEqual(values["saltG"], 0.0254)
        self.assertEqual(provenance["saltG"]["nutrientId"], 1093)
        self.assertEqual(provenance["saltG"]["amount"], 10)
        self.assertEqual(provenance["saltG"]["dataPoints"], 0)
        self.assertEqual(provenance["saltG"]["conversion"]["formula"], "sodium_mg * 2.54 / 1000")

    def test_preserves_zero_separately_from_unknown_and_keeps_derivation_details(self) -> None:
        values, provenance = nutrients_with_provenance({
            "foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "mg", 0, data_points=0)],
        })
        self.assertEqual(values["vitaminEMg"], 0)
        self.assertEqual(provenance["vitaminEMg"]["amount"], 0)
        self.assertEqual(provenance["vitaminEMg"]["dataPoints"], 0)
        self.assertIsNone(provenance["vitaminEMg"]["derivationCode"])
        self.assertIsNone(values["vitaminAMcg"])
        self.assertNotIn("vitaminAMcg", provenance)

    def test_foundation_energy_alternates_are_used_after_primary_energy(self) -> None:
        values, provenance = nutrients_with_provenance({
            "foodNutrients": [
                nutrient("Energy (Atwater General Factors)", "kcal", 400, nutrient_id=2047),
                nutrient("Energy (Atwater Specific Factors)", "kcal", 395, nutrient_id=2048),
            ],
        })
        self.assertEqual(values["energyKcal"], 395)
        self.assertEqual(provenance["energyKcal"]["nutrientId"], 2048)

    def test_rejects_invalid_amount_units_ids_and_conflicting_duplicates(self) -> None:
        invalid_foods = [
            {"foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "mg", True)]},
            {"foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "mg", math.nan)]},
            {"foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "mg", -0.1)]},
            {"foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "g", 1)]},
            {"foodNutrients": [nutrient("Vitamin E (alpha-tocopherol)", "mg", 1, nutrient_id=1108)]},
            {"foodNutrients": [
                nutrient("Vitamin E (alpha-tocopherol)", "mg", 1),
                nutrient("Vitamin E (alpha-tocopherol)", "mg", 2),
            ]},
        ]
        for food in invalid_foods:
            with self.subTest(food=food), self.assertRaises(ValueError):
                nutrient_amounts(food)

    def test_builds_profile_with_per_nutrient_provenance_and_source_archive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "171327.json"
            raw.write_text(json.dumps({
                "fdcId": 171327,
                "description": "Spices, onion powder",
                "dataType": "SR Legacy",
                "publicationDate": "4/1/2019",
                "foodNutrients": [
                    nutrient("Vitamin E (alpha-tocopherol)", "mg", 0.27, data_points=1, derivation_code="A"),
                    nutrient("Energy", "kcal", 341),
                ],
            }), encoding="utf-8")
            archive = {
                "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
                "sha256": "a" * 64,
                "retrievedAt": "2026-10-03T09:35:29.879971Z",
                "extractedAt": "2026-10-03T09:46:45Z",
            }
            entry = {
                "profileId": "fdc_onion_powder",
                "canonicalName": "たまねぎ粉末",
                "fdcId": 171327,
                "descriptionIncludes": "Spices, onion powder",
                "replaceProfileId": "general_mext_17056",
                "datasetRelease": "SR Legacy 04/2018",
                "retrievedAt": archive["retrievedAt"],
                "reviewedAt": "2026-10-03",
                "sourceArchive": archive,
            }

            profile = build_profile(entry, raw, entry["retrievedAt"])

            self.assertEqual(profile["nutrients"]["vitaminEMg"], 0.27)
            self.assertIsNone(profile["nutrients"]["calciumMg"])
            self.assertEqual(profile["nutrientProvenance"]["vitaminEMg"], {
                "nutrientId": 1109,
                "nutrientName": "Vitamin E (alpha-tocopherol)",
                "unit": "mg",
                "amount": 0.27,
                "derivationCode": "A",
                "dataPoints": 1,
            })
            self.assertNotIn("calciumMg", profile["nutrientProvenance"])
            self.assertEqual(profile["source"]["sourceArchive"], archive)
            self.assertEqual(profile["source"]["publicationDate"], "4/1/2019")

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

    def test_extracts_only_reviewed_ids_and_rejects_duplicate_bulk_ids(self) -> None:
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
            self.assertEqual(selected, {10: {"fdcId": 10, "description": "A"}, 30: {"fdcId": 30, "description": "C"}})
            bulk.write_text(json.dumps({"SRLegacyFoods": [
                {"fdcId": 10}, {"fdcId": 10}, {"fdcId": 30},
            ]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate FDC ID"):
                extract_bulk_foods(bulk, {10, 30})

    def test_bulk_json_does_not_copy_zip_hash_as_if_it_were_json_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            allowlist = root / "allowlist.json"
            bulk = root / "bulk.json"
            output = root / "profiles.json"
            entry = {
                "profileId": "fdc_test",
                "canonicalName": "試験食品",
                "fdcId": 10,
                "descriptionIncludes": "Test food",
                "replaceProfileId": "unresolved:test",
                "datasetRelease": "SR Legacy 04/2018",
                "retrievedAt": "2026-01-01T00:00:00Z",
                "reviewedAt": "2026-01-02",
                "sourceArchive": {
                    "url": "https://example.invalid/source.zip",
                    "sha256": "a" * 64,
                    "retrievedAt": "2026-01-01T00:00:00Z",
                    "extractedAt": "2026-01-01T01:00:00Z",
                },
            }
            allowlist.write_text(json.dumps({
                "format": "nutrition-estimator-fdc-allowlist",
                "formatVersion": 1,
                "profiles": [entry],
            }), encoding="utf-8")
            bulk.write_text(json.dumps({"SRLegacyFoods": [{
                "fdcId": 10,
                "description": "Test food",
                "dataType": "SR Legacy",
                "publicationDate": "4/1/2019",
                "foodNutrients": [],
            }]}), encoding="utf-8")

            with patch.object(sys, "argv", [
                "build_fdc_ingredient_profiles.py",
                "--allowlist", str(allowlist),
                "--raw-dir", str(root / "raw"),
                "--bulk-json", str(bulk),
                "--source-retrieved-at", "2026-10-03T09:35:29.879971Z",
                "--output", str(output),
            ]):
                main()

            generated = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(generated["profiles"][0]["source"]["retrievedAt"], "2026-10-03T09:35:29.879971Z")
            self.assertNotIn("sourceArchive", generated["profiles"][0]["source"])


if __name__ == "__main__":
    unittest.main()
