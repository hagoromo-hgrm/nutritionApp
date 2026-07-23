import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from food_data_rules import food_input_defaults, leading_category  # noqa: E402


def conversion(name: str):
    defaults = food_input_defaults(name, leading_category(name))
    return (
        defaults.serving_amount,
        defaults.serving_unit,
        [(item.unit, item.base_amount) for item in defaults.input_unit_conversions],
    )


class FoodInputDefaultTests(unittest.TestCase):
    def test_separates_raw_rice_and_cooked_rice(self) -> None:
        self.assertEqual(
            conversion("こめ　［水稲穀粒］　精白米　うるち米"),
            (1, "合", [("合", 150)]),
        )
        self.assertEqual(
            conversion("こめ　［水稲穀粒］　精白米　もち米"),
            (1, "合", [("合", 155)]),
        )
        self.assertEqual(
            conversion("こめ　［水稲めし］　精白米　うるち米"),
            (1, "杯", [("杯", 140)]),
        )

    def test_sets_staple_units_only_for_matching_foods(self) -> None:
        self.assertEqual(
            conversion("こむぎ　［うどん・そうめん類］　うどん　ゆで"),
            (1, "玉", [("玉", 200)]),
        )
        self.assertEqual(
            conversion("こむぎ　［うどん・そうめん類］　そうめん・ひやむぎ　乾"),
            (2, "束", [("束", 50)]),
        )
        self.assertEqual(
            conversion("こむぎ　［パン類］　ロールパン"),
            (1, "個", [("個", 30)]),
        )
        self.assertEqual(
            conversion("こむぎ　［その他］　ぎょうざの皮　生"),
            (1, "枚", [("枚", 6)]),
        )
        self.assertEqual(
            conversion("こめ　［うるち米製品］　ライスペーパー"),
            (1, "枚", [("枚", 10)]),
        )
        self.assertEqual(conversion("こむぎ　［パン類］　角形食パン　食パン"), (None, None, []))
        self.assertEqual(conversion("こめ　［うるち米製品］　米粉パン　ロールパン"), (None, None, []))
        self.assertEqual(conversion("こむぎ　［その他］　春巻きの皮　揚げ"), (None, None, []))

    def test_limits_egg_conversion_to_whole_egg(self) -> None:
        self.assertEqual(conversion("鶏卵　全卵　生"), (1, "個", [("個", 50)]))
        self.assertEqual(conversion("鶏卵　全卵　ゆで"), (1, "個", [("個", 50)]))
        self.assertEqual(conversion("うずら卵　全卵　生"), (1, "個", [("個", 10)]))
        for name in (
            "鶏卵　卵黄　生",
            "鶏卵　卵白　生",
            "鶏卵　全卵　乾燥全卵",
            "鶏卵　たまご豆腐",
        ):
            self.assertEqual(conversion(name), (None, None, []))

    def test_does_not_treat_substrings_as_fruit(self) -> None:
        self.assertEqual(
            conversion("＜いも類＞　（さつまいも類）　さつまいも　塊根　皮なし　生"),
            (1, "本", [("本", 250)]),
        )
        self.assertEqual(
            conversion("＜畜肉類＞　うし　［和牛肉］　もも　皮下脂肪なし　生"),
            (None, None, []),
        )
        self.assertEqual(
            conversion("＜魚類＞　（さけ・ます類）　たいせいようさけ　養殖　皮なし　生"),
            (None, None, []),
        )

    def test_applies_fruit_units_only_to_raw_fruit(self) -> None:
        self.assertEqual(conversion("バナナ　生"), (1, "本", [("本", 100)]))
        self.assertEqual(conversion("（もも類）　もも　白肉種　生"), (1, "個", [("個", 200)]))
        self.assertEqual(conversion("（なし類）　日本なし　生"), (1, "個", [("個", 250)]))
        for name in (
            "バナナ　乾",
            "（かんきつ類）　うんしゅうみかん　果実飲料　ストレートジュース",
            "りんご　缶詰",
        ):
            self.assertEqual(conversion(name), (None, None, []))

    def test_distinguishes_raw_vegetable_parts_and_sizes(self) -> None:
        self.assertEqual(conversion("（トマト類）　赤色ミニトマト　果実　生"), (1, "個", [("個", 15)]))
        self.assertEqual(conversion("（にんじん類）　にんじん　根　皮なし　生"), (1, "本", [("本", 150)]))
        self.assertEqual(conversion("（にんじん類）　にんじん　根　皮　生"), (None, None, []))
        self.assertEqual(conversion("（だいこん類）　だいこん　葉　生"), (None, None, []))
        self.assertEqual(conversion("ブロッコリー　花序　生"), (1, "房", [("房", 15)]))
        self.assertEqual(conversion("ブロッコリー　芽ばえ　生"), (None, None, []))

    def test_uses_name_specific_teaspoon_weights(self) -> None:
        self.assertEqual(
            conversion("＜調味料類＞　（しょうゆ類）　こいくちしょうゆ"),
            (1, "小さじ", [("小さじ", 6)]),
        )
        self.assertEqual(conversion("（砂糖類）　車糖　上白糖"), (1, "小さじ", [("小さじ", 3)]))
        self.assertEqual(conversion("（植物油脂類）　オリーブ油"), (1, "小さじ", [("小さじ", 4)]))
        self.assertEqual(conversion("こめ　［うるち米製品］　上新粉"), (1, "小さじ", [("小さじ", 3)]))
        self.assertEqual(
            conversion("＜アルコール飲料類＞　（混成酒類）　みりん　本みりん"),
            (1, "小さじ", [("小さじ", 6)]),
        )
        self.assertEqual(conversion("（その他）　ドレッシング"), (None, None, []))


class GeneratedMextInputDefaultTests(unittest.TestCase):
    def test_generated_foods_keep_100g_basis_and_reviewed_match_count(self) -> None:
        data = json.loads(
            (ROOT / "data/mext/processed/mext_foods.json").read_text(encoding="utf-8")
        )
        foods = data["foods"]
        foods_by_id = {food["id"]: food for food in foods}
        converted = [food for food in foods if food["inputUnitConversions"]]

        self.assertEqual(len(foods), 2538)
        self.assertTrue(all(food["baseAmount"] == 100 and food["baseUnit"] == "g" for food in foods))
        self.assertEqual(len(converted), 208)
        self.assertEqual(
            foods_by_id["mext_01088"]["inputUnitConversions"],
            [{"unit": "杯", "baseAmount": 140}],
        )
        self.assertEqual(
            foods_by_id["mext_12004"]["inputUnitConversions"],
            [{"unit": "個", "baseAmount": 50}],
        )
        for food_id in ("mext_11005", "mext_10438", "mext_07030", "mext_07108", "mext_12014"):
            self.assertEqual(foods_by_id[food_id]["inputUnitConversions"], [])


if __name__ == "__main__":
    unittest.main()
