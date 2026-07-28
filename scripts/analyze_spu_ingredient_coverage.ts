import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  NUTRIENT_ESTIMATOR_MODEL_VERSION,
  unresolvedIngredientNames,
} from '../src/services/nutrientEstimator'
import type { EstimatorGenreId } from '../src/types'

interface CoverageRecord {
  recordId: string
  genreId: EstimatorGenreId
  productName: string
  maker: string
  ingredientsText: string
}

interface CoverageDataset {
  format: 'nutrition-estimator-ingredient-coverage-data'
  formatVersion: 1
  records: CoverageRecord[]
}

function parseArgs(args: string[]): { input: string; output: string; summaryOutput?: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error('引数は --input と --output を指定してください。')
    }
    values.set(key, value)
  }
  const input = values.get('--input')
  const output = values.get('--output')
  if (!input || !output) throw new Error('引数は --input と --output を指定してください。')
  return {
    input,
    output,
    ...(values.has('--summary-output') ? { summaryOutput: values.get('--summary-output') } : {}),
  }
}

function assertDataset(value: unknown): asserts value is CoverageDataset {
  if (!value || typeof value !== 'object') throw new Error('カバレッジデータがオブジェクトではありません。')
  const payload = value as Partial<CoverageDataset>
  if (
    payload.format !== 'nutrition-estimator-ingredient-coverage-data'
    || payload.formatVersion !== 1
    || !Array.isArray(payload.records)
  ) {
    throw new Error('カバレッジデータの形式が不正です。')
  }
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function sortedCounts(counter: ReadonlyMap<string, number>): Array<{ name: string; count: number }> {
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ja'))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const parsed: unknown = JSON.parse(await readFile(args.input, 'utf8'))
  assertDataset(parsed)

  const unresolvedCounts = new Map<string, number>()
  const unresolvedSetCounts = new Map<string, number>()
  const unresolvedExamples = new Map<string, Array<{ recordId: string; productName: string }>>()
  const makerStats = new Map<string, { records: number; fullyResolved: number }>()
  const genreStats = new Map<string, { records: number; fullyResolved: number }>()
  let fullyResolvedRecords = 0
  for (const record of parsed.records) {
    const unresolved = unresolvedIngredientNames(
      record.ingredientsText,
      record.productName,
      record.genreId,
    )
    const uniqueUnresolved = [...new Set(unresolved)]
    for (const name of uniqueUnresolved) {
      increment(unresolvedCounts, name)
      const examples = unresolvedExamples.get(name) ?? []
      if (examples.length < 5) {
        examples.push({ recordId: record.recordId, productName: record.productName })
        unresolvedExamples.set(name, examples)
      }
    }
    if (uniqueUnresolved.length > 0) {
      increment(unresolvedSetCounts, [...uniqueUnresolved].sort((left, right) => left.localeCompare(right, 'ja')).join('\u0000'))
    }
    if (uniqueUnresolved.length === 0) fullyResolvedRecords += 1

    const maker = makerStats.get(record.maker) ?? { records: 0, fullyResolved: 0 }
    maker.records += 1
    if (uniqueUnresolved.length === 0) maker.fullyResolved += 1
    makerStats.set(record.maker, maker)

    const genre = genreStats.get(record.genreId) ?? { records: 0, fullyResolved: 0 }
    genre.records += 1
    if (uniqueUnresolved.length === 0) genre.fullyResolved += 1
    genreStats.set(record.genreId, genre)
  }

  const ratio = (count: number, total: number) => (
    total === 0 ? 0 : Math.round(count / total * 100_000) / 1_000
  )
  const output = {
    format: 'nutrition-estimator-ingredient-coverage-analysis',
    formatVersion: 1,
    modelVersion: NUTRIENT_ESTIMATOR_MODEL_VERSION,
    recordCount: parsed.records.length,
    fullyResolvedRecords,
    fullyResolvedPercent: ratio(fullyResolvedRecords, parsed.records.length),
    unresolvedOccurrenceCount: [...unresolvedCounts.values()].reduce((sum, count) => sum + count, 0),
    unresolvedUniqueCount: unresolvedCounts.size,
    unresolvedIngredients: sortedCounts(unresolvedCounts),
    unresolvedExamples: Object.fromEntries(
      [...unresolvedExamples.entries()].sort(([left], [right]) => left.localeCompare(right, 'ja')),
    ),
    unresolvedSets: [...unresolvedSetCounts.entries()]
      .map(([key, count]) => ({ ingredients: key.split('\u0000'), count }))
      .sort((left, right) => (
        right.count - left.count
        || left.ingredients.join('、').localeCompare(right.ingredients.join('、'), 'ja')
      )),
    byMaker: Object.fromEntries(
      [...makerStats.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'ja'))
        .map(([maker, stats]) => [maker, {
          ...stats,
          fullyResolvedPercent: ratio(stats.fullyResolved, stats.records),
        }]),
    ),
    byGenre: Object.fromEntries(
      [...genreStats.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([genre, stats]) => [genre, {
          ...stats,
          fullyResolvedPercent: ratio(stats.fullyResolved, stats.records),
        }]),
    ),
  }
  await mkdir(dirname(args.output), { recursive: true })
  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  if (args.summaryOutput) {
    const summary = {
      format: 'nutrition-estimator-ingredient-coverage-summary',
      formatVersion: 1,
      modelVersion: output.modelVersion,
      recordCount: output.recordCount,
      fullyResolvedRecords: output.fullyResolvedRecords,
      fullyResolvedPercent: output.fullyResolvedPercent,
      unresolvedOccurrenceCount: output.unresolvedOccurrenceCount,
      unresolvedUniqueCount: output.unresolvedUniqueCount,
      byMaker: output.byMaker,
      byGenre: output.byGenre,
      topUnresolvedIngredients: output.unresolvedIngredients.slice(0, 50),
    }
    await mkdir(dirname(args.summaryOutput), { recursive: true })
    await writeFile(args.summaryOutput, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

await main()
