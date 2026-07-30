from __future__ import annotations

import hashlib
import math
from typing import Any, Mapping

from .models import EstimateRequest, RequestValidationError, parse_request
from .normalize import normalize_ingredients
from .optimizer import Scenario, optimize
from .profiles import NON_CONTRIBUTING_ADDITIVES, candidates_for

MODEL_VERSION = "0.3.0"
DEFAULT_SEED = 20260725
DEFAULT_SAMPLES = 900
COMPOSITION_PARENT_NUTRIENTS = {
    "saturatedFatG": ("fatG", "飽和脂肪酸", "脂質"),
    "fiberG": ("carbohydrateG", "食物繊維", "炭水化物"),
}


def _failed(
    payload: Mapping[str, Any],
    code: str,
    message: str,
    next_action: str,
) -> dict[str, Any]:
    requested_at = payload.get("requestedAt")
    estimated_at = requested_at if isinstance(requested_at, str) else "1970-01-01T00:00:00Z"
    request_id = payload.get("requestId")
    return {
        "requestId": request_id if isinstance(request_id, str) else "",
        "status": "failed",
        "error": {"code": code, "message": message, "nextAction": next_action},
        "modelVersion": MODEL_VERSION,
        "estimatedAt": estimated_at,
    }


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("values must not be empty")
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _confidence(
    scenarios: list[Scenario],
    known_count: int,
    ambiguous: bool,
    relative_width: float,
) -> str:
    best_error = scenarios[0].objective_error
    if best_error <= 0.08 and known_count >= 4 and not ambiguous and relative_width <= 0.35:
        return "high"
    if best_error <= 0.35 and known_count >= 2 and relative_width <= 1.0:
        return "medium"
    return "low"


def _apply_composition_upper_bound(
    nutrient: str,
    estimate_item: dict[str, Any],
    request: EstimateRequest,
) -> None:
    constraint = COMPOSITION_PARENT_NUTRIENTS.get(nutrient)
    if constraint is None:
        return
    parent_key, nutrient_label, parent_label = constraint
    upper_bound = request.known_nutrients.get(parent_key)
    if upper_bound is None:
        return

    value = min(estimate_item["value"], upper_bound)
    low = min(estimate_item["range"]["min"], upper_bound)
    high = min(estimate_item["range"]["max"], upper_bound)
    if (
        value == estimate_item["value"]
        and low == estimate_item["range"]["min"]
        and high == estimate_item["range"]["max"]
    ):
        return
    estimate_item["value"] = value
    estimate_item["range"] = {"min": low, "max": high}
    estimate_item["warnings"].append(
        f"{nutrient_label}は{parent_label}の内訳であるため、"
        f"入力済みの{parent_label}（{upper_bound:g}g）を上限として"
        "推計値と推定範囲を補正しました。"
    )


def estimate(
    payload: Mapping[str, Any],
    *,
    seed: int = DEFAULT_SEED,
    samples_per_combination: int = DEFAULT_SAMPLES,
) -> dict[str, Any]:
    """ローカル入力を推計し、JSON直列化可能な結果を返す。

    時刻は入力requestedAtを使用するため、同じ入力・モデル・seed・設定なら結果全体が一致する。
    """
    try:
        request = parse_request(payload)
    except RequestValidationError as exc:
        return _failed(payload, exc.code, exc.message, exc.next_action)

    if not request.missing_nutrients:
        return _failed(
            payload,
            "NO_SUPPORTED_MISSING_NUTRIENTS",
            "推計対象の欠損栄養素がありません。",
            "対応する栄養素がnullのときだけ推計を実行してください。",
        )
    targets = tuple(
        key for key in request.missing_nutrients if request.known_nutrients.get(key) is None
    )
    if not targets:
        return _failed(
            payload,
            "TARGET_ALREADY_KNOWN",
            "対象栄養素には既に数値があり、推計値では上書きできません。",
            "既存値を維持し、欠損している栄養素だけを選択してください。",
        )
    if request.category_id not in {"cookie", "biscuit"}:
        return _failed(
            payload,
            "CATEGORY_UNSUPPORTED",
            "この食品カテゴリは初期推計モデルの対象外です。",
            "クッキーまたはビスケットとして分類できる場合だけカテゴリを確認して再実行してください。",
        )
    if not request.ingredients_text:
        return _failed(
            payload,
            "INGREDIENTS_UNAVAILABLE",
            "原材料情報が存在しないため推計できません。",
            "パッケージの原材料表示を確認して手入力するか、推計せず食品登録を続けてください。",
        )
    if not request.ingredients_source or request.ingredients_source.get("verified") is not True:
        return _failed(
            payload,
            "INGREDIENT_SOURCE_UNVERIFIED",
            "原材料表示の取得元が確認されていないため推計できません。",
            "原材料の取得元を入力し、内容を確認済みにしてから再実行してください。",
        )
    if request.reference_mass_g is None or not request.reference_mass_source:
        return _failed(
            payload,
            "REFERENCE_MASS_UNAVAILABLE",
            "製品基準量に対応する質量と換算根拠がないため推計できません。",
            "パッケージの内容量など、基準量に対応するg重量とその出典を入力してください。",
        )

    normalized = normalize_ingredients(request.ingredients_text)
    candidate_sets = []
    unresolved: list[str] = []
    additive_names: list[str] = []
    for item in normalized:
        candidates = candidates_for(item.normalizedName)
        if candidates:
            candidate_sets.append(candidates)
        elif item.normalizedName in NON_CONTRIBUTING_ADDITIVES or item.isAdditive:
            additive_names.append(item.normalizedName)
        else:
            unresolved.append(item.normalizedName)
    if unresolved:
        return _failed(
            payload,
            "INGREDIENT_PROFILE_UNAVAILABLE",
            f"対応する候補プロファイルがない原材料があります: {', '.join(unresolved)}",
            "原材料名を確認するか、対応カテゴリのプロファイル追加後に再実行してください。",
        )
    if len(candidate_sets) < 2:
        return _failed(
            payload,
            "INGREDIENTS_INSUFFICIENT",
            "配合を推計できる原材料候補が不足しています。",
            "パッケージの原材料表示を省略せず入力して再実行してください。",
        )

    scenarios = optimize(
        candidate_sets,
        request.known_nutrients,
        request.reference_mass_g,
        seed=seed,
        samples_per_combination=samples_per_combination,
    )
    if not scenarios:
        return _failed(
            payload,
            "CONSTRAINTS_INFEASIBLE",
            "原材料表示順と配合範囲を満たす配合を生成できませんでした。",
            "原材料の順序と製品基準重量を確認するか、モデル設定を見直してください。",
        )

    # 最良値に近い複数解だけで区間を作り、極端に適合しない配合の影響を避ける。
    best_error = scenarios[0].objective_error
    near = [item for item in scenarios if item.objective_error <= best_error + max(0.12, best_error * 0.75)]
    near = near[:250]
    known_count = sum(
        1
        for key in ("energyKcal", "proteinG", "fatG", "carbohydrateG", "saltG")
        if request.known_nutrients.get(key) is not None
    )
    ambiguous_names = [
        normalized[index].normalizedName
        for index, candidates in enumerate(candidate_sets)
        if len(candidates) > 1
    ]
    global_warnings = ["加工係数が未定義のため、未加工のモデルプロファイルで推計しました。"]
    if additive_names:
        global_warnings.append(
            "添加物は配合最適化から除外しました: " + ", ".join(additive_names)
        )
    estimates: dict[str, Any] = {}
    for nutrient in targets:
        values = [scenario.nutrients[nutrient] for scenario in near if nutrient in scenario.nutrients]
        if not values:
            continue
        low = _percentile(values, 0.10)
        median = _percentile(values, 0.50)
        high = _percentile(values, 0.90)
        relative_width = (high - low) / max(abs(median), 0.1)
        warnings: list[str] = []
        if ambiguous_names:
            warnings.append(
                f"{'、'.join(ambiguous_names)}の種類を特定できませんでした。"
            )
        if relative_width > 1.0:
            warnings.append("推計範囲が広いため、参考値として慎重に扱ってください。")
        if best_error > 0.35:
            warnings.append("公表済み栄養値との最適化誤差が大きい結果です。")
        estimates[nutrient] = {
            "value": median,
            "range": {"min": low, "max": high},
            "confidence": _confidence(near, known_count, bool(ambiguous_names), relative_width),
            "method": "ingredient_optimization",
            "warnings": warnings,
        }
    if not estimates:
        return _failed(
            payload,
            "NUTRIENT_PROFILE_UNAVAILABLE",
            "対象栄養素の候補値を算出できませんでした。",
            "原材料プロファイルに対象栄養素の根拠値を追加して再実行してください。",
        )

    digest = hashlib.sha256(
        "|".join(profile.profile_id for profile in scenarios[0].profiles).encode("utf-8")
    ).hexdigest()
    source_food_ids = sorted({
        source_id
        for scenario in near
        for profile in scenario.profiles
        for source_id in profile.source_food_ids
    })
    derivation_notes = sorted({
        note
        for scenario in near
        for profile in scenario.profiles
        for note in profile.derivation_notes
    })
    for nutrient, estimate_item in estimates.items():
        estimate_item["source"] = scenarios[0].profiles[0].source_version
        estimate_item["sourceFoodIds"] = source_food_ids
        if derivation_notes:
            estimate_item["warnings"].extend(derivation_notes)
        _apply_composition_upper_bound(nutrient, estimate_item, request)
    return {
        "requestId": request.request_id,
        "status": "completed" if len(estimates) == len(targets) else "partial",
        "inputHash": request.input_hash,
        "basis": {
            "baseAmount": request.base_amount,
            "baseUnit": request.base_unit,
            "referenceMassG": request.reference_mass_g,
            "referenceMassSource": request.reference_mass_source,
        },
        "normalizedIngredients": [item.to_dict() for item in normalized],
        "candidateTrace": {
            "selectedProfileSetHash": f"sha256:{digest}",
            "ambiguousIngredients": ambiguous_names,
            "sourceFoodIds": source_food_ids,
            "sourceVersion": scenarios[0].profiles[0].source_version,
            "derivationNotes": derivation_notes,
        },
        "estimates": estimates,
        "globalWarnings": global_warnings,
        "optimization": {
            "converged": True,
            "objectiveError": best_error,
            "scenarioCount": len(near),
            "seed": seed,
            "configSnapshot": {
                "orderConstraint": "strict",
                "samplesPerCombination": samples_per_combination,
                "rangePercentiles": [10, 90],
            },
        },
        "modelVersion": MODEL_VERSION,
        "estimatedAt": request.requested_at,
        "disclaimer": "参考推計には誤差と不確実性があります。医療上の判断には使用できません。",
    }
