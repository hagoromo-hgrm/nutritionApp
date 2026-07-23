import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from convert_food_data import convert_row  # noqa: E402


def row(**overrides):
    result = {
        "id": "mext_test",
        "official_name": "テスト食品",
        "name": "テスト食品",
        "maker": "",
        "barcode": "",
        "base_amount": "100",
        "base_unit": "g",
        "energy_kcal": "100",
    }
    result.update(overrides)
    return result


class ConvertFoodDataTests(unittest.TestCase):
    def test_old_csv_without_input_units_remains_compatible(self) -> None:
        food = convert_row(row(), "test", "2026-07-23T00:00:00Z")
        self.assertIsNone(food["servingAmount"])
        self.assertIsNone(food["servingUnit"])
        self.assertEqual(food["inputUnitConversions"], [])

    def test_reads_explicit_input_unit_defaults(self) -> None:
        food = convert_row(
            row(
                serving_amount="1",
                serving_unit="個",
                input_unit_conversions='[{"unit":"個","baseAmount":50}]',
            ),
            "test",
            "2026-07-23T00:00:00Z",
        )
        self.assertEqual(food["baseAmount"], 100)
        self.assertEqual(food["baseUnit"], "g")
        self.assertEqual(food["servingAmount"], 1)
        self.assertEqual(food["servingUnit"], "個")
        self.assertEqual(food["inputUnitConversions"], [{"unit": "個", "baseAmount": 50}])

    def test_rejects_invalid_input_unit_definitions(self) -> None:
        invalid_rows = (
            row(input_unit_conversions='[{"unit":"個","baseAmount":0}]'),
            row(input_unit_conversions='[{"unit":"個","baseAmount":50},{"unit":"個","baseAmount":60}]'),
            row(input_unit_conversions='[{"unit":"g","baseAmount":1}]'),
            row(serving_amount="1", serving_unit="個", input_unit_conversions="[]"),
            row(serving_amount="1", serving_unit="", input_unit_conversions="[]"),
        )
        for invalid in invalid_rows:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    convert_row(invalid, "test", "2026-07-23T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
