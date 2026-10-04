import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.audit_frozen_nutrient_evaluation import audit_frozen
class FrozenAuditGuardTests(unittest.TestCase):
    def test_changed_model_is_rejected_before_heldout_label_file_is_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.ts'; source.write_text('changed')
            protocol = root / 'freeze.json'; protocol.write_text(json.dumps({'finalGitSha': 'fixture', 'sourceHashes': {str(source): hashlib.sha256(b'original').hexdigest()}, 'datasetPath': str(root / 'must-not-be-read.json')}))
            with patch('scripts.audit_frozen_nutrient_evaluation.subprocess.check_output', return_value='fixture'):
                with self.assertRaisesRegex(ValueError, 'source bytes'):
                    audit_frozen(protocol)
    def test_changed_git_sha_is_rejected_before_source_or_labels_are_read(self):
        with tempfile.TemporaryDirectory() as directory:
            protocol = Path(directory) / 'freeze.json'; protocol.write_text(json.dumps({'finalGitSha': 'fixture'}))
            with patch('scripts.audit_frozen_nutrient_evaluation.subprocess.check_output', return_value='changed'):
                with self.assertRaisesRegex(ValueError, 'git SHA'):
                    audit_frozen(protocol)

    def test_changed_baseline_is_rejected_before_heldout_labels_are_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'baseline.ts').write_text('changed')
            protocol = root / 'freeze.json'
            protocol.write_text(json.dumps({'finalGitSha': 'fixture', 'sourceHashes': {}, 'baselineRoot': str(root), 'baselineSourceHashes': {'baseline.ts': hashlib.sha256(b'original').hexdigest()}}))
            with patch('scripts.audit_frozen_nutrient_evaluation.subprocess.check_output', return_value='fixture'):
                with self.assertRaisesRegex(ValueError, 'baseline bytes'):
                    audit_frozen(protocol)
