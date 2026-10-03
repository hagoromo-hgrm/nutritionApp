import unittest
from pathlib import Path

from scripts.build_spu_genre_nutrient_priors import (
    PriorBuildError,
    _label_center,
    build_priors,
    validate_output_destination,
    PRIVATE_ESTIMATOR_ROOT,
)


def nutrient(value: float, *, estimated: bool = False) -> dict:
    return {
        "value": value,
        "rangeMin": None,
        "rangeMax": None,
        "valueKind": "estimated" if estimated else "fixed",
    }


class SpuGenreNutrientPriorTests(unittest.TestCase):
    def test_nonredistributable_manifest_blocks_public_output_but_allows_private_output(self) -> None:
        manifest = {
            "publicTrainingOrAggregateRedistributionPermitted": False,
        }
        public_output = Path(__file__).resolve().parents[1] / "docs" / "analysis" / "synthetic-prior.json"
        private_output = PRIVATE_ESTIMATOR_ROOT / "synthetic-prior.json"
        with self.assertRaisesRegex(PriorBuildError, "prohibits public redistribution"):
            validate_output_destination(manifest, public_output)
        validate_output_destination(manifest, private_output)
        validate_output_destination({}, public_output)

    def test_uses_train_only_normalizes_to_100g_and_shrinks_small_genres(self) -> None:
        records = []
        manifest_records = []
        nutrient_keys = (
            "saturatedFatG",
            "fiberG",
            "calciumMg",
            "ironMg",
            "vitaminAMcg",
            "vitaminEMg",
            "vitaminB1Mg",
            "vitaminB2Mg",
            "vitaminCMg",
        )
        for index in range(12):
            record_id = f"train-{index}"
            records.append({
                "recordId": record_id,
                "genreId": "chocolate",
                "maker": "A" if index < 6 else "B",
                "productFamily": f"family-{index}",
                "referenceMassG": 50,
                "nutrients": {
                    key: nutrient(index + 1)
                    for key in nutrient_keys
                } | {"fatG": nutrient((index + 1) * 2)},
            })
            manifest_records.append({"recordId": record_id, "split": "train"})
        records.append({
            "recordId": "test-record",
            "genreId": "chocolate",
            "maker": "C",
            "productFamily": "test-family",
            "referenceMassG": 100,
            "nutrients": {
                **{key: nutrient(10_000) for key in nutrient_keys},
                "fatG": nutrient(10_000),
            },
        })
        manifest_records.append({"recordId": "test-record", "split": "test"})
        training = {
            "format": "nutrition-estimator-training-data",
            "formatVersion": 1,
            "records": records,
        }
        manifest = {
            "format": "nutrition-estimator-training-manifest",
            "normalizedDatasetSha256": "dataset-hash",
            "records": manifest_records,
        }

        artifact = build_priors(
            training,
            manifest,
            manifest_sha256="manifest-hash",
            prior_strength=12,
            minimum_genre_samples=10,
        )

        self.assertEqual(artifact["trainingRecordCount"], 12)
        prior = artifact["genres"]["chocolate"]["nutrients"]["fiberG"]
        self.assertEqual(prior["sampleSize"], 12)
        self.assertEqual(prior["scope"], "genre_nutrient")
        self.assertEqual(prior["genreObservationWeight"], 0.5)
        self.assertEqual(prior["independentFamilyCount"], 12)
        self.assertEqual(prior["effectiveFamilySampleSize"], 12)
        self.assertEqual(prior["maximumFamilyShare"], round(1 / 12, 6))
        self.assertLess(prior["p95"], 10_000)
        self.assertGreaterEqual(prior["median"], 2)
        ratio_prior = artifact["genres"]["chocolate"]["ratios"]["saturatedFatToFat"]
        self.assertEqual(ratio_prior["sampleSize"], 12)
        self.assertEqual(ratio_prior["scope"], "genre_nutrient")
        self.assertEqual(ratio_prior["median"], 0.5)
        self.assertEqual(
            artifact["global"]["ratios"]["saturatedFatToFat"]["sampleSize"],
            12,
        )
        self.assertEqual(
            artifact["source"]["containsProductRecords"],
            False,
        )

    def test_rejects_missing_global_target_nutrients(self) -> None:
        training = {
            "format": "nutrition-estimator-training-data",
            "formatVersion": 1,
            "records": [{
                "recordId": "only",
                "genreId": "chocolate",
                "maker": "A",
                "productFamily": "family-only",
                "referenceMassG": 100,
                "nutrients": {"fiberG": nutrient(1)},
            }],
        }
        manifest = {
            "format": "nutrition-estimator-training-manifest",
            "normalizedDatasetSha256": "dataset-hash",
            "records": [{"recordId": "only", "split": "train"}],
        }
        with self.assertRaises(PriorBuildError):
            build_priors(training, manifest, manifest_sha256="manifest-hash")

    def test_ratio_excludes_zero_denominator_estimated_and_impossible_labels(self) -> None:
        nutrient_keys = (
            "saturatedFatG",
            "fiberG",
            "calciumMg",
            "ironMg",
            "vitaminAMcg",
            "vitaminEMg",
            "vitaminB1Mg",
            "vitaminB2Mg",
            "vitaminCMg",
        )

        def record(record_id: str, saturated: dict, fat: dict, maker: str) -> dict:
            return {
                "recordId": record_id,
                "genreId": "chocolate",
                "maker": maker,
                "productFamily": f"family-{record_id}",
                "referenceMassG": 50,
                "nutrients": {
                    **{key: nutrient(1) for key in nutrient_keys},
                    "saturatedFatG": saturated,
                    "fatG": fat,
                },
            }

        records = [
            *[
                record(
                    f"valid-{index}",
                    nutrient(2),
                    nutrient(4),
                    "A" if index < 5 else "B",
                )
                for index in range(10)
            ],
            record("zero-fat", nutrient(0), nutrient(0), "C"),
            record("estimated", nutrient(2, estimated=True), nutrient(4), "C"),
            record("impossible", nutrient(5), nutrient(4), "C"),
        ]
        manifest_records = [
            {"recordId": item["recordId"], "split": "train"}
            for item in records
        ]
        artifact = build_priors(
            {
                "format": "nutrition-estimator-training-data",
                "formatVersion": 1,
                "records": records,
            },
            {
                "format": "nutrition-estimator-training-manifest",
                "normalizedDatasetSha256": "dataset-hash",
                "records": manifest_records,
            },
            manifest_sha256="manifest-hash",
            prior_strength=10,
            minimum_genre_samples=10,
        )

        ratio = artifact["genres"]["chocolate"]["ratios"]["saturatedFatToFat"]
        self.assertEqual(ratio["sampleSize"], 10)
        self.assertEqual(ratio["makerCount"], 2)
        self.assertEqual(ratio["median"], 0.5)
        self.assertLessEqual(ratio["p95"], 1)

    def test_nutrient_gate_uses_only_makers_with_valid_labels_for_that_nutrient(self) -> None:
        nutrient_keys = (
            "saturatedFatG",
            "fiberG",
            "calciumMg",
            "ironMg",
            "vitaminAMcg",
            "vitaminEMg",
            "vitaminB1Mg",
            "vitaminB2Mg",
            "vitaminCMg",
        )
        records = []
        for index in range(20):
            labels = {key: nutrient(index + 1) for key in nutrient_keys if key != "fiberG"}
            if index < 10:
                labels["fiberG"] = nutrient(index + 1)
            labels["fatG"] = nutrient(20)
            records.append({
                "recordId": f"gate-{index}",
                "genreId": "chocolate",
                "maker": "A" if index < 10 else "B",
                "productFamily": f"family-{index}",
                "referenceMassG": 100,
                "nutrients": labels,
            })
        manifest = {
            "format": "nutrition-estimator-training-manifest",
            "normalizedDatasetSha256": "dataset-hash",
            "records": [
                {"recordId": item["recordId"], "split": "train"}
                for item in records
            ],
        }
        artifact = build_priors(
            {
                "format": "nutrition-estimator-training-data",
                "formatVersion": 1,
                "records": records,
            },
            manifest,
            manifest_sha256="manifest-hash",
            minimum_genre_samples=10,
        )
        nutrients = artifact["genres"]["chocolate"]["nutrients"]
        self.assertEqual(nutrients["fiberG"]["sampleSize"], 10)
        self.assertEqual(nutrients["fiberG"]["makerCount"], 1)
        self.assertEqual(nutrients["fiberG"]["scope"], "pooled_nutrient")
        self.assertEqual(nutrients["calciumMg"]["makerCount"], 2)
        self.assertEqual(nutrients["calciumMg"]["scope"], "genre_nutrient")

    def test_family_weighting_keeps_variant_records_at_one_family_weight(self) -> None:
        nutrient_keys = (
            "saturatedFatG", "fiberG", "calciumMg", "ironMg", "vitaminAMcg",
            "vitaminEMg", "vitaminB1Mg", "vitaminB2Mg", "vitaminCMg",
        )
        records = []
        for family_index in range(6):
            maker = ("A", "B", "C")[family_index % 3]
            for variant in range(2):
                value = family_index + 1
                records.append({
                    "recordId": f"variant-{family_index}-{variant}",
                    "genreId": "chocolate",
                    "maker": maker,
                    "productFamily": f"family-{family_index}",
                    "referenceMassG": 100,
                    "nutrients": {
                        **{key: nutrient(value) for key in nutrient_keys},
                        "fatG": nutrient(value * 2),
                    },
                })
        manifest = {
            "format": "nutrition-estimator-training-manifest",
            "normalizedDatasetSha256": "dataset-hash",
            "records": [
                {"recordId": item["recordId"], "split": "train"}
                for item in records
            ],
        }
        artifact = build_priors(
            {
                "format": "nutrition-estimator-training-data",
                "formatVersion": 1,
                "records": records,
            },
            manifest,
            manifest_sha256="manifest-hash",
            prior_strength=30,
            minimum_genre_samples=6,
        )
        prior = artifact["genres"]["chocolate"]["nutrients"]["fiberG"]
        self.assertEqual(prior["sampleSize"], 12)
        self.assertEqual(prior["independentFamilyCount"], 6)
        self.assertEqual(prior["effectiveFamilySampleSize"], 6)
        self.assertEqual(prior["maximumFamilyShare"], round(1 / 6, 6))
        self.assertEqual(prior["genreObservationWeight"], round(6 / 36, 6))

    def test_declared_range_uses_midpoint_and_invalid_labels_are_rejected(self) -> None:
        self.assertEqual(
            _label_center({
                "valueKind": "declared_range",
                "value": 99,
                "rangeMin": 2,
                "rangeMax": 6,
            }),
            4,
        )
        self.assertIsNone(_label_center(nutrient(-0.1)))
        self.assertIsNone(_label_center({"value": 1}))
        self.assertIsNone(_label_center(nutrient(True)))
        self.assertIsNone(_label_center(nutrient(float("nan"))))
        self.assertIsNone(_label_center({
            "valueKind": "declared_range",
            "rangeMin": 7,
            "rangeMax": 2,
        }))
        self.assertIsNone(_label_center(nutrient(5, estimated=True)))


if __name__ == "__main__":
    unittest.main()
