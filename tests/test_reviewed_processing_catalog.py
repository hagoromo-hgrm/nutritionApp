import hashlib
import io
import csv
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import build_reviewed_processing_catalog as catalog  # noqa: E402


def retention_csv_bytes(*, mutate_rows=None):
    rows = []
    expected_percentages = {
        '0105': [100, 100, 100, 80, 85, 95],
        '2151': [100, 100, 100, 85, 90, 100],
        '3004': [95, 95, 95, 60, 85, 95],
        '3005': [95, 95, 95, 55, 80, 90],
    }
    for code, (description, group) in catalog.PROCESS_CODES.items():
        raw_code = '105' if code == '0105' else code
        for nutrient_no, percentage in zip(catalog.RF_NUTRIENTS, expected_percentages[code]):
            _, nutrient_description, _ = catalog.RF_NUTRIENTS[nutrient_no]
            rows.append({
                'Retn_Code': raw_code,
                'FdGrp_CD': group,
                'RetnDesc': description,
                'Nutr_No': nutrient_no,
                'NutrDesc': nutrient_description,
                'Retn_Factor': str(percentage),
                'Date': 'Sep-75',
            })
    if mutate_rows is not None:
        rows = mutate_rows(rows)
    header = ['Retn_Code', 'FdGrp_CD', 'RetnDesc', 'Nutr_No', 'NutrDesc', 'Retn_Factor', 'Date']
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=header, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode('utf-8')


def mext_source_bytes(*, mutate=None):
    foods = []
    for food_id in ('mext_13003', 'mext_12004', 'mext_12005'):
        nutrients = {key: 1.0 for key in catalog.NUTRIENT_KEYS}
        if food_id == 'mext_13003':
            nutrients['ironMg'] = 0.02
        food = {
            'id': food_id,
            'officialName': f'公式名 {food_id}',
            'name': food_id,
            'source': 'mext',
            'sourceVersion': catalog.MEXT_VERSION,
            'baseAmount': 100.0,
            'baseUnit': 'g',
            'nutrients': nutrients,
        }
        foods.append(food)
    document = {
        'metadata': {
            'sourceVersion': catalog.MEXT_VERSION,
            'sourceUrl': catalog.MEXT_SOURCE_URL,
            'acquiredDate': catalog.MEXT_ACQUIRED_DATE,
            'processedAt': '2026-07-23T11:52:55.779067Z',
            'script': 'scripts/convert_food_data.py',
        },
        'foods': foods,
    }
    if mutate is not None:
        mutate(document)
    return json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class RetentionCatalogTests(unittest.TestCase):
    def parse_synthetic(self, raw):
        return catalog.parse_retention_csv(raw, expected_sha256=hashlib.sha256(raw).hexdigest())

    def test_builds_four_codes_and_twenty_four_percent_and_factor_rows(self):
        artifact = self.parse_synthetic(retention_csv_bytes())
        self.assertEqual(artifact['source']['version'], 'USDA RF6 (2007)')
        self.assertEqual(artifact['source']['factorConversion'], 'retentionPercent / 100 exactly once')
        self.assertEqual([item['code'] for item in artifact['processes']], ['0105', '2151', '3004', '3005'])
        self.assertEqual(sum(len(item['factors']) for item in artifact['processes']), 24)
        egg = artifact['processes'][0]
        self.assertEqual(egg['officialDescription'], 'EGGS,HARD COOKED')
        self.assertEqual(egg['sourceDate'], 'Sep-75')
        self.assertEqual(egg['factors'][3]['retentionPercent'], 80)
        self.assertEqual(egg['factors'][3]['factor'], 0.8)
        self.assertEqual(egg['factors'][3]['nutrientNo'], '401')

    def test_ignores_unrelated_source_rows_without_widening_export(self):
        def add_unrelated(rows):
            rows.append({
                'Retn_Code': '9999', 'FdGrp_CD': '99', 'RetnDesc': 'UNRELATED',
                'Nutr_No': '999', 'NutrDesc': 'Unrelated', 'Retn_Factor': '50', 'Date': 'Jan-00',
            })
            return rows

        artifact = self.parse_synthetic(retention_csv_bytes(mutate_rows=add_unrelated))
        self.assertEqual(len(artifact['processes']), 4)
        self.assertEqual(sum(len(item['factors']) for item in artifact['processes']), 24)

    def test_rejects_mismatched_source_hash(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            catalog.parse_retention_csv(retention_csv_bytes(), expected_sha256='0' * 64)

    def test_rejects_missing_selected_factor(self):
        def remove_row(rows):
            return [row for row in rows if not (row['Retn_Code'] == '105' and row['Nutr_No'] == '303')]

        raw = retention_csv_bytes(mutate_rows=remove_row)
        with self.assertRaisesRegex(ValueError, 'missing selected rows'):
            self.parse_synthetic(raw)

    def test_rejects_duplicate_selected_factor(self):
        def duplicate(rows):
            rows.append(dict(rows[0]))
            return rows

        with self.assertRaisesRegex(ValueError, 'Duplicate USDA RF6 row'):
            self.parse_synthetic(retention_csv_bytes(mutate_rows=duplicate))

    def test_rejects_unknown_description_for_selected_process(self):
        def change_description(rows):
            rows[0]['RetnDesc'] = 'EGGS, UNKNOWN METHOD'
            return rows

        with self.assertRaisesRegex(ValueError, 'Unexpected USDA process description'):
            self.parse_synthetic(retention_csv_bytes(mutate_rows=change_description))

    def test_rejects_negative_and_nonfinite_selected_percentages(self):
        for percentage in ('-1', 'nan', 'inf'):
            with self.subTest(percentage=percentage):
                def change_factor(rows):
                    rows[0]['Retn_Factor'] = percentage
                    return rows

                with self.assertRaisesRegex(ValueError, 'finite and in 0..100'):
                    self.parse_synthetic(retention_csv_bytes(mutate_rows=change_factor))


class ReviewedMextProfilesTests(unittest.TestCase):
    def build_synthetic(self, raw):
        return catalog.build_profiles(raw, expected_sha256=hashlib.sha256(raw).hexdigest())

    def test_generates_three_pinned_profiles_and_localized_milk_iron_override(self):
        raw = mext_source_bytes()
        artifact = self.build_synthetic(raw)
        self.assertEqual(artifact['source']['sourceDataSha256'], hashlib.sha256(raw).hexdigest())
        profiles = {item['sourceFoodId']: item for item in artifact['profiles']}
        self.assertEqual(set(profiles), {'mext_13003', 'mext_12004', 'mext_12005'})
        self.assertEqual(len(profiles['mext_13003']['nutrients']), 14)
        self.assertEqual(profiles['mext_13003']['canonicalName'], '公式名 mext_13003')
        self.assertEqual(profiles['mext_13003']['nutrients']['ironMg'], 0)
        self.assertEqual(profiles['mext_13003']['reviewedOverrides']['ironMg']['fromValue'], 0.02)
        self.assertEqual(profiles['mext_13003']['reviewedOverrides']['ironMg']['toValue'], 0.0)
        self.assertNotIn('reviewedOverrides', profiles['mext_12004'])
        self.assertNotIn('reviewedOverrides', profiles['mext_12005'])
        self.assertEqual(
            catalog._js_fingerprint(
                'processing_mext_13003_v1',
                ['mext_13003'],
                {**{key: 1 for key in catalog.NUTRIENT_KEYS}, 'ironMg': 0},
            ),
            'fnv1a64:ecc927637176a349',
        )
        self.assertRegex(profiles['mext_13003']['nutrientFingerprint'], r'^fnv1a64:[0-9a-f]{16}$')
        self.assertEqual(json.loads(raw)['foods'][0]['nutrients']['ironMg'], 0.02)

    def test_rejects_mismatched_mext_source_hash(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            catalog.build_profiles(mext_source_bytes(), expected_sha256='f' * 64)

    def test_rejects_wrong_source_version_and_missing_nutrient(self):
        def wrong_version(document):
            document['metadata']['sourceVersion'] = 'other'

        with self.assertRaisesRegex(ValueError, 'source version'):
            self.build_synthetic(mext_source_bytes(mutate=wrong_version))

        def wrong_url(document):
            document['metadata']['sourceUrl'] = 'https://invalid.example/'

        with self.assertRaisesRegex(ValueError, 'source URL or acquisition date'):
            self.build_synthetic(mext_source_bytes(mutate=wrong_url))

        def missing_nutrient(document):
            del document['foods'][1]['nutrients']['calciumMg']

        with self.assertRaisesRegex(ValueError, 'exactly the 14 nutrient keys'):
            self.build_synthetic(mext_source_bytes(mutate=missing_nutrient))

    def test_rejects_negative_and_nonfinite_mext_nutrient_values(self):
        for invalid in (-0.1, float('nan'), float('inf')):
            with self.subTest(invalid=invalid):
                def bad_nutrient(document):
                    document['foods'][0]['nutrients']['ironMg'] = invalid

                raw = json.dumps(
                    (lambda doc: (bad_nutrient(doc), doc)[1])(
                        json.loads(mext_source_bytes())
                    ),
                    ensure_ascii=False,
                    separators=(',', ':'),
                    allow_nan=True,
                ).encode('utf-8')
                with self.assertRaises(ValueError):
                    self.build_synthetic(raw)


if __name__ == '__main__':
    unittest.main()
