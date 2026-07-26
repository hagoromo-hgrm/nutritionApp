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
