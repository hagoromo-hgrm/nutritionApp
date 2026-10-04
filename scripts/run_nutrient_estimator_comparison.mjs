#!/usr/bin/env node
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// vite-node removes process.argv, so pass the original CLI arguments explicitly.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'nutrient-comparison-runner-'))
try {
  const runner = join(temporary, 'run.ts')
  const modulePath = join(repository, 'scripts/compare_nutrient_estimator_fit.ts')
  writeFileSync(runner, `import { runComparisonCli } from ${JSON.stringify(modulePath)}\nawait runComparisonCli(${JSON.stringify(process.argv.slice(2))})\n`)
  execFileSync(join(repository, 'node_modules/.bin/vite-node'), [runner], { cwd: repository, stdio: 'inherit' })
} catch (error) {
  process.exitCode = typeof error.status === 'number' ? error.status : 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
