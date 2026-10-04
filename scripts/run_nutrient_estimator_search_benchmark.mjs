#!/usr/bin/env node
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'nutrient-search-benchmark-'))
try {
  const runner = join(temporary, 'run.ts')
  writeFileSync(runner, `import { runSearchBenchmark } from ${JSON.stringify(join(root, 'scripts/benchmark_nutrient_estimator_search.ts'))}\nawait runSearchBenchmark()\n`)
  execFileSync(join(root, 'node_modules/.bin/vite-node'), [runner], { cwd: root, stdio: 'inherit' })
} catch (error) {
  process.exitCode = typeof error.status === 'number' ? error.status : 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
