# 推計用教師データの受け渡し

教師データはGitへ直接コミットせず、`scripts/validate_nutrient_estimator_training.py`で検証してから使用する。個人の購入履歴、購入場所、摂取履歴を含めない。

最初は次の3ジャンルを推奨する。

1. `baked_sweets`（焼き菓子）
2. `chocolate`（チョコレート菓子）
3. `bread`（パン・菓子パン）

件数はパイロット50商品/ジャンル、本評価100商品/ジャンル、独立精度評価30商品/ジャンル・栄養素を目安とする。同一メーカー・商品系列の容量違い、味違い、更新前後は同じ`productFamily`にする。`productFamily`は分割漏れを防ぐ必須項目で、表記揺れを正規化したメーカー名との組で70%学習、15%校正、15%最終テストへ固定分割する。

## JSON

`training_schema.json`に従い、トップレベルを次の形にする。

```json
{
  "format": "nutrition-estimator-training-data",
  "formatVersion": 1,
  "records": []
}
```

栄養素キーはアプリの`NUTRIENT_KEYS`を使用する。欠損項目は省略し、ゼロ補完しない。パッケージに「推定値」等の表示がある場合は`valueKind: "estimated"`とし、最終テストの独立正解には使用しない。

## CSV

CSVでは、基本フィールドに加えて、栄養素を次の列名で表す。

```text
fiberG.displayText
fiberG.value
fiberG.rangeMin
fiberG.rangeMax
fiberG.unit
fiberG.basis
fiberG.decimalPlaces
fiberG.valueKind
```

テンプレートは次で生成できる。

```bash
python3 scripts/validate_nutrient_estimator_training.py --write-template /tmp/nutrient-estimator-training.csv
```

検証と固定分割は次で行う。

```bash
python3 scripts/validate_nutrient_estimator_training.py INPUT.json --output-manifest /tmp/training-manifest.json
```

分割はメーカーと`productFamily`をグループ化し、70%学習、15%校正、15%最終テストへ固定する。

## メーカー公式CSV

`data/spu_data/{maker}_{source}_{YYMMDD}.csv` はメーカー公式サイトから収集した検証用の原票として扱い、GitとPWAへ同梱しない。列は `カテゴリ`、`商品名`、`栄養素`、`原材料` の4列とする。次の手順で、明示的なg基準、主要栄養値、対象栄養素、原材料がそろう行だけを非公開の正規化データへ変換する。

```bash
python3 scripts/build_spu_estimator_training.py data/spu_data \
  --output data/estimator/private/spu_training.json \
  --report data/estimator/private/spu_training_report.json

python3 scripts/validate_nutrient_estimator_training.py \
  data/estimator/private/spu_training.json \
  --output-manifest data/estimator/private/spu_training_manifest.json

node_modules/.bin/vite-node scripts/evaluate_spu_nutrient_estimator.ts \
  --training data/estimator/private/spu_training.json \
  --manifest data/estimator/private/spu_training_manifest.json \
  --output data/estimator/private/spu_evaluation.json \
  --summary-output docs/analysis/spu_estimator_evaluation.json
```

メーカーのカテゴリ名はそのまま`genreId`へ流用せず、商品名、カテゴリ、原材料の順でアプリのジャンルへ決定的に変換する。変換レポートには元ファイルのSHA-256、除外理由、メーカーカテゴリからジャンルへの対応件数を残す。容量違い・味違いは`productFamily`へまとめ、同じ系列が学習・校正・最終テストへまたがらないようにする。

「推定値」は独立評価から除外し、基準重量をgへ安全に対応付けられない行や、複数商品分の値が1行に併記された行は推測で分割しない。生CSV、正規化レコード、商品単位の評価結果は`data/estimator/private/`へ置き、コミットするのは個別商品を含まない集計結果だけとする。
