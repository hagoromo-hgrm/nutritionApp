# Nutrition Estimator

NutritionAppから独立した、ローカル実行専用の栄養素推計コアです。初期版はクッキー・
ビスケット類の次の栄養素を対象にします。

- `fiberG`（食物繊維）
- `saturatedFatG`（飽和脂肪酸）
- `calciumMg`（カルシウム）
- `ironMg`（鉄）
- `vitaminAMcg`（ビタミンA）
- `vitaminEMg`（ビタミンE）
- `vitaminB1Mg`（ビタミンB1）
- `vitaminB2Mg`（ビタミンB2）
- `vitaminCMg`（ビタミンC）

外部通信は行いません。組み込みプロファイルは、リポジトリ内の検証・正規化済み
`data/mext/processed/mext_foods.json`から固定した、日本食品標準成分表（八訂）
増補2023年（2026年3月27日正誤表対応）の100g値です。結果には参照したMEXT食品IDと
版を含めます。MEXTで対象値が欠損する場合は原則`null`のままとし、その原材料を含む
栄養素だけを結果から除外します。他の対象栄養素を算出できる場合、結果は`partial`に
なります。脂質が0gの食品だけは「飽和脂肪酸も0g」と導出して、その規則を警告へ
記録します。

結果は参考推計で、メーカー表示値と同等の正確性を保証せず、医療上の判断には使用
できません。

## 実行

```bash
python -m pip install -e .
python -m nutrition_estimator hash request.json
python -m nutrition_estimator estimate request-with-hash.json
cat request-with-hash.json | python -m nutrition_estimator estimate -
```

`hash`は`inputHash`を除いた入力の正規JSONからSHA-256を計算し、設定済みの
`inputHash`を置換したJSONを出力します。CLIはJSONだけを標準出力へ書き、
入力エラー時も仕様に沿った失敗JSONを返します。

## テスト

```bash
python -m pip install -e ".[test]"
python -m pytest
```

推計には明示された製品基準重量とその根拠、および原材料表示が必要です。`個`、`袋`、
`ml`からgへの暗黙換算や、根拠のない欠損値のゼロ補完は行いません。
`ingredientsSource`には`provider`と`verified: true`を含むオブジェクトを指定します。
