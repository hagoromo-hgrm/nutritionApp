#!/usr/bin/env python3
"""食品検索メタデータの決定的な形式・安全性検証。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("metadata_json", type=Path)
    parser.add_argument("--forbidden-rules", type=Path)
    args = parser.parse_args()
    data = json.loads(args.metadata_json.read_text(encoding="utf-8"))
    groups = data.get("groups", [])
    aliases = data.get("aliases", [])
    related = data.get("relatedTerms", [])
    ids = {group.get("id") for group in groups}
    if len(ids) != len(groups) or None in ids:
        raise SystemExit("group id is missing or duplicated")
    for group in groups:
        if not group.get("displayName") or not 0 <= group.get("representativeScore", -1) <= 15:
            raise SystemExit(f"invalid group: {group.get('id')}")
        reading = group.get("reading")
        if reading is not None and not re.fullmatch(r"[ぁ-ゖー・ ]+", reading):
            raise SystemExit(f"reading must be hiragana: {group.get('id')}")
    if args.forbidden_rules:
        rules = json.loads(args.forbidden_rules.read_text(encoding="utf-8"))
        for group in groups:
            group_id = group["id"]
            for pair in rules.get("separatePairs", []):
                group_parts = set(group_id.replace("-", ":").split(":"))
                if len(pair) == 2 and all(token in group_parts for token in pair):
                    raise SystemExit(f"forbidden merge: {group_id}")
    for item in aliases:
        if item.get("foodGroupId") not in ids or not item.get("normalizedAlias"):
            raise SystemExit(f"invalid alias: {item.get('id')}")
    for item in related:
        if item.get("foodGroupId") not in ids or not item.get("normalizedTerm") or not 0 <= item.get("weight", -1) <= 1:
            raise SystemExit(f"invalid related term: {item.get('id')}")
    print(f"valid groups={len(groups)} aliases={len(aliases)} related_terms={len(related)}")


if __name__ == "__main__":
    main()
