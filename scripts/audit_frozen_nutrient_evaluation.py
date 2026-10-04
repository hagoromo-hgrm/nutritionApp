"""Read held-out labels only after byte-verified model/evaluator freeze."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
try:
    from .seal_nutrient_estimator_evaluation import normalize_and_validate, canonical_dataset
except ImportError:
    from seal_nutrient_estimator_evaluation import normalize_and_validate, canonical_dataset

def audit_frozen(protocol_path: Path) -> None:
    protocol = json.loads(protocol_path.read_text())
    current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if current != protocol['finalGitSha']:
        raise ValueError('frozen git SHA mismatch')
    for filename, expected in protocol['sourceHashes'].items():
        if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != expected:
            raise ValueError('frozen source bytes mismatch')
    for filename, expected in protocol['baselineSourceHashes'].items():
        if hashlib.sha256((Path(protocol['baselineRoot']) / filename).read_bytes()).hexdigest() != expected:
            raise ValueError('frozen baseline bytes mismatch')
    dataset_path, manifest_path = Path(protocol['datasetPath']), Path(protocol['manifestPath'])
    if hashlib.sha256(dataset_path.read_bytes()).hexdigest() != protocol['sealedSourceFileSha256']:
        raise ValueError('sealed bytes mismatch')
    dataset = json.loads(dataset_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    if not manifest.get('sealed') or not manifest.get('seal') or manifest['sourceFileSha256'] != protocol['sealedSourceFileSha256'] or manifest['normalizedDatasetSha256'] != protocol['sealedNormalizedDatasetSha256']:
        raise ValueError('sealed manifest flags or hashes mismatch')
    exclusions_path = Path(protocol['exclusionsPath'])
    if hashlib.sha256(exclusions_path.read_bytes()).hexdigest() != manifest['exclusionsFileSha256']:
        raise ValueError('sealed exclusions bytes mismatch')
    records, groups, _ = normalize_and_validate(dataset['records'], json.loads(exclusions_path.read_text()))
    if hashlib.sha256(canonical_dataset(records)).hexdigest() != protocol['sealedNormalizedDatasetSha256']:
        raise ValueError('sealed canonical hash mismatch')
    expected = [{'recordId': r['recordId'], 'genreId': r['genreId'], 'groupKey': g, 'split': 'test'} for r, g in zip(records, groups, strict=True)]
    if manifest['records'] != expected or manifest['recordCount'] != len(records):
        raise ValueError('held-out manifest bijection or split mismatch')
    # Training byte/canonical audit is independent of the held-out dataset hash.
    try:
        from .nutrient_estimator_integrity import _validate_integrity
    except ImportError:
        from nutrient_estimator_integrity import _validate_integrity
    training_path, training_manifest_path = Path(protocol['trainingPath']), Path(protocol['trainingManifestPath'])
    training_manifest = json.loads(training_manifest_path.read_text())
    _validate_integrity(json.loads(training_path.read_text()), training_manifest, training_path, training_manifest_path)
    prior_source = json.loads(Path(protocol['priorPath']).read_text())['source']
    if prior_source['datasetSha256'] != training_manifest['normalizedDatasetSha256'] or prior_source['manifestSha256'] != hashlib.sha256(training_manifest_path.read_bytes()).hexdigest():
        raise ValueError('training prior provenance differs from audited training manifest')

if __name__ == '__main__':
    try:
        audit_frozen(Path(sys.argv[1]))
    except Exception:
        raise SystemExit('frozen held-out integrity audit failed')
