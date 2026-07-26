from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass

_ORIGIN_WORDS = ("国内製造", "国内産", "国産", "外国製造", "日本製造")
_ADDITIVES = (
    "増粘剤",
    "増粘多糖類",
    "ゲル化剤",
    "安定剤",
    "膨張剤",
    "乳化剤",
    "香料",
    "着色料",
    "酸味料",
    "甘味料",
    "調味料",
    "保存料",
    "酸化防止剤",
    "pH調整剤",
    "発色剤",
    "漂白剤",
    "糊料",
)
_ALIASES = {
    "小麦": "小麦粉",
    "薄力粉": "小麦粉",
    "上白糖": "砂糖",
    "グラニュー糖": "砂糖",
    "鶏卵": "卵",
    "全卵": "卵",
    "食用植物油脂": "植物油脂",
    "ココアパウダー": "ココア",
    "脱脂乳粉": "脱脂粉乳",
}
_ALLERGENS = {
    "小麦粉": ("小麦",),
    "卵": ("卵",),
    "バター": ("乳",),
    "マーガリン": ("乳",),
    "乳製品": ("乳",),
    "脱脂粉乳": ("乳",),
    "全粉乳": ("乳",),
    "チョコレート": ("乳",),
}


@dataclass(frozen=True)
class NormalizedIngredient:
    rawName: str
    normalizedName: str
    parentheticalNotes: tuple[str, ...]
    originNote: str | None
    allergens: tuple[str, ...]
    isAdditive: bool
    isCompound: bool

    def to_dict(self) -> dict[str, object]:
        result = asdict(self)
        result["parentheticalNotes"] = list(self.parentheticalNotes)
        result["allergens"] = list(self.allergens)
        return result


def _split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    buffer: list[str] = []
    depth = 0
    for char in text:
        if char in "（(":
            depth += 1
        elif char in "）)" and depth:
            depth -= 1
        if char in "／/" and depth == 0:
            item = "".join(buffer).strip()
            if item:
                parts.append(item)
            buffer = []
            parts.append("/")
        elif char in "、,，;；\n\r" and depth == 0:
            item = "".join(buffer).strip()
            if item:
                parts.append(item)
            buffer = []
        else:
            buffer.append(char)
    item = "".join(buffer).strip()
    if item:
        parts.append(item)
    return parts


def normalize_ingredients(text: str) -> list[NormalizedIngredient]:
    normalized_text = unicodedata.normalize("NFKC", text).strip()
    if normalized_text.startswith("原材料名"):
        normalized_text = re.sub(r"^原材料名\s*[:：]\s*", "", normalized_text)

    ingredients: list[NormalizedIngredient] = []
    additive_section = False
    for raw in _split_top_level(normalized_text):
        if raw in {"/", "添加物"}:
            additive_section = True
            continue
        notes = tuple(
            note.strip()
            for note in re.findall(r"[（(]([^）)]*)[）)]", raw)
            if note.strip()
        )
        name = re.sub(r"[（(][^）)]*[）)]", "", raw).strip()
        name = re.sub(r"\s+", "", name)
        canonical = _ALIASES.get(name, name)
        origin = next(
            (word for note in notes for word in _ORIGIN_WORDS if word in note),
            None,
        )
        is_additive = additive_section or any(word in canonical for word in _ADDITIVES)
        is_compound = bool(notes) and origin is None and not is_additive
        ingredients.append(
            NormalizedIngredient(
                rawName=raw,
                normalizedName=canonical,
                parentheticalNotes=notes,
                originNote=origin,
                allergens=_ALLERGENS.get(canonical, ()),
                isAdditive=is_additive,
                isCompound=is_compound,
            )
        )
    return ingredients
