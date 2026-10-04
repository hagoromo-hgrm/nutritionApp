# Step14 教師値の厳密監査と系列レビュー

2026-10-04。コード・公開schemaの読み取りに基づく実装計画。private/sealedのラベルを閲覧せず、実データの再生成・精度測定・係数変更は実施していない。

## 現状の穴

- `build_spu_estimator_training.py` は栄養文に「推定値」があれば全栄養素へ同じestimatedフラグを渡す。項目限定の注記と表示全体の注記を区別しない。
- `parse_nutrient` は同名項目を後ろから探し、最後の有効値を選ぶ。矛盾した重複値を検出せず、数字前の一般文字列パターンが負号等を飲み込む恐れがある。逆転範囲はmin/maxで並べ替えてしまう。
- 基準量は最初の栄養素より前から取得し、全項目のbasis文字列へ流用する。行中の後続基準や複数表示パネルとの対応を保証しない。
- `product_family` は商品名の容量等を取り除く自動候補。`validate_nutrient_estimator_training.py` のmanifest生成は非推定レコード数を `independentEvaluationCounts` と呼ぶが、手動系列確認や系列単位の独立性を保証するものではない。
- Python厳密監査にはsource bytes hash、normalized hash、ID集合、genre/group、split分離の検証がある。一方prior builderの単独呼び出しは同等の監査を必須にしていない。共通入口へ統合する必要がある。

既存の自動系列と未レビュー教師から生成されたpriorは、現行の弱いlegacy根拠として保持する。Step14の実装完了だけを理由に、現行生成物を厳密確認済み・形式的に独立な教師へ再分類しない。

## 1. 栄養表示の項目単位parse

normalizerは「基準パネル→栄養項目→注記」を先に区切り、各項目に出典位置を対応させる。正規化前の文、source bytes SHA256、行番号、項目のspan、注記span、基準spanは非公開の監査sidecarへ保持する。公開レポートには理由ごとの集計だけを出す。

parseの結果は値だけでなく `accepted / review_required / rejected`、reason、`annotationScope=none/per_nutrient/whole_panel/unresolved` を返す。曖昧な候補をfixedとして正式教師へ投入しない。estimatedはその種類を記録したまま独立ラベル・fit・formal priorから除外する。

- 「食物繊維のみ推定値」等の明示項目限定注記は当該項目だけestimated。表示全体を対象とする注記は同じパネルの全項目へ適用。
- 脚注記号を項目と注記へ一意に結合できない場合はscope unresolved。どの項目かを都合よく推測せず、そのパネルのformal利用を保留する。注記の語を単に削除してfixed値を残さない。
- 一つの正規教師レコードは一つの明示基準・一つの材料状態。100gと1袋、調理前と調理後等の複数パネルが同じ行にあれば自動で合成しない。源データで明示分離できない行は保留する。
- g/ml/個を混同しない。個・袋の明示重量が確認できる場合だけ対応させ、密度や容量から質量を推測しない。栄養項目のbasisとレコードのstructured basisを検証する。
- 同じ項目の同じ値・単位・基準・valueKindの重複だけを一つへまとめる。異なる値、範囲と点値の混在、異なる注記、違う基準はconflicting duplicate。最後の一致や平均、最も狭い区間を選ばず、その項目を正式教師から除外する。
- 字句解析では数値の符号を保持する。負値、負の範囲端、NaN/Infinity、Python bool、部分的にだけ解析された数値、明示単位不一致を拒否する。`脂質 -1g` を1gとして読まない。
- `5〜2g` はreversed rangeとして拒否し、並べ替えない。範囲は端点を保持し、fixed値や教師truthの中点へ変換しない。decimalPlacesは元表記から保持する。
- 「未記載」「掲載なし」は欠損であり0ではない。不等号や検出限界はその意味を表現できるschemaを採用するまではreview_requiredとする。

行を除外した場合も原材料カバレッジ調査の非教師経路は別に維持できる。栄養値のparse失敗を無警告の教師採用で補わない。

## 2. schemaと源確認

厳密教師は新しいformat/transform版で生成し、旧v1を黙って厳密形式へ上書きしない。新labelにはstructured basisとannotation/source確認の根拠を持たせる。audit sidecarは値の採否と理由を保持するが、未確認候補を正規教師のaccepted labelへ混ぜない。

`sourceType=package/manufacturer`、非推定fixed/declared_range、一意な基準・状態、項目注記の確認済み対応がformal labelの必要条件。public_database/other、origin不明、メーカー一覧URLだけで個票の根拠が追えない値は、formal source確認を満たしたことにしない。ファイル名の日付だけを人的なverifiedAtと扱わず、取得日時と確認日時を区別する。

当面、区間は評価・fitで端点のまま使用する。legacy prior builderが宣言範囲の中点を代表値として使う場合、その用途をpriorの代表値に限定し、fixed教師や規制上の真値とは呼ばない。厳密priorで範囲をどう扱うかは別の明示設計とし、新係数や中点collapseの変更をこの監査に混ぜない。

## 3. 人による系列確認がformal独立性のゲート

自動 `productFamily` はレビュー候補に留める。別のprivate family-review sidecarに、source dataset hash、record ID→canonical family ID、review status、reviewer、日時、判断根拠、review版を保持する。対応はsource hashへ拘束し、商品情報が更新されたら再確認する。商品名や個票は公開artifactへ出さない。

正式な独立評価・校正済みという主張には、全利用レコードの系列レビュー済み対応、同系列のsplit横断なし、source label確認、モデル/設定固定が必要。レビュー不足が一件でも対象範囲に残る場合、その範囲は `legacy_unreviewed / retrospective` と表示し、formal independentとは呼ばない。

同一makerでも容量・包装・類似名が違うだけの系列、別名系列、味違い、OEM等の潜在的な重複を人が確認する。名前から異なる系列だと証明しない。統合された系列が既存splitを跨げば監査失敗とし、スコアをよくするために一部だけ移動しない。新しい正式splitを固定する場合は別manifest版とし、既に見た評価値は未見評価へ再分類しない。

今回の作業者はprivate/sealedラベルを読む必要がない。型・検証器・合成fixtureを先に実装する。実系列の人的レビューと未見評価解放は別工程であり、レビューが未完なら形式的な独立性は未達と報告する。

## 4. dataset/manifest/priorの一致検証

既存の厳密監査を共通ライブラリへ切り出し、validator、prior builder、bias auditが同じ検証を呼ぶ。要求事項はraw sourceFileSha256、Python正規化後のnormalizedDatasetSha256、record IDの重複なし・全単射、genre/group一致、正しいsplit enum、同一groupのsplit横断なし、review sidecarのsource hash/ID一致。重複manifest IDでdictが上書きする前に拒否する。

normalizedDatasetSha256はPythonの正規化JSONを対象にする。floatの `1.0` とTypeScriptの `1` の違いがあるため、TSのJSON.stringifyで同じhashを作れると仮定しない。TS evaluatorはraw source bytes SHA256とID/genre/group/splitの全単射を検証し、normalized hashは同じPython正規化で監査済みのartifactへ拘束する。跨言語canonical方式を新設する必要はない。

prior生成は一致検証に合格したtrainだけを使用。calibration/test/別封印評価をprior生成へ渡さない。ratioは分子・分母両方が同じ基準・非推定・確認済みであることを検証する。誤ったtruthを比率やジャンル分布へ迂回投入しない。

prior metadataに `teacherAuditStatus=legacy_unreviewed/strict_reviewed`、transform版、family-review hash、source/manifest hashを保持する。既存priorは数値を変えずlegacy_unreviewedとして追跡し、その使用をtraceへ伝播する。sampleSizeだけを正式な独立系列数と呼ばず、record数とreview済み系列数を分ける。弱いlegacyとして維持することは新たな統計的保証や重みの変更を意味しない。

訓練のprovenanceと別評価データのprovenanceは分離する。現行evalのprior hashと評価manifest hashの同値要求を、別の正式評価にそのまま使用しない。訓練artifactのhashを本当の訓練source/manifestへ照合し、別評価source/manifestは独立に検証する。封印解放前にモデルGit SHA・版・設定を固定する工程を維持する。

## ファイル別の実装順

| 対象 | 変更 |
| --- | --- |
| `scripts/build_spu_estimator_training.py` | basis panel分割、項目span/注記scope、符号を保持するparse、全重複候補の照合、理由付き除外。自動familyには未レビューを明示。 |
| `data/estimator/training_schema.json` | 厳密版のstructured basis/annotation/source確認の型。旧v1を別形式として保持。scope不明をacceptedへ変換しない。 |
| `scripts/validate_nutrient_estimator_training.py` | bool/未知字段/状態・基準矛盾を検証。rangeを並べ替えない。raw/normalized hashesとID全単射を必須化。非推定record数を独立確認数と呼ばない。 |
| 共通Python audit helper | 既存bias auditの源一致検証を再利用。private family-review sidecarの全対応とsplit横断を検証。 |
| `scripts/build_spu_genre_nutrient_priors.py` | 共通監査を必須入口へ。train以外を排除。監査statusをartifactへ保持。既存未レビュー生成物の数値を勝手に再調整しない。 |
| `scripts/audit_nutrient_estimator_training_bias.py` | label品質・basis・annotation・review済み系列数を理由別集計。個票を公開出力しない。 |
| `scripts/evaluate_spu_nutrient_estimator.ts` | raw bytes検証と厳密ID対応。対象自身のknown値/refs除外。範囲評価を維持。正式独立性の不足時はformal claimを拒否。 |
| prior型/trace/docs | legacy根拠とstrict確認済み根拠を表示/監査上区別。統計的校正や実商品精度の改善をこの変更から主張しない。 |

## 合成fixtureでの受入ゲート

1. 一項目だけ推定の注記で他の確認済み項目を全estimatedにしない。全体注記では全項目を除外。脚注scope不明をformalに入れない。
2. 100gと1袋の混在、調理前後のパネル混在、未知重量のml/個は保留。全項目のbasis対応が一意でないレコードを正式教師にしない。
3. 同値重複は統合、矛盾重複は除外。負値、負の端点、逆転範囲、NaN/Infinity、bool、不等号の未対応形式が正値/fixedへ化けない。
4. declared rangeの両端・桁数が往復保持され、評価・robust fitで中点へ潰れない。推定範囲も独立教師へ混入しない。
5. source bytes変更、normalized hash変更、manifest重複/欠落/余分ID、genre/group不一致、split横断、review sidecarの源不一致で監査失敗。
6. 未レビュー系列が残ればformal independent claimが拒否され、既存priorはlegacyとして動作を維持。review済みfixtureだけstrict statusになる。record数の増加を系列独立数の増加にしない。
7. train以外をprior builderへ混入させない。異なる評価sourceを訓練hashと同値扱いしない。sealed sourceを通常のparse/prior/開発評価経路から開かない。

確認に不足するsource・脚注scope・系列の取得/人的レビューは残作業として集計する。監査コードの完成と、実教師のレビュー完了を別の完了条件にする。

## 実装結果（2026-10-04、Step14）

normalizer transform0.5.0で符号/順序/重複/単位/項目注記/混在basisの検証を追加。v1レコードへstrict確認済みstatusを黙って付けず、private notesにsource bytes hash、source row、原栄養文、normalized宣言位置、structured g基準、annotationScope、legacy_unreviewedを保持する。これは新しい正式教師形式へ再分類する変更ではない。estimated範囲はv1の代表値要求に対応したlegacy代表値と両端を保持し、fixed truthやformal priorへ昇格させない。

`nutrient_estimator_integrity.py`はbias audit/prior CLI共通の源一致入口。新しい別形式のreview sidecar schemaで人的なlabel/family確認を受け付け、sourcehash/ID全単射/canonical family跨splitを検証する。`--require-strict-review`では全対応と基準/状態/注記/出典確認を必須にする。既存prior数値は再調整せずlegacy_unreviewedをtraceへ伝播。旧自動系列の全人的レビュー、公式個票の再確認、源再収集は未実施であり、formal independent/strict-reviewedの条件は未達と明示する。旧教師は開発用の後ろ向き校正としてだけ用いる。
