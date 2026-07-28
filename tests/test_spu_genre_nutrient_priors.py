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
                },
            })
            manifest_records.append({"recordId": record_id, "split": "train"})
        records.append({
            "recordId": "test-record",
            "genreId": "chocolate",
            "maker": "C",
            "referenceMassG": 100,
            "nutrients": {key: nutrient(10_000) for key in nutrient_keys},
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


if __name__ == "__main__":
    unittest.main()
