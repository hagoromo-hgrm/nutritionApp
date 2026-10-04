# Step7 確認済み既知栄養値の入力設計

2026-10-04。Step7の実装契約と検証記録。実商品精度の改善判定は別工程とし、保存済み食品・食事の一括移行は行わない。

## 採用する根拠

- 有限・非負の値で、`origin=user_input` または `manufacturer_label`、かつ `verified=true` の項目だけを既知入力にする。確認は入力内容の確認であり、分析精度の保証ではない。
- `estimated`、`derived`、`unknown`、明示的な `verified=false` は除外する。`external_source` は今回一括除外する。外部データには計算値や由来不明の値が混在し、取得内容を確認しただけでは非推定の公表値と区別できないためである。外部値を人が手修正した当該項目は、明示的な `user_input` として扱える。
- 数値を手編集した項目にだけ手入力metadataを付ける。限定した互換方針として、`Food.source=user`、当該項目のmetadataなし、旧推計・外部由来の指示なしの保存済み値だけを実効 `user_input` とする。これは旧保存済み手入力の互換解決であり、メーカー由来と推認しない。
- 当該metadataが存在する場合はlegacy fallbackしない。`open_food_facts`、`imported`、`mext` を手入力へ自動分類しない。未確認外部値は保存ボタン押下だけで確認済みにしない。
- 現行型に `estimatedNutrients` / `externalSource` は存在しないが、バックアップは余剰字段を許す。旧形式のこれらの指示が存在する場合は、構造を解釈できなければlegacy fallbackを止める。食品名、JAN、sourceVersionの曖昧な文字列から推測しない。
- 読み込み時のDB一括書換えや食事snapshotの書換えはしない。互換解決の根拠は推計入力snapshotへ保存し、旧除外指示が保存時に失われないよう未確認metadataを保持する。通常の旧手入力は実際の数値編集までmetadataなしを保ち、保存ボタンだけで明示確認へ昇格させない。

## 共通処理と自己項目の除外

UI、store、coreで同一の確認済み入力helperを使用する。値、栄養素ごとのmetadata、食品source、legacy除外指示を入力とし、使用値と使用根拠を返す。空文字を数値0に変換しない。

core入口で `requestedNutrients` に含まれる項目自身を既知値とStep6参照区間の両方から除外する。除外後の集合だけを候補のquick評価、fit、飽和脂肪酸比率prior、親栄養素の包含制約へ渡す。評価器のLOTOでは対象ごとに除外する。直接coreを呼び出してもUI/storeのガードを迂回できない構成にする。

未確認の脂肪ゼロから飽和脂肪酸ゼロを導出しない。未確認の炭水化物を繊維上限にしない。表示ゼロの確認済み参照区間が正の上限を持つ場合は、真のゼロの証拠と区別する。現行の包含制約と零値分類との仕様差はrequirements/decisionsへ明示し、無言で変更しない。

新しい栄養素の重み・スケールは今回の確認済み入力の伝播と切り離す。Step6で定義された目的関数を使用し、非公開ラベルから係数を調整しない。

## ファイル別の実装指示

| 対象 | 最小変更 |
| --- | --- |
| `src/types/index.ts` | 既知栄養値と確認根拠のsnapshot型を追加。Step6の参照区間・fit modeをそのまま保持。全栄養素の候補を型で受け、対象自身はcoreで除外。 |
| 共通入力helper | confirmed判定、限定legacy解決、対象除外、canonical入力構築を集約。外部値の取得や食品内容の推測をしない。 |
| `src/components/FoodFormView.tsx` | 当該数値の手編集時、元の外部・メーカー・推計metadataを継承せず `user_input, verified:true` に置換。旧source、推計request、校正、参照食品ID等を除去。空欄ならmetadataも除去。 |
| `src/components/formDrafts.ts` | 外部previewの値に未確認external metadataを付ける。draft変換・複製で新しい入力根拠をdeep copy。legacyは共通helper経由で解決。 |
| `src/components/NutrientEstimatePanel.tsx` | 共通helperの値と根拠をrequestへ渡す。requestKeyに値・origin・verified・source・参照区間・requestedKeys・modeを含め、根拠だけの変更でも結果を無効化。 |
| `src/services/nutrientEstimator.ts` | core入口でconfirmed集合と対象除外を確定。候補評価、fit、ratio prior、capsの全経路に同じ集合を渡す。Step6の作業中箇所とは統合順を調整。 |
| `src/services/nutrientEstimationStore.ts` | 全nonnull値の採用を廃止しhelperを使用。実際のrequest内容と根拠をreadonly snapshotへdeep copyする。 |
| `src/services/foodRevision.ts` | 全14値、origin/verified/source、食品sourceとlegacy判定に関わる指示を安定順で入力hashへ含める。run固有の対象・mode・refsは別のrequest fingerprintへ含める。hash形式の版を区別。 |
| `src/App.tsx` / `src/services/foodEstimationSave.ts` | 主要5項目だけの一致判定とFoodからのrequest再生成を廃止。評価に実際に使用したrequestを保存型へ変換し、共通fingerprintで照合。採用予定値を既知入力へ混ぜず採用前の値で比較。更新・request・result・判断履歴は既存transactionで一括保存。 |
| `src/services/backup.ts` | 新規snapshot根拠字段を検証。旧snapshotでは任意とし、旧値を確認済みに昇格させない。不正値・不正enum・非有限区間を拒否。旧hashによる未採用結果は再推計を要求し、旧履歴は保持。 |
| snapshot/CSVの複製・検証箇所 | 新しいFood metadata字段を追加した場合だけ `mealMenuSnapshots.ts`、`menuSetMeals.ts`、`foodPresentation.ts`、`csv.ts` のcopy/validationを揃える。既存食事の数値は変更しない。 |
| `docs/requirements.md` / `docs/decisions.md` | 上記のconfirmed条件、legacy例外、external除外、確認と精度保証の違い、自己項目除外、hash変更を実装時に記録。 |

Food revisionは食品の競合検出、request fingerprintは計算内容の一致検出を担う。日時等の保存時に変わる字段と計算内容を混同せず、実requestのrefs/modeを新しいFoodから再生成して失わないようにする。

## Step6完了後の具体的な分担

現行Step6ではcore requestに `fitMode`、`knownNutrientReferences`、`knownNutrientReferenceBasis` があるが、保存型 `NutritionEstimationInput` とPanelにはまだ伝播していない。fit keysは主要5項目に限定されている。この差を次の順序で解消する。

1. **契約を先に確定する担当**：共通型と純粋helperを追加する。`knownNutrients` と `knownNutrientReferences` のキーを全 `NutrientKey` へ拡張し、`knownNutrientEvidence` に許可origin、verified、source、明示/legacy解決の区別を保存する。snapshotにはStep6の3字段、明示requestedKeys、evidence、計算内容fingerprintを持たせる。metadata・値・refsを別々に解釈せず、一つのcanonical入力から生成する。型の編集者は一人にする。
2. **core/store/UI担当**：estimator、confirmed helper、store、FoodFormView、formDrafts、Panel、App、foodEstimationSaveと関連テストを担当する。全14項目を同じStep6目的関数の観測候補にし、対象自身と不許可根拠を入口で除外。新たな重みは追加しない。明示requestedKeysがなければ既存の全9対象の既定値を維持するため、追加9既知値を利用するUI/storeは実際の欠損対象を明示する。
3. **backup/hash担当**：契約確定後にfoodRevision、request canonicalization/fingerprint、backup検証、必要なsnapshot/CSVのcopy/validationと関連テストを担当する。core/store/UI担当はここで提供された比較関数を呼び、独自のJSON比較を追加しない。型変更の追加要望は契約担当へ戻す。
4. **統合担当**：実requestと保存snapshotの一致、採用前Foodとの照合、metadataのみの変更時の競合、旧backupの扱いを確認する。片側だけの変更を完成扱いにしない。requirements/decisionsの更新も統合時に行う。

bare known数値やStep6 referenceの `verified=true` だけではconfirmed根拠を新たに作らない。直接core呼び出しもallowed originを伴う必要がある。既存の直接呼び出しテストや評価器は、許可された根拠を明示するよう更新する。参照の `kind=estimated` はメーカー由来でもfitに使わず、数値へのfallbackで再投入しない。対象参照は検証・fit前に除外して、自己項目の参照が探索や検証分岐へ影響しないようにする。

## Step8との重量段階の境界

原材料表示順の制約はraw重量の順序として扱い、確認済みfinished重量を同じordered simplexへ投入しない。最小対応では、raw配合証拠は検証・保存した上でStep9まで適用保留にする。finished配合証拠は、同じ階層の全兄弟のfinished重量または比率が確認され、基準と合計が一致する場合だけ、固定混合として使用する。その群の比率探索と順序投影をスキップする。finished順序が表示順と逆でも、それだけを理由に拒否しない。

部分的なfinished anchorだけでは、残りのfinished重量をraw順序から決められないため、その群の証拠適用を保留する。根拠を黙って無視した通常推計として返さず、deferred理由をtraceへ残す。Step9でraw/finished対応が確認できた場合も、rawの順序制約とfinishedへの重量換算は分離する。finished重量からraw重量を逆算するには別の明示証拠が必要である。

群内が全固定でも、親群に未指定兄弟がある場合は親の順序制約はraw空間に限る。raw/finishedを跨ぐ親子積は確認済み換算がなければ保留。未知参照やゼロ重量はそれぞれ欠損/寄与なしとして区別し、固定混合の適用を理由に欠損栄養素を0にしない。

## 測定可能な受入ゲート

1. metadataなしの旧 `source=user` 主要5項目が使用され、旧追加栄養素も同じ条件で使用される。`source=open_food_facts/imported/mext` は同じ値でも使用されない。
2. verified manual/manufacturerだけが採用され、external/estimated/derived/unknownと明示verified=falseは各栄養素で除外される。legacy除外指示の存在でfallbackが止まる。
3. 外部取得後の保存押下だけではtrusted化しない。外部由来の値を手編集すると当該項目だけuser_inputへ変わり、元source・推計情報が残らない。空欄は0にならない。
4. requested対象の値または参照区間を意図的に混入させても、その対象のfit/caps/priorに使用されない。複数対象では全対象が除外される。
5. 未確認脂肪0、未確認炭水化物によるcaps/zeroEvidenceが発生しない。確認済み入力では既定の包含制約が動作し、区間の表示0と真の0証拠を混同しない。
6. 値が同一でもorigin/verified/source/refs/modeが変われば旧結果を採用できない。全9追加項目のいずれかの根拠変更を主要5だけの一致判定で見逃さない。
7. request/snapshot作成後に元metadataやrefsを変更しても保存snapshotが変わらない。保存後のsnapshotと実際の評価requestの値・根拠・refs・modeが一致する。
8. 旧JSONの履歴を復元可能、新JSONの新字段を往復保持、不正新字段では既存DBを変更しない。旧採用済み履歴を後からmanualへ分類しない。
9. 保存中の競合・transaction失敗ではFood/request/result/判断履歴の一部だけを保存しない。採用取消しと過去食事snapshotの非遡及を維持する。

実装時の検証は型チェック、関連するstore/form/save/backup/coreテスト、lint、build。実商品精度の改善判定は別工程であり、本変更だけから改善値を主張しない。
