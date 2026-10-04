import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts import audit_nutrient_estimator_training_bias as audit
from scripts import validate_nutrient_estimator_training as validator


UNIT_BY_NUTRIENT = {
    "energyKcal": "kcal",
    "proteinG": "g",
    "fatG": "g",
    "carbohydrateG": "g",
    "fiberG": "g",
    "calciumMg": "mg",
    "ironMg": "mg",
    "vitaminAMcg": "mcg",
    "vitaminEMg": "mg",
    "vitaminB1Mg": "mg",
    "vitaminB2Mg": "mg",
    "vitaminCMg": "mg",
    "saturatedFatG": "g",
    "saltG": "g",
}


def record(record_id, family, *, maker="Maker A", genre="bread", fiber=None):
    labels = {}
    if fiber is None:
        fiber = {
            "displayText": "1.0 g",
            "value": 1.0,
            "rangeMin": None,
            "rangeMax": None,
            "unit": "g",
            "basis": "per_100g",
            "decimalPlaces": 1,
            "valueKind": "fixed",
        }
    labels["fiberG"] = fiber
    return {
        "recordId": record_id,
        "genreId": genre,
        "productName": f"Synthetic product {record_id}",
        "maker": maker,
        "productFamily": family,
        "barcode": None,
        "ingredientsText": "synthetic fixture",
        "ingredientsLanguage": "ja",
        "baseAmount": 100,
        "baseUnit": "g",
        "referenceMassG": 100,
        "referenceMassSource": "fixture",
        "nutrients": labels,
        "sourceType": "manufacturer",
        "sourceReference": "https://example.invalid/fixture",
        "verifiedAt": "2026-10-04T00:00:00Z",
        "notes": None,
    }


def write_inputs(root: Path, records, *, sealed=False):
    training_path = root / "training.json"
    manifest_path = root / "manifest.json"
    payload = {
        "format": "nutrition-estimator-training-data",
        "formatVersion": 1,
        "records": records,
    }
    training_bytes = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
    training_path.write_bytes(training_bytes)
    normalized = [validator.normalize_record(item) for item in records]
    manifest_records = [
        {
            "recordId": item["recordId"],
            "genreId": item["genreId"],
            "groupKey": validator.group_key(item["maker"], item["productFamily"]),
            "split": "train",
        }
        for item in normalized
    ]
    manifest = {
        "format": "nutrition-estimator-training-manifest",
        "formatVersion": 1,
        "sourceFile": training_path.name,
        "sourceFileSha256": hashlib.sha256(training_bytes).hexdigest(),
        "normalizedDatasetSha256": hashlib.sha256(audit.canonical_dataset(normalized)).hexdigest(),
        "recordCount": len(records),
        "records": manifest_records,
    }
    if sealed:
        manifest["seal"] = True
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return training_path, manifest_path, manifest


class NutrientEstimatorTrainingBiasAuditTests(unittest.TestCase):
    def test_audits_train_only_and_emits_hashes_without_product_identifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = [
                record("train-a", "family-a", maker="Maker A"),
                record("train-b", "family-b", maker="Maker B"),
                record("test-c", "family-c", maker="Maker C"),
            ]
            training_path, manifest_path, manifest = write_inputs(root, records)
            manifest_data = json.loads(manifest_path.read_text())
            manifest_data["records"][2]["split"] = "test"
            manifest_path.write_text(json.dumps(manifest_data), encoding="utf-8")
            sealed_path = root / "sealed-collection.json"
            sealed_path.write_text(json.dumps({"familyCount": 0, "familyHashes": []}))

            result = audit.build_audit(training_path, manifest_path, sealed_path)
            fiber = result["genres"]["bread"]["nutrients"]["fiberG"]
            self.assertEqual(result["trainingRecordCount"], 2)
            self.assertEqual(result["taxonomyGenreCount"], 14)
            self.assertEqual(result["genreCount"], 14)
            self.assertEqual(result["observedGenreCount"], 1)
            self.assertEqual(fiber["observedCount"], 2)
            self.assertEqual(fiber["acceptedCount"], 2)
            self.assertEqual(fiber["independentFamilyCount"], 2)
            self.assertEqual(fiber["effectiveFamilySampleSize"], 2)
            self.assertEqual(fiber["maximumMakerShare"], 0.5)
            serialized = json.dumps(result)
            self.assertNotIn("train-a", serialized)
            self.assertNotIn("family-a", serialized)
            self.assertNotIn("Maker A", serialized)
            self.assertNotIn("Synthetic product", serialized)
            self.assertEqual(len(fiber["makerFamilyCountsBySha256"]), 2)
            self.assertTrue(all(
                type(count) is int
                for count in fiber["makerFamilyCountsBySha256"].values()
            ))
            self.assertEqual(result["source"]["normalizedDatasetSha256"], manifest["normalizedDatasetSha256"])
            self.assertEqual(result["genres"]["fried_food"]["trainingRecordCount"], 0)
            self.assertFalse(
                result["genres"]["fried_food"]["pilot50RecordTargetAchieved"]
            )

    def test_rejects_public_sealed_family_overlap_and_source_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, _ = write_inputs(
                root, [record("one", "family", maker="Maker A")]
            )
            family_key = validator.group_key("Maker A", "family")
            family_hash = hashlib.sha256(family_key.encode()).hexdigest()
            sealed_path = root / "sealed-collection.json"
            sealed_path.write_text(json.dumps({
                "familyCount": 1,
                "familyHashes": [family_hash],
            }))
            with self.assertRaisesRegex(audit.AuditError, "overlaps"):
                audit.build_audit(training_path, manifest_path, sealed_path)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, manifest = write_inputs(
                root, [record("one", "family")]
            )
            manifest["sourceFileSha256"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(audit.AuditError, "source file SHA-256"):
                audit._validate_integrity(
                    json.loads(training_path.read_text()),
                    manifest,
                    training_path,
                    manifest_path,
                )

    def test_rejects_manifest_id_mismatch_and_group_split_leak(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, _ = write_inputs(root, [record("one", "same")])
            manifest = json.loads(manifest_path.read_text())
            manifest["records"][0]["recordId"] = "different"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(audit.AuditError):
                audit._validate_integrity(
                    json.loads(training_path.read_text()),
                    manifest,
                    training_path,
                    manifest_path,
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, _ = write_inputs(root, [
                record("one", "same"),
                record("two", "same"),
            ])
            manifest = json.loads(manifest_path.read_text())
            manifest["records"][1]["split"] = "test"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(audit.AuditError, "leaks"):
                audit._validate_integrity(
                    json.loads(training_path.read_text()),
                    manifest,
                    training_path,
                    manifest_path,
                )

    def test_rejects_sealed_manifest_hash_mismatch_and_boolean_numbers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, _ = write_inputs(
                root, [record("one", "family")], sealed=True
            )
            with self.assertRaisesRegex(audit.AuditError, "sealed"):
                audit.build_audit(
                    training_path,
                    manifest_path,
                    audit.DEFAULT_SEALED_COLLECTION,
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, manifest = write_inputs(
                root, [record("one", "family")]
            )
            manifest["normalizedDatasetSha256"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(audit.AuditError, "canonical"):
                audit._validate_integrity(
                    json.loads(training_path.read_text()),
                    manifest,
                    training_path,
                    manifest_path,
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, manifest = write_inputs(
                root, [record("one", "family")]
            )
            training = json.loads(training_path.read_text())
            training["records"][0]["referenceMassG"] = True
            with self.assertRaisesRegex(audit.AuditError, "JSON type"):
                audit._validate_integrity(
                    training,
                    manifest,
                    training_path,
                    manifest_path,
                )

    def test_validator_rejects_boolean_labels_before_canonical_hashing(self):
        bool_fiber = {"displayText": "invalid fixture", "value": True, "rangeMin": None, "rangeMax": None,
            "unit": "g", "basis": "per_100g", "decimalPlaces": 1, "valueKind": "fixed"}
        with self.assertRaises(validator.ValidationError):
            validator.normalize_record(record("bool-label", "family", fiber=bool_fiber))

    def test_counts_missing_estimated_and_invalid_labels_with_family_level_ess(self):
        labels = [
            {
                "valueKind": "fixed", "value": 2.0,
            },
            {
                "valueKind": "declared_range", "value": None,
                "rangeMin": 3.0, "rangeMax": 5.0,
            },
            {"valueKind": "estimated", "value": 4.0},
            {"valueKind": "fixed", "value": -1.0},
            {"valueKind": "fixed", "value": True},
            {"valueKind": "declared_range", "rangeMin": 9.0, "rangeMax": 2.0},
            {"valueKind": "fixed", "value": float("inf")},
        ]
        records = []
        for index, label in enumerate(labels):
            records.append({
                "recordId": f"synthetic-{index}",
                "genreId": "bread",
                "maker": "one maker",
                "productFamily": f"family-{index}",
                "nutrients": {"fiberG": label},
            })
        result = audit.audit_training_records(
            records,
            {record["recordId"]: "train" for record in records},
            set(),
            source_hashes={},
        )
        fiber = result["genres"]["bread"]["nutrients"]["fiberG"]
        self.assertEqual(fiber["observedCount"], 7)
        self.assertEqual(fiber["acceptedCount"], 2)
        self.assertEqual(fiber["estimatedExcludedCount"], 1)
        self.assertEqual(fiber["invalidExcludedCount"], 4)
        self.assertEqual(fiber["invalidExclusionReasons"], {
            "invalid_boolean": 1,
            "invalid_negative": 1,
            "invalid_nonfinite": 1,
            "invalid_range_order": 1,
        })
        self.assertEqual(fiber["effectiveFamilySampleSize"], 2)
        self.assertEqual(fiber["maximumFamilyShare"], 0.5)
        self.assertEqual(fiber["missingCount"], 0)
        self.assertEqual(audit._label_center_and_reason(labels[1]), (4.0, None))


if __name__ == "__main__":
    unittest.main()
