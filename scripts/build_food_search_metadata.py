#!/usr/bin/env python3
"""食品成分表からローカル検索用の確定メタデータを生成する。

本番実行時にLLMやHTTP APIは呼ばない。LLMを利用する場合も、別工程で生成した
構造化JSONを known-good として確認してから入力する設計にする。
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = value.translate(str.maketrans({chr(code): chr(code - 0x60) for code in range(0x30A1, 0x30F7)}))
    return re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE)


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
    for group in known.get("groups", []):
        group_id = group.get("id")
        if not isinstance(group_id, str) or group_id in seen:
            raise ValueError(f"invalid or duplicate group id: {group_id}")
        seen.add(group_id)
        ids = group.get("foodIds", [])
        if not all(isinstance(food_id, str) and food_id in food_ids for food_id in ids):
            raise ValueError(f"unknown food id in {group_id}")
        if not isinstance(group.get("representativeScore"), (int, float)) or not 0 <= group["representativeScore"] <= 15:
            raise ValueError(f"invalid representative score in {group_id}")
        for alias in group.get("aliases", []):
            if not isinstance(alias.get("value"), str) or not alias["value"].strip():
                raise ValueError(f"invalid alias in {group_id}")
        for related in group.get("relatedTerms", []):
            if not isinstance(related.get("value"), str) or not related["value"].strip():
                raise ValueError(f"invalid related term in {group_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("foods_json", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("--known-good", type=Path, required=True)
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
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

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

    for food in foods:
        if food["id"] in assigned:
            continue
        group_id = f"food:{food['id']}"
        display = food.get("displayName") or food.get("name") or food.get("officialName") or food["id"]
        groups.append({"id": group_id, "displayName": display, "reading": None, "category": category_for(display), "representativeScore": 0, "defaultVariantId": food["id"], "isActive": True, "metadataSource": "rule", "generationVersion": "fallback-v1", "needsReview": True})

    output = {
        "metadata": {"generationVersion": known.get("generationVersion", "known-good"), "generatedAt": generated_at, "sourceFoodCount": len(foods), "llmRuntime": False},
        "groups": groups,
        "aliases": aliases,
        "relatedTerms": related_terms,
        "foodGroupByFoodId": food_group_by_food_id,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated groups={len(groups)} aliases={len(aliases)} related_terms={len(related_terms)} output={args.output_json}")


if __name__ == "__main__":
    main()
