from nutrition_estimator import normalize_ingredients


def test_normalize_preserves_raw_notes_origin_and_allergens() -> None:
    result = normalize_ingredients("原材料名：小麦粉（国内製造）、砂糖、全卵／膨張剤、香料")

    assert result[0].rawName == "小麦粉(国内製造)"
    assert result[0].normalizedName == "小麦粉"
    assert result[0].originNote == "国内製造"
    assert result[0].allergens == ("小麦",)
    assert result[2].normalizedName == "卵"
    assert result[3].isAdditive is True
    assert result[4].isAdditive is True


def test_slash_starts_additive_section_for_all_following_items() -> None:
    result = normalize_ingredients("小麦粉、はちみつ／増粘剤、香料、酸味料")

    assert [item.normalizedName for item in result] == [
        "小麦粉",
        "はちみつ",
        "増粘剤",
        "香料",
        "酸味料",
    ]
    assert [item.isAdditive for item in result] == [False, False, True, True, True]


def test_slash_inside_parentheses_does_not_start_outer_additive_section() -> None:
    result = normalize_ingredients("チョコレート（砂糖、カカオマス／乳化剤）、小麦粉")

    assert [item.normalizedName for item in result] == ["チョコレート", "小麦粉"]
    assert result[0].isCompound is True
    assert result[1].isAdditive is False
