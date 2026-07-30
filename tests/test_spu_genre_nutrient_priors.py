import unittest

from scripts.build_spu_genre_nutrient_priors import PriorBuildError, build_priors


def nutrient(value: float, *, estimated: bool = False) -> dict:
    return {
        "value": value,
        "rangeMin": None,
        "rangeMax": None,
        "valueKind": "estimated" if estimated else "fixed",
    }


class SpuGenreNutrientPriorTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
