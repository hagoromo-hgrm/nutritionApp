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

`data/spu_data/{maker}_{source}_{YYMMDD}.csv` はメーカー公式サイトから収集した検証用の原票として扱い、GitとPWAへ同梱しない。必須列は `カテゴリ`、`商品名`、`栄養素`、`原材料` の4列で、任意の`製品URL`列を商品単位の出典に利用できる。メーカーキーにアンダースコアがある場合も、ファイル名の右端からsourceと日付を判定する。次の手順で、明示的なg基準、主要栄養値、対象栄養素、原材料がそろう行だけを非公開の正規化データへ変換する。

```bash
python3 scripts/build_spu_estimator_training.py data/spu_data \
  --output data/estimator/private/spu_training.json \
  --report data/estimator/private/spu_training_report.json \
  --coverage-output data/estimator/private/spu_ingredient_coverage.json \
  --coverage-report data/estimator/private/spu_ingredient_coverage_report.json

python3 scripts/validate_nutrient_estimator_training.py \
  data/estimator/private/spu_training.json \
  --output-manifest data/estimator/private/spu_training_manifest.json

python3 scripts/build_spu_genre_nutrient_priors.py \
  data/estimator/private/spu_training.json \
  --manifest data/estimator/private/spu_training_manifest.json \
  --output data/estimator/spu_genre_nutrient_priors.json

node_modules/.bin/vite-node scripts/evaluate_spu_nutrient_estimator.ts \
  --training data/estimator/private/spu_training.json \
  --manifest data/estimator/private/spu_training_manifest.json \
  --output data/estimator/private/spu_evaluation.json \
  --summary-output docs/analysis/spu_estimator_evaluation.json
```

ジャンル別栄養分布と栄養素比率は、評価より先に、固定分割後の`train`だけから個別商品を含まない集計生成物へ変換する。生成物は100g当たりの栄養素と`飽和脂肪酸÷脂質`の5・50・95パーセンタイル、標本数、メーカー数、最大メーカー比率、元データハッシュだけを含む。比率は脂質が正で`0 ≦ 飽和脂肪酸 ≦ 脂質`を満たす非推定ラベルだけを使用する。低頻度・メーカー偏重・`other_unknown`は栄養素全体へ縮約し、分離重量または校正済み誤差分布として扱わない。評価スクリプトは生成物とマニフェストのデータハッシュが一致しない場合に停止する。

メーカーのカテゴリ名はそのまま`genreId`へ流用せず、商品名、カテゴリ、原材料の順でアプリのジャンルへ決定的に変換する。変換レポートには元ファイルのSHA-256、除外理由、メーカーカテゴリからジャンルへの対応件数を残す。容量違い・味違いは`productFamily`へまとめ、同じ系列が学習・校正・最終テストへまたがらないようにする。

「推定値」は独立評価から除外し、基準重量をgへ安全に対応付けられない行や、複数商品分の値が1行に併記された行は推測で分割しない。生CSV、正規化レコード、商品単位の評価結果は`data/estimator/private/`へ置き、コミットするのは個別商品を含まない集計結果だけとする。

評価集計は、全原材料を解決した推計と、未解決原材料、参照値欠損または添加物寄与割合不明の寄与を加算せず既知分だけを計算した`browser_ingredient_partial_rule`を分離する。部分参考値は数値提示率には含めるが、商品全体の正解値を使う実測校正からは除外する。公開集計には数値提示率80%ゲートと、`ingredient_unresolved`、`reference_value_missing`、`additive_contribution_unknown`の理由別・栄養素別・ジャンル別件数を含め、どの参照データを次に拡充すべきか判定できるようにする。

評価時は、飽和脂肪酸／脂質比率を候補・配合探索へ戻すフィードバック重み6候補と、後段混合重み4候補の24通りを校正区分だけで再推計する。飽和脂肪酸だけでなく同じ商品の他栄養素、ビタミンE、候補変更数および配合比のL1変化を保存する。他栄養素MAPEまたは範囲包含率を悪化させず、飽和脂肪酸MAPEを0.1ポイント以上改善した場合だけ本番定数を変更する。最終テストは定数選択へ使用しない。

## 一般原材料プロファイル

`general_ingredient_profile_sources.json`は、推計辞書へ追加する一般原材料とMEXT食品IDの対応を管理する正本である。MEXTの栄養値を手で複製せず、次のコマンドで検証済みの`general_ingredient_profiles.json`を再生成する。

```bash
python3 scripts/build_general_ingredient_profiles.py \
  --source data/estimator/general_ingredient_profile_sources.json \
  --mext data/mext/processed/mext_foods.json \
  --output data/estimator/general_ingredient_profiles.json
```

生成時にMEXT食品ID、栄養素キー、候補事前確率、表記別名を検証し、MEXT生成物と対応正本のSHA-256を出力へ保存する。生鮮・乾燥・濃縮等で値が大きく変わるものは同一視せず、近似を許す表記には`ambiguous`と`derivationWarning`を必須とする。`subtractBaseFraction`は全体食品から既知の基材を重量比分布で差し引き、`scaleNutrients`は調査した固形分濃度を離散候補化する。手動辞書を先に解決するため、既存の用途別候補やFDC直接値は汎用カタログで上書きしない。濃縮率と事前確率の根拠は`docs/analysis/nutrient_estimator_concentration_priors.md`に記録する。

更新後の原材料カバレッジは次で再評価する。

```bash
node_modules/.bin/vite-node scripts/analyze_spu_ingredient_coverage.ts \
  --input data/estimator/private/spu_ingredient_coverage.json \
  --output data/estimator/private/spu_ingredient_coverage_analysis.json \
  --summary-output docs/analysis/spu_ingredient_coverage.json
```
