#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertApprovedPriorDataset,
  buildFitComparison,
  buildRatioStrategyComparison,
  markdownReport,
} from './lib/nutrientEstimatorComparison'

interface CliOptions {
  training: string
  manifest: string
  outputJson: string
  outputMarkdown: string
  comparison: 'fit' | 'ratio'
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON_AUDIT = join(REPO_ROOT, 'scripts', 'audit_nutrient_estimator_training_bias.py')
const PUBLIC_SEALED_COLLECTION = join(REPO_ROOT, 'docs', 'analysis', 'nutrient_estimator_sealed_collection.json')

function parseArgs(args: readonly string[]): CliOptions {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--') || options.has(name)) {
      throw new Error('必須引数 --training、--manifest、--output-json、--output-markdown を指定してください。')
    }
    options.set(name, value)
  }
  const training = options.get('--training')
  const manifest = options.get('--manifest')
  const outputJson = options.get('--output-json')
  const outputMarkdown = options.get('--output-markdown')
  if (!training || !manifest || !outputJson || !outputMarkdown || (options.size !== 4 && options.size !== 5)) {
    throw new Error('必須引数 --training、--manifest、--output-json、--output-markdown を指定してください。')
  }
  const comparison = options.get('--comparison') ?? 'fit'
  if (!['fit', 'ratio'].includes(comparison) || [...options.keys()].some((key) => !['--training', '--manifest', '--output-json', '--output-markdown', '--comparison'].includes(key))) throw new Error('comparison must be fit or ratio')
  return { training, manifest, outputJson, outputMarkdown, comparison: comparison as 'fit' | 'ratio' }
}

function rejectSealedInput(path: string): void {
  if (resolve(path).split(/[\\/]+/).includes('sealed_20261003')) {
    throw new Error('sealed evaluation inputs are not accepted')
  }
}

async function canonicalOutputPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    const parent = dirname(path)
    if (parent === path) return resolve(path)
    return join(await canonicalOutputPath(parent), basename(path))
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    throw new Error('教師データまたはマニフェストをJSONとして読み込めません。')
  }
}

async function verifyWithPythonAudit(training: string, manifest: string): Promise<Record<string, unknown>> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nutrient-fit-audit-'))
  const auditOutput = join(temporaryDirectory, 'integrity.json')
  try {
    execFileSync('python3', [
      PYTHON_AUDIT,
      training,
      '--manifest', manifest,
      '--sealed-collection', PUBLIC_SEALED_COLLECTION,
      '--output', auditOutput,
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
    const audit = await readJson(auditOutput)
    if (
      typeof audit !== 'object'
      || audit === null
      || Array.isArray(audit)
      || typeof (audit as { source?: unknown }).source !== 'object'
      || (audit as { source?: unknown }).source === null
    ) {
      throw new Error('integrity report shape mismatch')
    }
    return (audit as { source: Record<string, unknown> }).source
  } catch {
    throw new Error('Python integrity audit failed; calibration comparison was stopped.')
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function runComparisonCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  const trainingPath = isAbsolute(options.training) ? options.training : resolve(process.cwd(), options.training)
  const manifestPath = isAbsolute(options.manifest) ? options.manifest : resolve(process.cwd(), options.manifest)
  const outputJson = isAbsolute(options.outputJson) ? options.outputJson : resolve(process.cwd(), options.outputJson)
  const outputMarkdown = isAbsolute(options.outputMarkdown) ? options.outputMarkdown : resolve(process.cwd(), options.outputMarkdown)
  rejectSealedInput(trainingPath)
  rejectSealedInput(manifestPath)
  rejectSealedInput(outputJson)
  rejectSealedInput(outputMarkdown)
  const [training, manifest] = await Promise.all([realpath(trainingPath), realpath(manifestPath)])
  rejectSealedInput(training)
  rejectSealedInput(manifest)
  const [safeOutputJson, safeOutputMarkdown] = await Promise.all([
    canonicalOutputPath(outputJson),
    canonicalOutputPath(outputMarkdown),
  ])
  rejectSealedInput(safeOutputJson)
  rejectSealedInput(safeOutputMarkdown)
  if (
    new Set([training, manifest]).has(safeOutputJson)
    || new Set([training, manifest]).has(safeOutputMarkdown)
    || safeOutputJson === safeOutputMarkdown
  ) {
    throw new Error('レポート出力先は入力ファイルと別のパスにしてください。')
  }

  const manifestValue = await readJson(manifest)
  // Reject unapproved/new teacher inputs before integrity audit or calibration evaluation.
  assertApprovedPriorDataset(manifestValue)
  const sourceHashes = await verifyWithPythonAudit(training, manifest)
  const datasetValue = await readJson(training)
  const report = options.comparison === 'ratio' ? buildRatioStrategyComparison(datasetValue, manifestValue, sourceHashes) : buildFitComparison(datasetValue, manifestValue, sourceHashes)
  const markdown = options.comparison === 'ratio' ? `# 飽和脂肪酸補正戦略の校正比較\n\n対象: calibrationのみ、${report.calibrationRecordCount}商品。24戦略を各対象栄養素ごとに比較した。結果の全項目・方式別・ジャンル別集計は同名JSONに保存する。対象ラベル自身、推定値、未確認値はfitへ渡さず、封印ラベルは参照していない。\n\n既定feedback=0 / postBlend=.75を維持する。系列・メーカー条件と全栄養素の非退行を満たす代替戦略がない。部分値やジャンル補完の成績から全原材料推計の精度を保証しない。表の区間外誤差は参照区間への距離で、真値の誤差や真値包含率ではない。\n` : markdownReport(report as ReturnType<typeof buildFitComparison>)
  await Promise.all([
    mkdir(dirname(safeOutputJson), { recursive: true }),
    mkdir(dirname(safeOutputMarkdown), { recursive: true }),
  ])
  await Promise.all([
    writeFile(safeOutputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(safeOutputMarkdown, markdown, 'utf8'),
  ])
  process.stdout.write(`Calibration aggregate reports written; records=${report.calibrationRecordCount}\n`)
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  runComparisonCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'comparison failed'}\n`)
    process.exitCode = 1
  })
}
