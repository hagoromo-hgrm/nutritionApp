#!/usr/bin/env python3
"""Build pinned USDA RF6 and reviewed MEXT processing artifacts.

Only the selected RF6 rows and three explicitly reviewed MEXT entries are
exported. Source files are verified by their locked SHA-256 before use.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RETENTION_CSV = Path('/tmp/nutrition-usda-rf6-20261004.csv')
MEXT_INPUT = ROOT / 'data/mext/processed/mext_foods.json'
RETENTION_OUTPUT = ROOT / 'data/estimator/usda_retention_factors.json'
PROFILES_OUTPUT = ROOT / 'data/estimator/reviewed_processing_profiles.json'

RETENTION_CSV_SHA256 = 'b863e891989020edf3a429af8060523e5dee275699ae08893a5f91ff9a84b1e5'
MEXT_DATA_SHA256 = 'af5d1e9c623c3a23bdf29f471df65d2e324988dce3f9c8cf62e9795f15c819ea'
MEXT_VERSION = '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）'
MEXT_SOURCE_URL = 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html'
MEXT_ACQUIRED_DATE = '2026-07-22'

RETENTION_TRANSFORM_VERSION = 'reviewed-usda-rf6-2026-10-04-v1'
PROFILE_TRANSFORM_VERSION = 'reviewed-mext-processing-profiles-2026-10-04-v1'
ACQUIRED_DATE = '2026-10-04'

USDA_RF6_PDF_URL = 'https://www.ars.usda.gov/ARSUserFiles/80400535/Data/retn/retn06.pdf'
USDA_RF6_CSV_URL = 'https://ndownloader.figshare.com/files/44488754'
USDA_RF6_DATASET_URL = 'https://agdatacommons.nal.usda.gov/articles/dataset/USDA_Table_of_Nutrient_Retention_Factors_Release_6_2007_/24660888'
USDA_RF6_DOI = '10.15482/USDA.ADC/1409034'
CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'

NUTRIENT_KEYS = (
    'energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'fiberG',
    'calciumMg', 'ironMg', 'vitaminAMcg', 'vitaminEMg', 'vitaminB1Mg',
    'vitaminB2Mg', 'vitaminCMg', 'saturatedFatG', 'saltG',
)

RF_NUTRIENTS: dict[str, tuple[str, str, str]] = {
    '301': ('calciumMg', 'Calcium, Ca', 'calcium'),
    '303': ('ironMg', 'Iron, Fe', 'iron'),
    # USDA reports sodium; the app key is salt-equivalent from sodium.
    '307': ('saltG', 'Sodium, Na', 'sodium_to_salt_equivalent'),
    '401': ('vitaminCMg', 'Vitamin C, total ascorbic acid', 'vitamin_c'),
    '404': ('vitaminB1Mg', 'Thiamin', 'thiamin'),
    '405': ('vitaminB2Mg', 'Riboflavin', 'riboflavin'),
}

PROCESS_CODES: dict[str, tuple[str, str]] = {
    '0105': ('EGGS,HARD COOKED', '1'),
    '2151': ('MILK,HEATED APPROX 10MIN', '1'),
    '3004': ('VEG,GREENS,BOILD,LITTLE WATER DRAIN', '11'),
    '3005': ('VEG,GREENS,BOILED,WATER COVER DRAIN', '11'),
}

MEXT_PROFILES: tuple[dict[str, Any], ...] = (
    {
        'profileId': 'processing_mext_13003_v1',
        'foodId': 'mext_13003',
        'stateId': 'mext_13003:listed-state-v1',
        'officialSourceUrl': 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=13_13003_7',
    },
    {
        'profileId': 'processing_mext_12004_v1',
        'foodId': 'mext_12004',
        'stateId': 'mext_12004:listed-raw-state-v1',
        'officialSourceUrl': 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=12_12004_7',
    },
    {
        'profileId': 'processing_mext_12005_v1',
        'foodId': 'mext_12005',
        'stateId': 'mext_12005:listed-boiled-state-v1',
        'officialSourceUrl': 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=12_12005_7',
    },
)

MILK_IRON_OVERRIDE = {
    'nutrientKey': 'ironMg',
    'fromValue': 0.02,
    'toValue': 0.0,
    'reason': 'MEXT食品成分DB 13003_7の掲載値は鉄0 mg/100g。処理済み生成データの0.02との差を、レビュー済み加工プロファイルだけで補正する。通常食品マスターと汎用プロファイルは変更しない。',
    'sourceUrl': 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=13_13003_7',
    'pageAcquiredDate': '2026-10-04',
    'pageSha256': '2dbcff6a49011deddace66c46f58c4e5c32c3bbebe29266a42140d4d028cdf90',
}


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def _js_fingerprint(profile_id: str, source_food_ids: list[str], nutrients: dict[str, int | float | None]) -> str:
    """Match the TS FNV-1a64 stable fingerprint over JS UTF-16 code units."""
    pairs: list[list[Any]] = []
    for key in NUTRIENT_KEYS:
        value = nutrients[key]
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        pairs.append([key, value])
    canonical = _canonical_json({
        'profileId': profile_id,
        'sourceFoodIds': source_food_ids,
        'nutrients': pairs,
    })
    encoded = canonical.encode('utf-16-le')
    hash_value = 0xCBF29CE484222325
    mask = 0xFFFFFFFFFFFFFFFF
    for index in range(0, len(encoded), 2):
        code_unit = encoded[index] | (encoded[index + 1] << 8)
        hash_value ^= code_unit
        hash_value = (hash_value * 0x100000001B3) & mask
    return f'fnv1a64:{hash_value:016x}'


def parse_retention_csv(csv_bytes: bytes, expected_sha256: str = RETENTION_CSV_SHA256) -> dict[str, Any]:
    actual_sha = _sha256(csv_bytes)
    if actual_sha != expected_sha256:
        raise ValueError(f'USDA RF6 CSV SHA-256 mismatch: expected {expected_sha256}, got {actual_sha}')
    try:
        text = csv_bytes.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise ValueError('USDA RF6 CSV must be UTF-8 encoded') from error
    reader = csv.DictReader(text.splitlines())
    required = {'Retn_Code', 'FdGrp_CD', 'RetnDesc', 'Nutr_No', 'NutrDesc', 'Retn_Factor', 'Date'}
    if reader.fieldnames is None or not required.issubset(reader.fieldnames):
        raise ValueError('USDA RF6 CSV is missing required columns')

    selected: dict[tuple[str, str], dict[str, Any]] = {}
    for line_number, row in enumerate(reader, start=2):
        if not row or row.get('Retn_Code') is None or row.get('Nutr_No') is None:
            continue
        raw_code = row['Retn_Code'].strip()
        if not raw_code.isdigit():
            continue
        code = raw_code.zfill(4)
        nutrient_no = row['Nutr_No'].strip()
        if code not in PROCESS_CODES or nutrient_no not in RF_NUTRIENTS:
            continue
        description, expected_group = PROCESS_CODES[code]
        if row['RetnDesc'].strip() != description:
            raise ValueError(f'Unexpected USDA process description for {code} at CSV line {line_number}')
        if row['FdGrp_CD'].strip() != expected_group:
            raise ValueError(f'Unexpected USDA food-group code for {code} at CSV line {line_number}')
        nutrient_key, expected_nutrient_desc, _ = RF_NUTRIENTS[nutrient_no]
        if row['NutrDesc'].strip() != expected_nutrient_desc:
            raise ValueError(f'Unexpected USDA nutrient description for {nutrient_no} at CSV line {line_number}')
        try:
            percent = float(row['Retn_Factor'])
        except (TypeError, ValueError) as error:
            raise ValueError(f'Invalid USDA retention percentage at CSV line {line_number}') from error
        if not math.isfinite(percent) or percent < 0 or percent > 100:
            raise ValueError(f'USDA retention percentage must be finite and in 0..100 at CSV line {line_number}')
        date = row['Date'].strip()
        if not date:
            raise ValueError(f'Missing USDA row date at CSV line {line_number}')
        identity = (code, nutrient_no)
        if identity in selected:
            raise ValueError(f'Duplicate USDA RF6 row for process {code}, nutrient {nutrient_no}')
        selected[identity] = {
            'nutrientNo': nutrient_no,
            'nutrientKey': nutrient_key,
            'nutrientDescription': expected_nutrient_desc,
            'retentionPercent': int(percent) if percent.is_integer() else percent,
            'factor': percent / 100,
            'sourceDate': date,
        }

    expected_pairs = {(code, nutrient_no) for code in PROCESS_CODES for nutrient_no in RF_NUTRIENTS}
    missing = sorted(expected_pairs - selected.keys())
    if missing:
        raise ValueError(f'USDA RF6 CSV is missing selected rows: {missing}')

    process_rows = []
    for code, (description, group_code) in PROCESS_CODES.items():
        rows = [selected[(code, nutrient_no)] for nutrient_no in RF_NUTRIENTS]
        dates = {row['sourceDate'] for row in rows}
        if len(dates) != 1:
            raise ValueError(f'USDA RF6 rows for {code} have inconsistent source dates')
        process_rows.append({
            'code': code,
            'rawFoodGroupCode': group_code,
            'officialDescription': description,
            'sourceDate': next(iter(dates)),
            'factors': rows,
        })

    return {
        'schemaVersion': 1,
        'source': {
            'title': 'USDA Table of Nutrient Retention Factors, Release 6 (2007)',
            'version': 'USDA RF6 (2007)',
            'release': '6',
            'publicationDate': '2007-12',
            'officialSourceUrl': USDA_RF6_PDF_URL,
            'csvSourceUrl': USDA_RF6_CSV_URL,
            'datasetUrl': USDA_RF6_DATASET_URL,
            'doi': USDA_RF6_DOI,
            'license': 'CC0 1.0 Universal',
            'licenseUrl': CC0_URL,
            'acquiredDate': ACQUIRED_DATE,
            'processedDate': ACQUIRED_DATE,
            'sourceDataSha256': actual_sha,
            'transformVersion': RETENTION_TRANSFORM_VERSION,
            'rawFoodGroupCodeField': 'FdGrp_CD (source CSV ordinal retained verbatim; not interpreted as the PDF group number)',
            'processCodeTransform': 'numeric source Retn_Code normalized to four-character code with leading zero retained',
            'factorConversion': 'retentionPercent / 100 exactly once',
            'saltMapping': 'USDA sodium retention factor mapped to salt-equivalent key; only usable when sodium transfer is confirmed absent.',
        },
        'processes': process_rows,
    }


def build_profiles(mext_bytes: bytes, expected_sha256: str = MEXT_DATA_SHA256) -> dict[str, Any]:
    actual_sha = _sha256(mext_bytes)
    if actual_sha != expected_sha256:
        raise ValueError(f'MEXT processed data SHA-256 mismatch: expected {expected_sha256}, got {actual_sha}')
    try:
        document = json.loads(mext_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('MEXT processed source must be valid UTF-8 JSON') from error
    metadata = document.get('metadata')
    foods = document.get('foods')
    if not isinstance(metadata, dict) or not isinstance(foods, list):
        raise ValueError('MEXT processed source structure is invalid')
    if metadata.get('sourceVersion') != MEXT_VERSION:
        raise ValueError('MEXT source version does not match the reviewed version')
    if metadata.get('sourceUrl') != MEXT_SOURCE_URL or metadata.get('acquiredDate') != MEXT_ACQUIRED_DATE:
        raise ValueError('MEXT source URL or acquisition date does not match the reviewed source')
    if metadata.get('script') != 'scripts/convert_food_data.py' or not isinstance(metadata.get('processedAt'), str):
        raise ValueError('MEXT processed-source transform metadata is missing')
    transform_script = ROOT / metadata['script']
    if not transform_script.is_file():
        raise ValueError('MEXT processed-source transform script is missing')

    by_id: dict[str, dict[str, Any]] = {}
    for food in foods:
        if isinstance(food, dict) and isinstance(food.get('id'), str):
            if food['id'] in by_id:
                raise ValueError(f'Duplicate MEXT food id: {food["id"]}')
            by_id[food['id']] = food

    profiles = []
    for definition in MEXT_PROFILES:
        food_id = definition['foodId']
        food = by_id.get(food_id)
        if food is None:
            raise ValueError(f'MEXT source is missing reviewed food {food_id}')
        if food.get('source') != 'mext' or food.get('sourceVersion') != MEXT_VERSION:
            raise ValueError(f'MEXT source metadata mismatch for {food_id}')
        if food.get('baseAmount') != 100 or food.get('baseUnit') != 'g':
            raise ValueError(f'MEXT food {food_id} is not on the reviewed 100 g basis')
        nutrients_raw = food.get('nutrients')
        if not isinstance(nutrients_raw, dict) or set(nutrients_raw) != set(NUTRIENT_KEYS):
            raise ValueError(f'MEXT food {food_id} must have exactly the 14 nutrient keys')
        nutrients: dict[str, int | float | None] = {}
        for key in NUTRIENT_KEYS:
            value = nutrients_raw[key]
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value < 0
            ):
                raise ValueError(f'MEXT nutrient {food_id}/{key} must be null or a finite nonnegative number')
            nutrients[key] = value

        override = None
        if food_id == 'mext_13003':
            if nutrients['ironMg'] != MILK_IRON_OVERRIDE['fromValue']:
                raise ValueError('MEXT milk iron input no longer matches the reviewed override source value')
            nutrients['ironMg'] = MILK_IRON_OVERRIDE['toValue']
            override = {
                'ironMg': {
                    'fromValue': MILK_IRON_OVERRIDE['fromValue'],
                    'toValue': MILK_IRON_OVERRIDE['toValue'],
                    'reason': MILK_IRON_OVERRIDE['reason'],
                    'sourceUrl': MILK_IRON_OVERRIDE['sourceUrl'],
                    'pageAcquiredDate': MILK_IRON_OVERRIDE['pageAcquiredDate'],
                    'pageSha256': MILK_IRON_OVERRIDE['pageSha256'],
                },
            }
        source_food_ids = [food_id]
        profile = {
            'profileId': definition['profileId'],
            'canonicalName': food.get('officialName'),
            'nutrients': nutrients,
            'sourceFoodIds': source_food_ids,
            'stateId': definition['stateId'],
            'sourceFoodId': food_id,
            'sourceVersion': MEXT_VERSION,
            'officialSourceUrl': definition['officialSourceUrl'],
            'sourceDataSha256': actual_sha,
            'nutrientFingerprint': _js_fingerprint(definition['profileId'], source_food_ids, nutrients),
        }
        if not isinstance(profile['canonicalName'], str) or not profile['canonicalName']:
            raise ValueError(f'MEXT food {food_id} is missing its official name')
        if override is not None:
            profile['reviewedOverrides'] = override
        profiles.append(profile)

    return {
        'schemaVersion': 1,
        'source': {
            'version': MEXT_VERSION,
            'officialSourceUrl': MEXT_SOURCE_URL,
            'sourceDataSha256': actual_sha,
            'acquiredDate': MEXT_ACQUIRED_DATE,
            'processedDate': ACQUIRED_DATE,
            'processedSourceSha256': actual_sha,
            'processedSourcePath': 'data/mext/processed/mext_foods.json',
            'processedSourceAt': metadata['processedAt'],
            'sourceTransform': {
                'script': metadata['script'],
                'scriptSha256': _sha256(transform_script.read_bytes()),
            },
            'transformVersion': PROFILE_TRANSFORM_VERSION,
            'acquiredDateForOverridePage': MILK_IRON_OVERRIDE['pageAcquiredDate'],
        },
        'profiles': profiles,
    }


def _write_or_check(path: Path, value: Any, check: bool) -> None:
    serialized = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if check:
        if not path.is_file() or path.read_text(encoding='utf-8') != serialized:
            raise ValueError(f'Generated artifact differs from checked-in file: {path.relative_to(ROOT)}')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(serialized, encoding='utf-8')


def build_artifacts(retention_bytes: bytes, mext_bytes: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    return parse_retention_csv(retention_bytes), build_profiles(mext_bytes)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retention-csv', type=Path, default=DEFAULT_RETENTION_CSV)
    parser.add_argument('--mext-json', type=Path, default=MEXT_INPUT)
    parser.add_argument('--check', action='store_true', help='fail if generated artifacts differ; do not write')
    args = parser.parse_args(argv)
    retention_bytes = args.retention_csv.read_bytes()
    mext_bytes = args.mext_json.read_bytes()
    retention, profiles = build_artifacts(retention_bytes, mext_bytes)
    _write_or_check(RETENTION_OUTPUT, retention, args.check)
    _write_or_check(PROFILES_OUTPUT, profiles, args.check)
    action = 'verified' if args.check else 'wrote'
    print(f'{action} {len(retention["processes"])} RF6 processes / {sum(len(row["factors"]) for row in retention["processes"])} factors')
    print(f'{action} {len(profiles["profiles"])} reviewed MEXT profiles')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
