from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .estimator import estimate
from .models import compute_input_hash


def _read_json(path: str) -> dict[str, Any]:
    if path == "-":
        value = json.load(sys.stdin)
    else:
        with Path(path).open(encoding="utf-8") as stream:
            value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("JSONのルートはオブジェクトである必要があります。")
    return value


def _write_json(value: object) -> None:
    json.dump(value, sys.stdout, ensure_ascii=False, allow_nan=False, indent=2)
    sys.stdout.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="NutritionAppローカル栄養素推計コア")
    subparsers = parser.add_subparsers(dest="command", required=True)
    estimate_parser = subparsers.add_parser("estimate", help="推計要求JSONを処理する")
    estimate_parser.add_argument("input", help="入力JSONファイル。標準入力は-")
    estimate_parser.add_argument("--seed", type=int, default=20260725)
    estimate_parser.add_argument("--samples", type=int, default=900)
    hash_parser = subparsers.add_parser("hash", help="入力JSONへinputHashを設定する")
    hash_parser.add_argument("input", help="入力JSONファイル。標準入力は-")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = _read_json(args.input)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        _write_json(
            {
                "status": "failed",
                "error": {
                    "code": "INVALID_JSON",
                    "message": f"入力JSONを読み込めませんでした: {exc}",
                    "nextAction": "UTF-8のJSONオブジェクトを確認して再実行してください。",
                },
            }
        )
        return 2
    if args.command == "hash":
        payload["inputHash"] = compute_input_hash(payload)
        _write_json(payload)
        return 0
    result = estimate(payload, seed=args.seed, samples_per_combination=max(1, args.samples))
    _write_json(result)
    return 0 if result["status"] in {"completed", "partial"} else 1
