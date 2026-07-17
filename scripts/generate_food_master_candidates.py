#!/usr/bin/env python3
"""LLMを本番検索から分離した食品マスター候補生成補助。

--prompt-output は、外部の承認済みLLM環境へ渡す入力JSONLを作るだけです。
--llm-jsonl は、LLMが返した構造化候補を決定的に検証して採用候補JSONLへ出します。
このスクリプト自身はネットワーク、APIキー、ユーザーIDを使用しません。
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = "".join(chr(ord(char) - 0x60) if 0x30A1 <= ord(char) <= 0x30F6 else char for char in value)
    return re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE)


def validate(candidate: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = ("source_id", "official_name", "display_name", "group_key", "group_display_name", "confidence")
    for key in required:
        if not candidate.get(key): errors.append(f"missing:{key}")
    if not isinstance(candidate.get("confidence"), (int, float)) or not 0 <= candidate["confidence"] <= 1:
        errors.append("confidence-range")
    reading = candidate.get("reading")
    if reading and not re.fullmatch(r"[ぁ-ゖー・ ]+", reading): errors.append("reading-not-hiragana")
    aliases = candidate.get("aliases", [])
    related = candidate.get("related_terms", [])
    if not isinstance(aliases, list) or not isinstance(related, list): errors.append("terms-not-list")
    else:
        alias_values = {normalize(str(item.get("value", item))) for item in aliases}
        related_values = {normalize(str(item.get("value", item))) for item in related}
        if alias_values & related_values: errors.append("alias-related-overlap")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("foods_json", type=Path)
    parser.add_argument("output_jsonl", type=Path)
    parser.add_argument("--prompt-output", type=Path)
    parser.add_argument("--llm-jsonl", type=Path)
    args = parser.parse_args()
    foods = json.loads(args.foods_json.read_text(encoding="utf-8"))["foods"]
    if args.prompt_output:
        with args.prompt_output.open("w", encoding="utf-8") as handle:
            for food in foods:
                handle.write(json.dumps({"source_id": food["id"], "official_name": food.get("officialName", food["name"]), "task": "display name, hiragana reading, aliases, related terms, conservative group and variant attributes as JSON", "constraints": {"keep_official_name": True, "do_not_merge_different_species_or_parts": True, "no_runtime_llm": True}}, ensure_ascii=False) + "\n")
    if not args.llm_jsonl:
        args.output_jsonl.write_text("", encoding="utf-8")
        print(f"prompt_only foods={len(foods)} output={args.output_jsonl}")
        return
    valid = 0
    rejected = 0
    args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with args.llm_jsonl.open("r", encoding="utf-8") as source, args.output_jsonl.open("w", encoding="utf-8") as output:
        for line_number, line in enumerate(source, start=1):
            if not line.strip(): continue
            candidate = json.loads(line)
            errors = validate(candidate)
            if errors:
                rejected += 1
                print(f"rejected line={line_number} reasons={','.join(errors)}")
                continue
            candidate["needs_review"] = candidate["confidence"] < 0.98
            candidate["generation_version"] = candidate.get("generation_version", "llm-candidate-v1")
            output.write(json.dumps(candidate, ensure_ascii=False) + "\n")
            valid += 1
    print(f"validated candidates={valid} rejected={rejected} output={args.output_jsonl}")


if __name__ == "__main__":
    main()
