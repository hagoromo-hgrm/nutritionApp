import json
import math
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from import_food_database import FoodDatabaseImportError, convert_database, convert_file  # noqa: E402


NUTRIENT_KEYS = (
    "energyKcal",
    "proteinG",
    "fatG",
    "carbohydrateG",
    "fiberG",
    "calciumMg",
    "ironMg",
    "vitaminAMcg",
    "vitaminEMg",
    "vitaminB1Mg",
    "vitaminB2Mg",
    "vitaminCMg",
    "saturatedFatG",
    "saltG",
)


def nutrients(energy=100):
    result = {key: None for key in NUTRIENT_KEYS}
    result["energyKcal"] = energy
    result["proteinG"] = 2.5
    return result


def food(food_id="user:food-1", **overrides):
    result = {
        "id": food_id,
        "name": "テスト食品",
        "officialName": "テスト食品 正式名",
        "displayName": "テスト食品",
        "reading": None,
        "maker": None,
        "barcode": None,
        "isCommercial": True,
        "source": "user",
        "sourceVersion": None,
        "baseAmount": 100,
        "baseUnit": "g",
        "servingAmount": None,
        "servingUnit": None,
        "inputUnitConversions": [{"unit": "g", "baseAmount": 100}, {"unit": "袋", "baseAmount": 40}],
        "variantAttributes": {"species": None},
        "nutrients": nutrients(),
        "createdAt": None,
        "updatedAt": None,
    }
    result.update(overrides)
    return result


def database(*foods):
    return {
        "format": "nutrition-pwa-food-db",
        "formatVersion": 1,
        "metadata": {
            "sourceName": "テストDB",
            "sourceVersion": "2026-test",
            "license": "ライセンス文言を保持",
            "processedAt": "2026-07-23T12:00:00Z",
        },
        "foods": list(foods),
    }


class ImportFoodDatabaseTests(unittest.TestCase):
    def test_normalises_foods_and_excludes_placeholders(self):
        placeholder = food("user:placeholder", baseAmount=None, baseUnit=None, sourceVersion=None, nutrients={key: None for key in NUTRIENT_KEYS})
        first = food("user:z", barcode="490000000001", name="Z食品")
        second = food("vendor-a", barcode="", name="A食品")

        output = convert_database(database(placeholder, first, second))

        self.assertEqual(output["summary"], {"inputCount": 3, "outputCount": 2, "excludedPlaceholderCount": 1})
        self.assertEqual([item["id"] for item in output["foods"]], ["imported:vendor-a", "imported:z"])
        self.assertEqual(output["metadata"]["license"], "ライセンス文言を保持")
        self.assertEqual(output["metadata"]["conversionScript"], "scripts/import_food_database.py")
        self.assertNotIn("importedAt", output["metadata"])

    def test_normalises_null_strings_source_group_and_fallbacks(self):
        output = convert_database(database(food("user:abc", maker=None, reading=None, barcode=None)))
        item = output["foods"][0]

        self.assertEqual(item["id"], "imported:abc")
        self.assertEqual(item["source"], "imported")
        self.assertEqual(item["foodGroupId"], "food:imported:abc")
        self.assertEqual(item["maker"], "")
        self.assertEqual(item["barcode"], "")
        self.assertIsNone(item["reading"])
        self.assertEqual(item["sourceVersion"], "2026-test")
        self.assertEqual(item["createdAt"], "2026-07-23T12:00:00.000Z")
        self.assertEqual(item["updatedAt"], "2026-07-23T12:00:00.000Z")

    def test_processed_at_is_only_required_for_missing_food_timestamps(self):
        item = food("user:timestamps", sourceVersion="provided", createdAt="2026-01-01T00:00:00Z", updatedAt="2026-01-02T00:00:00Z")
        data = database(item)
        del data["metadata"]["processedAt"]

        output = convert_database(data)
        self.assertEqual(output["foods"][0]["createdAt"], "2026-01-01T00:00:00.000Z")

        missing_timestamp = food("user:missing-timestamp", sourceVersion="provided", createdAt=None)
        data = database(missing_timestamp)
        del data["metadata"]["processedAt"]
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(data)

    def test_packaging_unit_is_other_and_gets_conversion(self):
        item = food(
            "user:pack",
            baseAmount=2,
            baseUnit="包装",
            servingAmount=1,
            servingUnit="包装",
            inputUnitConversions=[{"unit": "その他", "baseAmount": 9}, {"unit": "g", "baseAmount": 80}],
        )
        result = convert_database(database(item))["foods"][0]

        self.assertEqual(result["baseUnit"], "その他")
        self.assertEqual(result["baseAmount"], 2)
        self.assertEqual(result["servingAmount"], 1)
        self.assertEqual(result["servingUnit"], "包装")
        self.assertEqual(result["inputUnitConversions"], [{"unit": "包装", "baseAmount": 2}, {"unit": "g", "baseAmount": 80}])

    def test_removes_conversion_that_matches_base_unit(self):
        result = convert_database(database(food("user:unit", inputUnitConversions=[{"unit": "g", "baseAmount": 100}, {"unit": "袋", "baseAmount": 40}])))["foods"][0]
        self.assertEqual(result["inputUnitConversions"], [{"unit": "袋", "baseAmount": 40}])

    def test_rejects_partial_invalid_nutrients_and_numbers(self):
        partial = nutrients()
        partial["energyKcal"] = None
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:partial", nutrients=partial)))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:negative", nutrients={**nutrients(), "fatG": -1})))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:nan", baseAmount=math.nan)))

    def test_rejects_invalid_top_level_and_unknown_nutrient_key(self):
        invalid = database(food())
        invalid["unexpected"] = True
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(invalid)
        invalid = database(food())
        invalid["foods"][0]["nutrients"]["unknown"] = 1
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(invalid)

    def test_rejects_duplicate_normalised_ids_and_barcodes(self):
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:same"), food("imported:same")))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:a", barcode="490000000001"), food("user:b", barcode="490000000001")))

    def test_rejects_invalid_barcode_serving_and_datetime(self):
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:barcode", barcode="49A000")))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:serving-pair", servingAmount=1, servingUnit=None)))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:serving-conversion", servingAmount=1, servingUnit="箱", inputUnitConversions=[])))
        with self.assertRaises(FoodDatabaseImportError):
            convert_database(database(food("user:datetime", createdAt="2026-02-30T00:00:00Z")))

    def test_file_conversion_is_reproducible_and_does_not_overwrite_input(self):
        data = database(food("user:file"))
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.json"
            output_path = Path(directory) / "nested" / "output.json"
            original = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
            input_path.write_text(original, encoding="utf-8")

            first = convert_file(input_path, output_path)
            first_text = output_path.read_text(encoding="utf-8")
            second = convert_file(input_path, output_path)

            self.assertEqual(first, second)
            self.assertEqual(first_text, output_path.read_text(encoding="utf-8"))
            self.assertEqual(original, input_path.read_text(encoding="utf-8"))
            with self.assertRaises(FoodDatabaseImportError):
                convert_file(input_path, input_path)


if __name__ == "__main__":
    unittest.main()
