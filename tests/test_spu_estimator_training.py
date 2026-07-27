import csv
import tempfile
import unittest
from pathlib import Path

from scripts.build_spu_estimator_training import build_dataset, product_family


HEADERS = ["カテゴリ", "商品名", "栄養素", "原材料"]


def write_csv(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(rows)


class SpuEstimatorTrainingTests(unittest.TestCase):
    def test_normalizes_fullwidth_labels_range_and_genre(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "morinaga_officialSite_260727.csv", [[
                "菓子 > チョコレート",
                "テストチョコ＜ミルク＞ 60g",
                "[ 1本（60g）当たり ]；エネルギー:200kcal；たんぱく質:3.0g；"
                "脂質:10.0g；炭水化物:25.0g；食塩相当量:0.1g；"
                "カルシウム:20～30mg；ビタミンＢ１:0.10mg",
                "砂糖、カカオマス、ココアバター",
            ]])
            dataset, report = build_dataset(source)

        self.assertEqual(report["acceptedRows"], 1)
        record = dataset["records"][0]
        self.assertEqual(record["genreId"], "chocolate")
        self.assertEqual(record["referenceMassG"], 60)
        self.assertEqual(record["nutrients"]["calciumMg"]["valueKind"], "declared_range")
        self.assertEqual(record["nutrients"]["calciumMg"]["rangeMax"], 30)
        self.assertEqual(record["nutrients"]["vitaminB1Mg"]["value"], 0.1)

    def test_excludes_missing_mass_multi_product_and_no_target(self) -> None:
        rows = [
            ["アイス > カップ", "重量なし", "1個当たり；エネルギー:20kcal；たんぱく質:0g；脂質:0g；炭水化物:5g；食塩相当量:0g；ビタミンC:10mg", "砂糖"],
            ["小さなおかず", "三種セット", "1個当たり(各15g)；エネルギー；18/19/20kcal；たん白質；1/2/3g；脂質；1/2/3g；炭水化物；2/3/4g；食塩相当量；0.1/0.2/0.3g；カルシウム；1/2/3mg", "野菜"],
            ["菓子 > ビスケット", "微量栄養素なし", "100gあたり；エネルギー:400kcal；たんぱく質:5g；脂質:20g；炭水化物:50g；食塩相当量:0.5g", "小麦粉、砂糖"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "morinaga_officialSite_260727.csv", rows)
            dataset, report = build_dataset(source)

        self.assertEqual(dataset["records"], [])
        self.assertEqual(report["exclusions"]["missing_explicit_reference_mass"], 1)
        self.assertEqual(report["exclusions"]["multiple_products_in_one_row"], 1)
        self.assertEqual(report["exclusions"]["no_target_nutrient"], 1)

    def test_estimated_values_are_not_counted_as_independent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "morinaga_officialSite_260727.csv", [[
                "健康・美容 > inゼリー",
                "テストゼリー 180g",
                "1袋（180g）当たり；エネルギー:100kcal；たんぱく質:1g；脂質:0g；"
                "炭水化物:24g；食塩相当量:0.1g；ビタミンC:100mg；（推定値）",
                "果糖ぶどう糖液糖、ビタミンC",
            ]])
            dataset, report = build_dataset(source)

        self.assertEqual(dataset["records"][0]["nutrients"]["vitaminCMg"]["valueKind"], "estimated")
        self.assertNotIn("vitaminCMg", report["independentTargetNutrientCounts"])

    def test_product_family_removes_size_and_flavor(self) -> None:
        self.assertEqual(
            product_family("テストチョコ＜ミルク＞ 60g"),
            product_family("テストチョコ＜ビター＞ 120g"),
        )


if __name__ == "__main__":
    unittest.main()
