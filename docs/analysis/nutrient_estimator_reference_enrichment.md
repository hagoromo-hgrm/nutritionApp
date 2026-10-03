# 栄養素推計のFDC出典補完監査

監査日: 2026-10-03。対象は、MEXTの参照値へ公式FDC値を追加する際の原材料状態、栄養素単位の出典、欠損の扱いです。自動推計の精度向上や可用率の改善は測定・主張していません。

## 情報源と再現性

FoodData Centralの公式[ダウンロード一覧](https://fdc.nal.usda.gov/download-datasets/)はSR Legacyを04/2018の最終リリースとして掲載し、公式[APIガイド](https://fdc.nal.usda.gov/api-guide/)はデータがCC0 1.0 / 米国パブリックドメインであること、FoodData Centralを出典に表示することを案内しています。FDCの[データ項目説明](https://fdc.nal.usda.gov/portal-data/external/dataDictionary)も参照しました。

レビューに使った公式ZIPは[SR Legacy JSON 04/2018](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip)です。SHA-256 `0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef`、取得日時 `2026-10-03T09:35:29.879971Z`、対象レコードの展開日時 `2026-10-03T09:46:45Z` を分けて記録しました。ZIPと抽出rawはGit対象外の `data/estimator/private/research_20261003/` にあります。生成物の `publicationDate` はUSDA項目日付、`reviewedAt` は許可リスト上の監査日、`sourceArchive.retrievedAt` と `sourceArchive.extractedAt` はZIPの取得・展開時刻、最上位の `generatedAt` はアプリ用JSON生成時刻です。個別レコードは[173412](https://fdc.nal.usda.gov/fdc-app.html#/food-details/173412/nutrients)、[171283](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171283/nutrients)、[171327](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171327/nutrients)で照合できます。

生成物の各栄養素には、FDC栄養素ID・英語名・単位・FDC原値・導出コード・データ点数を保存します。原値0は値として残し、未収載の栄養素にはprovenanceを追加せず `null` を保ちます。食塩だけはFDCナトリウムID 1093 (mg) を `mg × 2.54 / 1000` で換算し、原値と換算式の両方を記録します。生成器はID・名称・単位の不一致、矛盾する重複ID、boolean・非有限・負の値を拒否します。Foundationのエネルギー代替IDは優先順を固定し、通常のkJ IDはkcalへ混ぜません。

## 採用した参照

| FDC項目 | 適用する名前 | 根拠・制限 |
| --- | --- | --- |
| [Butter oil, anhydrous, ID 173412](https://fdc.nal.usda.gov/fdc-app.html#/food-details/173412/nutrients) | バターオイル、無水乳脂肪 | 同じ加工状態のFDC直接項目。普通のバターや「バター加工品」には割り当てません。 |
| [Whey, sweet, dried, ID 171283](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171283/nutrients) | 甘性/スイートと乾燥/粉末を明示したホエイ名 | FDC項目名の甘性・乾燥状態を要求。一般的なホエイや乳たんぱく原料には割り当てません。 |
| [Spices, onion powder, ID 171327](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171327/nutrients) | MEXTの `general_mext_17056` に対するビタミンEのみ | MEXTのビタミンEが `null` の場合だけID 1109、Vitamin E (alpha-tocopherol)、mg、0.27を使用。非null値は維持します。 |

FDC由来の直接プロファイル値は可食部100g基準です。ID 173412には876 kcal、脂質99.5g、飽和脂肪酸61.9g、食塩換算0.00508gが収録されています。ID 171283には353 kcal、たんぱく質12.9g、炭水化物74.5g、カルシウム796mg、食塩換算2.7432gが収録されています。各値の原栄養素IDと出典情報は `data/fdc/app/ingredient_profiles.json` にあります。

MEXTの `general_mext_17056` はビタミンEが欠損しています。生成済みMEXT値のうち他の栄養素は変更せず、FDC ID 171327のビタミンEだけを補います。MEXTプロフィール全体の `sourceFoodIds` は `mext_17056` のまま、Eだけの出典IDは `fdc:171327` として推計結果まで伝播します。通常のMEXT参照項目と、複合原材料内で作られるプロフィールの両方をテストします。

## 不採用・欠損維持

- 「バター」「バター加工品」はバターオイルと状態が一致しないため、FDC 173412へ置き換えません。
- 一般的なホエイ、乳清たんぱく、ホエイ濃縮物・分離物はタンパク質濃度や残存脂質・ミネラルが不確定です。FDC 171283に結び付けず、既存の低信頼度候補と欠損を維持します。
- ローストオニオン粉末、たまねぎエキスは処理状態が異なるため、通常オニオン粉末の直接値へ割り当てません。
- FDCオニオン粉末の食物繊維15.2g/100gはMEXT側の測定・定義との互換性を確認できないため、MEXTの欠損を埋めません。FDCの他のビタミン・ミネラル・マクロ値も、Eの許可範囲外なのでMEXT値を置き換えません。
- 濃縮果汁、粉末と液状、具材・衣など、濃縮度や配合が不明なグループには新しい数値を追加していません。

既存のレビュー済みFDC 6項目について、再生成前後の14栄養値はすべて一致しました。監査対象の許可リストは `data/fdc/ingredient_profile_allowlist.json`、生成ロジックは `scripts/build_fdc_ingredient_profiles.py` です。
