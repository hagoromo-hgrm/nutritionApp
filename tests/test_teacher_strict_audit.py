import copy
import json
import tempfile
import unittest
from pathlib import Path
from scripts import build_spu_estimator_training as parser
from scripts.nutrient_estimator_integrity import AuditError, reviewed_teacher_status, _validate_integrity
from tests.test_nutrient_estimator_training_bias import record, write_inputs

class StrictTeacherAuditTests(unittest.TestCase):
    def test_signed_invalid_and_reversed_values_do_not_become_positive(self):
        for value in ('-1g', '1~-2g', '5~2g', 'NaNg', 'Infinityg', '1.2.3g', '<1g', '1mg'):
            with self.subTest(value=value):
                self.assertIsNone(parser.parse_nutrient('脂質 ' + value, 'fatG', '100g', False))
    def test_numbered_vitamin_labels_do_not_match_longer_numbers(self):
        text = 'ビタミンB1:0.40mg; ビタミンB12:0.80μg; ビタミンB2:0.12mg'
        self.assertEqual(parser.parse_nutrient(text, 'vitaminB1Mg', '50g')['value'], .4)
        self.assertEqual(parser.parse_nutrient(text, 'vitaminB2Mg', '50g')['value'], .12)
        self.assertIsNone(parser.parse_nutrient('ビタミンB12:0.80μg', 'vitaminB1Mg', '50g'))
        self.assertIsNone(parser.parse_nutrient('ビタミンB20:0.80mg', 'vitaminB2Mg', '50g'))
    def test_numbered_label_does_not_hide_a_real_conflicting_duplicate(self):
        text = 'ビタミンB1 0.4mg; ビタミンB12 0.8μg; ビタミンB1 0.5mg'
        self.assertIsNone(parser.parse_nutrient(text, 'vitaminB1Mg', '50g'))
    def test_duplicates_are_equal_or_rejected_not_last_wins(self):
        self.assertEqual(parser.parse_nutrient('脂質 1g; 脂質 1g', 'fatG', '100g')['value'], 1)
        self.assertIsNone(parser.parse_nutrient('脂質 1g; 脂質 2g', 'fatG', '100g'))
        self.assertIsNone(parser.parse_nutrient('脂質 1g; 脂質 -2g', 'fatG', '100g'))
    def test_per_item_annotations_do_not_mark_other_items_estimated(self):
        text = '脂質 1g; 食物繊維 2g; 食物繊維のみ推定値'
        self.assertEqual(parser.parse_nutrient(text, 'fatG', '100g')['valueKind'], 'fixed')
        self.assertEqual(parser.parse_nutrient(text, 'fiberG', '100g')['valueKind'], 'estimated')
    def test_local_item_note_is_per_nutrient(self):
        text = '脂質 1g; 食物繊維 2g(推定値)'
        self.assertEqual(parser.parse_nutrient(text, 'fatG', '100g')['valueKind'], 'fixed')
        self.assertEqual(parser.parse_nutrient(text, 'fiberG', '100g')['valueKind'], 'estimated')
    def test_panel_and_unresolved_annotations_are_excluded(self):
        for suffix in ('これらの値は目安', '※推定値'):
            self.assertEqual(parser.parse_nutrient('脂質 1g; ' + suffix, 'fatG', '100g')['valueKind'], 'estimated')
    def test_mixed_basis_is_detected_and_range_endpoints_are_preserved(self):
        self.assertTrue(parser.has_mixed_basis('100g当たり 脂質 1g; 1袋当たり 脂質 2g'))
        value = parser.parse_nutrient('カルシウム 2.00~5.0mg', 'calciumMg', '100g')
        self.assertEqual((value['rangeMin'], value['rangeMax'], value['decimalPlaces'], value['value']), (2, 5, 2, None))
    def test_source_integrity_and_review_gates_are_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            training_path, manifest_path, _ = write_inputs(root, [record('review', 'family')])
            training = json.loads(training_path.read_text())
            manifest = json.loads(manifest_path.read_text())
            _validate_integrity(training, manifest, training_path, manifest_path)
            self.assertEqual(reviewed_teacher_status(None, training, manifest)['teacherAuditStatus'], 'legacy_unreviewed')
            with self.assertRaises(AuditError):
                reviewed_teacher_status(None, training, manifest, require_strict=True)
            item = training['records'][0]
            review = {'format': 'nutrition-estimator-teacher-review', 'formatVersion': 1,
                'sourceFileSha256': manifest['sourceFileSha256'], 'normalizedDatasetSha256': manifest['normalizedDatasetSha256'],
                'records': [{'recordId': 'review', 'canonicalFamilyId': 'reviewed-family', 'status': 'reviewed', 'reviewer': 'synthetic reviewer', 'reviewedAt': '2026-10-04T00:00:00Z', 'rationale': 'synthetic provenance',
                    'labels': {key: {'status': 'reviewed', 'annotationScope': 'none', 'sourceType': 'manufacturer', 'sourceReference': 'synthetic source', 'basis': {'amount': item['referenceMassG'], 'unit': 'g'}, 'stateConfirmed': True} for key in item['nutrients']}}]}
            self.assertEqual(reviewed_teacher_status(review, training, manifest, require_strict=True)['teacherAuditStatus'], 'strict_reviewed')
            stale = copy.deepcopy(review); stale['sourceFileSha256'] = '0' * 64
            with self.assertRaises(AuditError): reviewed_teacher_status(stale, training, manifest)
            duplicate = copy.deepcopy(review); duplicate['records'] *= 2
            with self.assertRaises(AuditError): reviewed_teacher_status(duplicate, training, manifest)
            unknown = copy.deepcopy(review); unknown['records'][0]['labels'][next(iter(item['nutrients']))]['annotationScope'] = 'unresolved'
            with self.assertRaises(AuditError): reviewed_teacher_status(unknown, training, manifest, require_strict=True)
    def test_reviewed_alias_family_cannot_cross_splits(self):
        training = {'records': [{'recordId': x, 'nutrients': {}, 'referenceMassG': 100} for x in ['a', 'b']]}
        manifest = {'sourceFileSha256': 'a' * 64, 'normalizedDatasetSha256': 'b' * 64, 'records': [{'recordId': 'a', 'split': 'train'}, {'recordId': 'b', 'split': 'test'}]}
        review = {'format': 'nutrition-estimator-teacher-review', 'formatVersion': 1, **{k: manifest[k] for k in ['sourceFileSha256', 'normalizedDatasetSha256']}, 'records': [{'recordId': x, 'canonicalFamilyId': 'same-review-family'} for x in ['a', 'b']]}
        with self.assertRaises(AuditError): reviewed_teacher_status(review, training, manifest)
