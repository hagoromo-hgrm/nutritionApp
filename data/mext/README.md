# 日本食品標準成分表データ

食品データ収集の初回取得分です。元データは文部科学省が公開する「日本食品標準成分表（八訂）増補2023年」第2章データです。

- 取得元: <https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html>
- 取得日: 2026-07-22
- 一般成分表: `raw/mext_food_composition_2023_supplement.xlsx`
  - SHA-256: `0d5a77077dd6cd91cbc2e6e317b8b218a38728c409eed452f1c10635a0d3099c`
- 脂肪酸成分表第1表: `raw/mext_fatty_acids_2023_supplement_table1.xlsx`
  - SHA-256: `435ab7125d3de26fba968de952b463b71d011c6b0f50e8966112293c521fd5fd`
- 対象: 食品番号、食品名、エネルギー、三大栄養素、食物繊維、食塩相当量、カルシウム、鉄、ビタミンA・E・B1・B2・C、飽和脂肪酸
- 基準量: 全食品で元データの可食部100g当たりを `100g` として保持
- 入力単位: 食品名・状態と可食部重量の根拠を確認できる食品だけ、個・杯・枚・切れ・小さじ等と1単位のg換算を初期設定
- 飽和脂肪酸: 脂肪酸成分表第1表の `FASAT`（可食部100g当たりg）を食品番号で結合。2,538食品中1,967食品が収載され、数値を取得できる1,960食品へ設定

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
python scripts/extract_mext_xlsx.py data/mext/raw/mext_food_composition_2023_supplement.xlsx data/mext/processed/mext_foods.csv \
  --fatty-acids-xlsx data/mext/raw/mext_fatty_acids_2023_supplement_table1.xlsx
python scripts/convert_food_data.py data/mext/processed/mext_foods.csv data/mext/processed/mext_foods.json \
  --source-version '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）' \
  --source-url 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html' \
  --acquired-date 2026-07-22
```

`extract_mext_xlsx.py`の実行には、`requirements-data.txt`のデータ変換用依存関係が必要です。アプリのバンドルには含めません。一般成分表と脂肪酸成分表で食品番号または食品名が一致しない場合は変換を中止します。

変換時に食品名の先頭にある成分表の分類見出し（例: `＜調味料類＞`、`（調味ソース類）`）を除去します。食品の状態や調理方法などの注記は保持します。栄養値は出典どおり可食部100g基準のまま保持し、日常的な単位は `inputUnitConversions` と既定入力値へ分離します。

入力単位の換算重量は、栄養計算との整合のため可食部の正味量を示す資料を優先します。味の素パーク、DELISH KITCHEN、食品ロス資料のように廃棄部込みと明記された重量は、単位候補と妥当性確認に利用し、廃棄率を推測して可食部へ変換しません。食品名の部分一致だけでは適用せず、生・ゆで・乾燥・缶詰・果汁等の状態まで確認します。

参考資料:

- <https://eat-treat.jp/columns/1268>
- <https://eat-treat.jp/columns/1277>
- <https://eat-treat.jp/columns/1279>
- <https://eat-treat.jp/columns/1291>
- <https://park.ajinomoto.co.jp/contents/basic/ingredients_bunryou/>
- <https://help.delishkitchen.tv/hc/ja/articles/30436039087129-%E9%A3%9F%E6%9D%90%E3%81%AE%E7%9B%AE%E5%AE%89%E9%87%8F%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6>
- <https://gomi-jp-foodloss.com/pdf/food_weight.pdf>

以下の旧検索メタデータ生成経路は、上流データの調査・回帰確認用として残しています。`mext_search_metadata.json` は本番の食品グループ・バリエーション解決には使用せず、確定済みv2 JSONから生成した `data/mext/app/` を使用します。

```bash
python scripts/build_food_search_metadata.py data/mext/processed/mext_foods.json data/mext/processed/mext_search_metadata.json --known-good data/mext/food_group_known_good.json --review-output data/mext/food_group_review.json
python scripts/validate_food_master.py data/mext/processed/mext_search_metadata.json
```

旧 `variantAttributesByFoodId` は調査用です。本番UIの属性ボタンは `food_group_attributes.json`、元レコード解決は `food_variants.json` を正本とします。

LLMを使う場合も、`scripts/generate_food_master_candidates.py` で候補入力・構造化出力の検証を別工程として行い、アプリ実行時には呼び出しません。
