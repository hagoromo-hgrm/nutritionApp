#!/usr/bin/env python3
"""食品成分表からローカル検索用の確定メタデータを生成する。

本番実行時にLLMやHTTP APIは呼ばない。事前にSubagentが作成した静的なLLM判定JSONを
明示的に指定した場合だけ、その確定判定を取り込み、残りは決定的なルールで処理する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VARIANT_KEYS = ("species", "part", "cultivation", "sourceBean", "skin", "preparation", "processing", "variety", "nameSpecification")
SKIN_VALUE_ALIASES = {"皮つき": "皮つき", "皮なし": "皮なし"}
SKIN_VALUES = set(SKIN_VALUE_ALIASES)
PREPARATION_VALUES = {
    "生", "ゆで", "焼き", "水煮", "蒸し", "電子レンジ調理", "油いため", "素揚げ",
    "天ぷら", "から揚げ", "ソテー", "フライ", "煮", "あめ色たまねぎ",
}
PROCESSING_VALUES = {
    "冷凍", "乾", "乾燥", "水戻し", "塩抜き", "水さらし", "カット", "常法洗浄",
    "次亜塩素酸洗浄", "おろし",
}
CULTIVATION_VALUES = {"菌床栽培", "原木栽培"}
SOURCE_BEAN_VALUES = {
    "アルファルファもやし": "アルファルファ",
    "だいずもやし": "だいず",
    "ブラックマッペもやし": "ブラックマッペ",
    "りょくとうもやし": "りょくとう",
}

# これらは原材料の単なる状態違いではなく、独立した食品として扱う候補。
# 自動統合せず、レビュー一覧に残す。
INDEPENDENT_PRODUCT_TOKENS = {
    "グラッセ", "ジュース", "缶詰", "漬物", "甘煮", "ナムル", "料理", "スープ",
    "だし", "ソース", "ペースト", "ピューレー", "ケチャップ", "フライドポテト",
    "おろし汁", "おろし水洗い", "いぶりがっこ", "ぬかみそ漬", "たくあん漬",
    "塩押しだいこん漬", "干しだいこん漬", "守口漬", "べったら漬", "みそ漬", "福神漬",
    "塩漬", "こうじ漬", "からし漬", "しば漬",
}

PART_VALUES = (
    "手羽さき", "手羽もと", "ひき肉", "なんこつ（胸肉）", "りん茎及び葉", "結球葉",
    "生しいたけ", "乾しいたけ", "むね", "もも", "ささみ", "手羽", "心臓", "肝臓",
    "すなぎも", "皮", "赤身", "脂身", "卵白", "卵黄", "根", "葉", "芽ばえ", "果実",
    "りん茎", "塊根", "塊茎", "ロース", "ばら", "かた", "そともも", "もも肉",
)

DISPLAY_SUFFIXES = {"根", "果実", "結球葉", "りん茎", "塊根", "塊茎"}

AMBIGUOUS_FAMILY_RULES = (
    {
        "id": "carrot-family",
        "label": "にんじん類",
        "terms": ("にんじん", "きんとき", "島にんじん", "ミニキャロット", "葉にんじん"),
        "reason": "通常のにんじん、品種・サイズ違い、葉の食品を同じグループにするか判断が必要",
        "recommendation": "通常のにんじんの根だけを同一グループとし、品種・葉は分離する案を推奨",
        "decision": "通常のにんじんの根だけを同一グループとし、品種・葉は分離",
    },
    {
        "id": "daikon-family",
        "label": "だいこん類",
        "terms": ("だいこん", "かいわれだいこん", "葉だいこん", "切干しだいこん", "はつかだいこん"),
        "reason": "根、葉、芽ばえ、乾燥品、別品種、漬物が同じ分類見出しに含まれる",
        "recommendation": "だいこん根の皮・調理状態だけを同一グループとし、葉・芽ばえ・乾燥品・漬物は分離する案を推奨",
        "decision": "だいこん根の皮・調理状態だけを同一グループとし、葉・芽ばえ・乾燥品・漬物は分離",
    },
    {
        "id": "tomato-family",
        "label": "トマト類",
        "terms": ("トマト", "ミニトマト", "ドライトマト", "トマトジュース", "トマトピューレー", "トマトペースト", "トマトケチャップ", "トマトソース"),
        "reason": "品種・乾燥状態・飲料・調味加工品が混在する",
        "recommendation": "生の赤色トマトだけを基準グループ候補とし、ミニ・黄色・乾燥・加工品は分離する案を推奨",
        "decision": "生の赤色トマトだけを同一グループとし、ミニ・黄色・乾燥・加工品は分離",
    },
    {
        "id": "cabbage-family",
        "label": "キャベツ類",
        "terms": ("キャベツ", "グリーンボール", "レッドキャベツ", "めキャベツ"),
        "reason": "一般キャベツ、品種違い、芽キャベツを同一グループにするか判断が必要",
        "recommendation": "一般キャベツの調理状態だけを同一グループとし、品種は分離する案を推奨",
        "decision": "一般キャベツの調理状態だけを同一グループとし、品種は分離",
    },
    {
        "id": "eggplant-family",
        "label": "なす類",
        "terms": ("なす", "べいなす"),
        "reason": "一般なす、べいなす、漬物が同じ分類見出しに含まれる",
        "recommendation": "通常なす、べいなす、なすの漬物を別グループにする案を推奨",
        "decision": "通常なす、べいなす、なすの漬物を別グループにする",
    },
    {
        "id": "pumpkin-family",
        "label": "かぼちゃ類",
        "terms": ("日本かぼちゃ", "西洋かぼちゃ", "そうめんかぼちゃ"),
        "reason": "品種が栄養値と食品選択に影響する",
        "recommendation": "日本・西洋・そうめんを別グループにする案を推奨",
        "decision": "日本・西洋・そうめんを別グループにする",
    },
    {
        "id": "onion-family",
        "label": "たまねぎ類",
        "terms": ("たまねぎ", "赤たまねぎ", "葉たまねぎ", "あめ色たまねぎ"),
        "reason": "品種、可食部、加工状態が混在する",
        "recommendation": "通常たまねぎの調理状態だけを同一グループとし、赤・葉は分離する案を推奨",
        "decision": "あめ色たまねぎを調理状態として通常たまねぎのグループに含め、赤・葉は分離",
    },
    {
        "id": "shiitake-family",
        "label": "しいたけ類",
        "terms": ("生しいたけ", "乾しいたけ", "しいたけだし", "菌床栽培", "原木栽培"),
        "reason": "生鮮・栽培方法・乾燥品・だしが混在する",
        "recommendation": "生しいたけは栽培方法を属性にし、乾燥品とだしは分離する案を推奨",
        "decision": "菌床栽培・原木栽培を栽培方法属性として生しいたけを同一グループにし、乾燥品・だしは分離",
    },
    {
        "id": "sprout-family",
        "label": "もやし類",
        "terms": ("アルファルファもやし", "だいずもやし", "ブラックマッペもやし", "りょくとうもやし"),
        "reason": "原料豆の違いが食品名と栄養値に反映される",
        "recommendation": "もやしを一つのグループとし、原料豆を属性にする案を推奨",
        "decision": "もやしを一つのグループとし、アルファルファ・だいず・ブラックマッペ・りょくとうを原料豆属性にする",
    },
)


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = value.translate(str.maketrans({chr(code): chr(code - 0x60) for code in range(0x30A1, 0x30F7)}))
    return re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE)


def clean_name(name: str) -> str:
    value = re.sub(r"（(?:小さじ|大さじ)1=[^)]+）$", "", name)
    value = re.sub(r"＜[^＞]*＞", " ", value)
    value = re.sub(r"（[^）]*類）", " ", value)
    return re.sub(r"\s+", " ", value.replace("　", " ")).strip()


def tokens_for(name: str) -> list[str]:
    value = clean_name(name)
    return [token for token in re.split(r"\s+", value) if token]


def square_content(token: str) -> str:
    return token.strip("［］[]")


def variant_token(token: str) -> str:
    return token.strip("（）()")


def standalone_skin_is_attribute(tokens: list[str]) -> bool:
    # 成分表の「にんじん 根 皮 生」は可食部の皮の有無として扱う。
    # 鶏皮・あひる皮などの「皮」は独立した部位なので、部位のまま残す。
    return "皮" in tokens and "にんじん" in tokens


def is_grouping_variant_token(token: str, tokens: list[str] | None = None) -> bool:
    normalized_token = variant_token(token)
    return normalized_token in (
        SKIN_VALUES
        | PREPARATION_VALUES
        | PROCESSING_VALUES
        | CULTIVATION_VALUES
        | set(SOURCE_BEAN_VALUES)
    ) or (normalized_token == "皮" and tokens is not None and standalone_skin_is_attribute(tokens))


def variant_attributes(name: str) -> dict[str, str | None]:
    tokens = tokens_for(name)
    attributes: dict[str, str | None] = {key: None for key in VARIANT_KEYS}
    for token in tokens:
        normalized_token = variant_token(token)
        if normalized_token in SKIN_VALUES:
            attributes["skin"] = SKIN_VALUE_ALIASES[normalized_token]
        elif normalized_token == "皮" and standalone_skin_is_attribute(tokens):
            attributes["skin"] = "皮つき"
        elif normalized_token in PREPARATION_VALUES:
            attributes["preparation"] = normalized_token
        elif normalized_token in PROCESSING_VALUES:
            attributes["processing"] = normalized_token
        elif normalized_token in CULTIVATION_VALUES:
            attributes["cultivation"] = normalized_token
        elif normalized_token in SOURCE_BEAN_VALUES:
            attributes["sourceBean"] = SOURCE_BEAN_VALUES[normalized_token]

        content = square_content(token)
        if "若どり" in content:
            attributes["variety"] = "若どり"
        elif "親" in content:
            attributes["variety"] = "親"
        elif any(marker in content for marker in ("和牛", "乳用肥育", "交雑", "黒毛")):
            attributes["variety"] = content
        elif "養殖" in token:
            attributes["variety"] = "養殖"

    if "皮" in tokens and not standalone_skin_is_attribute(tokens):
        attributes["part"] = "皮"
    else:
        for part in sorted(PART_VALUES, key=len, reverse=True):
            if part in tokens and part != "皮":
                attributes["part"] = part
                break

    species_map = (("にわとり", "鶏"), ("うし", "牛"), ("ぶた", "豚"), ("ひつじ", "羊"), ("やぎ", "山羊"))
    for token, species in species_map:
        if token in tokens:
            attributes["species"] = species
            break

    # LLMレビューで確定した、成分表上のfamily内選択に使う属性。
    if "あずき" in tokens and "あん" in tokens:
        if "こし生あん" in name:
            attributes["variety"] = "こしあん（生）"
        elif "さらしあん" in name:
            attributes["variety"] = "さらしあん（乾燥）"
        elif "並あん" in name:
            attributes["variety"] = "こしあん（並）"
        elif "中割りあん" in name:
            attributes["variety"] = "こしあん（中割り）"
        elif "もなかあん" in name:
            attributes["variety"] = "こしあん（もなか）"
        elif "つぶし生あん" in name:
            attributes["variety"] = "つぶしあん（生）"
        elif "つぶし練りあん" in name:
            attributes["variety"] = "つぶしあん（練り）"
    if "あまのり" in tokens:
        if "ほしのり" in name:
            attributes["processing"] = "ほしのり"
        elif "焼きのり" in name:
            attributes["processing"] = "焼きのり"
        elif "味付けのり" in name:
            attributes["processing"] = "味付けのり"
    if "からし" in tokens:
        if "粒入りマスタード" in name:
            attributes["processing"] = "粒入り"
        elif "練りマスタード" in name:
            attributes["processing"] = "練り"
        elif "粉" in tokens:
            attributes["processing"] = "粉"
        elif "練り" in tokens:
            attributes["processing"] = "練り"
    if "こしあん入り" in name:
        attributes["variety"] = "こしあん"
    elif "つぶしあん入り" in name:
        attributes["variety"] = "つぶしあん"
    if "アメリカンタイプ" in name:
        attributes["processing"] = "アメリカンタイプ"
    elif "デンマークタイプ" in name:
        attributes["processing"] = "デンマークタイプ"
    if "プレーン" in tokens:
        attributes["variety"] = "プレーン"
    elif "カスタードクリーム" in name:
        attributes["variety"] = "カスタードクリーム"
    if "イーストドーナッツ" in name:
        attributes["processing"] = "イーストドーナッツ"
    elif "ケーキドーナッツ" in name:
        attributes["processing"] = "ケーキドーナッツ"
    if "全卵型" in name:
        attributes["variety"] = "全卵型"
    elif "卵黄型" in name:
        attributes["variety"] = "卵黄型"
    elif "低カロリータイプ" in name:
        attributes["variety"] = "低カロリータイプ"
    return attributes


def candidate_signature(name: str) -> str | None:
    tokens = tokens_for(name)
    if any(independent in token for token in tokens for independent in INDEPENDENT_PRODUCT_TOKENS):
        return None
    remaining = [
        token for token in tokens
        if not is_grouping_variant_token(token, tokens)
    ]
    return " ".join(remaining) or None


def display_for_signature(name: str) -> str:
    tokens = tokens_for(name)
    tokens = [
        token for token in tokens
        if not token.startswith(("［", "["))
        and not is_grouping_variant_token(token, tokens)
    ]
    if len(tokens) > 1 and tokens[-1] in DISPLAY_SUFFIXES:
        tokens = tokens[:-1]
    return " ".join(tokens) or name


def first_token_for_review(name: str) -> str | None:
    """分類見出しを除去した食品名の先頭語を返す。

    レビュー候補のまとまりを作るためだけに使う。normalize() は通さず、
    ``AA`` と ``AAB`` のような語を完全一致で別候補として扱う。
    """
    tokens = tokens_for(name)
    return tokens[0] if tokens else None


def build_first_token_review_groups(
    foods: list[dict[str, Any]],
    group_by_food_id: dict[str, str],
    groups_by_id: dict[str, dict[str, Any]],
    variant_attributes_by_food_id: dict[str, dict[str, str | None]],
) -> list[dict[str, Any]]:
    """needsReview 食品を先頭語の完全一致でレビュー用にまとめる。

    ここで作るのは人手確認用の候補一覧であり、family の自動確定は行わない。
    """
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for food in foods:
        official_name = food.get("officialName") or food.get("name") or food["id"]
        clean = clean_name(official_name)
        first_token = first_token_for_review(official_name)
        if first_token is None:
            continue
        group_id = group_by_food_id.get(food["id"])
        group = groups_by_id.get(group_id or "")
        grouped[first_token].append({
            "id": food["id"],
            "name": food.get("displayName") or food.get("name") or official_name,
            "officialName": official_name,
            "cleanName": clean,
            "tokens": tokens_for(official_name),
            "groupId": group_id,
            "groupDisplayName": group.get("displayName") if group else None,
            "variantAttributes": variant_attributes_by_food_id.get(food["id"], {}),
        })

    return [
        {
            "firstToken": first_token,
            "foodCount": len(members),
            "isCandidateGroup": len(members) >= 2,
            "foodIds": [member["id"] for member in members],
            "foods": members,
        }
        for first_token, members in sorted(grouped.items())
    ]


def auto_group_id(signature: str) -> str:
    return f"auto:{hashlib.sha1(signature.encode('utf-8')).hexdigest()[:12]}"


def category_for(name: str) -> str:
    if any(token in name for token in ("米", "めし", "パン", "めん", "麺")):
        return "主食"
    if any(token in name for token in ("肉", "魚", "卵", "豆腐", "納豆", "大豆")):
        return "主菜"
    if any(token in name for token in ("果物", "牛乳", "ヨーグルト", "チーズ", "バナナ", "りんご")):
        return "乳製品・果物"
    if any(token in name for token in ("塩", "しょうゆ", "みそ", "酢", "ソース")):
        return "調味料"
    return "副菜"


def validate_known_good(known: dict[str, Any], food_ids: set[str]) -> None:
    seen: set[str] = set()
    seen_food_ids: set[str] = set()
    for group in known.get("groups", []):
        group_id = group.get("id")
        if not isinstance(group_id, str) or group_id in seen:
            raise ValueError(f"invalid or duplicate group id: {group_id}")
        seen.add(group_id)
        ids = group.get("foodIds", [])
        if not all(isinstance(food_id, str) and food_id in food_ids for food_id in ids):
            raise ValueError(f"unknown food id in {group_id}")
        if seen_food_ids.intersection(ids):
            raise ValueError(f"food id is assigned to multiple known groups in {group_id}")
        seen_food_ids.update(ids)
        if not isinstance(group.get("representativeScore"), (int, float)) or not 0 <= group["representativeScore"] <= 15:
            raise ValueError(f"invalid representative score in {group_id}")
        for alias in group.get("aliases", []):
            if not isinstance(alias.get("value"), str) or not alias["value"].strip():
                raise ValueError(f"invalid alias in {group_id}")
        for related in group.get("relatedTerms", []):
            if not isinstance(related.get("value"), str) or not related["value"].strip():
                raise ValueError(f"invalid related term in {group_id}")


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    return [item for item in values if isinstance(item, str) and item.strip()]


def _llm_spec_label(value: str) -> str:
    label = clean_name(value)
    return label or "標準"


def _match_llm_name_spec(food: dict[str, Any], specifications: list[str]) -> str | None:
    official_name = food.get("officialName") or food.get("name") or ""
    normalized_name = normalize(clean_name(official_name))
    matches = []
    for specification in specifications:
        label = _llm_spec_label(specification)
        normalized_specification = normalize(label)
        if normalized_specification and normalized_specification in normalized_name:
            matches.append((len(normalized_specification), label))
    if not matches:
        return None
    return max(matches, key=lambda item: item[0])[1]


def _llm_group_id(first_token: str, family_index: int, display_name: str, food_ids: list[str]) -> str:
    normalized_display_name = clean_name(display_name).strip()
    signature = f"{first_token}\0{family_index}\0{normalized_display_name}\0{'/'.join(food_ids)}"
    return f"llm:{hashlib.sha1(signature.encode('utf-8')).hexdigest()[:12]}"


def build_llm_confirmed_groups(
    llm_review: dict[str, Any],
    foods_by_id: dict[str, dict[str, Any]],
    assigned: set[str],
    variant_attributes_by_food_id: dict[str, dict[str, str | None]],
) -> tuple[list[dict[str, Any]], set[str], dict[str, str]]:
    """Subagentの静的判定から、clear判定だけを確定familyとして取り込む。

    ambiguousはユーザー判断を反映したknown-good側に置くため、ここでは取り込まない。
    判定済みJSONのfoodId重複・欠落は、静かに補正せずエラーにする。
    """
    groups: list[dict[str, Any]] = []
    imported_food_ids: set[str] = set()
    imported_group_ids: set[str] = set()
    expected_clear_food_ids: set[str] = set()
    food_group_by_food_id: dict[str, str] = {}
    clear_classifications = {"clear-variant", "clear-separate"}

    for review_group in llm_review.get("groups", []):
        classification = review_group.get("classification")
        source_ids = review_group.get("sourceFoodIds", [])
        proposed_families = review_group.get("proposedFamilies", [])
        if not all(food_id in foods_by_id for food_id in source_ids):
            raise ValueError(f"unknown food ID in LLM review group {review_group.get('firstToken')}")
        if classification not in clear_classifications:
            continue
        proposed_ids = [food_id for family in proposed_families for food_id in family.get("foodIds", [])]
        if len(proposed_ids) != len(set(proposed_ids)) or set(source_ids) != set(proposed_ids):
            raise ValueError(f"LLM review food IDs do not match in {review_group.get('firstToken')}")
        expected_clear_food_ids.update(source_ids)
        if assigned.intersection(source_ids):
            raise ValueError(f"LLM clear group overlaps known-good food IDs in {review_group.get('firstToken')}")

        for family_index, family in enumerate(proposed_families):
            food_ids = family.get("foodIds", [])
            if not food_ids:
                raise ValueError(f"empty LLM family in {review_group.get('firstToken')}")
            if imported_food_ids.intersection(food_ids):
                raise ValueError(f"food ID is assigned to multiple LLM families in {review_group.get('firstToken')}")
            display_name = family.get("displayName")
            if not isinstance(display_name, str) or not display_name.strip():
                raise ValueError(f"invalid LLM family name in {review_group.get('firstToken')}")
            display_name = clean_name(display_name).strip()
            group_id = _llm_group_id(review_group.get("firstToken", ""), family_index, display_name, food_ids)
            if group_id in imported_group_ids:
                raise ValueError(f"duplicate generated LLM group ID: {group_id}")
            imported_group_ids.add(group_id)
            groups.append({
                "id": group_id,
                "displayName": display_name.strip(),
                "reading": None,
                "category": category_for(display_name),
                "representativeScore": 7 if len(food_ids) > 1 else 5,
                "defaultVariantId": food_ids[0],
                "isActive": True,
                "metadataSource": "llm",
                "generationVersion": "llm-review-v1",
                "needsReview": False,
            })
            specifications = _string_list(family.get("variantAttributes", {}).get("nameSpecification"))
            for food_id in food_ids:
                imported_food_ids.add(food_id)
                food_group_by_food_id[food_id] = group_id
                if specifications:
                    variant_attributes_by_food_id[food_id]["nameSpecification"] = _match_llm_name_spec(foods_by_id[food_id], specifications) or "標準"

    if imported_food_ids != expected_clear_food_ids:
        raise ValueError("LLM clear food IDs were not imported exactly")
    summary = llm_review.get("summary", {})
    if summary.get("clearFoodCount") is not None and summary["clearFoodCount"] != len(imported_food_ids):
        raise ValueError("LLM review clearFoodCount does not match imported food IDs")
    return groups, imported_food_ids, food_group_by_food_id


def review_family(rule: dict[str, Any], foods: list[dict[str, Any]], group_by_food_id: dict[str, str]) -> dict[str, Any]:
    matched = [
        {"id": food["id"], "name": food.get("displayName") or food.get("name") or food["id"], "groupId": group_by_food_id.get(food["id"]) }
        for food in foods
        if any(term in (food.get("officialName") or food.get("name") or "") for term in rule["terms"])
    ]
    return {**rule, "foodCount": len(matched), "foods": matched}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("foods_json", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("--known-good", type=Path, required=True)
    parser.add_argument("--llm-review", type=Path)
    parser.add_argument("--review-output", type=Path)
    args = parser.parse_args()

    source = json.loads(args.foods_json.read_text(encoding="utf-8"))
    foods = source["foods"]
    known = json.loads(args.known_good.read_text(encoding="utf-8"))
    food_ids = {food["id"] for food in foods}
    validate_known_good(known, food_ids)
    assigned: set[str] = set()
    groups: list[dict[str, Any]] = []
    aliases: list[dict[str, Any]] = []
    related_terms: list[dict[str, Any]] = []
    food_group_by_food_id: dict[str, str] = {}
    variant_attributes_by_food_id: dict[str, dict[str, str | None]] = {}
    review_foods: list[dict[str, Any]] = []
    foods_by_id = {food["id"]: food for food in foods}
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    generation_version = f"{known.get('generationVersion', 'known-good')}-auto-v1"

    for food in foods:
        variant_attributes_by_food_id[food["id"]] = variant_attributes(food.get("officialName") or food.get("name") or "")

    for group in known["groups"]:
        group_id = group["id"]
        ids = [food_id for food_id in group.get("foodIds", []) if food_id in food_ids]
        if not ids:
            continue
        assigned.update(ids)
        for food_id in ids:
            food_group_by_food_id[food_id] = group_id
        default_id = group.get("defaultVariantId") if group.get("defaultVariantId") in ids else ids[0]
        groups.append({
            "id": group_id,
            "displayName": group["displayName"],
            "reading": group.get("reading"),
            "category": group.get("category"),
            "representativeScore": group.get("representativeScore", 0),
            "defaultVariantId": default_id,
            "isActive": True,
            "metadataSource": "manual",
            "generationVersion": known.get("generationVersion", "known-good"),
            "needsReview": False,
        })
        for index, alias in enumerate(group.get("aliases", [])):
            value = alias["value"].strip()
            aliases.append({"id": f"alias:{group_id}:{index}", "foodGroupId": group_id, "foodVariantId": None, "alias": value, "normalizedAlias": normalize(value), "aliasType": alias.get("type", "synonym"), "priority": alias.get("priority", 50), "isActive": True, "metadataSource": "manual"})
        for index, related in enumerate(group.get("relatedTerms", [])):
            value = related["value"].strip()
            related_terms.append({"id": f"related:{group_id}:{index}", "foodGroupId": group_id, "term": value, "normalizedTerm": normalize(value), "weight": related.get("weight", 0.5), "isActive": True, "metadataSource": "manual"})

    llm_groups: list[dict[str, Any]] = []
    llm_food_ids: set[str] = set()
    if args.llm_review:
        llm_review = json.loads(args.llm_review.read_text(encoding="utf-8"))
        llm_groups, llm_food_ids, llm_food_group_by_food_id = build_llm_confirmed_groups(
            llm_review,
            foods_by_id,
            assigned,
            variant_attributes_by_food_id,
        )
        for food_id, group_id in llm_food_group_by_food_id.items():
            assigned.add(food_id)
            food_group_by_food_id[food_id] = group_id
        groups.extend(llm_groups)
        generation_version = f"{generation_version}-llm-review-v1"

    known_signatures: dict[str, list[str]] = defaultdict(list)
    for food_id in assigned:
        food = foods_by_id[food_id]
        signature = candidate_signature(food.get("officialName") or food.get("name") or "")
        if signature:
            known_signatures[signature].append(food_group_by_food_id[food_id])

    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for food in foods:
        if food["id"] in assigned:
            continue
        signature = candidate_signature(food.get("officialName") or food.get("name") or "")
        if signature:
            candidates[signature].append(food)

    auto_proposals: list[dict[str, Any]] = []
    mixed_known_candidates: list[dict[str, Any]] = []
    for signature in sorted(candidates):
        members = candidates[signature]
        if len(members) < 2:
            continue
        if signature in known_signatures:
            mixed_known_candidates.append({"signature": signature, "knownGroupIds": sorted(set(known_signatures[signature])), "foodIds": [food["id"] for food in members], "foods": [food.get("displayName") or food.get("name") for food in members]})
            continue
        group_id = auto_group_id(signature)
        default_id = members[0]["id"]
        group_name = display_for_signature(members[0].get("officialName") or members[0].get("name") or group_id)
        groups.append({"id": group_id, "displayName": group_name, "reading": None, "category": category_for(group_name), "representativeScore": 0, "defaultVariantId": default_id, "isActive": True, "metadataSource": "rule", "generationVersion": "auto-group-v1", "needsReview": False})
        for food in members:
            assigned.add(food["id"])
            food_group_by_food_id[food["id"]] = group_id
        auto_proposals.append({"groupId": group_id, "displayName": group_name, "signature": signature, "foodIds": [food["id"] for food in members], "foods": [food.get("displayName") or food.get("name") for food in members], "variantAttributes": {key: sorted({variant_attributes_by_food_id[food["id"]].get(key) for food in members if variant_attributes_by_food_id[food["id"]].get(key) is not None}) for key in VARIANT_KEYS}})

    # 既知の手動グループと同じ基底候補に残った食品は、勝手に統合せずレビューへ回す。
    for signature in sorted(candidates):
        members = candidates[signature]
        if len(members) == 1 and signature in known_signatures:
            mixed_known_candidates.append({"signature": signature, "knownGroupIds": sorted(set(known_signatures[signature])), "foodIds": [food["id"] for food in members], "foods": [food.get("displayName") or food.get("name") for food in members]})

    for food in foods:
        if food["id"] in assigned:
            continue
        group_id = f"food:{food['id']}"
        # 単独食品でも、調理状態・皮の有無などの属性を検索結果名へ残さない。
        # 部位や独立した加工品名は display_for_signature が保持する。
        official_name = food.get("officialName") or food.get("name") or food["id"]
        official_tokens = tokens_for(official_name)
        has_grouping_attribute = any(is_grouping_variant_token(token, official_tokens) for token in official_tokens)
        display = display_for_signature(official_name) if has_grouping_attribute else (food.get("displayName") or food.get("name") or official_name)
        groups.append({"id": group_id, "displayName": display, "reading": None, "category": category_for(display), "representativeScore": 0, "defaultVariantId": food["id"], "isActive": True, "metadataSource": "rule", "generationVersion": "fallback-v2", "needsReview": True})
        review_foods.append(food)

    for food in foods:
        food_group_by_food_id.setdefault(food["id"], f"food:{food['id']}")

    output = {
        "metadata": {"generationVersion": generation_version, "generatedAt": generated_at, "sourceFoodCount": len(foods), "llmRuntime": False, "llmReviewSource": args.llm_review.name if args.llm_review else None, "llmReviewGroupCount": len(llm_groups), "llmReviewFoodCount": len(llm_food_ids), "groupingPolicy": "static-llm-review-plus-deterministic-conservative-v1" if args.llm_review else "deterministic-conservative-v1"},
        "groups": groups,
        "aliases": aliases,
        "relatedTerms": related_terms,
        "foodGroupByFoodId": food_group_by_food_id,
        "variantAttributesByFoodId": variant_attributes_by_food_id,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    groups_by_id = {group["id"]: group for group in groups}
    first_token_review_groups = build_first_token_review_groups(
        review_foods,
        food_group_by_food_id,
        groups_by_id,
        variant_attributes_by_food_id,
    )
    family_decisions = [review_family(rule, foods, food_group_by_food_id) for rule in AMBIGUOUS_FAMILY_RULES]
    review = {
        "metadata": {
            "generatedAt": generated_at,
            "sourceFoodCount": len(foods),
            "generationVersion": generation_version,
            "autoGroupCount": len(auto_proposals),
            "autoGroupedFoodCount": sum(len(item["foodIds"]) for item in auto_proposals),
            "fallbackGroupCount": sum(1 for group in groups if group["needsReview"]),
            "llmReviewGroupCount": len(llm_groups),
            "llmReviewFoodCount": len(llm_food_ids),
            "reviewFoodCount": len(review_foods),
            "firstTokenReviewGroupCount": len(first_token_review_groups),
            "multiFoodFirstTokenReviewGroupCount": sum(1 for item in first_token_review_groups if item["isCandidateGroup"]),
            "policy": "同一基底名から状態・調理・皮の有無だけを除去して一致するもののみ自動統合。判断が必要な品種・加工品は統合しない。",
        },
        "autoGroupProposals": auto_proposals,
        "mixedWithKnownGroups": mixed_known_candidates,
        "firstTokenReviewGroups": first_token_review_groups,
        "familyDecisions": family_decisions,
        "ambiguousFamilies": [item for item in family_decisions if not item.get("decision")],
    }
    review_output = args.review_output or args.output_json.with_name("food_group_review.json")
    review_output.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated groups={len(groups)} auto_groups={len(auto_proposals)} aliases={len(aliases)} related_terms={len(related_terms)} review={review_output} output={args.output_json}")


if __name__ == "__main__":
    main()
