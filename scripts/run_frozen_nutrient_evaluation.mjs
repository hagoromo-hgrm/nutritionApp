#!/usr/bin/env node
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const protocolPath = resolve(process.argv[2] ?? 'docs/analysis/nutrient_estimator_evaluation_freeze.json')
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'))
const temporary = mkdtempSync(join(tmpdir(), 'nutrient-heldout-runner-'))
try {
  // Audit both source trees before loading either estimator or reading label values.
  execFileSync('python3', ['scripts/audit_frozen_nutrient_evaluation.py', protocolPath], { cwd: repository, stdio: ['ignore', 'ignore', 'pipe'] })
  const runner = join(temporary, 'run.ts')
  writeFileSync(runner, `import { runFrozenEvaluation } from ${JSON.stringify(join(repository, 'scripts/evaluate_frozen_nutrient_estimator.ts'))}\nimport { estimateNutrients } from ${JSON.stringify(join(protocol.baselineRoot, 'src/services/nutrientEstimator.ts'))}\nawait runFrozenEvaluation(${JSON.stringify(protocolPath)}, estimateNutrients)\n`)
  execFileSync(join(repository, 'node_modules/.bin/vite-node'), [runner], { cwd: repository, stdio: 'inherit' })
} catch {
  process.stderr.write('Frozen held-out evaluation failed; individual label details are suppressed.\n')
  process.exitCode = 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
