import { writeFile } from 'node:fs/promises'
import { benchmarkCandidateSearch } from '../src/services/nutrientEstimator'
import type { IngredientProfile } from '../src/services/nutrientEstimatorProfiles'
import { EMPTY_NUTRIENTS } from '../src/types'

export async function runSearchBenchmark() {
  const fixtures = Array.from({ length: 8 }, (_, fixture) => {
    const sets: IngredientProfile[][] = Array.from({ length: 3 }, (_, position) => Array.from({ length: 4 }, (_, option) => ({
      profileId: `synthetic-${fixture}-${position}-${option}`, canonicalName: 'synthetic', sourceFoodIds: ['synthetic'], priorProbability: [.7, .2, .09, .01][option],
      nutrients: { ...EMPTY_NUTRIENTS, energyKcal: [100, 250, 400, 600][option] * (1 + position / 10), fatG: [0, 5, 30, 60][option], carbohydrateG: [20, 45, 25, 5][option] * (1 + position / 10) },
    })))
    const ratios = [.6, .3, .1]
    const knownNutrients = Object.fromEntries((['energyKcal', 'fatG', 'carbohydrateG'] as const).map((key) => [key,
      sets.reduce((sum, set, position) => sum + set[(fixture + position) % 4].nutrients[key]! * ratios[position], 0),
    ]))
    const context = { referenceMassG: 100, knownNutrients }
    const reference = benchmarkCandidateSearch(sets, context, 64, 64)
    const runs = [2, 4, 8, 16, 64].map((limit) => {
      const run = benchmarkCandidateSearch(sets, context, limit, 64)
      const repeated = benchmarkCandidateSearch(sets, context, limit, 64)
      if (JSON.stringify([run.bestProfileIds, run.bestRatios, run.bestScore]) !== JSON.stringify([repeated.bestProfileIds, repeated.bestRatios, repeated.bestScore])) throw new Error('search benchmark is nondeterministic')
      return { ...run, objectiveGap: Math.max(0, run.bestScore - reference.bestScore), missedReferenceCombination: JSON.stringify(run.bestProfileIds) !== JSON.stringify(reference.bestProfileIds), deterministic: true }
    })
    return { fixtureId: `synthetic-${fixture}`, reference, runs }
  })
  const budgets = [2, 4, 8, 16, 64].map((limit) => {
    const runs = fixtures.map((fixture) => fixture.runs.find((run) => run.limit === limit)!)
    return { limit, meanObjectiveGap: runs.reduce((sum, run) => sum + run.objectiveGap, 0) / runs.length,
      missedReferenceCombinationCount: runs.filter((run) => run.missedReferenceCombination).length, meanElapsedMs: runs.reduce((sum, run) => sum + run.elapsedMs, 0) / runs.length }
  })
  const report = { format: 'nutrient-estimator-search-budget-benchmark', formatVersion: 1, syntheticOnly: true,
    reference: 'all candidate combinations with the same deterministic ratio samples/refinement and original prior scale; not an analytic global optimum',
    platform: 'macOS development process; not iPhone latency', randomScenarioCountPerCombination: 64, productionBudgetChanged: false,
    lowerBound: 'ordered-simplex prefix vertices, widened unresolved candidate envelope, all-observed-key denominator',
    limitation: 'Beam diversity is heuristic. A valid fit lower bound alone does not guarantee retention of the global optimum or real-product accuracy.', budgets, fixtures }
  await writeFile('docs/analysis/nutrient_estimator_search_benchmark.json', JSON.stringify(report, null, 2) + '\n')
  await writeFile('docs/analysis/nutrient_estimator_search_benchmark.md', `# 候補探索量の合成比較\n\n3原材料×4候補の8ケースを、beam 2/4/8/16/64で比較した。全候補64組でも比率最適化は同じ有限サンプルと局所改善であり、解析的な大域最適解ではない。実商品ラベルは用いていない。\n\n| beam | 平均目的関数gap | 参照最良組合せの不一致件数 | 平均時間ms |\n| ---: | ---: | ---: | ---: |\n${budgets.map((row) => `| ${row.limit} | ${row.meanObjectiveGap.toFixed(6)} | ${row.missedReferenceCombinationCount} | ${row.meanElapsedMs.toFixed(2)} |`).join('\n')}\n\n枝刈り用fit境界は固定fallback配合から、表示順を満たすsimplexのprefix頂点包絡へ変更。欠損候補がある項目の最小損失は0、分母は観測全項目数とし、最終fit損失を過大評価しない。prior/多様性を使うbeam選別は引き続きheuristicで、取りこぼしを完全に防ぐ保証はない。全runで同一候補・比率・scoreの再実行一致を確認。時間は開発用macOSプロセスで測定し、iPhone性能の保証に用いない。本番候補上限と比率探索予算は増やさない。\n`)
  process.stdout.write('Synthetic search benchmark written; fixtures=8\n')
}
