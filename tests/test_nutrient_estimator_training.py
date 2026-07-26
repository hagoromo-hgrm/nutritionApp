import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_nutrient_estimator_training import (
    ValidationError,
    build_manifest,
    load_records,
    normalize_record,
    write_template,
)


def record(record_id: str = "record-1") -> dict:
    return {
        "recordId": record_id,
        "genreId": "baked_sweets",
        "productName": "テストクッキー",
        "maker": "テスト社",
        "productFamily": "テストクッキー",
        "barcode": "04901234567890",
        "ingredientsText": "小麦粉、砂糖、バター",
        "ingredientsLanguage": "ja",
        "baseAmount": 1,
        "baseUnit": "袋",
        "referenceMassG": 50,
        "referenceMassSource": "パッケージ内容量",
        "nutrients": {
            "fiberG": {
                "displayText": "1.2g",
                "value": 1.2,
                "rangeMin": None,
                "rangeMax": None,
                "unit": "g",
                "basis": "1袋",
                "decimalPlaces": 1,
                "valueKind": "fixed",
            }
        },
        "sourceType": "package",
        "sourceReference": "パッケージ写真 record-1",
        "verifiedAt": "2026-07-26T12:00:00+09:00",
        "notes": None,
    }


class NutrientEstimatorTrainingTests(unittest.TestCase):
    def test_validates_and_groups_product_variants_before_split(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "training.json"
            first = record("record-1")
            second = record("record-2")
            second["maker"] = "ＴＥＳＴ社"
            second["productFamily"] = " Cookie "
            first["maker"] = "TEST社"
            first["productFamily"] = "cookie"
            path.write_text(json.dumps({
                "format": "nutrition-estimator-training-data",
                "formatVersion": 1,
                "records": [first, second],
            }, ensure_ascii=False), encoding="utf-8")

            manifest = build_manifest(load_records(path), path)

            self.assertEqual(manifest["recordCount"], 2)
            self.assertEqual(
                manifest["records"][0]["groupKey"],
                manifest["records"][1]["groupKey"],
            )
            self.assertEqual(
                manifest["records"][0]["split"],
                manifest["records"][1]["split"],
            )
            self.assertEqual(len(manifest["sourceFileSha256"]), 64)
            self.assertEqual(len(manifest["normalizedDatasetSha256"]), 64)

    def test_rejects_zero_mass_fractional_display_places_wrong_unit_and_naive_time(self) -> None:
        invalid = record()
        invalid["referenceMassG"] = 0
        with self.assertRaises(ValidationError):
            normalize_record(invalid)

        invalid = record()
        invalid["nutrients"]["fiberG"]["decimalPlaces"] = 1.5
        with self.assertRaises(ValidationError):
            normalize_record(invalid)

        invalid = record()
        invalid["nutrients"]["fiberG"]["unit"] = "mg"
        with self.assertRaises(ValidationError):
            normalize_record(invalid)

        invalid = record()
        invalid["verifiedAt"] = "2026-07-26T12:00:00"
        with self.assertRaises(ValidationError):
            normalize_record(invalid)

    def test_writes_utf8_bom_csv_template(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "template.csv"
            write_template(path)
            content = path.read_bytes()
            self.assertTrue(content.startswith(b"\xef\xbb\xbf"))
            self.assertIn(b"productFamily", content)
            self.assertIn(b"vitaminCMg.valueKind", content)


if __name__ == "__main__":
    unittest.main()
