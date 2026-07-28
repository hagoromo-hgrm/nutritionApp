# FoodData Central工業原材料プロファイル

FoodData Central（FDC）は、MEXTに直接項目がない工業原材料の補完だけに使用する。FDC APIキーと取得生データはPWAおよびGitへ含めない。

## レビュー手順

1. `ingredient_profile_allowlist.json`の`reviewQueue`にある検索語をFDCで確認する。
2. FoundationまたはSR Legacyの直接原材料であること、100g基準、栄養素単位、説明を確認する。
3. 採用するFDC IDを`profiles`へ移し、`reviewedAt`、`descriptionIncludes`、`replaceProfileId`を記録する。
4. APIまたはUSDA公式一括JSONから、生データとアプリ同梱用生成物を作る。

```bash
FDC_API_KEY=... python3 scripts/build_fdc_ingredient_profiles.py \
  --fetch \
  --output data/fdc/app/ingredient_profiles.json
```

APIを使わず公式ダウンロードから取得した場合は、対象の食品オブジェクトだけを
`data/fdc/raw/{fdcId}.json`へ抽出する。SR Legacy JSON一括配布は、レビュー済みIDだけを
`--bulk-json`で抽出できる。

```bash
python3 scripts/build_fdc_ingredient_profiles.py \
  --bulk-json /path/to/FoodData_Central_sr_legacy_food_json_2018-04.json \
  --output data/fdc/app/ingredient_profiles.json
```

`datasetRelease`と`retrievedAt`を許可リストへ記録した後は、`--fetch`も`--bulk-json`も付けず、
Git対象外のrawから生成物を再構築できる。

2026-07-28時点では、公式SR Legacy 04/2018のココアバター、小麦ふすま、ココナッツ油、
鶏脂、酵母エキススプレッド、種子ガムの6項目をレビュー済み。乳糖とカカオマスは
Foundation/SR Legacyに純原材料の直接項目を確認できていないため、レビュー待ちのままとし、
既存の代理参照を維持する。

取得応答は`data/fdc/raw/`へ保存されるが、Gitの対象外である。生成物にはFDC ID、データ種別、取得日時、元データハッシュ、変換版、CC0表記を保持する。値が欠損する栄養素は`null`のまま維持する。
