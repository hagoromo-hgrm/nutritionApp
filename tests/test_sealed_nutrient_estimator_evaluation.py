import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import seal_nutrient_estimator_evaluation as seal  # noqa: E402
import validate_nutrient_estimator_training as validator  # noqa: E402


def record(index=1, *, maker=None, family=None, kind="fixed", basis="per 100g"):
    nutrients = {}
    for key in validator.NUTRIENT_KEYS:
        target = key in validator.TARGET_NUTRIENTS
        nutrients[key] = {
            "displayText": "3.2g", "value": index + 0.125, "rangeMin": None, "rangeMax": None,
            "unit": validator.EXPECTED_NUTRIENT_UNITS[key], "basis": basis,
            "decimalPlaces": 1, "valueKind": kind if target else "fixed",
        }
    return {
        "recordId": f"record-{index}", "genreId": "bread", "productName": f"Private Product {index}",
        "maker": maker or f"Maker {index}", "productFamily": family or f"Family {index}",
        "barcode": None, "ingredientsText": "小麦粉", "ingredientsLanguage": "ja",
        "baseAmount": 100, "baseUnit": "g", "referenceMassG": 100.0,
        "referenceMassSource": "表示の100g根拠", "nutrients": nutrients,
        "sourceType": "package", "sourceReference": f"https://example.test/product/{index}",
        "verifiedAt": "2026-10-04T10:00:00+09:00", "notes": None,
    }


class SealedEvaluationTests(unittest.TestCase):
    def test_fixed_range_validation_and_preserves_numeric_precision(self):
        item = record()
        item["nutrients"]["fiberG"].update(valueKind="declared_range", value=None, rangeMin=0.125, rangeMax=0.375)
        normalized, _, _ = seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        self.assertEqual(normalized[0]["nutrients"]["energyKcal"]["value"], 1.125)
        self.assertEqual(normalized[0]["nutrients"]["fiberG"]["rangeMin"], 0.125)
        item["nutrients"]["fiberG"]["value"] = 0.5
        with self.assertRaisesRegex(validator.ValidationError, "outside declared range"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})

    def test_nfkc_casefold_group_collisions_are_rejected(self):
        a, b = record(1, maker="ＡＢＣ", family="Family"), record(2, maker="abc", family="ＦＡＭＩＬＹ")
        with self.assertRaisesRegex(validator.ValidationError, "duplicate normalized"):
            seal.normalize_and_validate([a, b], {"familyHashes": [], "blockedMakers": []})

    def test_excluded_family_hash_and_blocked_maker_are_rejected(self):
        item = record()
        digest = hashlib.sha256(validator.group_key(item["maker"], item["productFamily"]).encode()).hexdigest()
        with self.assertRaisesRegex(validator.ValidationError, "overlaps"):
            seal.normalize_and_validate([item], {"familyHashes": [digest], "blockedMakers": []})
        with self.assertRaisesRegex(validator.ValidationError, "blocked"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": ["MAKER 1"]})

    def test_basis_mismatch_boolean_and_estimated_only_rejected(self):
        item = record()
        item["nutrients"] = {key: value for key, value in item["nutrients"].items() if key in seal.MAJOR_NUTRIENTS or key == "fiberG"}
        normalized, _, _ = seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        self.assertEqual(set(normalized[0]["nutrients"]), seal.MAJOR_NUTRIENTS | {"fiberG"})
        item = record()
        item["nutrients"]["fiberG"]["basis"] = "per serving"
        with self.assertRaisesRegex(validator.ValidationError, "bases"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        item = record()
        item["nutrients"]["energyKcal"]["value"] = True
        with self.assertRaisesRegex(validator.ValidationError, "boolean"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        item = record()
        item["referenceMassG"] = True
        with self.assertRaisesRegex(validator.ValidationError, "referenceMassG.*boolean"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        item = record()
        item["baseAmount"] = 99.999
        with self.assertRaisesRegex(validator.ValidationError, "must match for g basis"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})
        item = record(kind="estimated")
        with self.assertRaisesRegex(validator.ValidationError, "non-estimated"):
            seal.normalize_and_validate([item], {"familyHashes": [], "blockedMakers": []})

    def test_duplicate_record_ids_are_rejected(self):
        a, b = record(1), record(2)
        b["recordId"] = a["recordId"]
        with self.assertRaisesRegex(validator.ValidationError, "recordId"):
            seal.normalize_and_validate([a, b], {"familyHashes": [], "blockedMakers": []})
        with self.assertRaisesRegex(validator.ValidationError, "must not be empty"):
            seal.normalize_and_validate([], {"familyHashes": [], "blockedMakers": []})

    def test_inadequate_thresholds_warn_without_fabricating_counts(self):
        normalized, groups, report = seal.normalize_and_validate([record()], {"familyHashes": [], "blockedMakers": []})
        self.assertEqual(len(groups), len(normalized))
        self.assertFalse(report["adequacy"])
        self.assertEqual(report["familyCount"], 1)
        self.assertEqual(report["makerCount"], 1)
        self.assertTrue(report["warnings"])
        self.assertEqual(set(report["nutrientsBelowEvaluationMinimum"]), validator.TARGET_NUTRIENTS)
        self.assertEqual(report["adequacyScope"], "collection_family_and_maker_targets_only")

    def test_manifest_has_all_test_splits_and_public_report_excludes_private_labels(self):
        items = [record(i) for i in range(1, 31)]
        normalized, groups, report = seal.normalize_and_validate(items, {"familyHashes": [], "blockedMakers": []})
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "synthetic.json"
            src.write_text(json.dumps({"records": items}), encoding="utf-8")
            manifest = seal.build_sealed_manifest(normalized, groups, src, "a" * 64, "2026-10-04T00:00:00Z")
            self.assertTrue(manifest["seal"] and manifest["sealed"])
            self.assertEqual(manifest["sealedAt"], "2026-10-04T00:00:00Z")
            self.assertEqual(manifest["exclusionsFileSha256"], "a" * 64)
            self.assertEqual({r["split"] for r in manifest["records"]}, {"test"})
            self.assertTrue(report["adequacy"])
            public = json.dumps(report, ensure_ascii=False)
            for forbidden in ("Private Product", "小麦粉", "https://", "record-1", "1.125"):
                self.assertNotIn(forbidden, public)
            self.assertEqual(len(report["familyHashes"]), 30)

    def test_cli_private_paths_and_public_report_are_immutable_and_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tmpprivate"
            root.mkdir()
            inp, exclusions, manifest = root / "evaluation.json", root / "exclusions.json", root / "manifest.json"
            public = Path(tmp) / "public.json"
            inp.write_text(json.dumps({"format": "nutrition-estimator-training-data", "formatVersion": 1, "records": [record()]}), encoding="utf-8")
            exclusions.write_text(json.dumps({"familyHashes": [], "blockedMakers": []}), encoding="utf-8")
            argv = ["seal", str(inp), "--excluded-family-hashes", str(exclusions), "--output-manifest", str(manifest), "--public-report", str(public)]
            with patch.object(seal, "PRIVATE_ROOT", root), patch.object(sys, "argv", argv):
                self.assertEqual(seal.main(), 0)
            report_text = public.read_text(encoding="utf-8")
            for forbidden in ("Private Product", "小麦粉", "https://", "record-1", "1.125"):
                self.assertNotIn(forbidden, report_text)
            with patch.object(seal, "PRIVATE_ROOT", root), patch.object(sys, "argv", argv):
                self.assertEqual(seal.main(), 2)
            manifest.unlink()
            with patch.object(seal, "PRIVATE_ROOT", root), patch.object(sys, "argv", argv):
                self.assertEqual(seal.main(), 2)  # Existing public report.
            alias_argv = ["seal", str(inp), "--excluded-family-hashes", str(exclusions), "--output-manifest", str(root / "new.json"), "--public-report", str(inp)]
            with patch.object(seal, "PRIVATE_ROOT", root), patch.object(sys, "argv", alias_argv):
                self.assertEqual(seal.main(), 2)  # Report aliases the input.


if __name__ == "__main__":
    unittest.main()
