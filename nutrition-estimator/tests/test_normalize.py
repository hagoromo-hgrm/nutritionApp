from nutrition_estimator import normalize_ingredients


def test_normalize_preserves_raw_notes_origin_and_allergens() -> None:
    result = normalize_ingredients("原材料名：小麦粉（国内製造）、砂糖、全卵／膨張剤、香料")

    assert result[0].rawName == "小麦粉(国内製造)"
    assert result[0].normalizedName == "小麦粉"
    assert result[0].originNote == "国内製造"
    assert result[0].allergens == ("小麦",)
    assert result[2].normalizedName == "卵"
    assert result[3].isAdditive is True
