# 日本食品標準成分表データ

食品データ収集の初回取得分です。元データは文部科学省が公開する「日本食品標準成分表（八訂）増補2023年」第2章データです。

- 取得元: <https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html>
- 取得日: 2026-07-17
- 元ファイル: `raw/mext_food_composition_2023_supplement.xlsx`
- SHA-256: `0d5a77077dd6cd91cbc2e6e317b8b218a38728c409eed452f1c10635a0d3099c`
- 対象: 食品番号、食品名、エネルギー、三大栄養素、食物繊維、食塩相当量、カルシウム、鉄、ビタミンA・E・B1・B2・C
- 基準量: 重量換算の根拠がない食品は元データの可食部100g当たりを `100g` として保持。卵・米・パン・果物・豆腐などは代表的な食品単位へ換算し、調味料類は `小さじ1` と小さじ1杯の代表重量を食品名に併記
- 飽和脂肪酸: 一般成分表に含まれないため、推測せず未設定

文部科学省の案内に従い、アプリ内の出典は「日本食品標準成分表（八訂）増補2023年から引用」とします。括弧付きの推定値は数値として扱い、`-`・`Tr`・`(Tr)`は未設定として扱います。`0`・`(0)`は元データの意味を保って0として扱います。

## 確定済み食品グループから本番データを生成する

アプリが使用する食品グループとバリエーションは、次の確認済みv2 JSONを入力とします。これらは分類判断の正本なので、本番データ生成時に上書きしません。

- `processed/mext_food_groups_v2.json`
- `processed/mext_food_group_mappings_v2.json`
- `processed/mext_food_group_review_v2.json`
- `processed/mext_food_group_resolution_log_v2.json`
- `processed/mext_food_group_summary_v2.json`

macOSまたはVisual Studio Codeのプロジェクトルートで、次を実行します。

```bash
python3 scripts/build_mext_food_app_data.py
python3 scripts/validate_mext_food_app_data.py
python3 -m unittest tests/test_mext_food_app_data.py
```

生成先は `data/mext/app/` です。

- `food_groups.json`: 食品グループ本体
- `food_group_attributes.json`: UIで選択する属性と属性値
- `food_group_fixed_attributes.json`: 選択UIに出さない固定属性
- `food_variants.json`: 属性値の組合せとMEXT `source_id` の対応
- `food_search_index.json`: 確定済み名称・検索語・親概念の検索インデックス
- `build_summary.json`: 件数と整合性検証結果

書き込みは一時ファイルからの置換で行い、同じ入力から同じ順序・内容を再生成します。`build_summary.json` の `validationPassed` が `true` にならない場合、生成物をアプリ用として使用してはいけません。分類や名称を変更する場合はこの変換スクリプトを編集せず、上流の確認済みJSONを再作成してください。

アプリは `src/services/mextFoodData.ts` をデータアクセス層として使用します。検索、選択属性取得、固定属性取得、属性値からの `source_id` 解決はこの層を経由し、UIから生成JSONを直接走査しません。Dexie初期化時には同じデータからMEXT食品の `foodGroupId` と検索語を投入します。

変換:

```bash
python scripts/extract_mext_xlsx.py data/mext/raw/mext_food_composition_2023_supplement.xlsx data/mext/processed/mext_foods.csv
python scripts/convert_food_data.py data/mext/processed/mext_foods.csv data/mext/processed/mext_foods.json \
  --source-version '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）' \
  --source-url 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html' \
  --acquired-date 2026-07-17
```

`extract_mext_xlsx.py`の実行には、`requirements-data.txt`のデータ変換用依存関係が必要です。アプリのバンドルには含めません。

変換時に食品名の先頭にある成分表の分類見出し（例: `＜調味料類＞`、`（調味ソース類）`）を除去します。食品の状態や調理方法などの注記は保持します。小さじ・個・合などへ換算した食品は、元データの100g基準値をその代表重量に比例換算しています。換算根拠がない食品は推測で変換せず、100g基準のままです。

以下の旧検索メタデータ生成経路は、上流データの調査・回帰確認用として残しています。`mext_search_metadata.json` は本番の食品グループ・バリエーション解決には使用せず、確定済みv2 JSONから生成した `data/mext/app/` を使用します。

```bash
python scripts/build_food_search_metadata.py data/mext/processed/mext_foods.json data/mext/processed/mext_search_metadata.json --known-good data/mext/food_group_known_good.json --review-output data/mext/food_group_review.json
python scripts/validate_food_master.py data/mext/processed/mext_search_metadata.json
```

旧 `variantAttributesByFoodId` は調査用です。本番UIの属性ボタンは `food_group_attributes.json`、元レコード解決は `food_variants.json` を正本とします。

LLMを使う場合も、`scripts/generate_food_master_candidates.py` で候補入力・構造化出力の検証を別工程として行い、アプリ実行時には呼び出しません。
