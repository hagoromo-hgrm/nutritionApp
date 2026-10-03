# FoodData Central 原材料プロファイル

FoodData Central (FDC) は、MEXTの原材料状態と一致する直接項目、または明示的に許可した栄養素単位の欠損補完に使います。MEXTの既知値は上書きせず、加工状態や濃縮度が確認できない候補は追加しません。

## 再生成

API取得にはローカル環境だけで `FDC_API_KEY` を設定します。APIキーと取得生データはPWAやGitへ含めません。

```bash
FDC_API_KEY=... python3 scripts/build_fdc_ingredient_profiles.py \
  --fetch \
  --output data/fdc/app/ingredient_profiles.json
```

オフライン生成では、既定の `data/fdc/raw/` に加え、必要なら検証済みのローカルrawディレクトリを複数指定します。`--raw-dir` は繰り返し指定できます。

```bash
python3 scripts/build_fdc_ingredient_profiles.py \
  --raw-dir data/fdc/raw \
  --raw-dir data/estimator/private/research_YYYYMMDD \
  --output data/fdc/app/ingredient_profiles.json
```

公式ZIPのSHA-256はZIP自体に対して検証し、許可リストの `sourceArchive` に記録します。`--bulk-json` はZIPではなく展開後のJSONファイルを受け取るため、そのJSONのハッシュをZIPハッシュとして扱いません。この経路では実際の元アーカイブ取得時刻を `--source-retrieved-at` で明示し、元ZIPの検証済みメタデータは生成物へ継承しません。ZIPのハッシュ・取得時刻・展開時刻を生成物にも残す場合は、該当ZIPから抽出済みrawディレクトリを `--raw-dir` で指定する方法を使います。生成時刻を取得日時として流用しません。

各栄養値には、出典に存在する場合だけ栄養素ID、名称、単位、原値、導出コード、データ点数を保存します。測定値0と未収載の `null` を区別し、食塩はFDCナトリウム値から `mg × 2.54 / 1000` で換算した式も記録します。元値のID・名称・単位が一致しないもの、負値・非有限値・真偽値、同一栄養素IDの矛盾する重複は生成時に拒否します。項目の `publicationDate`、レビュー日の `reviewedAt`、原アーカイブの取得・展開時刻、最上位のJSON `generatedAt` は別々に記録します。

FDCの栄養データおよび出力はCC0 1.0 / 米国パブリックドメインです。USDAはFoodData Centralを出典として表示するよう推奨しています。

## 2026-10-03の追加

レビュー済みの公式SR Legacy 04/2018項目を追加しました。

- [Butter oil, anhydrous (FDC ID 173412)](https://fdc.nal.usda.gov/fdc-app.html#/food-details/173412/nutrients): 「バターオイル」「無水乳脂肪」の直接候補。
- [Whey, sweet, dried (FDC ID 171283)](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171283/nutrients): 甘性・スイート・乾燥を明示したホエイ粉末だけの直接候補。
- [Spices, onion powder (FDC ID 171327)](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171327/nutrients): MEXTオニオンパウダーの欠損するビタミンEだけを補完。許可範囲は生成物の `nullSupplement` に記録しています。

MEXTオニオンパウダーの他の既知値は維持します。食物繊維はFDCにも値がありますが、MEXTとの分析方法・定義の互換性を確認できないため欠損のままです。ローストオニオン、オニオンエキス、一般的なホエイ・たんぱく質濃縮物・分離物はこれらの直接値へ割り当てません。

取得元の公式ZIPは[USDA SR Legacy JSON配布](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip)。FDC公式の[ダウンロード一覧](https://fdc.nal.usda.gov/download-datasets/)ではSR Legacyを04/2018の最終リリースとして掲載しています。[ライセンスと推奨出典](https://fdc.nal.usda.gov/api-guide/)も参照してください。

2026-10-03のZIP SHA-256は `0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef`、実取得時刻は `2026-10-03T09:35:29.879971Z`、対象食品の展開時刻は `2026-10-03T09:46:45Z` です。取得生データとZIPはGit対象外です。FDCレビュー項目は `ingredient_profile_allowlist.json`、アプリ用生成物は `app/ingredient_profiles.json` です。
