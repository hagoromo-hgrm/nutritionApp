import csv
import tempfile
import unittest
from pathlib import Path

from scripts.build_spu_estimator_training import (
    build_dataset,
    build_ingredient_coverage_dataset,
    infer_genre,
    product_family,
)


HEADERS = ["カテゴリ", "商品名", "栄養素", "原材料"]


def write_csv(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(rows)


class SpuEstimatorTrainingTests(unittest.TestCase):
    def test_accepts_optional_product_url_and_maker_key_with_underscore(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            path = source / "asahi_milky_officialSite_260728.csv"
            with path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow([*HEADERS, "製品URL"])
                writer.writerow([
                    "乳性・乳酸菌飲料",
                    "テスト飲料",
                    "100g当たり；エネルギー 40kcal；たんぱく質 0.4g；"
                    "脂質 0g；炭水化物 10g；食塩相当量 0.1g；カルシウム 30mg",
                    "乳、砂糖",
                    "https://www.asahiinryo.co.jp/products/example/",
                ])
            dataset, report = build_dataset(source)

        self.assertEqual(report["acceptedRows"], 1)
        self.assertEqual(dataset["records"][0]["maker"], "アサヒ飲料")
        self.assertEqual(
            dataset["records"][0]["sourceReference"],
            "https://www.asahiinryo.co.jp/products/example/",
        )

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

    def test_instant_noodle_brand_overrides_flavor_words(self) -> None:
        self.assertEqual(
            infer_genre(
                "カップヌードル 欧風チーズカレー",
                "カップヌードル",
                "油揚げめん、スープ、かやく",
            ),
            "noodle_flour_dish",
        )

    def test_uses_labeled_values_after_unlabeled_table_header(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "itoham_officialSite_260728.csv", [[
                "お肉 > ソーセージ",
                "テストソーセージ",
                "（1パック(50g)当たり） 熱量 たんぱく質 脂質 炭水化物 食塩相当量 "
                "145 kcal 5.9 g 11.7 g 5.5 g 1.2 g カルシウム 317 mg："
                "熱量 145 kcal；たんぱく質 5.9 g；脂質 11.7 g；"
                "炭水化物 5.5 g；食塩相当量 1.2 g；カルシウム 317 mg",
                "豚肉、でん粉、食塩",
            ]])
            dataset, report = build_dataset(source)

        self.assertEqual(report["acceptedRows"], 1)
        self.assertEqual(dataset["records"][0]["nutrients"]["proteinG"]["value"], 5.9)
        self.assertEqual(dataset["records"][0]["nutrients"]["calciumMg"]["value"], 317)

    def test_normalizes_split_vitamin_b_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "basefood_officialSite_260728.csv", [[
                "BASE BREAD",
                "テストパン",
                "1袋(80g)当たり；熱量；260kcal；たんぱく質；13g；脂質；9g；"
                "炭水化物；35g；食塩相当量；0.3g；ビタミンB；1；0.5mg",
                "小麦全粒粉、小麦たんぱく、パン酵母",
            ]])
            dataset, report = build_dataset(source)

        self.assertEqual(report["acceptedRows"], 1)
        self.assertEqual(dataset["records"][0]["nutrients"]["vitaminB1Mg"]["value"], 0.5)

    def test_coverage_data_sanitizes_nissin_html_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            write_csv(source / "nissin_officialSite_260728.csv", [[
                "即席麺 > 袋麺",
                "テストラーメン",
                "[1食 (32g) 当たり]",
                "油揚げめん（小麦粉、食用油脂）、スープ（食塩、しょうゆ） "
                "class s extends HTMLElement{constructor(){super()}}",
            ]])
            dataset, report = build_ingredient_coverage_dataset(source)

        self.assertEqual(report["acceptedRows"], 1)
        self.assertEqual(report["files"][0]["sanitizedHtmlSuffixRows"], 1)
        self.assertEqual(
            dataset["records"][0]["ingredientsText"],
            "油揚げめん(小麦粉、食用油脂)、スープ(食塩、しょうゆ)",
        )


if __name__ == "__main__":
    unittest.main()
