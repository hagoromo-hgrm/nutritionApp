# 栄養推定器の封印済み実商品評価

この手順は、学習・調整に使っていない実商品の表示値を後工程で一度だけ評価するためのものです。推定器の実行、モデル選択、閾値変更はこのCLIでは行いません。モデルと評価コードを固定し、別工程で明示的に開封するまでは封印データを参照しないでください。

## 実行

個票JSON、除外情報、出力manifestはすべて`data/estimator/private/`以下に置きます。除外ファイルの形式は次のとおりです。

```json
{
  "familyHashes": ["<SHA256(group_key(maker, family))>"],
  "blockedMakers": ["normalized maker"]
}
```

封印manifestを新しいパスへ一度だけ生成し、公開可能な集計が必要な場合だけ`--public-report`を指定します。

```bash
python3 scripts/seal_nutrient_estimator_evaluation.py \
  data/estimator/private/sealed_20261003/evaluation.json \
  --excluded-family-hashes data/estimator/private/sealed_exclusions_20261003.json \
  --output-manifest data/estimator/private/sealed_20261003/manifest.json \
  --public-report docs/analysis/nutrient_estimator_evaluation_report.json
```

出力manifestは既存ファイルを上書きしません。内容を変えて作り直す場合も既存manifestを編集せず、新しい封印セットとして新しいパスを使います。manifestにはUTCの`sealedAt`と除外JSONのbyte SHA256を記録し、公開レポートにもこれらの由来情報とsource/normalized dataset hashを載せます。個票の入力、manifest、出典URLはprivate領域から出さないでください。公開レポートには製品単位の名前、原材料、値、URL、recordId、生のfamily名、個票ファイル名を含めません。

## 検証と封印条件

各レコードはvalidatorの共通正規化を通したうえで、energyKcal、proteinG、fatG、carbohydrateG、saltGの5 major栄養素、全て同一basis、9対象栄養素のうち最低1つの非推定値、package/manufacturer出典、HTTP(S)出典URL、タイムゾーン付き確認日時、正のreferenceMassGと根拠を要求します。指定のないその他栄養素は必須にしません。Pythonのboolが数値として通るvalidatorの挙動はCLI側で拒否します。familyは正規化makerとproductFamilyの組で一意にし、同一味・容量違いなどを別family名にして独立サンプル数を増やしてはいけません。既存の学習・調整family hashおよび除外makerとの重複も拒否します。

評価に十分な件数の目安は独立family 30以上、maker 3以上、最大maker share 0.5以下です。足りない場合も実際の件数をそのまま保存し、`adequacy: false`と不足warningを出します。件数を補うための複製や擬似レコード作成は禁止です。manifestの全レコードは`split: test`となり、既存training manifestと同じcanonical JSON規則で正規化データのSHA256を記録します。

封印ファイルをprior builderへ直接渡してはいけません。封印評価を行う時点では、推定器、教師データ、評価処理を固定した別のレビュー可能な工程を用意してください。開封判断はその工程の後に行います。

## 2026-10-04の収集結果

349候補を確認し、30系列の代表30商品を封印した。江崎グリコ13、雪印メグミルク14、大塚製薬3、最大メーカー占有率46.67%。既存教師707系列のhashと除外メーカーに対する重複はなかった。対象表示は食物繊維28、飽和脂肪酸15、Ca14、B1/B2各4、A/E各3、鉄2、C1系列。各商品には非推定の主要5項目と少なくとも1対象項目があり、同一表示基準と明示g質量を確認した。

`adequacy`は系列数とメーカー分散の収集目標だけを判定する。栄養素別に独立30系列の評価目安へ達した項目はない。小標本の誤差は探索的結果として記録し、精度保証や全栄養素の改善率には使わない。公開可能な件数とhashは `nutrient_estimator_sealed_collection.json`、原票・注記範囲・系列統合根拠・権利確認はprivate領域に保持する。モデル・評価コード固定後まで推計は実行していない。

主な除外は対象表示なし133、質量不明33、主要項目不足5、抽出不確定20、味・容量・系列統合等95、個数からの重量推測25、終了品5、ソース込み質量不明1、全表示推定2。メーカー原票と商品別数値はGit/PWAへ含めない。
