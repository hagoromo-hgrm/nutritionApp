from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

SUPPORTED_NUTRIENTS = frozenset(
    {
        "saturatedFatG",
        "fiberG",
        "calciumMg",
        "ironMg",
        "vitaminAMcg",
        "vitaminEMg",
        "vitaminB1Mg",
        "vitaminB2Mg",
        "vitaminCMg",
    }
)
KNOWN_NUTRIENTS = frozenset(
    {
        "energyKcal",
        "proteinG",
        "fatG",
        "carbohydrateG",
        "saltG",
        *SUPPORTED_NUTRIENTS,
    }
)


class RequestValidationError(ValueError):
    def __init__(self, message: str, next_action: str, code: str = "INVALID_REQUEST") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.next_action = next_action


@dataclass(frozen=True)
class EstimateRequest:
    request_id: str
    food_id: str
    barcode: str | None
    name: str
    maker: str | None
    category_id: str | None
    base_amount: float
    base_unit: str
    reference_mass_g: float | None
    reference_mass_source: str | None
    known_nutrients: dict[str, float | None]
    missing_nutrients: tuple[str, ...]
    ingredients_text: str | None
    ingredients_source: dict[str, Any] | None
    requested_at: str
    input_hash: str


def canonical_input(payload: Mapping[str, Any]) -> bytes:
    canonical = {key: value for key, value in payload.items() if key != "inputHash"}
    return json.dumps(
        canonical,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def compute_input_hash(payload: Mapping[str, Any]) -> str:
    return f"sha256:{hashlib.sha256(canonical_input(payload)).hexdigest()}"


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RequestValidationError(
            f"{key}が指定されていません。",
            f"{key}を文字列で指定してから再実行してください。",
        )
    return value.strip()


def _optional_text(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise RequestValidationError(
            f"{key}の形式が正しくありません。",
            f"{key}を文字列またはnullで指定してください。",
        )
    stripped = value.strip()
    return stripped or None


def _positive_number(payload: Mapping[str, Any], key: str, *, optional: bool = False) -> float | None:
    value = payload.get(key)
    if optional and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RequestValidationError(
            f"{key}は正の数で指定してください。",
            f"{key}の値を確認して再実行してください。",
        )
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise RequestValidationError(
            f"{key}は正の有限値で指定してください。",
            f"{key}の値を確認して再実行してください。",
        )
    return number


def _validate_iso8601(value: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RequestValidationError(
            "requestedAtがISO 8601形式ではありません。",
            "タイムゾーンを含むISO 8601形式で指定してください。",
        ) from exc


def parse_request(payload: Mapping[str, Any]) -> EstimateRequest:
    request_id = _required_text(payload, "requestId")
    food_id = _required_text(payload, "foodId")
    name = _required_text(payload, "name")
    base_unit = _required_text(payload, "baseUnit")
    requested_at = _required_text(payload, "requestedAt")
    _validate_iso8601(requested_at)

    barcode = _optional_text(payload, "barcode")
    if barcode is not None and (not barcode.isdigit() or len(barcode) not in {8, 12, 13, 14}):
        raise RequestValidationError(
            "barcodeは8、12、13、14桁の数字文字列で指定してください。",
            "JAN/GTINを先頭ゼロを保持した文字列として入力してください。",
        )

    known_raw = payload.get("knownNutrients")
    if not isinstance(known_raw, dict):
        raise RequestValidationError(
            "knownNutrientsが指定されていません。",
            "公表済み栄養値をオブジェクトで指定してください。",
        )
    known: dict[str, float | None] = {}
    for key, value in known_raw.items():
        if key not in KNOWN_NUTRIENTS:
            continue
        if value is None:
            known[key] = None
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise RequestValidationError(
                f"knownNutrients.{key}は数値またはnullで指定してください。",
                "栄養成分表示を確認し、欠損はnullとして再実行してください。",
            )
        number = float(value)
        if not math.isfinite(number) or number < 0:
            raise RequestValidationError(
                f"knownNutrients.{key}は0以上の有限値で指定してください。",
                "栄養成分表示を確認して再実行してください。",
            )
        known[key] = number

    missing_raw = payload.get("missingNutrients")
    if not isinstance(missing_raw, list) or not all(isinstance(item, str) for item in missing_raw):
        raise RequestValidationError(
            "missingNutrientsが文字列配列ではありません。",
            "欠損している栄養素キーを配列で指定してください。",
        )
    missing = tuple(dict.fromkeys(item for item in missing_raw if item in SUPPORTED_NUTRIENTS))

    input_hash = _required_text(payload, "inputHash")
    expected_hash = compute_input_hash(payload)
    if input_hash != expected_hash:
        raise RequestValidationError(
            "inputHashが入力内容と一致しません。",
            "現在の入力内容からinputHashを再計算して再実行してください。",
            "INPUT_HASH_MISMATCH",
        )

    ingredients_source_raw = payload.get("ingredientsSource")
    ingredients_source: dict[str, Any] | None
    if ingredients_source_raw is None:
        ingredients_source = None
    elif not isinstance(ingredients_source_raw, dict):
        raise RequestValidationError(
            "ingredientsSourceの形式が正しくありません。",
            "providerとverifiedを含むオブジェクト、またはnullで指定してください。",
        )
    else:
        provider = ingredients_source_raw.get("provider")
        verified = ingredients_source_raw.get("verified")
        if not isinstance(provider, str) or not provider.strip() or not isinstance(verified, bool):
            raise RequestValidationError(
                "ingredientsSourceのproviderまたはverifiedが正しくありません。",
                "原材料表示の取得元と確認状態を入力して再実行してください。",
            )
        ingredients_source = dict(ingredients_source_raw)
        ingredients_source["provider"] = provider.strip()

    return EstimateRequest(
        request_id=request_id,
        food_id=food_id,
        barcode=barcode,
        name=name,
        maker=_optional_text(payload, "maker"),
        category_id=_optional_text(payload, "estimatorCategoryId"),
        base_amount=_positive_number(payload, "baseAmount") or 0.0,
        base_unit=base_unit,
        reference_mass_g=_positive_number(payload, "referenceMassG", optional=True),
        reference_mass_source=_optional_text(payload, "referenceMassSource"),
        known_nutrients=known,
        missing_nutrients=missing,
        ingredients_text=_optional_text(payload, "ingredientsText"),
        ingredients_source=ingredients_source,
        requested_at=requested_at,
        input_hash=input_hash,
    )
