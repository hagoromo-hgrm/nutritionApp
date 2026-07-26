# FoodData Central工業原材料プロファイル

FoodData Central（FDC）は、MEXTに直接項目がない工業原材料の補完だけに使用する。FDC APIキーと取得生データはPWAおよびGitへ含めない。

## レビュー手順

1. `ingredient_profile_allowlist.json`の`reviewQueue`にある検索語をFDCで確認する。
2. FoundationまたはSR Legacyの直接原材料であること、100g基準、栄養素単位、説明を確認する。
3. 採用するFDC IDを`profiles`へ移し、`reviewedAt`、`descriptionIncludes`、`replaceProfileId`を記録する。
4. 環境変数`FDC_API_KEY`を設定して生成する。

```bash
FDC_API_KEY=... python3 scripts/build_fdc_ingredient_profiles.py \
  --fetch \
  --output data/fdc/app/ingredient_profiles.json
```

APIを使わず公式ダウンロードから取得した場合は、対象の食品オブジェクトだけを
`data/fdc/raw/{fdcId}.json`へ抽出し、`datasetRelease`と`retrievedAt`を許可リストへ記録して、
`--fetch`なしで同じ生成コマンドを実行する。

2026-07-26時点では、公式SR Legacy 04/2018の`fdcId=171421`（`Oil, cocoa butter`）を
ココアバターの直接項目としてレビュー済み。乳糖とカカオマスはFoundation/SR Legacyに
純原材料の直接項目を確認できていないため、レビュー待ちのままとし、既存の代理参照を維持する。

取得応答は`data/fdc/raw/`へ保存されるが、Gitの対象外である。生成物にはFDC ID、データ種別、取得日時、元データハッシュ、変換版、CC0表記を保持する。値が欠損する栄養素は`null`のまま維持する。
