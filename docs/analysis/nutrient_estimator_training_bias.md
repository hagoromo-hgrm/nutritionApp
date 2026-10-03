# 栄養推定教師データの偏り監査

## 対象と検証

既存教師データのtrain split 545件を、固定14ジャンル全てについて集計した。観測ジャンルは12/14で、trainデータが0件のジャンルは **bread, fried_food**。個別商品名、原材料、ラベル数値、record ID、family名は監査出力へ含めない。メーカー識別はSHA-256と件数だけをJSONへ記録した。

入力ファイルSHA-256 `3edf63aa78c138460c528a75a1870839c710332e68f781cab86aff93132db89b` と正規化データSHA-256 `bd2b3230343b917e4fa8c542043519f8c532b9f967f8feb44056b4c273e246e3` はmanifestと一致した。manifestのIDはデータと一対一で、genre/groupKeyも全件一致し、同一maker/productFamilyのsplit跨ぎと公開sealed評価family hashとの重複はなかった（公開sealed family 30件、overlap 0）。

監査値は食品精度の評価ではない。学習データの量、欠損、系列区分、メーカー集中だけを示す。既存教師のfamilyは取り込み済みのproductFamilyを使うため、hash非重複はレシピや製法の実質的な独立性を保証しない。味・容量違いの系列再監査は後続の教師取込工程で扱う。

## 目標の達成状況

| ジャンル | train商品数 | 50件パイロット | 100件本評価 | 不足理由 |
|---|---:|:---:|:---:|---|
| baked_sweets | 56 | ○ | × | fewer_than_100_formal_records |
| bread | 0 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| cake_pastry | 8 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| chocolate | 67 | ○ | × | fewer_than_100_formal_records |
| dairy | 93 | ○ | × | fewer_than_100_formal_records |
| drink_jelly_pudding | 38 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| fried_food | 0 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| frozen_dessert | 1 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| noodle_flour_dish | 1 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| other_unknown | 119 | ○ | ○ | なし |
| prepared_meal | 25 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| sauce_spread | 92 | ○ | × | fewer_than_100_formal_records |
| snack_rice_cracker | 24 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |
| sugar_confectionery | 21 | × | × | fewer_than_50_pilot_records、fewer_than_100_formal_records |

**50件パイロットと100件本評価はジャンル別record数の目標**であり、独立family ESS 30の条件とは別に判定する。固定14ジャンル中、record目標はそれぞれ5/14、1/14が達成した。栄養素別126組のうち、独立family ESS 30以上は9組、さらに3メーカー以上かつ最大メーカー比率50%以下を満たす組は2組、推奨20%以下も満たす組は0組だった。

## ジャンル・栄養素別集計

| ジャンル | 栄養素 | 観測 | 採用 | 独立family | maker | 最大maker比率 | 最大family比率 | 欠損 / 推定除外 / 不正除外 | 不足理由 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| baked_sweets | saturatedFatG | 47 | 47 | 47 (ESS 47) | 1 | 100.0% | 2.1% | 9 / 0 / 0 | maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | fiberG | 52 | 52 | 50 (ESS 50) | 2 | 94.0% | 2.0% | 4 / 0 / 0 | maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | calciumMg | 6 | 6 | 6 (ESS 6) | 2 | 66.7% | 16.7% | 50 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | ironMg | 5 | 5 | 5 (ESS 5) | 1 | 100.0% | 20.0% | 51 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 56 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| baked_sweets | vitaminEMg | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 55 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | vitaminB1Mg | 6 | 6 | 4 (ESS 4) | 1 | 100.0% | 25.0% | 50 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | vitaminB2Mg | 6 | 6 | 4 (ESS 4) | 1 | 100.0% | 25.0% | 50 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| baked_sweets | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 56 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | saturatedFatG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | fiberG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | calciumMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | ironMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| bread | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| cake_pastry | saturatedFatG | 4 | 4 | 4 (ESS 4) | 1 | 100.0% | 25.0% | 4 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| cake_pastry | fiberG | 4 | 4 | 4 (ESS 4) | 1 | 100.0% | 25.0% | 4 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| cake_pastry | calciumMg | 3 | 3 | 3 (ESS 3) | 2 | 66.7% | 33.3% | 5 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| cake_pastry | ironMg | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 7 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| cake_pastry | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 8 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| cake_pastry | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 8 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| cake_pastry | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 8 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| cake_pastry | vitaminB2Mg | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 7 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| cake_pastry | vitaminCMg | 2 | 2 | 2 (ESS 2) | 2 | 50.0% | 50.0% | 6 / 0 / 0 | family ESS <30、maker <3、推奨maker比率 >20% |
| chocolate | saturatedFatG | 28 | 28 | 28 (ESS 28) | 1 | 100.0% | 3.6% | 39 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| chocolate | fiberG | 59 | 57 | 50 (ESS 50) | 3 | 56.0% | 2.0% | 8 / 2 / 0 | maker比率 >50%、推奨maker比率 >20% |
| chocolate | calciumMg | 13 | 13 | 12 (ESS 12) | 4 | 41.7% | 8.3% | 54 / 0 / 0 | family ESS <30、推奨maker比率 >20% |
| chocolate | ironMg | 6 | 6 | 5 (ESS 5) | 2 | 60.0% | 20.0% | 61 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| chocolate | vitaminAMcg | 3 | 3 | 2 (ESS 2) | 2 | 50.0% | 50.0% | 64 / 0 / 0 | family ESS <30、maker <3、推奨maker比率 >20% |
| chocolate | vitaminEMg | 2 | 2 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 65 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| chocolate | vitaminB1Mg | 11 | 11 | 7 (ESS 7) | 2 | 71.4% | 14.3% | 56 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| chocolate | vitaminB2Mg | 11 | 11 | 7 (ESS 7) | 2 | 71.4% | 14.3% | 56 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| chocolate | vitaminCMg | 7 | 7 | 4 (ESS 4) | 1 | 100.0% | 25.0% | 60 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | saturatedFatG | 2 | 2 | 2 (ESS 2) | 2 | 50.0% | 50.0% | 91 / 0 / 0 | family ESS <30、maker <3、推奨maker比率 >20% |
| dairy | fiberG | 9 | 9 | 7 (ESS 7) | 4 | 57.1% | 14.3% | 84 / 0 / 0 | family ESS <30、maker比率 >50%、推奨maker比率 >20% |
| dairy | calciumMg | 87 | 82 | 78 (ESS 78) | 4 | 93.6% | 1.3% | 6 / 5 / 0 | maker比率 >50%、推奨maker比率 >20% |
| dairy | ironMg | 18 | 18 | 17 (ESS 17) | 2 | 94.1% | 5.9% | 75 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | vitaminAMcg | 15 | 15 | 14 (ESS 14) | 1 | 100.0% | 7.1% | 78 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | vitaminEMg | 15 | 15 | 14 (ESS 14) | 1 | 100.0% | 7.1% | 78 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | vitaminB1Mg | 17 | 17 | 15 (ESS 15) | 2 | 93.3% | 6.7% | 76 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | vitaminB2Mg | 17 | 17 | 15 (ESS 15) | 2 | 93.3% | 6.7% | 76 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| dairy | vitaminCMg | 18 | 18 | 16 (ESS 16) | 1 | 100.0% | 6.2% | 75 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| drink_jelly_pudding | saturatedFatG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 38 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| drink_jelly_pudding | fiberG | 23 | 21 | 18 (ESS 18) | 3 | 50.0% | 5.6% | 15 / 2 / 0 | family ESS <30、推奨maker比率 >20% |
| drink_jelly_pudding | calciumMg | 7 | 7 | 6 (ESS 6) | 2 | 50.0% | 16.7% | 31 / 0 / 0 | family ESS <30、maker <3、推奨maker比率 >20% |
| drink_jelly_pudding | ironMg | 6 | 6 | 5 (ESS 5) | 2 | 60.0% | 20.0% | 32 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| drink_jelly_pudding | vitaminAMcg | 6 | 6 | 5 (ESS 5) | 1 | 100.0% | 20.0% | 32 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| drink_jelly_pudding | vitaminEMg | 6 | 6 | 5 (ESS 5) | 2 | 80.0% | 20.0% | 32 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| drink_jelly_pudding | vitaminB1Mg | 12 | 12 | 11 (ESS 11) | 2 | 54.5% | 9.1% | 26 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| drink_jelly_pudding | vitaminB2Mg | 11 | 11 | 10 (ESS 10) | 2 | 50.0% | 10.0% | 27 / 0 / 0 | family ESS <30、maker <3、推奨maker比率 >20% |
| drink_jelly_pudding | vitaminCMg | 10 | 10 | 8 (ESS 8) | 2 | 62.5% | 12.5% | 28 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| fried_food | saturatedFatG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | fiberG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | calciumMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | ironMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| fried_food | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 0 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | saturatedFatG | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 0 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| frozen_dessert | fiberG | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 0 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| frozen_dessert | calciumMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | ironMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| frozen_dessert | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | saturatedFatG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | fiberG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | calciumMg | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 0 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| noodle_flour_dish | ironMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| noodle_flour_dish | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 1 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| other_unknown | saturatedFatG | 6 | 6 | 6 (ESS 6) | 1 | 100.0% | 16.7% | 113 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | fiberG | 80 | 69 | 60 (ESS 60) | 6 | 33.3% | 1.7% | 39 / 11 / 0 | 推奨maker比率 >20% |
| other_unknown | calciumMg | 47 | 45 | 42 (ESS 42) | 5 | 33.3% | 2.4% | 72 / 2 / 0 | 推奨maker比率 >20% |
| other_unknown | ironMg | 25 | 22 | 19 (ESS 19) | 4 | 52.6% | 5.3% | 94 / 3 / 0 | family ESS <30、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | vitaminAMcg | 8 | 8 | 5 (ESS 5) | 1 | 100.0% | 20.0% | 111 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | vitaminEMg | 10 | 10 | 7 (ESS 7) | 2 | 85.7% | 14.3% | 109 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | vitaminB1Mg | 43 | 41 | 28 (ESS 28) | 2 | 85.7% | 3.6% | 76 / 2 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | vitaminB2Mg | 41 | 41 | 28 (ESS 28) | 2 | 85.7% | 3.6% | 78 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| other_unknown | vitaminCMg | 47 | 47 | 33 (ESS 33) | 3 | 78.8% | 3.0% | 72 / 0 / 0 | maker比率 >50%、推奨maker比率 >20% |
| prepared_meal | saturatedFatG | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| prepared_meal | fiberG | 7 | 7 | 7 (ESS 7) | 2 | 71.4% | 14.3% | 18 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| prepared_meal | calciumMg | 13 | 13 | 9 (ESS 9) | 2 | 77.8% | 11.1% | 12 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| prepared_meal | ironMg | 5 | 5 | 5 (ESS 5) | 1 | 100.0% | 20.0% | 20 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| prepared_meal | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| prepared_meal | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| prepared_meal | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| prepared_meal | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| prepared_meal | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 25 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sauce_spread | saturatedFatG | 6 | 6 | 6 (ESS 6) | 1 | 100.0% | 16.7% | 86 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sauce_spread | fiberG | 77 | 77 | 77 (ESS 77) | 3 | 67.5% | 1.3% | 15 / 0 / 0 | maker比率 >50%、推奨maker比率 >20% |
| sauce_spread | calciumMg | 53 | 53 | 53 (ESS 53) | 2 | 62.3% | 1.9% | 39 / 0 / 0 | maker <3、maker比率 >50%、推奨maker比率 >20% |
| sauce_spread | ironMg | 6 | 6 | 6 (ESS 6) | 2 | 66.7% | 16.7% | 86 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sauce_spread | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 92 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sauce_spread | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 92 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sauce_spread | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 92 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sauce_spread | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 92 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sauce_spread | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 92 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| snack_rice_cracker | saturatedFatG | 18 | 18 | 18 (ESS 18) | 1 | 100.0% | 5.6% | 6 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| snack_rice_cracker | fiberG | 18 | 18 | 18 (ESS 18) | 1 | 100.0% | 5.6% | 6 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| snack_rice_cracker | calciumMg | 8 | 8 | 5 (ESS 5) | 2 | 60.0% | 20.0% | 16 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| snack_rice_cracker | ironMg | 2 | 2 | 2 (ESS 2) | 1 | 100.0% | 50.0% | 22 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| snack_rice_cracker | vitaminAMcg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 24 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| snack_rice_cracker | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 24 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| snack_rice_cracker | vitaminB1Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 24 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| snack_rice_cracker | vitaminB2Mg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 24 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| snack_rice_cracker | vitaminCMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 24 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sugar_confectionery | saturatedFatG | 1 | 1 | 1 (ESS 1) | 1 | 100.0% | 100.0% | 20 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | fiberG | 6 | 6 | 4 (ESS 4) | 3 | 50.0% | 25.0% | 15 / 0 / 0 | family ESS <30、推奨maker比率 >20% |
| sugar_confectionery | calciumMg | 7 | 7 | 7 (ESS 7) | 2 | 85.7% | 14.3% | 14 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | ironMg | 5 | 5 | 5 (ESS 5) | 2 | 60.0% | 20.0% | 16 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | vitaminAMcg | 2 | 2 | 2 (ESS 2) | 1 | 100.0% | 50.0% | 19 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | vitaminEMg | 0 | 0 | 0 (ESS 0) | 0 | — | — | 21 / 0 / 0 | family ESS <30、maker <3、採用値なし |
| sugar_confectionery | vitaminB1Mg | 8 | 8 | 6 (ESS 6) | 2 | 66.7% | 16.7% | 13 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | vitaminB2Mg | 8 | 8 | 6 (ESS 6) | 2 | 66.7% | 16.7% | 13 / 0 / 0 | family ESS <30、maker <3、maker比率 >50%、推奨maker比率 >20% |
| sugar_confectionery | vitaminCMg | 12 | 12 | 10 (ESS 10) | 3 | 60.0% | 10.0% | 9 / 0 / 0 | family ESS <30、maker比率 >50%、推奨maker比率 >20% |

「観測」は対象ラベルを持つtrain record数で、estimatedも含む。「採用」はfixed値、または有効なdeclared_rangeの中点を事前分布用代表値として使える数である。declared_rangeの中点は確定点値として扱わない。不正値は負値、bool、非有限値、range順序、形式などの理由別に除外する。今回の正規化済み入力では不正除外0件だった。

独立familyは正規化したメーカー名とproductFamilyの組で数え、同一family内のrecordは合計weight 1を等分する。`effectiveFamilySampleSize`はfamily内record weightを合算してから計算するKish ESS `(Σ family weight)² / Σ(family weight²)`。makerBalanceはfamily全体へ掛けるスカラーなのでESSを変えない。最大maker比率と最大family比率は各栄養素の採用ラベルに基づく。採用値が0件の比率は未定義として`—`にした。

## prior生成への反映と解釈

prior builderはメーカー数、メーカー比率、サンプルgateを栄養素ごとの有効ラベルに限定した。表示名が同じ系列の味違いが増えても、そのfamilyの総weightは1のままにする。global分布もfamily均等weightで作り、genre分布と混ぜるglobal側の擬似標本weightは合計30となるよう正規化する。

既定の`priorStrength=30`、`minimumGenreSamples=10`（独立family数）、`minimumGenreMakers=2`は補助分布の縮約gateであり、実商品精度の証明ではない。監査の30 independent family・3 maker・最大share基準は別に判定する。実商品の精度評価や公式収集目標の完了判定とも別に扱う。アプリ用priorの再生成・採用は今回行っていない。

機械可読な集計は[nutrient_estimator_training_bias.json](./nutrient_estimator_training_bias.json)。manifest SHA-256は`79adc1258b0e0aa5a2f115bff9ada6de499c196b6912d3cd95ba334fa2eed8d2`。
