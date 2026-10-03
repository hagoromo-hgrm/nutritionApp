# 栄養推定 fit mode 校正split比較

この比較は既存教師データのcalibration splitだけを使った補助評価です。商品ごとの情報、表示値、原材料、family名、record IDは掲載していません。

全対象をまとめた既定方式の推奨: legacy_point（robust_interval適格な栄養素 1/9）。ジャンル・栄養素別の推定種別内訳はJSONに記録しています。

対象校正レコード数: 128。対象は各行の栄養素について、fixedまたは有効なdeclared rangeラベルがあるレコードです。

固定表示値のMAEとbiasは、印刷された値そのものを点として計算しました。declared rangeの中点は正解値として扱わず、CAA区間または表示範囲からの点推定距離をintervalOutsideMAEに集計しています。推定範囲とのoverlapは区間の重なり率であり、真のcoverageを意味しません。誤差と範囲幅はすべて100gあたりへ換算しています。

CAA interval rule: caa-label-tolerance-2026-10-01-v1。Estimator: browser-rule-0.25.0。

各栄養素は個別requestで推定し、両方式のrequest ID・verifiedAt・既定ratio strategy・候補由来の探索回数を揃えました。方式以外のrequest設定は共通です。

## 栄養素別

| 栄養素 | 観測 / 採用 | 欠損 / estimated / invalid | 独立family / maker / 最大maker share | paired n / 非退行 | 評価下限の不足 | 推奨 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| saturatedFatG | 28 / 28 | 100 / 0 / 0 | 28 / 1 / 100.0% | 28 / 退行あり | 独立family数が30未満、メーカー数が3未満、最大メーカーshareが50%超 | legacy_point |
| fiberG | 74 / 69 | 54 / 5 / 0 | 60 / 6 / 46.7% | 69 / 非退行 | なし | robust_interval |
| calciumMg | 57 / 55 | 71 / 2 / 0 | 47 / 7 / 57.4% | 55 / 非退行 | 最大メーカーshareが50%超 | legacy_point |
| ironMg | 11 / 11 | 117 / 0 / 0 | 9 / 3 / 44.4% | 11 / 退行あり | 独立family数が30未満 | legacy_point |
| vitaminAMcg | 8 / 8 | 120 / 0 / 0 | 6 / 2 / 50.0% | 8 / 退行あり | 独立family数が30未満、メーカー数が3未満 | legacy_point |
| vitaminEMg | 7 / 7 | 121 / 0 / 0 | 5 / 2 / 60.0% | 7 / 退行あり | 独立family数が30未満、メーカー数が3未満、最大メーカーshareが50%超 | legacy_point |
| vitaminB1Mg | 19 / 19 | 109 / 0 / 0 | 14 / 2 / 57.1% | 19 / 非退行 | 独立family数が30未満、メーカー数が3未満、最大メーカーshareが50%超 | legacy_point |
| vitaminB2Mg | 18 / 18 | 110 / 0 / 0 | 13 / 2 / 61.5% | 18 / 退行あり | 独立family数が30未満、メーカー数が3未満、最大メーカーshareが50%超 | legacy_point |
| vitaminCMg | 15 / 15 | 113 / 0 / 0 | 12 / 4 / 66.7% | 15 / 非退行 | 独立family数が30未満、最大メーカーshareが50%超 | legacy_point |

| 栄養素 | mode | 利用可能 / 採用数 (availability) | 固定値MAE / bias | intervalOutsideMAE | 推定range幅 / target区間幅 | interval overlap |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| saturatedFatG | legacy_point | 28 / 28 (100.0%) | 2.036 / -0.659 | 0.474 | 17.795 / 5.694 | 96.4% |
| saturatedFatG | robust_interval | 28 / 28 (100.0%) | 2.125 / -0.706 | 0.465 | 17.623 / 5.694 | 96.4% |
| fiberG | legacy_point | 69 / 69 (100.0%) | 7.037 / -3.700 | 4.817 | 6.030 / 3.770 | 81.2% |
| fiberG | robust_interval | 69 / 69 (100.0%) | 6.702 / -3.714 | 4.738 | 6.477 / 3.770 | 82.6% |
| calciumMg | legacy_point | 55 / 55 (100.0%) | 308.472 / -174.726 | 232.236 | 390.266 / 265.037 | 74.5% |
| calciumMg | robust_interval | 55 / 55 (100.0%) | 304.479 / -164.694 | 227.429 | 414.471 / 265.037 | 78.2% |
| ironMg | legacy_point | 11 / 11 (100.0%) | 7.149 / -7.124 | 3.938 | 20.010 / 10.814 | 81.8% |
| ironMg | robust_interval | 11 / 11 (100.0%) | 7.151 / -7.126 | 4.079 | 20.698 / 10.814 | 81.8% |
| vitaminAMcg | legacy_point | 8 / 8 (100.0%) | 825.458 / -825.458 | 482.491 | 314.703 / 739.501 | 37.5% |
| vitaminAMcg | robust_interval | 8 / 8 (100.0%) | 825.463 / -825.463 | 482.539 | 369.146 / 739.501 | 37.5% |
| vitaminEMg | legacy_point | 7 / 7 (100.0%) | 4.009 / -4.009 | 2.678 | 5.621 / 2.883 | 71.4% |
| vitaminEMg | robust_interval | 7 / 7 (100.0%) | 4.236 / -4.236 | 2.872 | 6.192 / 2.883 | 71.4% |
| vitaminB1Mg | legacy_point | 19 / 19 (100.0%) | 2.125 / -2.125 | 1.292 | 0.795 / 1.722 | 36.8% |
| vitaminB1Mg | robust_interval | 19 / 19 (100.0%) | 2.107 / -2.107 | 1.279 | 0.875 / 1.722 | 36.8% |
| vitaminB2Mg | legacy_point | 18 / 18 (100.0%) | 2.315 / -2.315 | 1.537 | 1.611 / 2.004 | 50.0% |
| vitaminB2Mg | robust_interval | 18 / 18 (100.0%) | 2.315 / -2.315 | 1.538 | 1.773 / 2.004 | 50.0% |
| vitaminCMg | legacy_point | 15 / 15 (100.0%) | 282.648 / -282.648 | 201.380 | 243.242 / 256.676 | 66.7% |
| vitaminCMg | robust_interval | 15 / 15 (100.0%) | 282.648 / -282.648 | 201.379 | 261.207 / 256.676 | 66.7% |

独立family 30以上、メーカー3以上、最大メーカーshare 50%以下を各栄養素の評価下限としました。下限未達またはpaired非退行を確認できない場合はlegacy_pointを推奨します。

## ジャンル別 availability

| ジャンル | 栄養素 | 対象参照数 | legacy | robust |
| --- | --- | ---: | ---: | ---: |
| baked_sweets | saturatedFatG | 8 | 100.0% | 100.0% |
| baked_sweets | fiberG | 9 | 100.0% | 100.0% |
| baked_sweets | calciumMg | 1 | 100.0% | 100.0% |
| baked_sweets | ironMg | 1 | 100.0% | 100.0% |
| baked_sweets | vitaminAMcg | 0 | — | — |
| baked_sweets | vitaminEMg | 0 | — | — |
| baked_sweets | vitaminB1Mg | 0 | — | — |
| baked_sweets | vitaminB2Mg | 0 | — | — |
| baked_sweets | vitaminCMg | 0 | — | — |
| cake_pastry | saturatedFatG | 0 | — | — |
| cake_pastry | fiberG | 1 | 100.0% | 100.0% |
| cake_pastry | calciumMg | 0 | — | — |
| cake_pastry | ironMg | 0 | — | — |
| cake_pastry | vitaminAMcg | 0 | — | — |
| cake_pastry | vitaminEMg | 0 | — | — |
| cake_pastry | vitaminB1Mg | 0 | — | — |
| cake_pastry | vitaminB2Mg | 0 | — | — |
| cake_pastry | vitaminCMg | 0 | — | — |
| bread | saturatedFatG | 0 | — | — |
| bread | fiberG | 0 | — | — |
| bread | calciumMg | 0 | — | — |
| bread | ironMg | 0 | — | — |
| bread | vitaminAMcg | 0 | — | — |
| bread | vitaminEMg | 0 | — | — |
| bread | vitaminB1Mg | 0 | — | — |
| bread | vitaminB2Mg | 0 | — | — |
| bread | vitaminCMg | 0 | — | — |
| chocolate | saturatedFatG | 12 | 100.0% | 100.0% |
| chocolate | fiberG | 22 | 100.0% | 100.0% |
| chocolate | calciumMg | 6 | 100.0% | 100.0% |
| chocolate | ironMg | 4 | 100.0% | 100.0% |
| chocolate | vitaminAMcg | 4 | 100.0% | 100.0% |
| chocolate | vitaminEMg | 4 | 100.0% | 100.0% |
| chocolate | vitaminB1Mg | 8 | 100.0% | 100.0% |
| chocolate | vitaminB2Mg | 8 | 100.0% | 100.0% |
| chocolate | vitaminCMg | 5 | 100.0% | 100.0% |
| sugar_confectionery | saturatedFatG | 0 | — | — |
| sugar_confectionery | fiberG | 0 | — | — |
| sugar_confectionery | calciumMg | 0 | — | — |
| sugar_confectionery | ironMg | 0 | — | — |
| sugar_confectionery | vitaminAMcg | 0 | — | — |
| sugar_confectionery | vitaminEMg | 0 | — | — |
| sugar_confectionery | vitaminB1Mg | 0 | — | — |
| sugar_confectionery | vitaminB2Mg | 0 | — | — |
| sugar_confectionery | vitaminCMg | 2 | 100.0% | 100.0% |
| snack_rice_cracker | saturatedFatG | 4 | 100.0% | 100.0% |
| snack_rice_cracker | fiberG | 4 | 100.0% | 100.0% |
| snack_rice_cracker | calciumMg | 0 | — | — |
| snack_rice_cracker | ironMg | 0 | — | — |
| snack_rice_cracker | vitaminAMcg | 0 | — | — |
| snack_rice_cracker | vitaminEMg | 0 | — | — |
| snack_rice_cracker | vitaminB1Mg | 0 | — | — |
| snack_rice_cracker | vitaminB2Mg | 0 | — | — |
| snack_rice_cracker | vitaminCMg | 0 | — | — |
| frozen_dessert | saturatedFatG | 0 | — | — |
| frozen_dessert | fiberG | 0 | — | — |
| frozen_dessert | calciumMg | 0 | — | — |
| frozen_dessert | ironMg | 0 | — | — |
| frozen_dessert | vitaminAMcg | 0 | — | — |
| frozen_dessert | vitaminEMg | 0 | — | — |
| frozen_dessert | vitaminB1Mg | 0 | — | — |
| frozen_dessert | vitaminB2Mg | 0 | — | — |
| frozen_dessert | vitaminCMg | 0 | — | — |
| dairy | saturatedFatG | 0 | — | — |
| dairy | fiberG | 0 | — | — |
| dairy | calciumMg | 26 | 100.0% | 100.0% |
| dairy | ironMg | 2 | 100.0% | 100.0% |
| dairy | vitaminAMcg | 1 | 100.0% | 100.0% |
| dairy | vitaminEMg | 1 | 100.0% | 100.0% |
| dairy | vitaminB1Mg | 1 | 100.0% | 100.0% |
| dairy | vitaminB2Mg | 1 | 100.0% | 100.0% |
| dairy | vitaminCMg | 1 | 100.0% | 100.0% |
| drink_jelly_pudding | saturatedFatG | 0 | — | — |
| drink_jelly_pudding | fiberG | 11 | 100.0% | 100.0% |
| drink_jelly_pudding | calciumMg | 4 | 100.0% | 100.0% |
| drink_jelly_pudding | ironMg | 1 | 100.0% | 100.0% |
| drink_jelly_pudding | vitaminAMcg | 3 | 100.0% | 100.0% |
| drink_jelly_pudding | vitaminEMg | 2 | 100.0% | 100.0% |
| drink_jelly_pudding | vitaminB1Mg | 7 | 100.0% | 100.0% |
| drink_jelly_pudding | vitaminB2Mg | 6 | 100.0% | 100.0% |
| drink_jelly_pudding | vitaminCMg | 2 | 100.0% | 100.0% |
| fried_food | saturatedFatG | 0 | — | — |
| fried_food | fiberG | 0 | — | — |
| fried_food | calciumMg | 0 | — | — |
| fried_food | ironMg | 0 | — | — |
| fried_food | vitaminAMcg | 0 | — | — |
| fried_food | vitaminEMg | 0 | — | — |
| fried_food | vitaminB1Mg | 0 | — | — |
| fried_food | vitaminB2Mg | 0 | — | — |
| fried_food | vitaminCMg | 0 | — | — |
| noodle_flour_dish | saturatedFatG | 0 | — | — |
| noodle_flour_dish | fiberG | 0 | — | — |
| noodle_flour_dish | calciumMg | 0 | — | — |
| noodle_flour_dish | ironMg | 0 | — | — |
| noodle_flour_dish | vitaminAMcg | 0 | — | — |
| noodle_flour_dish | vitaminEMg | 0 | — | — |
| noodle_flour_dish | vitaminB1Mg | 0 | — | — |
| noodle_flour_dish | vitaminB2Mg | 0 | — | — |
| noodle_flour_dish | vitaminCMg | 0 | — | — |
| prepared_meal | saturatedFatG | 0 | — | — |
| prepared_meal | fiberG | 3 | 100.0% | 100.0% |
| prepared_meal | calciumMg | 7 | 100.0% | 100.0% |
| prepared_meal | ironMg | 1 | 100.0% | 100.0% |
| prepared_meal | vitaminAMcg | 0 | — | — |
| prepared_meal | vitaminEMg | 0 | — | — |
| prepared_meal | vitaminB1Mg | 0 | — | — |
| prepared_meal | vitaminB2Mg | 0 | — | — |
| prepared_meal | vitaminCMg | 0 | — | — |
| sauce_spread | saturatedFatG | 1 | 100.0% | 100.0% |
| sauce_spread | fiberG | 12 | 100.0% | 100.0% |
| sauce_spread | calciumMg | 6 | 100.0% | 100.0% |
| sauce_spread | ironMg | 0 | — | — |
| sauce_spread | vitaminAMcg | 0 | — | — |
| sauce_spread | vitaminEMg | 0 | — | — |
| sauce_spread | vitaminB1Mg | 0 | — | — |
| sauce_spread | vitaminB2Mg | 0 | — | — |
| sauce_spread | vitaminCMg | 0 | — | — |
| other_unknown | saturatedFatG | 3 | 100.0% | 100.0% |
| other_unknown | fiberG | 7 | 100.0% | 100.0% |
| other_unknown | calciumMg | 5 | 100.0% | 100.0% |
| other_unknown | ironMg | 2 | 100.0% | 100.0% |
| other_unknown | vitaminAMcg | 0 | — | — |
| other_unknown | vitaminEMg | 0 | — | — |
| other_unknown | vitaminB1Mg | 3 | 100.0% | 100.0% |
| other_unknown | vitaminB2Mg | 3 | 100.0% | 100.0% |
| other_unknown | vitaminCMg | 5 | 100.0% | 100.0% |

## 入力整合性

- Calibration records: 128
- Source file SHA-256: `3edf63aa78c138460c528a75a1870839c710332e68f781cab86aff93132db89b`
- Normalized canonical SHA-256: `bd2b3230343b917e4fa8c542043519f8c532b9f967f8feb44056b4c273e246e3`
- Manifest SHA-256: `79adc1258b0e0aa5a2f115bff9ada6de499c196b6912d3cd95ba334fa2eed8d2`
- Source/manifest hashes and canonical normalized hash were checked by the Python dataset audit before evaluation; IDs were checked as a one-to-one mapping and split-family leakage was rejected.

familyは正規化したメーカー名とproductFamilyを使う分割単位です。これは同一系列内の漏出を抑えるための代理単位で、各familyが別配合・別商品の独立な標本であることまでは保証しません。

このcalibration標本は実商品精度の証明ではありません。推定方式の既定値変更や公式評価の代替には使わず、別途定義された正式評価条件と混同しません。
