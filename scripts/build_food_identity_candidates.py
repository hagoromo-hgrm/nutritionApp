#!/usr/bin/env python3
"""Build food identity and variant candidates from the Luna v6 name analysis.

This stage deliberately does not merge MEXT records.  It only assigns every
extracted name element to identity, variant, metadata, or unresolved so the
next stage can construct group candidates deterministically.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/mext/processed/mext_food_name_analysis_luna_v6.json"
DEFAULT_CANDIDATES = ROOT / "data/mext/processed/mext_food_identity_candidates_v1.json"
DEFAULT_REVIEW = ROOT / "data/mext/processed/mext_food_identity_review_v1.json"
DEFAULT_SUMMARY = ROOT / "data/mext/processed/mext_food_identity_summary_v1.json"

SOURCE_ANALYSIS_FIELDS = (
    "base_food_name",
    "primary_ingredient",
    "variety_or_breed",
    "anatomical_part",
    "maturity_state",
    "cooking_state",
    "processing_state",
    "preservation_state",
    "skin_state",
    "fat_state",
    "bone_state",
    "liquid_state",
    "other_descriptors",
    "filling",
    "filling_ingredient",
    "flavor",
)

SIGNATURE_ORDER = (
    "variety",
    "breed",
    "origin",
    "grade",
    "part",
    "form",
    "processing_state",
    "preservation_state",
    "cooking_state",
    "skin_state",
    "fat_state",
    "bone_state",
    "liquid_state",
    "filling",
    "filling_ingredient",
    "flavor",
    "use",
    "other",
)
SIGNATURE_RANK = {value: index for index, value in enumerate(SIGNATURE_ORDER)}

DEFAULT_FIELD_ROLES = {
    "source_name": "identity_core",
    "base_food_name": "identity_core",
    "primary_ingredient": "identity_core",
    "variety_or_breed": "variant_attribute",
    "anatomical_part": "variant_attribute",
    "maturity_state": "variant_attribute",
    "cooking_state": "variant_attribute",
    "processing_state": "variant_attribute",
    "preservation_state": "variant_attribute",
    "skin_state": "variant_attribute",
    "fat_state": "variant_attribute",
    "bone_state": "variant_attribute",
    "liquid_state": "variant_attribute",
    "other_descriptors": "metadata",
    "filling": "variant_attribute",
    "filling_ingredient": "variant_attribute",
    "flavor": "variant_attribute",
}

ANIMAL_NORMALIZATION = {
    "うし": "牛",
    "ぶた": "豚",
    "にわとり": "鶏",
    "めんよう": "羊",
    "やぎ": "山羊",
    "うま": "馬",
    "いのしし": "猪",
    "いのぶた": "いのぶた",
    "しか": "鹿",
    "にほんじか": "鹿",
    "うさぎ": "兎",
    "あひる": "あひる",
    "うずら": "うずら",
    "かも": "かも",
    "きじ": "きじ",
    "しちめんちょう": "七面鳥",
    "ほろほろちょう": "ほろほろ鳥",
    "はと": "鳩",
    "すずめ": "すずめ",
    "くじら": "くじら",
    "かえる": "かえる",
    "すっぽん": "すっぽん",
}

MEAT_CHAPTERS = {"11"}
BIRD_MEAT_CHAPTERS = {"11"}
FISH_CHAPTERS = {"10"}
CONFECTIONERY_CHAPTERS = {"15"}
BEVERAGE_CHAPTERS = {"16"}
SEASONING_CHAPTERS = {"17"}
DISH_CHAPTERS = {"18"}

GENERIC_BASE_WORDS = {
    "食品",
    "その他",
    "加工品",
    "調味加工品",
    "料理",
    "和風料理",
    "洋風料理",
    "中国料理",
    "韓国料理",
    "肉",
}

GENERIC_STATE_VALUES = {
    "生",
    "ゆで",
    "茹で",
    "焼き",
    "蒸し",
    "油いため",
    "炒め",
    "ソテー",
    "揚げ",
    "フライ",
    "素揚げ",
    "電子レンジ調理",
    "水戻し",
    "水煮",
    "調理後全体",
    "調理後のめん",
    "乾",
    "冷凍",
    "冷蔵",
    "皮つき",
    "皮なし",
    "脂身つき",
    "脂身なし",
    "赤肉",
    "赤身",
    "脂身",
    "骨付き",
    "骨なし",
    "液汁",
    "浸出液",
}

INDEPENDENT_COOKED_FOODS = {
    "つくだ煮",
    "天ぷら",
    "から揚げ",
    "唐揚げ",
    "蒲焼き",
    "かば焼",
    "油揚げ",
    "田作り",
    "くさや",
    "うるか",
    "釜揚げしらす",
    "塩いわし",
    "ローストビーフ",
    "ビーフジャーキー",
    "スモークタン",
    "ピータン",
}

PRODUCT_SUFFIXES = (
    "ミックス",
    "プレミックス粉",
    "小麦粉",
    "薄力粉",
    "中力粉",
    "強力粉",
    "全粒粉",
    "粉",
    "アルファ化米",
    "でん粉",
    "パウダー",
    "フラワー",
    "ミール",
    "グリッツ",
    "パン",
    "マフィン",
    "ベーグル",
    "クロワッサン",
    "ナン",
    "めん",
    "麺",
    "そば",
    "うどん",
    "そうめん",
    "ひやむぎ",
    "パスタ",
    "スパゲッティ",
    "マカロニ",
    "ビーフン",
    "ライスペーパー",
    "もち",
    "餅",
    "かゆ",
    "おもゆ",
    "おにぎり",
    "きりたんぽ",
    "豆腐",
    "納豆",
    "豆乳",
    "油揚げ",
    "がんもどき",
    "ゆば",
    "湯葉",
    "生揚げ",
    "あん",
    "こんにゃく",
    "しらたき",
    "ジャム",
    "マーマレード",
    "ジュース",
    "飲料",
    "ネクター",
    "ピューレ",
    "ペースト",
    "缶詰",
    "漬物",
    "梅漬",
    "梅干し",
    "塩漬",
    "みそ",
    "味噌",
    "しょうゆ",
    "醤油",
    "酢",
    "ソース",
    "ドレッシング",
    "マヨネーズ",
    "だし",
    "スープ",
    "チーズ",
    "ヨーグルト",
    "クリーム",
    "バター",
    "マーガリン",
    "アイスクリーム",
    "アイスミルク",
    "菓子",
    "ゼリー",
    "キャンデー",
    "チョコレート",
    "せんべい",
    "あられ",
    "まんじゅう",
    "まん",
    "ようかん",
    "ケーキ",
    "ドーナッツ",
    "ペストリー",
    "ビスケット",
    "クッキー",
    "クラッカー",
    "ワイン",
    "ビール",
    "清酒",
    "焼酎",
    "ウイスキー",
    "ブランデー",
    "リキュール",
    "コーヒー",
    "ココア",
    "茶",
    "料理",
    "和え",
    "煮物",
    "汁",
    "鍋",
    "カレー",
    "シチュー",
    "グラタン",
    "コロッケ",
    "ハンバーグ",
    "ぎょうざ",
    "しゅうまい",
    "春巻き",
    "ピザ",
)

GRADE_RE = re.compile(r"^(?:[0-9０-９]+等|特級|上級|標準|規格値|一級|二級)$")
ORIGIN_RE = re.compile(r"(?:国産|輸入|外国産|国内産|産$|天然|養殖)")
HEADING_RE = re.compile(r"^[＜\[].*[＞\]]$|^[＜［].*[＞］]$")
PAREN_CATEGORY_RE = re.compile(r"^[（(].*(?:類|料理|製品|飲料|食品)[）)]$")
NOTE_RE = re.compile(r"^[（(].*[）)]$")
STATE_SUFFIX_RE = re.compile(
    r"(?:生|ゆで|焼き|蒸し|炒め|いため|揚げ|乾|冷凍|水煮|塩漬|塩蔵|缶詰|味付け)$"
)

PREMIX_DISPLAY_NAMES = {
    "天ぷら用": "天ぷら粉",
    "お好み焼き用": "お好み焼き粉",
    "ホットケーキ用": "ホットケーキミックス",
    "から揚げ用": "から揚げ粉",
}

MEAT_BREED_HEADINGS = {
    "和牛肉": ("breed", "和牛"),
    "乳用肥育牛肉": ("breed", "乳用肥育牛"),
    "輸入牛肉": ("origin", "輸入"),
    "交雑牛肉": ("breed", "交雑牛"),
    "子牛肉": ("variety", "子牛"),
    "大型種肉": ("breed", "大型種"),
    "中型種肉": ("breed", "中型種"),
    "肉用種": ("breed", "肉用種"),
    "若どり": ("variety", "若どり"),
    "若鶏肉": ("variety", "若どり"),
    "成鶏肉": ("variety", "成鶏"),
    "マトン": ("variety", "マトン"),
    "ラム": ("variety", "ラム"),
    "親・主品目": ("variety", "親鶏"),
    "親・副品目": ("variety", "親鶏"),
    "若どり・主品目": ("variety", "若どり"),
    "若どり・副品目": ("variety", "若どり"),
}

RICE_FORM_HEADINGS = {
    "水稲穀粒": ("水稲", "穀粒"),
    "水稲めし": ("水稲", "ごはん"),
    "水稲全かゆ": ("水稲", "全かゆ"),
    "水稲五分かゆ": ("水稲", "五分かゆ"),
    "水稲おもゆ": ("水稲", "おもゆ"),
    "水稲軟めし": ("水稲", "軟めし"),
    "陸稲穀粒": ("陸稲", "穀粒"),
    "陸稲めし": ("陸稲", "ごはん"),
}

GENERIC_PROCESSED_IDENTITIES = {
    "ジャム",
    "果実飲料",
    "果汁",
    "果汁入り飲料",
    "水煮缶詰",
    "味付け缶詰",
    "缶詰",
    "塩辛",
    "漬物",
    "塩漬",
    "ピューレ",
    "ペースト",
    "ジュース",
    "ストレートジュース",
    "濃縮還元ジュース",
    "ネクター",
    "つくだ煮",
}

SIGNIFICANT_NOTE_ATTRIBUTES = {
    "（添付調味料等を含むもの）": ("form", "添付調味料等を含む", "hidden"),
    "（添付調味料等を含まないもの）": ("form", "添付調味料等を含まない", "hidden"),
    "（スープを残したもの）": ("form", "スープを残す", "advanced"),
    "（生を揚げたもの）": ("form", "生から揚げたもの", "advanced"),
    "（市販冷凍食品を揚げたもの）": ("form", "市販冷凍食品を揚げたもの", "advanced"),
    "（あめ色たまねぎ）": ("form", "あめ色たまねぎ", "optional"),
    "（和菓子）": ("form", "和菓子", "advanced"),
    "（洋菓子）": ("form", "洋菓子", "advanced"),
    "（凝固剤：塩化マグネシウム）": ("form", "凝固剤：塩化マグネシウム", "advanced"),
    "（凝固剤：硫酸カルシウム）": ("form", "凝固剤：硫酸カルシウム", "advanced"),
}

METADATA_CATEGORY_WORDS = {
    "和風料理",
    "洋風料理",
    "中国料理",
    "韓国料理",
    "和え物類",
    "汁物類",
    "酢の物類",
    "煮物類",
    "焼き物類",
    "炒め物類",
    "揚げ物類",
    "蒸し物類",
    "めん類",
    "ご飯物類",
    "フライ用冷凍食品",
}

RAW_INGREDIENT_FORMS = {
    "玄穀",
    "玄米",
    "精白粒",
    "全粒",
    "種実",
    "葉",
    "根",
    "果実",
    "茎",
    "茎葉",
    "球根",
    "塊根",
    "塊茎",
    "未熟種子",
}


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("　", " ")).strip()


def source_tokens(source_name: str) -> list[str]:
    return [token.strip() for token in re.split(r"　+|\s{2,}", source_name) if token.strip()]


def normalized_value(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    return item.get("normalized") or item.get("raw")


def heading_inner(raw: str) -> str:
    value = raw.strip()
    for opening, closing in (("＜", "＞"), ("［", "］"), ("[", "]"), ("（", "）"), ("(", ")")):
        if value.startswith(opening) and value.endswith(closing):
            return value[len(opening) : -len(closing)].strip()
    return value


def strip_heading(raw: str) -> str:
    stripped = raw.strip()
    value = heading_inner(stripped)
    if value != stripped:
        value = re.sub(r"(?:類|肉)$", "", value)
    return value


def chapter_of(source_id: str) -> str:
    match = re.match(r"mext_(\d{2})", source_id)
    return match.group(1) if match else ""


def is_heading(raw: str, interpretation: str | None = None) -> bool:
    if interpretation == "日本食品標準成分表の分類見出し":
        return True
    return bool(HEADING_RE.match(raw) or PAREN_CATEGORY_RE.match(raw))


def is_note(raw: str) -> bool:
    return bool(NOTE_RE.match(raw)) and not PAREN_CATEGORY_RE.match(raw)


def looks_like_product(raw: str) -> bool:
    value = strip_heading(raw)
    if not value or value in GENERIC_BASE_WORDS or value in GENERIC_STATE_VALUES:
        return False
    if value in INDEPENDENT_COOKED_FOODS:
        return True
    return value.endswith(PRODUCT_SUFFIXES)


def is_processed_form(value: str) -> bool:
    return looks_like_product(value) or any(
        marker in value
        for marker in (
            "粉",
            "干し",
            "乾燥",
            "塩蔵",
            "燻製",
            "発酵",
            "果実飲料",
            "濃縮",
            "精白",
            "圧搾",
        )
    )


def normalize_animal(value: str) -> str:
    return ANIMAL_NORMALIZATION.get(value, value)


def occurrence_key(source_field: str, raw: str) -> tuple[str, str]:
    return source_field, raw


def iter_occurrences(record: dict[str, Any]) -> Iterable[tuple[str, str]]:
    for raw in record["base_food_name"].get("raw_segments", []):
        yield "base_food_name", raw
    raw = record["primary_ingredient"].get("raw")
    if raw:
        yield "primary_ingredient", raw
    for field_name in (
        "variety_or_breed",
        "anatomical_part",
        "maturity_state",
        "cooking_state",
        "processing_state",
        "preservation_state",
    ):
        for item in record[field_name]:
            if item.get("raw"):
                yield field_name, item["raw"]
    for field_name in (
        "skin_state",
        "fat_state",
        "bone_state",
        "liquid_state",
        "filling",
        "filling_ingredient",
        "flavor",
    ):
        raw = record[field_name].get("raw")
        if raw:
            yield field_name, raw
    for item in record["other_descriptors"]:
        if item.get("raw"):
            yield "other_descriptors", item["raw"]


@dataclass
class RecordBuilder:
    source: dict[str, Any]
    roles: dict[tuple[str, str], set[str]] = field(default_factory=lambda: defaultdict(set))
    identity_evidence: list[tuple[str, str]] = field(default_factory=list)
    attributes: list[dict[str, Any]] = field(default_factory=list)
    metadata: list[dict[str, Any]] = field(default_factory=list)
    unresolved: list[dict[str, Any]] = field(default_factory=list)
    corrections: list[dict[str, Any]] = field(default_factory=list)
    review_reasons: list[str] = field(default_factory=list)
    generated_display_name: bool = False

    def mark_role(
        self,
        source_field: str,
        raw: str,
        role: str,
        *,
        dimension: str | None = None,
        reason: str,
    ) -> None:
        key = occurrence_key(source_field, raw)
        self.roles[key].add(role)
        default_role = DEFAULT_FIELD_ROLES[source_field]
        if role != default_role:
            correction = {
                "raw": raw,
                "original_field": source_field,
                "new_role": role,
                "new_dimension": dimension,
                "reason": reason,
            }
            if correction not in self.corrections:
                self.corrections.append(correction)

    def add_identity(self, source_field: str, raw: str, reason: str) -> None:
        pair = (source_field, raw)
        if pair not in self.identity_evidence:
            self.identity_evidence.append(pair)
        self.mark_role(source_field, raw, "identity_core", reason=reason)

    def add_attribute(
        self,
        dimension: str,
        value: str,
        raw: str,
        source_field: str,
        ui_visibility: str,
        reason: str,
        *,
        signature_dimension: str | None = None,
        presence: str | None = None,
    ) -> None:
        value = normalize_space(value)
        if not value:
            self.add_unresolved(raw, source_field, "属性値が空")
            return
        signature_dimension = signature_dimension or dimension
        existing = next(
            (
                item
                for item in self.attributes
                if item["_signature_dimension"] == signature_dimension
                and item["value"] == value
            ),
            None,
        )
        if existing is None:
            item = {
                "dimension": dimension,
                "value": value,
                "raw": raw,
                "source_field": source_field,
                "ui_visibility": ui_visibility,
                "_signature_dimension": signature_dimension,
            }
            if presence:
                item["presence"] = presence
            self.attributes.append(item)
        elif existing["raw"] != raw:
            self.add_metadata(
                raw,
                "source_context",
                source_field,
                value,
                "同義の属性表記を統合",
                mark_role=False,
            )
        self.mark_role(
            source_field,
            raw,
            "variant_attribute",
            dimension=signature_dimension,
            reason=reason,
        )

    def add_metadata(
        self,
        raw: str,
        metadata_type: str,
        source_field: str,
        semantic_value: str | None,
        reason: str,
        *,
        mark_role: bool = True,
    ) -> None:
        item = {
            "raw": raw,
            "type": metadata_type,
            "source_field": source_field,
            "semantic_value": semantic_value,
        }
        if item not in self.metadata:
            self.metadata.append(item)
        if mark_role:
            self.mark_role(source_field, raw, "metadata", reason=reason)

    def add_unresolved(self, raw: str, source_field: str, reason: str) -> None:
        item = {"raw": raw, "source_field": source_field, "reason": reason}
        if item not in self.unresolved:
            self.unresolved.append(item)
        self.mark_role(source_field, raw, "unresolved", reason=reason)
        self.add_review_reason(reason)

    def add_review_reason(self, reason: str) -> None:
        if reason not in self.review_reasons:
            self.review_reasons.append(reason)


def classify_heading_semantics(builder: RecordBuilder, raw: str, source_field: str) -> bool:
    semantic = heading_inner(raw)
    if semantic in MEAT_BREED_HEADINGS:
        dimension, value = MEAT_BREED_HEADINGS[semantic]
        visibility = "optional" if dimension != "origin" else "advanced"
        builder.add_metadata(
            raw,
            "classification_heading",
            source_field,
            value,
            "分類見出しの文脈を保持",
            mark_role=False,
        )
        builder.add_attribute(
            dimension,
            value,
            raw,
            source_field,
            visibility,
            "分類見出しに選択可能な意味がある",
        )
        if "主品目" in semantic or "副品目" in semantic:
            item_kind = "主品目" if "主品目" in semantic else "副品目"
            builder.add_attribute(
                "other",
                item_kind,
                raw,
                source_field,
                "hidden",
                "成分表内の品目区分を保持",
            )
        return True
    return False


def select_identity(builder: RecordBuilder) -> tuple[str, str | None, list[dict[str, Any]]]:
    record = builder.source
    chapter = chapter_of(record["source_id"])
    tokens = source_tokens(record["source_name"])
    primary_raw = record["primary_ingredient"].get("raw")
    primary = normalized_value(record["primary_ingredient"])
    raw_base_segments = record["base_food_name"].get("raw_segments", [])
    base_segments = [
        raw
        for raw in raw_base_segments
        if not is_heading(raw)
    ]
    other_products = [
        item["raw"]
        for item in record["other_descriptors"]
        if item.get("interpretation") == "食品名・製品種別"
    ]
    process_products = [
        item["raw"]
        for item in record["processing_state"]
        if looks_like_product(item["raw"])
        and item["raw"] not in {"塩漬", "粉"}
    ]
    variety_products = [
        item["raw"]
        for item in record["variety_or_breed"]
        if looks_like_product(item["raw"])
    ]

    for raw in raw_base_segments:
        if is_heading(raw):
            builder.add_metadata(
                raw,
                "classification_heading",
                "base_food_name",
                strip_heading(raw) or None,
                "表構造の分類見出し",
            )

    rice_heading_raw = next(
        (
            item["raw"]
            for item in record["other_descriptors"]
            if heading_inner(item["raw"]) in RICE_FORM_HEADINGS
        ),
        None,
    )
    if rice_heading_raw:
        cultivation, prepared_form = RICE_FORM_HEADINGS[heading_inner(rice_heading_raw)]
        rice_kind = next(
            (
                token
                for token in tokens
                if token
                in {
                    "玄米",
                    "半つき米",
                    "七分つき米",
                    "精白米",
                    "はいが精米",
                    "発芽玄米",
                    "赤米",
                    "黒米",
                }
            ),
            "米",
        )
        suffix = "" if prepared_form == "穀粒" else prepared_form
        canonical = f"{cultivation}{rice_kind}{suffix}"
        builder.generated_display_name = True
        builder.add_metadata(
            rice_heading_raw,
            "classification_heading",
            "other_descriptors",
            heading_inner(rice_heading_raw),
            "分類見出しの文脈を保持",
            mark_role=False,
        )
        builder.add_identity(
            "other_descriptors",
            rice_heading_raw,
            "水稲・陸稲と調理形態は食品本体を識別する",
        )
        rice_kind_field = find_source_field(record, rice_kind)
        if any(raw == rice_kind for _, raw in iter_occurrences(record)):
            builder.add_identity(rice_kind_field, rice_kind, "米の精製形態は食品本体")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "米は食品本体の上位概念",
            )
        rice_variety = next(
            (token for token in tokens if token in {"うるち米", "もち米", "インディカ米"}),
            None,
        )
        if rice_variety:
            rice_variety_field = find_source_field(record, rice_variety)
            builder.add_attribute(
                "variety",
                rice_variety,
                rice_variety,
                rice_variety_field,
                "optional",
                "source_nameに明記された米の種類",
            )
        return canonical, "米", [
            {
                "dimension": "cultivation_system",
                "value": cultivation,
                "raw_evidence": [rice_heading_raw],
                "source_fields": ["other_descriptors"],
            },
            {
                "dimension": "rice_type",
                "value": rice_kind,
                "raw_evidence": [rice_kind],
                "source_fields": [rice_kind_field if rice_kind != "米" else "source_name"],
            },
            {
                "dimension": "prepared_form",
                "value": prepared_form,
                "raw_evidence": [rice_heading_raw],
                "source_fields": ["other_descriptors"],
            },
        ]

    # Explicit application-facing names for premixes are allowed by the task.
    premix_use = next((token for token in tokens if token in PREMIX_DISPLAY_NAMES), None)
    if premix_use and "プレミックス粉" in tokens:
        canonical = PREMIX_DISPLAY_NAMES[premix_use]
        builder.generated_display_name = True
        for raw in record["base_food_name"].get("raw_segments", []):
            if raw in {"プレミックス粉", premix_use}:
                builder.add_identity("base_food_name", raw, "用途で一般名称が変わるプレミックス粉")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "加工後の一般名称を食品本体に優先",
            )
        key_parts = [
            {
                "dimension": "food_type",
                "value": canonical,
                "raw_evidence": ["プレミックス粉", premix_use],
                "source_fields": ["base_food_name"],
            }
        ]
        return canonical, "小麦粉", key_parts

    state_prefixes = ("半生", "生", "乾", "ゆで", "焼き", "蒸し", "冷凍", "冷蔵")
    state_prefixed_pair = next(
        (
            (base, item["raw"])
            for base in base_segments
            for item in record["processing_state"]
            if item["raw"].endswith(base)
            and item["raw"] != base
            and item["raw"][: -len(base)].startswith(state_prefixes)
        ),
        None,
    )
    if state_prefixed_pair:
        base, state_name = state_prefixed_pair
        builder.add_identity("base_food_name", base, "状態語を除いた食品名を食品本体に使用")
        independent_during_state = next(
            (
                item["raw"]
                for item in record["cooking_state"]
                if item["raw"] in INDEPENDENT_COOKED_FOODS
            ),
            None,
        )
        canonical = base
        key_parts = [
            {
                "dimension": "food_type",
                "value": base,
                "raw_evidence": [base],
                "source_fields": ["base_food_name"],
            }
        ]
        if independent_during_state:
            canonical = f"{base}{independent_during_state}"
            builder.generated_display_name = True
            builder.add_identity(
                "cooking_state",
                independent_during_state,
                "一般名称として独立する調理品",
            )
            key_parts.append(
                {
                    "dimension": "prepared_food",
                    "value": independent_during_state,
                    "raw_evidence": [independent_during_state],
                    "source_fields": ["cooking_state"],
                }
            )
        if primary_raw and primary_raw != base:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "加工食品の原材料文脈",
            )
        return canonical, primary if primary and primary != base else None, key_parts

    # Previously confirmed family boundary: azuki paste is one food identity.
    if "あずき" in base_segments and "あん" in base_segments:
        canonical = "小豆あん"
        builder.generated_display_name = True
        builder.add_identity("base_food_name", "あずき", "原料と加工食品名を組み合わせた一般名称")
        builder.add_identity("base_food_name", "あん", "原料と加工食品名を組み合わせた一般名称")
        return canonical, "あん", [
            {
                "dimension": "food_type",
                "value": canonical,
                "raw_evidence": ["あずき", "あん"],
                "source_fields": ["base_food_name"],
            }
        ]

    if "板こんにゃく" in base_segments:
        builder.add_identity("base_food_name", "板こんにゃく", "こんにゃくの製品形態を食品本体に使用")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "こんにゃくは上位概念",
            )
        return "板こんにゃく", "こんにゃく", [
            {
                "dimension": "food_type",
                "value": "板こんにゃく",
                "raw_evidence": ["板こんにゃく"],
                "source_fields": ["base_food_name"],
            }
        ]

    oil_fried_field = next(
        (
            field_name
            for field_name in ("base_food_name", "cooking_state", "processing_state")
            if any(
                raw == "油揚げ"
                for current_field, raw in iter_occurrences(record)
                if current_field == field_name
            )
        ),
        None,
    )
    if chapter == "04" and oil_fried_field:
        builder.add_identity(oil_fried_field, "油揚げ", "油揚げは独立した大豆加工食品")
        if primary_raw and primary_raw != "油揚げ":
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "油揚げの原材料文脈",
            )
        return "油揚げ", "大豆加工品", [
            {
                "dimension": "food_type",
                "value": "油揚げ",
                "raw_evidence": ["油揚げ"],
                "source_fields": [oil_fried_field],
            }
        ]

    soybean_product = next(
        (
            value
            for value in ("絹生揚げ", "生揚げ")
            if value in record["source_name"]
        ),
        None,
    )
    if chapter == "04" and soybean_product:
        source_field = find_source_field(record, soybean_product)
        builder.add_identity(source_field, soybean_product, "独立した大豆加工食品名")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "大豆加工品の原材料文脈",
            )
        return soybean_product, "大豆加工品", [
            {
                "dimension": "food_type",
                "value": soybean_product,
                "raw_evidence": [soybean_product],
                "source_fields": [source_field],
            }
        ]

    if chapter == "04" and "きな粉" in record["source_name"]:
        sugar_kinako = next(
            (
                item["raw"]
                for item in record["other_descriptors"]
                if item["raw"] == "きな粉（砂糖入り）"
            ),
            None,
        )
        canonical = sugar_kinako or "きな粉"
        source_field = find_source_field(record, canonical)
        builder.add_identity(source_field, canonical, "きな粉は独立した大豆加工食品")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "きな粉の原材料文脈",
            )
        return canonical, "大豆加工品", [
            {
                "dimension": "food_type",
                "value": canonical,
                "raw_evidence": [canonical],
                "source_fields": [source_field],
            }
        ]

    if chapter == "04" and "湯葉" in record["source_name"]:
        source_field = find_source_field(record, "湯葉")
        builder.add_identity(source_field, "湯葉", "湯葉は独立した大豆加工食品")
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "湯葉の原材料文脈",
            )
        return "湯葉", "大豆加工品", [
            {
                "dimension": "food_type",
                "value": "湯葉",
                "raw_evidence": ["湯葉"],
                "source_fields": [source_field],
            }
        ]

    unsalted_butter = next(
        (item["raw"] for item in record["other_descriptors"] if item["raw"] == "食塩不使用バター"),
        None,
    )
    if unsalted_butter:
        builder.add_identity(
            "other_descriptors", unsalted_butter, "食塩不使用バターは独立した製品名"
        )
        return unsalted_butter, "バター", [
            {
                "dimension": "food_type",
                "value": unsalted_butter,
                "raw_evidence": [unsalted_butter],
                "source_fields": ["other_descriptors"],
            }
        ]

    # Pickles and canned fish keep the source category as identity evidence.
    if len(raw_base_segments) >= 2 and raw_base_segments[-1] in {"漬物", "缶詰"}:
        category_raw = raw_base_segments[-2]
        category = strip_heading(category_raw)
        if category:
            canonical = f"{category}{raw_base_segments[-1]}"
            builder.generated_display_name = True
            builder.add_identity("base_food_name", category_raw, "分類語に食品種の意味がある")
            builder.add_identity("base_food_name", raw_base_segments[-1], "独立した加工食品名")
            return canonical, category, [
                {
                    "dimension": "ingredient",
                    "value": category,
                    "raw_evidence": [category_raw],
                    "source_fields": ["base_food_name"],
                },
                {
                    "dimension": "food_type",
                    "value": raw_base_segments[-1],
                    "raw_evidence": [raw_base_segments[-1]],
                    "source_fields": ["base_food_name"],
                }
            ]

    animal_raw = next(
        (
            candidate
            for candidate in [primary_raw, *base_segments, *tokens]
            if candidate in ANIMAL_NORMALIZATION
        ),
        None,
    )
    parts = [item["raw"] for item in record["anatomical_part"]]
    product_candidates = [*other_products, *process_products, *variety_products]
    product_candidates.extend(
        raw
        for raw in base_segments
        if looks_like_product(raw) and raw != primary_raw
    )

    # Wheat and rye wholemeal products need the grain and flour type to remain
    # in identity; otherwise unrelated records collapse to a generic 全粒粉.
    if any(item["raw"] == "全粒粉" for item in record["processing_state"]):
        grain = {"こむぎ": "小麦", "ライむぎ": "ライ麦"}.get(primary_raw or "", primary or "")
        flour_type = next(
            (
                item["raw"].removesuffix("粉")
                for item in record["processing_state"]
                if item["raw"] in {"薄力粉", "中力粉", "強力粉"}
            ),
            "",
        )
        canonical = f"{grain}{flour_type}全粒粉"
        builder.generated_display_name = True
        if primary_raw:
            builder.add_identity("primary_ingredient", primary_raw, "穀物種は全粒粉の食品本体要素")
        builder.add_identity("processing_state", "全粒粉", "全粒粉は独立した加工食品名")
        if flour_type:
            builder.add_identity(
                "processing_state", f"{flour_type}粉", "粉の種類は食品本体を識別する"
            )
        return canonical, "粉", [
            {
                "dimension": "ingredient",
                "value": grain,
                "raw_evidence": [primary_raw] if primary_raw else [],
                "source_fields": ["primary_ingredient"] if primary_raw else [],
            },
            {
                "dimension": "food_type",
                "value": f"{flour_type}全粒粉",
                "raw_evidence": [f"{flour_type}粉", "全粒粉"] if flour_type else ["全粒粉"],
                "source_fields": ["processing_state"],
            },
        ]

    # Rice-flour bread and explicitly shaped bread are distinct products.
    bread_candidates = [raw for raw in base_segments if "パン" in raw]
    if chapter == "01" and bread_candidates:
        specific_bread = max(bread_candidates, key=lambda raw: (len(raw), -base_segments.index(raw)))
        if "米粉パン" in bread_candidates and bread_candidates[-1] != "米粉パン":
            specific_bread = f"米粉{bread_candidates[-1]}"
            builder.generated_display_name = True
            for raw in {"米粉パン", bread_candidates[-1]}:
                builder.add_identity("base_food_name", raw, "米粉とパン種別を食品本体に保持")
            evidence = ["米粉パン", bread_candidates[-1]]
        else:
            source_raw = specific_bread
            builder.add_identity("base_food_name", source_raw, "具体的なパン種別を食品本体に使用")
            evidence = [source_raw]
        if primary_raw:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "パンの原材料文脈",
            )
        return specific_bread, "パン", [
            {
                "dimension": "food_type",
                "value": specific_bread,
                "raw_evidence": evidence,
                "source_fields": ["base_food_name"],
            }
        ]

    # In confectionery names, text after a filling marker is not the food body.
    if chapter in CONFECTIONERY_CHAPTERS:
        before_filling = tokens
        filling_raw = record["filling"].get("raw")
        if filling_raw and filling_raw in tokens:
            before_filling = tokens[: tokens.index(filling_raw)]
        def valid_confection(raw: str) -> bool:
            return (
                looks_like_product(raw)
                and not is_heading(raw)
                and not NOTE_RE.match(raw)
                and raw not in GENERIC_BASE_WORDS
                and raw not in {"カスタードクリーム", "こしあん", "つぶしあん"}
            )

        candidate_tiers = (
            [raw for raw in other_products if valid_confection(raw)],
            [raw for raw in variety_products if valid_confection(raw)],
            [raw for raw in base_segments if valid_confection(raw)],
            [raw for raw in before_filling if valid_confection(raw)],
        )
        confection_candidates = next((tier for tier in candidate_tiers if tier), [])
        if confection_candidates:
            specific_confection = max(confection_candidates, key=len)
            source_field = find_source_field(record, specific_confection)
            builder.add_identity(source_field, specific_confection, "最も具体的な菓子名を食品本体に使用")
            parent_candidate = next(
                (
                    raw
                    for raw in base_segments
                    if raw != specific_confection and looks_like_product(raw)
                ),
                None,
            )
            return specific_confection, parent_candidate or "菓子", [
                {
                    "dimension": "food_type",
                    "value": specific_confection,
                    "raw_evidence": [specific_confection],
                    "source_fields": [source_field],
                }
            ]

    # Named processed meat products are selected as foods, not meat states.
    meat_product = next(
        (
            raw
            for raw in reversed([*base_segments, *product_candidates, *tokens])
            if not is_heading(raw)
            and (
                raw in INDEPENDENT_COOKED_FOODS
                or any(
                marker in raw
                for marker in (
                    "ハム",
                    "ベーコン",
                    "ソーセージ",
                    "コンビーフ",
                    "ジャーキー",
                    "ローストビーフ",
                    "スモークタン",
                    "さらしくじら",
                )
                )
            )
        ),
        None,
    )
    if chapter in MEAT_CHAPTERS and meat_product:
        source_field = find_source_field(record, meat_product)
        builder.add_identity(source_field, meat_product, "一般名称を持つ畜肉加工品")
        if meat_product in INDEPENDENT_COOKED_FOODS and animal_raw:
            animal = normalize_animal(animal_raw)
            canonical = f"{animal}{meat_product}"
            builder.generated_display_name = True
            animal_field = find_source_field(record, animal_raw)
            builder.add_identity(animal_field, animal_raw, "調理品の動物種を食品本体に保持")
            return canonical, f"{animal}肉", [
                {
                    "dimension": "animal",
                    "value": animal,
                    "raw_evidence": [animal_raw],
                    "source_fields": [animal_field],
                },
                {
                    "dimension": "food_type",
                    "value": meat_product,
                    "raw_evidence": [meat_product],
                    "source_fields": [source_field],
                },
            ]
        if primary_raw and primary_raw != meat_product:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                normalize_animal(primary or primary_raw),
                "加工品の動物種を原料文脈として保持",
            )
        return meat_product, normalize_animal(animal_raw) if animal_raw else None, [
            {
                "dimension": "food_type",
                "value": meat_product,
                "raw_evidence": [meat_product],
                "source_fields": [source_field],
            }
        ]

    # Meat and poultry parts are identity core by product design.
    if chapter in MEAT_CHAPTERS and animal_raw and parts:
        animal = normalize_animal(animal_raw)
        part = parts[0]
        suffix = (
            ""
            if part in {"肝臓", "心臓", "腎臓", "舌", "砂じょう"}
            or "なんこつ" in part
            or "軟骨" in part
            else "肉"
        )
        canonical = f"{animal}{part}{suffix}"
        builder.generated_display_name = True
        animal_field = find_source_field(record, animal_raw)
        builder.add_identity(animal_field, animal_raw, "肉類の動物種は食品本体")
        builder.add_identity("anatomical_part", part, "肉類の主要部位は食品本体")
        key_parts = [
            {
                "dimension": "animal",
                "value": animal,
                "raw_evidence": [animal_raw],
                "source_fields": [animal_field],
            },
            {
                "dimension": "part",
                "value": part,
                "raw_evidence": [part],
                "source_fields": ["anatomical_part"],
            },
        ]
        return canonical, f"{animal}肉", key_parts

    if chapter in MEAT_CHAPTERS and animal_raw and "肉" in tokens:
        animal = normalize_animal(animal_raw)
        canonical = f"{animal}肉"
        builder.generated_display_name = True
        animal_field = find_source_field(record, animal_raw)
        builder.add_identity(animal_field, animal_raw, "動物種と肉を食品本体に使用")
        if "肉" in base_segments:
            builder.add_identity("base_food_name", "肉", "肉は食品本体を構成する")
        return canonical, "肉", [
            {
                "dimension": "animal",
                "value": animal,
                "raw_evidence": [animal_raw],
                "source_fields": [animal_field],
            },
            {
                "dimension": "food_type",
                "value": "肉",
                "raw_evidence": ["肉"],
                "source_fields": ["base_food_name" if "肉" in base_segments else "source_name"],
            },
        ]

    # Fish offal and major cuts are also searched as distinct foods.
    if chapter in FISH_CHAPTERS and parts:
        fish = primary or (base_segments[-1] if base_segments else None)
        if fish:
            part = parts[0]
            independent_fish_product = next(
                (
                    item["raw"]
                    for field_name in ("cooking_state", "processing_state")
                    for item in record[field_name]
                    if item["raw"] in INDEPENDENT_COOKED_FOODS
                ),
                None,
            )
            canonical = f"{fish}{part}{independent_fish_product or ''}"
            fish_field = "primary_ingredient" if primary_raw else "base_food_name"
            fish_raw = primary_raw or base_segments[-1]
            builder.add_identity(fish_field, fish_raw, "魚種は食品本体")
            builder.add_identity("anatomical_part", part, "魚介の主要部位は食品本体")
            if independent_fish_product:
                builder.add_identity(
                    find_source_field(record, independent_fish_product),
                    independent_fish_product,
                    "一般名称として独立する魚介調理品",
                )
            builder.generated_display_name = True
            key_parts = [
                {
                    "dimension": "species",
                    "value": fish,
                    "raw_evidence": [fish_raw],
                    "source_fields": [fish_field],
                },
                {
                    "dimension": "part",
                    "value": part,
                    "raw_evidence": [part],
                    "source_fields": ["anatomical_part"],
                },
            ]
            if independent_fish_product:
                key_parts.append(
                    {
                        "dimension": "food_type",
                        "value": independent_fish_product,
                        "raw_evidence": [independent_fish_product],
                        "source_fields": [find_source_field(record, independent_fish_product)],
                    }
                )
            return canonical, fish, key_parts

    independent_state = next(
        (
            item["raw"]
            for field_name in ("cooking_state", "processing_state")
            for item in record[field_name]
            if item["raw"] in INDEPENDENT_COOKED_FOODS and item["raw"] != "油揚げ"
        ),
        None,
    )
    identity_ingredient = primary or (base_segments[-1] if base_segments else None)
    if independent_state and identity_ingredient and independent_state not in identity_ingredient:
        ingredient = strip_heading(identity_ingredient)
        canonical = f"{ingredient}{independent_state}"
        builder.generated_display_name = True
        ingredient_raw = primary_raw or base_segments[-1]
        ingredient_field = "primary_ingredient" if primary_raw else "base_food_name"
        state_field = find_source_field(record, independent_state)
        builder.add_identity(ingredient_field, ingredient_raw, "調理品の対象食品を食品本体に保持")
        builder.add_identity(state_field, independent_state, "一般名称として独立する調理品")
        return canonical, ingredient, [
            {
                "dimension": "ingredient",
                "value": ingredient,
                "raw_evidence": [ingredient_raw],
                "source_fields": [ingredient_field],
            },
            {
                "dimension": "food_type",
                "value": independent_state,
                "raw_evidence": [independent_state],
                "source_fields": [state_field],
            },
        ]

    if chapter in DISH_CHAPTERS:
        dish_token = next(
            (
                token
                for token in reversed(tokens)
                if token not in METADATA_CATEGORY_WORDS
                and not is_heading(token)
                and token not in GENERIC_STATE_VALUES
            ),
            None,
        )
        if dish_token:
            source_field = find_source_field(record, dish_token)
            builder.add_identity(source_field, dish_token, "料理名を食品本体に使用")
            return dish_token, "料理", [
                {
                    "dimension": "dish_name",
                    "value": dish_token,
                    "raw_evidence": [dish_token],
                    "source_fields": [source_field],
                }
            ]

    # A generic 茶 product token is only a form/context; 玉露・抹茶などが本体。
    if chapter in BEVERAGE_CHAPTERS and "茶" in other_products and base_segments:
        tea_name = base_segments[-1]
        builder.add_identity("base_food_name", tea_name, "具体的な茶名を食品本体に使用")
        builder.add_metadata(
            "茶",
            "source_context",
            "other_descriptors",
            "茶",
            "一般的な製品種別",
        )
        if primary_raw and primary_raw != tea_name:
            builder.add_metadata(
                primary_raw,
                "source_context",
                "primary_ingredient",
                primary,
                "茶の原料文脈",
            )
        return tea_name, "茶", [
            {
                "dimension": "food_type",
                "value": tea_name,
                "raw_evidence": [tea_name],
                "source_fields": ["base_food_name"],
            }
        ]

    # Prefer explicit product names over their raw ingredients.
    if "即席" in record["source_name"] and "めん" in record["source_name"]:
        instant_candidates = [*variety_products, *[raw for raw in base_segments if looks_like_product(raw)]]
        specific = max(instant_candidates, key=len, default=None)
    elif other_products:
        specific = other_products[0] if other_products[-1].endswith("状") else other_products[-1]
    elif process_products:
        specific = max(process_products, key=len)
    elif variety_products:
        specific = max(variety_products, key=len)
    else:
        base_products = [raw for raw in base_segments if looks_like_product(raw)]
        specific = max(base_products, key=len, default=None)
    if specific is None and len(base_segments) > 1:
        specific = base_segments[-1]
    if specific is None and base_segments:
        specific = base_segments[-1]
    if specific is None and primary_raw:
        specific = primary_raw
    if specific is None:
        specific = next(
            (
                token
                for token in reversed(tokens)
                if token not in GENERIC_STATE_VALUES and not is_heading(token)
            ),
            "",
        )

    generic_processed = bool(
        specific
        and (
            specific in GENERIC_PROCESSED_IDENTITIES
            or re.fullmatch(r"\d+%果汁入り飲料", specific)
        )
    )
    generic_ingredient_raw = primary_raw or (base_segments[0] if base_segments else None)
    generic_ingredient = primary or generic_ingredient_raw
    if generic_processed and generic_ingredient and strip_heading(generic_ingredient) != strip_heading(specific):
        ingredient = strip_heading(generic_ingredient)
        canonical = f"{ingredient}{specific}"
        builder.generated_display_name = True
        specific_field = find_source_field(record, specific)
        ingredient_field = "primary_ingredient" if primary_raw else "base_food_name"
        builder.add_identity(ingredient_field, generic_ingredient_raw, "加工品の原材料種を食品本体に保持")
        builder.add_identity(specific_field, specific, "一般名称を持つ加工食品")
    elif not specific or specific in GENERIC_BASE_WORDS:
        builder.add_review_reason("食品本体候補を一意に決定できない")
        canonical = specific or "未確定食品"
    else:
        canonical = strip_heading(specific)
        specific_field = find_source_field(record, specific)
        builder.add_identity(specific_field, specific, "source_name内の最も具体的な食品名")

    # Parent/base elements remain source context when a processed name wins.
    for raw in base_segments:
        if raw != specific and occurrence_key("base_food_name", raw) not in builder.roles:
            builder.add_metadata(
                raw,
                "source_context",
                "base_food_name",
                normalize_animal(raw),
                "より具体的な食品名の上位概念",
            )
    if primary_raw and primary_raw != specific and occurrence_key("primary_ingredient", primary_raw) not in builder.roles:
        builder.add_metadata(
            primary_raw,
            "source_context",
            "primary_ingredient",
            normalize_animal(primary or primary_raw),
            "加工後の食品名を食品本体に優先",
        )

    parent: str | None = None
    if primary and normalize_space(primary) != normalize_space(canonical):
        parent = normalize_animal(primary)
    elif len(base_segments) > 1 and base_segments[0] != specific:
        parent = strip_heading(base_segments[0]) or None
    elif chapter in CONFECTIONERY_CHAPTERS:
        parent = "菓子"
    elif chapter in BEVERAGE_CHAPTERS:
        parent = "飲料"
    elif chapter in SEASONING_CHAPTERS:
        parent = "調味料"

    if generic_processed and generic_ingredient:
        key_parts = [
            {
                "dimension": "ingredient",
                "value": strip_heading(generic_ingredient),
                "raw_evidence": [generic_ingredient_raw],
                "source_fields": ["primary_ingredient" if primary_raw else "base_food_name"],
            },
            {
                "dimension": "food_type",
                "value": specific,
                "raw_evidence": [specific],
                "source_fields": [find_source_field(record, specific)],
            },
        ]
    else:
        key_parts = [
            {
                "dimension": "food_type",
                "value": canonical,
                "raw_evidence": [specific] if specific else [],
                "source_fields": [find_source_field(record, specific)] if specific else [],
            }
        ]
    return canonical, parent, key_parts


def find_source_field(record: dict[str, Any], raw: str) -> str:
    if raw in record["base_food_name"].get("raw_segments", []):
        return "base_food_name"
    if record["primary_ingredient"].get("raw") == raw:
        return "primary_ingredient"
    for field_name in (
        "variety_or_breed",
        "anatomical_part",
        "maturity_state",
        "cooking_state",
        "processing_state",
        "preservation_state",
    ):
        if any(item.get("raw") == raw for item in record[field_name]):
            return field_name
    for field_name in (
        "skin_state",
        "fat_state",
        "bone_state",
        "liquid_state",
        "filling",
        "filling_ingredient",
        "flavor",
    ):
        if record[field_name].get("raw") == raw:
            return field_name
    if any(item.get("raw") == raw for item in record["other_descriptors"]):
        return "other_descriptors"
    return "base_food_name"


def classify_food_form(record: dict[str, Any], canonical: str) -> str:
    chapter = chapter_of(record["source_id"])
    if chapter in CONFECTIONERY_CHAPTERS:
        return "confectionery"
    if chapter in BEVERAGE_CHAPTERS:
        return "beverage"
    if chapter in SEASONING_CHAPTERS:
        return "seasoning"
    if chapter in DISH_CHAPTERS:
        return "dish"
    if any(word in canonical for word in ("料理", "和え", "汁", "鍋", "カレー", "シチュー", "グラタン")):
        return "dish"
    if any(word in canonical for word in ("粉", "でん粉", "油", "ペースト", "ピューレ", "あん")):
        return "processed_ingredient"
    if looks_like_product(canonical) or is_processed_form(canonical):
        return "processed_food"
    return "raw_ingredient"


def classify_variants_and_metadata(builder: RecordBuilder) -> None:
    record = builder.source
    chapter = chapter_of(record["source_id"])
    other_product_values = [
        item["raw"]
        for item in record["other_descriptors"]
        if item.get("interpretation") == "食品名・製品種別"
    ]

    for item in record["other_descriptors"]:
        raw = item["raw"]
        interpretation = item.get("interpretation")
        key = occurrence_key("other_descriptors", raw)
        if key in builder.roles:
            continue
        if raw in SIGNIFICANT_NOTE_ATTRIBUTES:
            dimension, value, visibility = SIGNIFICANT_NOTE_ATTRIBUTES[raw]
            builder.add_metadata(
                raw,
                "table_note",
                "other_descriptors",
                value,
                "注記の文脈も保持",
                mark_role=False,
            )
            builder.add_attribute(
                dimension,
                value,
                raw,
                "other_descriptors",
                visibility,
                "レコードを区別する注記",
            )
        elif is_heading(raw, interpretation):
            if classify_heading_semantics(builder, raw, "other_descriptors"):
                continue
            builder.add_metadata(
                raw,
                "classification_heading",
                "other_descriptors",
                strip_heading(raw) or None,
                "表構造の分類見出し",
            )
        elif raw in METADATA_CATEGORY_WORDS:
            builder.add_metadata(
                raw,
                "classification_heading",
                "other_descriptors",
                raw.rstrip("類") or None,
                "料理分類の見出し",
            )
        elif interpretation == "産地・由来または天然・養殖条件":
            builder.add_attribute(
                "origin",
                raw.replace("国産品", "国産"),
                raw,
                "other_descriptors",
                "optional" if raw in {"天然", "養殖", "国産", "輸入"} else "advanced",
                "産地・由来は属性",
            )
        elif interpretation in {"規格・品質・用途条件", "規格・品質・調味条件"}:
            if "味" in raw or "風味" in raw:
                builder.add_attribute(
                    "flavor",
                    raw,
                    raw,
                    "other_descriptors",
                    "primary",
                    "味付けは属性",
                )
            elif GRADE_RE.match(raw):
                builder.add_attribute(
                    "grade", raw, raw, "other_descriptors", "advanced", "等級は属性"
                )
            elif "用" in raw or "使用" in raw or "無添加" in raw or "無塩" in raw:
                builder.add_attribute(
                    "use", raw, raw, "other_descriptors", "advanced", "用途・品質条件は属性"
                )
            else:
                builder.add_attribute(
                    "other", raw, raw, "other_descriptors", "advanced", "規格条件は詳細属性"
                )
        elif interpretation == "品種・製品タイプ・地域区分":
            builder.add_attribute(
                "variety", raw, raw, "other_descriptors", "optional", "品種・製品タイプは属性"
            )
        elif interpretation == "原材料・配合材料":
            builder.add_attribute(
                "form",
                raw.removesuffix("ドレッシング"),
                raw,
                "other_descriptors",
                "optional",
                "名称に明記された配合材料は属性",
            )
        elif interpretation == "食品名に明記された状態・構成情報":
            builder.add_attribute(
                "form",
                raw,
                raw,
                "other_descriptors",
                "optional",
                "食品の構成状態は属性",
            )
        elif interpretation == "栽培方法":
            builder.add_attribute(
                "other",
                raw,
                raw,
                "other_descriptors",
                "optional",
                "栽培方法は必要な食品だけで表示",
            )
        elif interpretation == "ドレッシングの状態・分類見出し":
            builder.add_metadata(
                raw,
                "classification_heading",
                "other_descriptors",
                raw,
                "ドレッシング分類の文脈を保持",
                mark_role=False,
            )
            builder.add_attribute(
                "form",
                raw,
                raw,
                "other_descriptors",
                "optional",
                "ドレッシングの状態は属性",
            )
        elif interpretation == "風味・味付け":
            builder.add_attribute(
                "flavor", raw, raw, "other_descriptors", "primary", "風味は属性"
            )
        elif interpretation == "食品名・製品種別":
            selected_raws = {evidence for _, evidence in builder.identity_evidence}
            if raw in {"全粒大豆", "脱皮大豆"} and "きな粉" in record["source_name"]:
                builder.add_attribute(
                    "form",
                    raw,
                    raw,
                    "other_descriptors",
                    "optional",
                    "きな粉の原料形態は属性",
                )
            elif raw == "湯戻し" and "湯葉" in record["source_name"]:
                builder.add_attribute(
                    "cooking_state",
                    raw,
                    raw,
                    "other_descriptors",
                    "primary",
                    "湯葉の戻し状態は調理属性",
                )
            elif raw == "くずでん粉製品" and "くずもち" in record["source_name"]:
                builder.add_metadata(
                    raw,
                    "source_context",
                    "other_descriptors",
                    raw,
                    "くずもちの原料・製品分類文脈",
                )
            elif raw in {"精粉こんにゃく", "生いもこんにゃく"}:
                builder.add_attribute(
                    "form",
                    raw,
                    raw,
                    "other_descriptors",
                    "optional",
                    "こんにゃくの原料・製法形態は属性",
                )
            elif raw.endswith("状") and len(other_product_values) > 1:
                builder.add_attribute(
                    "form",
                    raw,
                    raw,
                    "other_descriptors",
                    "optional",
                    "製品の形状は属性",
                )
            elif len(other_product_values) > 1 and raw == other_product_values[0]:
                builder.add_metadata(
                    raw,
                    "source_context",
                    "other_descriptors",
                    raw,
                    "後続する具体的な製品名の上位概念",
                )
            elif any(raw in selected or selected in raw for selected in selected_raws):
                builder.add_metadata(
                    raw,
                    "source_context",
                    "other_descriptors",
                    raw,
                    "選択した食品名の上位概念",
                )
            else:
                builder.add_unresolved(raw, "other_descriptors", "複数の食品本体候補がある")
        elif is_note(raw):
            builder.add_metadata(
                raw,
                "table_note",
                "other_descriptors",
                None,
                "成分表上の注記",
            )
        elif interpretation is None:
            if raw in {
                "分離液状",
                "乳化液状",
                "分離液状ドレッシング",
                "乳化液状ドレッシング",
                "半固体状ドレッシング",
            }:
                builder.add_attribute(
                    "form",
                    raw.removesuffix("ドレッシング"),
                    raw,
                    "other_descriptors",
                    "optional",
                    "製品状態は属性",
                )
            elif raw == "バッター":
                builder.add_attribute(
                    "form", raw, raw, "other_descriptors", "advanced", "試料形態は詳細属性"
                )
            else:
                builder.add_unresolved(raw, "other_descriptors", "other_descriptorsの意味役割が不明")
        else:
            builder.add_metadata(
                raw,
                "source_context",
                "other_descriptors",
                None,
                "成分表上の補足文脈",
            )

    for item in record["variety_or_breed"]:
        raw = item["raw"]
        if occurrence_key("variety_or_breed", raw) in builder.roles:
            continue
        value = normalized_value(item) or raw
        if GRADE_RE.match(raw):
            builder.add_attribute("grade", value, raw, "variety_or_breed", "advanced", "等級は属性")
        elif ORIGIN_RE.search(raw):
            builder.add_attribute("origin", value, raw, "variety_or_breed", "optional", "由来は属性")
        elif looks_like_product(raw):
            builder.add_unresolved(raw, "variety_or_breed", "品種欄に食品名候補が残っている")
        elif any(term in raw for term in ("和牛", "乳用肥育牛", "大型種", "中型種", "肉用種")):
            builder.add_attribute("breed", value, raw, "variety_or_breed", "optional", "動物系統は属性")
        else:
            builder.add_attribute("variety", value, raw, "variety_or_breed", "optional", "品種・種類は属性")

    for item in record["anatomical_part"]:
        raw = item["raw"]
        if occurrence_key("anatomical_part", raw) in builder.roles:
            continue
        value = normalized_value(item) or raw
        builder.add_attribute(
            "form" if raw.endswith("型") else "other",
            value,
            raw,
            "anatomical_part",
            "primary" if chapter not in {"01", "06", "07"} else "advanced",
            "食品本体に含めない部位は属性",
            signature_dimension="form" if raw.endswith("型") else "part",
        )

    for item in record["maturity_state"]:
        raw = item["raw"]
        if occurrence_key("maturity_state", raw) in builder.roles:
            continue
        builder.add_attribute(
            "form",
            normalized_value(item) or raw,
            raw,
            "maturity_state",
            "optional",
            "成熟状態は属性",
            signature_dimension="form",
        )

    for item in record["cooking_state"]:
        raw = item["raw"]
        if occurrence_key("cooking_state", raw) in builder.roles:
            continue
        value = normalized_value(item) or raw
        if raw in INDEPENDENT_COOKED_FOODS:
            builder.add_unresolved(raw, "cooking_state", "調理状態と独立食品名の境界が曖昧")
        else:
            builder.add_attribute(
                "cooking_state", value, raw, "cooking_state", "primary", "調理状態は原則属性"
            )

    for item in record["processing_state"]:
        raw = item["raw"]
        if occurrence_key("processing_state", raw) in builder.roles:
            continue
        value = normalized_value(item) or raw
        source_name = record["source_name"]
        selected_raws = {evidence for _, evidence in builder.identity_evidence}
        state_prefixes = ("半生", "生", "乾", "ゆで", "焼き", "蒸し", "冷凍", "冷蔵")
        state_prefixed_identity = next(
            (
                selected
                for selected in selected_raws
                if raw.endswith(selected)
                and raw != selected
                and raw[: -len(selected)].startswith(state_prefixes)
            ),
            None,
        )
        if state_prefixed_identity:
            state_value = raw[: -len(state_prefixed_identity)]
            builder.add_attribute(
                "processing_state",
                state_value,
                raw,
                "processing_state",
                "primary",
                "食品本体名を含む状態表現は属性",
            )
        elif raw == "粉":
            builder.add_attribute(
                "form",
                raw,
                raw,
                "processing_state",
                "primary",
                "香辛料等の粉末形態は属性",
            )
        elif raw in {"全層粉", "内層粉", "中層粉", "表層粉"} and "そば粉" in source_name:
            builder.add_attribute(
                "form",
                raw,
                raw,
                "processing_state",
                "advanced",
                "そば粉の製粉層区分は詳細属性",
            )
        elif "きな粉" in source_name and raw in {"青きな粉", "きな粉"}:
            builder.add_attribute(
                "variety",
                raw,
                raw,
                "processing_state",
                "optional",
                "砂糖入りきな粉系列の種類は属性",
            )
        elif raw == "塩漬":
            builder.add_attribute(
                "processing_state",
                value,
                raw,
                "processing_state",
                "primary",
                "塩漬は加工状態",
            )
        elif "あずき" in source_name and "あん" in source_name:
            builder.add_attribute(
                "processing_state",
                value,
                raw,
                "processing_state",
                "primary",
                "小豆あん系列の製法・状態は属性",
            )
        elif "即席" in source_name and "めん" in source_name and raw in {
            "油揚げ",
            "非油揚げ",
            "油揚げ味付け",
        }:
            builder.add_attribute(
                "processing_state",
                value,
                raw,
                "processing_state",
                "primary",
                "即席めんの油揚げ状態は属性",
            )
        elif raw in {"乾", "冷凍", "冷蔵", "缶詰"}:
            builder.add_attribute(
                "preservation_state",
                value,
                raw,
                "processing_state",
                "primary" if raw in {"乾", "缶詰"} else "optional",
                "保存状態へ再分類",
            )
        elif looks_like_product(raw) and raw not in {"漬物", "缶詰"}:
            if chapter in FISH_CHAPTERS and (
                record["anatomical_part"]
                or any(evidence.endswith("缶詰") or evidence == "缶詰" for evidence in selected_raws)
            ):
                builder.add_attribute(
                    "processing_state",
                    value,
                    raw,
                    "processing_state",
                    "primary",
                    "魚介の部位・缶詰内の加工状態",
                )
            elif raw in {"果実飲料", "加工品"} and selected_raws:
                builder.add_metadata(
                    raw,
                    "source_context",
                    "processing_state",
                    raw,
                    "より具体的な加工食品名の上位概念",
                )
            else:
                builder.add_unresolved(raw, "processing_state", "加工状態と独立食品名の境界が曖昧")
        else:
            builder.add_attribute(
                "processing_state", value, raw, "processing_state", "primary", "加工状態は属性"
            )

    for item in record["preservation_state"]:
        raw = item["raw"]
        if occurrence_key("preservation_state", raw) in builder.roles:
            continue
        builder.add_attribute(
            "preservation_state",
            normalized_value(item) or raw,
            raw,
            "preservation_state",
            "primary" if raw in {"乾", "缶詰"} else "optional",
            "保存状態は属性",
        )

    for field_name, dimension in (
        ("skin_state", "skin_state"),
        ("fat_state", "fat_state"),
        ("bone_state", "bone_state"),
        ("liquid_state", "liquid_state"),
    ):
        item = record[field_name]
        raw = item.get("raw")
        if raw and occurrence_key(field_name, raw) not in builder.roles:
            builder.add_attribute(
                dimension,
                normalized_value(item) or raw,
                raw,
                field_name,
                "primary",
                f"{dimension}は属性",
            )

    filling = record["filling"]
    filling_raw = filling.get("raw")
    if filling_raw and occurrence_key("filling", filling_raw) not in builder.roles:
        filling_value = normalized_value(filling) or filling_raw
        presence = None
        if filling_value.endswith("入り"):
            filling_value = filling_value[: -len("入り")]
            presence = "入り"
        elif filling_value == "あんなし":
            filling_value = "あん"
            presence = "なし"
        builder.add_attribute(
            "filling",
            filling_value,
            filling_raw,
            "filling",
            "primary",
            "中身は属性",
            presence=presence,
        )

    filling_ingredient = record["filling_ingredient"]
    ingredient_raw = filling_ingredient.get("raw")
    if ingredient_raw and occurrence_key("filling_ingredient", ingredient_raw) not in builder.roles:
        value = normalized_value(filling_ingredient) or ingredient_raw
        presence = "入り" if value.endswith("入り") else None
        if presence:
            value = value[: -len("入り")]
        builder.add_attribute(
            "filling",
            value,
            ingredient_raw,
            "filling_ingredient",
            "primary",
            "中身の材料は属性",
            signature_dimension="filling_ingredient",
            presence=presence,
        )

    flavor = record["flavor"]
    flavor_raw = flavor.get("raw")
    if flavor_raw and occurrence_key("flavor", flavor_raw) not in builder.roles:
        builder.add_attribute(
            "flavor",
            normalized_value(flavor) or flavor_raw,
            flavor_raw,
            "flavor",
            "primary",
            "系列内の味は属性",
        )

    # The preceding base term can describe a variant of the selected product.
    for raw in record["base_food_name"].get("raw_segments", []):
        key = occurrence_key("base_food_name", raw)
        if raw in {"無発酵バター", "発酵バター"}:
            value = "無発酵" if raw.startswith("無発酵") else "発酵"
            builder.add_attribute(
                "processing_state",
                value,
                raw,
                "base_food_name",
                "primary",
                "バターの発酵状態は属性",
            )
        elif record["filling"].get("raw") and raw in {
            "こしあん",
            "つぶしあん",
            "カスタードクリーム",
        }:
            builder.add_attribute(
                "filling",
                raw,
                raw,
                "base_food_name",
                "primary",
                "中身の材料を抽出結果から補正",
                signature_dimension="filling_ingredient",
            )
        elif key in builder.roles:
            continue

    # Base and primary occurrences not selected for identity are context.
    for raw in record["base_food_name"].get("raw_segments", []):
        key = occurrence_key("base_food_name", raw)
        if key not in builder.roles:
            builder.add_metadata(
                raw,
                "source_context",
                "base_food_name",
                strip_heading(raw) or raw,
                "食品本体の上位概念または原料文脈",
            )
    primary_raw = record["primary_ingredient"].get("raw")
    if primary_raw and occurrence_key("primary_ingredient", primary_raw) not in builder.roles:
        builder.add_metadata(
            primary_raw,
            "source_context",
            "primary_ingredient",
            normalized_value(record["primary_ingredient"]),
            "加工後名称を優先した原材料文脈",
        )


def ensure_coverage(builder: RecordBuilder) -> None:
    for source_field, raw in iter_occurrences(builder.source):
        key = occurrence_key(source_field, raw)
        if not builder.roles.get(key):
            builder.add_unresolved(raw, source_field, "意味要素の役割が未分類")
        elif len(builder.roles[key] - {"metadata"}) > 1:
            builder.add_review_reason("同じ語が複数の意味役割に分類された")


def build_variant_signature(attributes: list[dict[str, Any]]) -> list[dict[str, str]]:
    values: dict[tuple[str, str], dict[str, str]] = {}
    for attribute in attributes:
        dimension = attribute["_signature_dimension"]
        value = attribute["value"]
        presence = attribute.get("presence")
        if presence:
            value = f"{value}:{presence}"
        values[(dimension, value)] = {"dimension": dimension, "value": value}
    return sorted(
        values.values(),
        key=lambda item: (SIGNATURE_RANK.get(item["dimension"], 999), item["dimension"], item["value"]),
    )


def clean_attributes(attributes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for attribute in attributes:
        item = {key: value for key, value in attribute.items() if not key.startswith("_")}
        cleaned.append(item)
    return cleaned


def build_record(source: dict[str, Any]) -> dict[str, Any]:
    builder = RecordBuilder(source=source)
    canonical, parent, key_parts = select_identity(builder)
    classify_variants_and_metadata(builder)
    ensure_coverage(builder)

    confidence = 0.94
    if builder.generated_display_name:
        confidence -= 0.04
    if builder.unresolved:
        confidence = min(confidence, 0.72)
    if canonical in {"", "未確定食品"}:
        confidence = min(confidence, 0.4)
        builder.add_review_reason("食品本体候補を一意に決定できない")
    if any("複数の食品本体候補" in reason for reason in builder.review_reasons):
        confidence = min(confidence, 0.74)
    if confidence < 0.8:
        builder.add_review_reason("confidenceが0.8未満")

    food_form = classify_food_form(source, canonical)
    attributes = sorted(
        builder.attributes,
        key=lambda item: (
            SIGNATURE_RANK.get(item["_signature_dimension"], 999),
            item["_signature_dimension"],
            item["value"],
        ),
    )
    variant_signature = build_variant_signature(attributes)
    result = {
        "source_id": source["source_id"],
        "source_name": source["source_name"],
        "source_analysis": {field: copy.deepcopy(source[field]) for field in SOURCE_ANALYSIS_FIELDS},
        "identity_candidate": {
            "canonical_name": canonical,
            "display_name": canonical,
            "parent_concept": parent,
            "food_form": food_form,
            "key_parts": key_parts,
            "generated_display_name": builder.generated_display_name,
        },
        "variant_attributes": clean_attributes(attributes),
        "metadata": builder.metadata,
        "unresolved": builder.unresolved,
        "field_role_corrections": builder.corrections,
        "variant_signature": variant_signature,
        "confidence": round(confidence, 2),
        "needs_review": bool(builder.review_reasons),
        "review_reasons": builder.review_reasons,
    }
    return result


def identity_signature(record: dict[str, Any]) -> str:
    semantic_parts = [
        {"dimension": part["dimension"], "value": part["value"]}
        for part in record["identity_candidate"]["key_parts"]
    ]
    return json.dumps(semantic_parts, ensure_ascii=False, sort_keys=True)


def variant_signature_key(record: dict[str, Any]) -> str:
    return json.dumps(record["variant_signature"], ensure_ascii=False, sort_keys=True)


def add_collision_reviews(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        groups[(identity_signature(record), variant_signature_key(record))].append(record)

    collisions: list[dict[str, Any]] = []
    for (identity_key, variant_key), group in groups.items():
        if len(group) < 2:
            continue
        source_ids = [record["source_id"] for record in group]
        collision = {
            "identity_key_parts": json.loads(identity_key),
            "variant_signature": json.loads(variant_key),
            "source_ids": source_ids,
            "record_count": len(group),
        }
        collisions.append(collision)
        for record in group:
            if "variant_signatureが同一のレコードと衝突" not in record["review_reasons"]:
                record["review_reasons"].append("variant_signatureが同一のレコードと衝突")
            record["needs_review"] = True
            record["confidence"] = min(record["confidence"], 0.78)
    return collisions


def count_nested(counter: Counter[str]) -> dict[str, int]:
    return dict(sorted(counter.items(), key=lambda item: (-item[1], item[0])))


def build_summary(records: list[dict[str, Any]], collisions: list[dict[str, Any]]) -> dict[str, Any]:
    corrections = Counter()
    forms = Counter()
    dimensions = Counter()
    values: dict[str, Counter[str]] = defaultdict(Counter)
    visibility = Counter()
    review_reasons = Counter()
    identity_parts: dict[str, Counter[str]] = defaultdict(Counter)

    for record in records:
        forms[record["identity_candidate"]["food_form"]] += 1
        for part in record["identity_candidate"]["key_parts"]:
            identity_parts[part["dimension"]][part["value"]] += 1
        for attribute in record["variant_attributes"]:
            dimensions[attribute["dimension"]] += 1
            values[attribute["dimension"]][attribute["value"]] += 1
            visibility[attribute["ui_visibility"]] += 1
        for correction in record["field_role_corrections"]:
            corrections[f"{correction['original_field']}->{correction['new_role']}"] += 1
        for reason in record["review_reasons"]:
            review_reasons[reason] += 1

    unique_identity_signatures = {identity_signature(record) for record in records}
    return {
        "total_records": len(records),
        "processed_records": len(records),
        "review_records": sum(record["needs_review"] for record in records),
        "generated_display_name_records": sum(
            record["identity_candidate"]["generated_display_name"] for record in records
        ),
        "identity_candidate_count": len(unique_identity_signatures),
        "variant_signature_collision_count": len(collisions),
        "field_role_correction_counts": count_nested(corrections),
        "identity_food_form_counts": count_nested(forms),
        "identity_key_part_counts": {
            dimension: count_nested(counter) for dimension, counter in sorted(identity_parts.items())
        },
        "attribute_dimension_counts": count_nested(dimensions),
        "attribute_value_counts": {
            dimension: count_nested(counter) for dimension, counter in sorted(values.items())
        },
        "ui_visibility_counts": count_nested(visibility),
        "review_reason_counts": count_nested(review_reasons),
        "variant_signature_collisions": collisions,
    }


def validate(
    source: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    review: list[dict[str, Any]],
    summary: dict[str, Any],
) -> None:
    allowed_food_forms = {
        "raw_ingredient",
        "processed_ingredient",
        "processed_food",
        "dish",
        "confectionery",
        "beverage",
        "seasoning",
        "other",
    }
    allowed_attribute_dimensions = {
        "cooking_state",
        "processing_state",
        "preservation_state",
        "skin_state",
        "fat_state",
        "bone_state",
        "liquid_state",
        "variety",
        "breed",
        "grade",
        "origin",
        "filling",
        "flavor",
        "form",
        "use",
        "other",
    }
    allowed_visibility = {"primary", "optional", "advanced", "hidden"}
    allowed_metadata_types = {
        "classification_heading",
        "table_note",
        "analysis_condition",
        "source_context",
        "other",
    }
    source_ids = [record["source_id"] for record in source]
    candidate_ids = [record["source_id"] for record in candidates]
    assert len(source) == len(candidates), "input/output record count mismatch"
    assert len(candidate_ids) == len(set(candidate_ids)), "duplicate source_id in candidates"
    assert set(source_ids) == set(candidate_ids), "source_id set mismatch"
    assert all(record.get("identity_candidate") for record in candidates)
    assert all(record["identity_candidate"].get("key_parts") for record in candidates)
    assert all(record["source_name"] == source[index]["source_name"] for index, record in enumerate(candidates))
    assert all(not record["unresolved"] or record["needs_review"] for record in candidates)
    expected_review_ids = {record["source_id"] for record in candidates if record["needs_review"]}
    actual_review_ids = {record["source_id"] for record in review}
    assert expected_review_ids == actual_review_ids, "review output is incomplete"
    assert summary["total_records"] == len(source)
    assert summary["processed_records"] == len(candidates)
    assert summary["review_records"] == len(review)
    assert summary["variant_signature_collision_count"] == len(
        summary["variant_signature_collisions"]
    )
    for source_record, record in zip(source, candidates, strict=True):
        identity = record["identity_candidate"]
        assert identity["canonical_name"]
        assert identity["display_name"]
        assert identity["food_form"] in allowed_food_forms
        assert record["source_analysis"] == {
            field: source_record[field] for field in SOURCE_ANALYSIS_FIELDS
        }
        explained_raw = {
            raw
            for part in identity["key_parts"]
            for raw in part.get("raw_evidence", [])
        }
        explained_raw.update(attribute["raw"] for attribute in record["variant_attributes"])
        explained_raw.update(item["raw"] for item in record["metadata"])
        explained_raw.update(item["raw"] for item in record["unresolved"])
        for _, raw in iter_occurrences(source_record):
            assert raw in explained_raw, f"unexplained element: {record['source_id']} {raw}"

        attribute_keys = set()
        for attribute in record["variant_attributes"]:
            assert attribute["dimension"] in allowed_attribute_dimensions
            assert attribute["ui_visibility"] in allowed_visibility
            key = (attribute["dimension"], attribute["value"])
            assert key not in attribute_keys, f"duplicate attribute: {record['source_id']} {key}"
            attribute_keys.add(key)
        assert all(item["type"] in allowed_metadata_types for item in record["metadata"])
        assert all(
            re.fullmatch(r"[a-z][a-z0-9_]*", part["dimension"])
            for part in identity["key_parts"]
        )

        signature = record["variant_signature"]
        ranks = [SIGNATURE_RANK.get(item["dimension"], 999) for item in signature]
        assert ranks == sorted(ranks), f"variant signature order error: {record['source_id']}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    return parser.parse_args()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    candidates = [build_record(record) for record in source]
    collisions = add_collision_reviews(candidates)
    review = [record for record in candidates if record["needs_review"]]
    summary = build_summary(candidates, collisions)
    validate(source, candidates, review, summary)
    write_json(args.candidates, candidates)
    write_json(args.review, review)
    write_json(args.summary, summary)
    # Reparse the final files as the last syntax check.
    json.loads(args.candidates.read_text(encoding="utf-8"))
    json.loads(args.review.read_text(encoding="utf-8"))
    json.loads(args.summary.read_text(encoding="utf-8"))
    print(
        f"records={len(candidates)} review={len(review)} "
        f"collisions={len(collisions)} identities={summary['identity_candidate_count']}"
    )


if __name__ == "__main__":
    main()
