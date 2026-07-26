# Open Food Facts事前分布

Open Food Facts（OFF）は、実行時のバーコード候補取得とは別に、商品ジャンルごとの原材料候補事前分布をローカル生成するために使う。OFFの栄養値は教師データの独立した正解にせず、画像も取得・再配布しない。

## 入力

OFFのJSONLまたはJSONL.gzエクスポートを`data/openfoodfacts/raw/`へ置く。このディレクトリと生成物は、ODbLの帰属・Share-Alike・対応データベースの提供方法を確認するまでGitへコミットしない。

次のフィールドだけを読む。

- `product_name`、`product_name_ja`
- `categories_tags`、`countries_tags`
- `ingredients`または`ingredients_tags`
- `unknown_ingredients_n`
- `completeness`、`data_quality_errors_tags`

## 生成

```bash
python3 scripts/build_off_estimator_priors.py \
  data/openfoodfacts/raw/openfoodfacts-products.jsonl.gz \
  --dataset-release 2026-07-01 \
  --retrieved-at 2026-07-26T00:00:00Z \
  --output data/openfoodfacts/generated/estimator_priors.json
```

既定では`countries_tags`に`en:japan`を含む商品だけを対象とし、完全性0.5未満、品質エラーあり、原材料なし、未知原材料数が多すぎる商品を除く。`ingredient_profile_map.json`でレビュー済みのOFF原材料タグだけをアプリ内プロファイルへ対応付ける。

出力には、ジャンル別プロファイル倍率、表示位置帯、共起、商品名トークンの集計、採用・除外件数、元ファイルのSHA-256、ODbL表記、変換版を保持する。商品コードや個別商品名は出力せず、商品名トークンも既定で5商品以上に現れる集計だけを残す。
