import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_mext_xlsx import clean_value, load_saturated_fat_values  # noqa: E402


class MextFattyAcidExtractionTests(unittest.TestCase):
    def test_saturated_fat_source_coverage(self) -> None:
        values = load_saturated_fat_values(
            ROOT / "data/mext/raw/mext_fatty_acids_2023_supplement_table1.xlsx"
        )

        self.assertEqual(len(values), 1967)
        self.assertEqual(sum(bool(value) for _, value in values.values()), 1960)
        self.assertEqual(values["01001"], ("アマランサス　玄穀", "1.18"))
        self.assertEqual(values["12004"], ("鶏卵　全卵　生", "3.12"))
        self.assertEqual(values["12014"], ("鶏卵　卵白　生", ""))

    def test_missing_and_zero_symbols_are_distinguished(self) -> None:
        for value in (None, "", "-", "Tr", "(Tr)"):
            self.assertEqual(clean_value(value), "")
        self.assertEqual(clean_value("0"), "0")
        self.assertEqual(clean_value("(0)"), "0")
        self.assertEqual(clean_value("(1.18)"), "1.18")


if __name__ == "__main__":
    unittest.main()
