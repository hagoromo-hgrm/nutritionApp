# Step8–10 明示配合・加工・添加量の証拠入力

2026-10-04。Step8の実装契約とStep9–10の設計・適用限界。公式の公開資料だけを確認した。private/sealed商品ラベル、実商品改善結果、配合の逆算は使用していない。後続段階の型は実装前の案として区別する。

## 最小の対応範囲

| 段階 | 今回計算するもの | 保存するが適用保留にするもの |
| --- | --- | --- |
| Step8 | 同じ階層で全兄弟を指定したfinished配合の固定混合。参照状態がfinished配合と一致する場合だけ。 | 部分finished配合、raw配合、raw/finishedを跨ぐ親子換算の根拠不足。 |
| Step9 | 一つの明示工程について、加工前可食重量・加工後可食重量・入力profile状態・RFの適用状態が一致する栄養素。加工後の直接参照が一致すればそちらを優先。 | 工程/状態不明、重量不足、複数工程の自動連鎖、未収録RF、対応するfinished重量なしのraw配合。 |
| Step10 | 製剤重量とその製剤の栄養含有量が確認できる添加物。単独の有効成分量は直接確認できる当該寄与だけ。 | 製剤重量不明の残量配分、carrier不明のPFC、raw添加量しかなく加工後製剤重量/残存根拠がないもの。 |

証拠なしの既存requestの数値経路と探索予算は維持する。証拠がある経路は適用/保留をtraceで区別し、根拠を黙って無視した完全推計として返さない。対象ラベルから配合・添加量・RFを逆算しない。新しい係数の調整、未レビュー原料の自動カタログ追加、大きな入力画面は不要。

## 共通入力の型案

Foodとcore requestへ同じ任意字段 `estimationEvidence?: ExplicitEstimationEvidence` を追加する。入力snapshotはdeep copyして保持する。取得経路からの型付き入力とbackup復元時に同じ構造検証器を使う。通常の食品フォームへ内部schemaやJSON編集欄を露出しない。

```ts
interface EvidenceSource {
  kind: 'manufacturer_recipe' | 'user_measurement'
    | 'official_retention_table' | 'material_specification';
  reference: string;       // URL、測定記録、規格書の識別子等。空文字不可
  verified: true;
  checkedAt: string;       // ISO日時
  version?: string;
  sourceSha256?: string;
}

interface IngredientEvidenceRef {
  section: 'ingredient' | 'additive';
  path: readonly number[]; // sectionのrootからcomponentsを辿る位置。名称で検索しない
  expectedNames: readonly string[]; // 各path位置のnormalizedName
}

interface VerifiedCompositionGroup {
  id: string;
  parent: { section: 'ingredient'; path: readonly number[] };
  expectedChildNames: readonly string[];
  denominator: 'product' | 'parent';
  weightStage: 'raw' | 'finished';
  massScope?: 'whole_parent' | 'food_remainder_after_additives';
  profileBindings?: readonly {
    index: number;
    expectedProfileId: string;
    expectedProfileStateId: string;
    finishedIngredientStateId: string;
    stateSource: EvidenceSource;
  }[];
  amounts:
    | { kind: 'fractions'; children: readonly { index: number; value: number }[] }
    | { kind: 'masses_g'; denominatorMassG: number;
        children: readonly { index: number; value: number }[] };
  source: EvidenceSource;
}

interface VerifiedProcessingEvidence {
  id: string;
  ingredient: IngredientEvidenceRef;
  inputProfileId: string;
  inputState: string;      // レビュー済みstate対応と照合。rawという単語から推測しない
  outputState: string;
  processId: string;       // 明示工程の識別子。商品名から選択しない
  rawMassG: number;        // 当該工程前の可食重量。生鮮に限定しない
  finishedMassG: number;   // 当該工程後の可食重量
  finishedProfileId?: string; // 同じoutputStateの直接参照が確認できる場合
  retention:
    | { kind: 'usda_rf6'; code: string }
    | { kind: 'user_supplied'; factors: Partial<Record<NutrientKey, number>>;
        source: EvidenceSource }; // factorは0..1。根拠のある項目だけ
  source: EvidenceSource;  // 重量・実際の工程・状態の確認記録
}

type ExplicitNutrientAmount =
  | { kind: 'exact' | 'published_reference'; value: number }
  | { kind: 'declared_range'; min: number; max: number }
  | { kind: 'minimum'; min: number };

interface VerifiedAdditiveEvidence {
  id: string;
  ingredient: IngredientEvidenceRef;
  parentPath: readonly number[]; // 製剤重量を一度だけ控除するingredient親
  materialIdentity: string;      // 製剤/水和状態/製品grade等の明示識別
  weightStage: 'raw' | 'finished';
  dose:
    | { kind: 'preparation_mass_g'; value: number }
    | { kind: 'active_nutrient_amount'; nutrient: NutrientKey;
        amount: ExplicitNutrientAmount }; // appの当該栄養素単位
  preparationNutrientsPerG?: Partial<Record<NutrientKey, ExplicitNutrientAmount>>;
  carrierStatus: 'included_in_confirmed_preparation_values' | 'unknown';
  source: EvidenceSource;
}

interface ExplicitEstimationEvidence {
  schemaVersion: 1;
  declarationFingerprint: string;
  compositions?: readonly VerifiedCompositionGroup[];
  processing?: readonly VerifiedProcessingEvidence[];
  additives?: readonly VerifiedAdditiveEvidence[];
}
```

数値の単位は栄養素ごとのapp単位を維持する。`preparationNutrientsPerG.calciumMg` は製剤1gあたりmgであり、百分率やmg/100gを曖昧に受け付けない。正規化前の記載と換算理由はsourceの記録へ保持する。supplier一般値を材料同定や個別製剤の根拠として自動補充しない。target栄養表示は `EvidenceSource.kind` に存在せず、sourceの種類を検証して配合の根拠へ流用させない。

入力上限は既存原材料parser/backupの入力制限と共通化し、boundedな配列・path・文字列だけを受け付ける。新たな汎用solverや工程DAGは導入しない。一つのnodeの同一工程は一件だけ。今回の最小適用では工程証拠を重なる祖先・子孫へ同時適用しない。

## Step8 固定混合と階層

Step8の実装envelopeは `compositions` だけを定義する。processing/additives/massScopeは対応段階まで受け付けない。子の結合は直接profileと適用済み子compositionの識別unionにする。後者は子群のIDを指定し、そのparent.pathが参照元の子pathと完全一致する場合だけ解決する。生成compound profile IDを入力側へ要求しない。nullの明示量は保存できるがunknown_amountとして保留し、0に変換しない。

初期状態registryは上白糖03003、脱脂粉乳13010、ピュアココア16048等のレビューした直接参照だけに限定する。profile ID・source IDs・出典URL・確認版・栄養値のfingerprintを照合し、代理やscaled profileを名前から登録しない。状態は参照の販売状態から追加変化がないことを表し、元の製造過程が非加熱だったと主張しない。

parserが内側の添加物をrootへ平坦化しているため、Step8では添加物のある宣言のwhole-parent固定混合を保留する。製剤質量を先取りして控除しない。

宣言fingerprintはparser版、各材料の原名・状態注記、section/path/normalizedName/componentsを安定順に含める。証拠は同一階層のindexで対応させ、同名複数位置を別物として扱う。root親は空path。親名だけでなく全兄弟の名前列を照合する。正重量の複合枝は子compositionへ結合し、直接profile指定で内側の表示を省略しない。

全兄弟が指定されたfinished群で、同じ基準の比率合計が1、または重量合計がdenominatorMassGに一致する場合、`w_i = m_i / sum(m)` または明示比率で固定混合する。公表丸め値の合計を勝手に再正規化しない。入力の意味を変えない浮動小数演算誤差だけを区別する。

`denominatorMassG` は出典のfinished batch総量F、要求の `referenceMassG` は出力基準Bを表す。FとBは一致不要で、各比率をm/Fで作り、混合100g濃度をB/100で換算する。例えばfinished batch1000gから100g要求を計算できる。子重量合計はFに一致させ、親子の絶対重量は同じbatch内で整合を確認する。表示基準が異なるという理由だけで正しい配合証拠を拒否しない。

最小適用では正の重量を持つ全枝のchildBindingsを必須とする。`expectedProfileId` の完全一致、レビュー済みprofile→state対応と `expectedProfileStateId` の一致、実際のfinished材料状態 `finishedIngredientStateId` との一致、当該材料状態を確認する `stateSource` が全て必要。状態IDはレビュー済み対応表の識別子であり、任意の自由文を双方へ同じように入力して確認を代用しない。profileのsource ID/版も対応表に保持し、更新でstate対応が未確認になれば保留する。材料の名称・群全体のverified・finished重量だけでは状態証拠としない。

一つでも不足/不一致なら当該群は `deferred: profile_state_unconfirmed` または `profile_state_mismatch`。同じ名前の別profileを探索で代わりに選ばず、sourceが一致しないprofileの値を完全混合へ入れない。stateSourceは当該材料の実際の状態の確認記録であり、MEXT sourceだけを指定してfinished材料の状態を確認したことにはしない。

例えば、非加熱の乾燥材料を混ぜたfinished dry mixは、各枝が乾燥・非加熱の直接profileに明示結合され、finishedでもその状態を維持する確認記録があればStep8だけで適用できる。焼成品に含まれる小麦粉は、焼成後重量が分かっていても生の小麦粉profileへ結合しただけでは適用しない。焼成後の直接対応またはStep9の適合する加工証拠がなければ保留する。finishedは製品内の基準段階であり、必ず加熱済みを意味するわけではない。

原材料表示順はraw投入順として扱い、finished混合の大小順を検証しない。群内のratio探索・ordered simplex投影をスキップし、明示結合されたprofileだけで固定混合する。全体を解決できない明示配合は保留し、通常探索へ黙って切り替えない。証拠なしの要求は既存候補比較を維持する。新しい反復回数や候補数は追加しない。混合profileのIDには完全な固定比率またはcanonical hashを使い、既存の小数3桁丸めIDによる衝突を避ける。

`denominator=parent` の全指定群は親内比率を表す。親のfinished製品比率が確認できる場合だけ製品比率へ積で換算する。`denominator=product` の深い群は今回の最小実装では一律 `product_denominator_not_supported` として保留。二階層の親子が同じfinished基準なら内側から固定混合し、外側へ伝播する。

部分finished、raw、親子のstage不一致は保存可能だが `deferred`。raw群内の既知順序矛盾は入力エラーにできるが、raw比率をfinished比率へ置き換えない。全fixedでも正の重量を持つ参照に対象値欠損があれば、完全混合値はnull。重量0の枝は欠損栄養値を0へ書き換えず、寄与だけをスキップする。部分値の表示は既存の部分参考値区分へ渡す。

全配合が明示されても、一枝のsource/profile-stateが一致しなければ完全混合としない。警告を付けただけの部分寄与を全原材料推計へ昇格させない。

## Step9 量の式と状態照合

USDAのtrue retentionは濃度だけでなく工程前後重量を含む。加工前濃度 `C_i,n` がapp単位/100g、確認済み重量が `R_i` と `F_i`、残存率が `r_i,n` のとき：

```text
加工後の栄養素量 A_i,n = C_i,n × R_i / 100 × r_i,n
加工後100g濃度 C'_i,n = A_i,n × 100 / F_i
製品基準重量Bへの寄与 = A_i,n × B / 製品finished重量F
```

`C×r` だけで加工後100g濃度としない。R/Fを推測しない。加工後の直接profile濃度Dが同じ状態で確認できれば `A=D×F_i/100` を使用し、RFを重ねない。源profileの対象値がnullなら、RFが存在してもnullを維持する。

raw群の明示量から各R_iが確定し、同じnodeごとのF_iが確認できれば、finished比率はF_iの実重量から作る。F_iをraw順序へ投影しない。親finished重量だけがあり子のF_iがない場合、全子のR_iと各対象RFが確認できる栄養素量の合計は親重量で除せるが、子finished比率を生成して他のfitへ流用しない。今回の単一node RF hookでは、この複合工程への一般化は保留でもよい。

recipeのrawは「この工程への投入時」を意味する。市販牛乳の直接値でも、追加加熱前の状態と実際の追加約10分加熱を確認できれば2151の入力になり得る。市販牛乳の元の殺菌工程を二度処理してはいけない。ゆで卵直接値が確認できる場合はそれを優先し、ゆで卵profileに0105を再適用しない。state/processの正確な対応がレビュー済みでないprofileは保留。

未収録RFは `r=1` ではなくnull/未適用。今回のRF6 mappingはCa、Fe、Na、C、B1、B2だけ。Naの率を食塩相当量へ使用するのは、当該値がNaからの食塩相当量で、Naの新規投入/除去が別に存在しない同じ枝に限る。RF6の古いA RE/IUをappのAへ転用しない。E、PFC、繊維、飽和脂肪酸はこのcatalogで加工後値を作らない。

加工枝のPFCがnullなら、その枝を0PFCのfit入力にしない。その栄養素について製品全体のfit予測は利用不能とする。対象微量栄養素だけ計算できる場合はその栄養素の部分参考値として返す。target-onlyの計算を完全な加工後食品プロファイルや全栄養素推計と表示しない。

## RF6の公式出典・選択カタログ

公式[USDA Release 6 PDF](https://www.ars.usda.gov/ARSUserFiles/80400535/Data/retn/retn06.pdf)はDecember 2007。率は5%刻みで公表され、100%を超える算出率は100%として報告される。個別の食品や工程の実測保証ではない。[Ag Data Commonsの配布](https://agdatacommons.nal.usda.gov/articles/dataset/USDA_Table_of_Nutrient_Retention_Factors_Release_6_2007_/24660888)はCC0（DOI `10.15482/USDA.ADC/1409034`）。公式配布APIのlicense名/URLを2026-10-04に確認した。FDCの利用条件をRF6へ推測で流用していない。

最小catalog候補は4工程×6項目＝24行。下表は公式CSVの百分率であり、アプリで調整した値ではない。[公式CSV](https://ndownloader.figshare.com/files/44488754)のbytes SHA256は `b863e891989020edf3a429af8060523e5dee275699ae08893a5f91ff9a84b1e5`。

| code | 公式工程 | Ca 301 | Fe 303 | Na 307 | C 401 | B1 404 | B2 405 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0105 | EGGS,HARD COOKED | 100 | 100 | 100 | 80 | 85 | 95 |
| 2151 | MILK,HEATED APPROX 10MIN | 100 | 100 | 100 | 85 | 90 | 100 |
| 3004 | VEG,GREENS,BOILD,LITTLE WATER DRAIN | 95 | 95 | 95 | 60 | 85 | 95 |
| 3005 | VEG,GREENS,BOILED,WATER COVER DRAIN | 95 | 95 | 95 | 55 | 80 | 90 |

生成物のmetadataはsource URL/DOI、Release 6、取得日、CC0 URL、raw bytes SHA256、変換版、4桁code、公式Nutr_No、公式工程名を保持する。codeの先頭0を失わない。百分率を1回だけ `/100` してfactorへ変換する。数値catalogとprofile-state/processのレビュー済み対応表は分離する。工程名や原材料の部分一致から選択しない。レビュー済みstate対応のないgreens profileに3004/3005を自動適用しない。

user-supplied RFは0..1の有限値・当該栄養素単位定義・工程前後状態・sourceを必須とし、今回の6項目だけを許可する。出典のない係数を手入力しただけではverified扱いにしない。ユーザー保持RFを同梱catalogや自動学習へ送らない。RF catalogをまだ生成しない最小実装でも、この明示入力hookだけで計算可能にする。

## Step10 製剤重量・有効成分量・carrier

製剤重量d gと、その製剤1g当たりの対象含有量cが確認できる場合、同じfinished基準で `添加物寄与=d×c`。製品基準B、finished製品重量Fなら `d×c×B/F`。declared_rangeは非負区間として両端へ掛ける。minimumは下限だけで、上限や点値を捏造しない。published_referenceは公表参考点であり、保証された純度/区間とは扱わず、根拠のない丸め幅・CAA許容差を追加しない。

同じ親に属する製剤重量を合計d_totalとし、食品枝の配分重量は `F_parent-d_total`。製剤を一度だけ控除する。同じ物質がStep8固定配合とStep10の両方に存在する場合、同じpathの明示重量を照合して一つの重量勘定へ統合する。一致しない二重指定はエラー。Step8の全finished配合が親重量を使い切っており、別の添加物重量が後から追加された場合もエラーで、全配合を自動縮小しない。

massScopeの省略はwhole_parent。food_remainder_after_additivesは、同じ親の全製剤finished重量が確認でき、宣言に残る量不明添加物がない場合だけ適用する。群の重量基準は明示された `F_parent-d_total` に一致し、比率合計1はその食品残量内を意味する。これにより食品全兄弟の固定重量と別欄の添加物を同じ総重量へ整合させる。Scopeが明示されない矛盾した全配合を、この例外で勝手に救済しない。

添加物が主原材料欄の一枝として既に計算される場合、その枝を明示製剤値へ置き換える。元profile寄与と製剤寄与を加算しない。添加物欄の製剤は同じ親の食品残量から控除する。最初の実装ではroot additiveのparentPathは空pathのみ計算可能とし、内側の添加物はparserの位置/親への対応が明示できない場合保留する。

確認された製剤含有値はcarrierを含む製剤全体の値として扱う。carrierStatusがunknownでも確認済みCa寄与は計算できるが、記載のないPFCや他の栄養素はnull。Ca以外の製剤質量をcarrier、炭水化物、純水、ゼロ栄養と推測しない。carrierが分かっていても、その説明だけから栄養値を生成せず、確認された製剤全体の値がある項目だけ計算する。

active_nutrient_amountだけでは製剤重量を求められない。成分mgを製剤gとして食品重量から控除しない。濃度の逆算、化学式からの無確認純度補完をしない。製剤重量不明時は `unknownAdditiveMass=true` とし、製品全重量を食品へ配分した旧値にactive量を単純加算しない。確認できるactive寄与と実重量が確認できる食品寄与だけを部分参考値として返すか、全体計算を保留する。

raw添加量をfinished計算へ用いるには、対応する加工後製剤重量とその対象残存/直接値の根拠が別途必要。工程後に添加したfinished製剤に、その前の食品加工RFを適用しない。対象ラベルが既知でもdoseを探索変数にしない。

## supplier/ADPIの数値と利用条件の境界

- Jungbunzlauerの[公式製品ページ](https://www.jungbunzlauer.com/ingredients/tricalcium-citrate/)と[dairy alternatives資料のTable 1（p4）](https://www.jungbunzlauer.com/wp-content/uploads/2025/04/Mineral-fortification-in-dairy-alternatives.pdf)は四水和物のCa含有量を21%と公表。これは約210mg/gの参考値だが、個別grade/lotの保証下限・純度・carrierを確定しない。M1098の「98% <10µm」は粒径条件であり98%純度ではない。
- [prototype資料Table 3（p6）](https://www.jungbunzlauer.com/wp-content/uploads/2025/04/Calcium-and-zinc-fortification-of-infant-and-child-products.pdf)の製剤量は0.57g、配合総量は100.57g。これを0.57g/100gや市販品の一般添加量に置き換えない。今回そのprototype配合・数値を同梱catalogにしない。
- [Jungbunzlauer利用条件](https://www.jungbunzlauer.com/terms-of-use/)は、権利表示を除去しない個人/非商用copy・配布を許し、商用のcopy・配布・公開表示には書面同意を要求する。再配布権が全くないという扱いではないが、CC0型の用途無制限ライセンスでもない。今回の公開PWA/原料数値catalogへは0行同梱し、ユーザーが保持・確認するsource付き入力に限定する。
- [ADPI milk minerals v2.0](https://adpi.org/ingredient-resources/milk-minerals/)のCa22.0%以上はminimumであり、全ミルクミネラル製剤の点値ではない。21%のクエン酸カルシウムとは材料が異なる。ADPI標準は[公式説明](https://adpi.org/standards/)で非拘束・非強制かつ著作権対象とされる。一般原料名だけへの下限適用と数値catalog同梱は行わず、今回の新規同梱は0行。適合確認された個別材料の規格下限がユーザー証拠にある場合だけminimumとして扱う。

本書の少量の数値は出典確認と適用限界の記録であり、再利用可能なsupplier/ADPI数値データベースを生成する許可とは扱わない。既存ADPI由来profileの権利/材料適合問題は別途レビュー対象であり、このhookの新設で正当化しない。

## 検証器・trace・保存

不正な構造、未知enum/版、非有限/負の値、0以下の基準重量、比率>1、重複id/index、同じ重量の矛盾した二重指定は入力エラーとして計算・保存前に拒否する。JSON parserの型assertionだけで採用しない。現在の宣言とfingerprintが一致するのにpath/名前列が不正なら拒否する。

食品draftの編集で宣言が変わった場合は証拠をdeep copyして保持し、適用状態だけを `deferred: declaration_stale` にする。旧pathを新しい同名へ付け替えず、source/verifiedを作り直さない。古い証拠の構造が正常ならFood/backupへ保持可能だが、現在の宣言には適用しない。新しい対応の確認がないままfingerprintだけを更新して救済しない。編集時はpending結果を無効化する。証拠なしへ明示的に戻した場合だけ通常経路へ戻る。

正しい構造だが今回未対応のstage/部分配合/状態/量不足は保存可能なdeferred。権利未確認sourceを同梱catalogへ昇格させないことと、ユーザー保持証拠を保存することを分ける。不正JSON復元ではDBを変更しない。未知将来schemaVersionは無言で捨てず拒否する。

traceは証拠id/path、applied/deferred/rejected、理由コード、使用profile/state/process、raw/finished重量、固定finished比率、適用RFのsource/code/各factor、製剤重量勘定、未知重量の有無、栄養素別の確認寄与/欠損を保存する。未知重量はnullであり0ではない。source本文や原料規格書全体をtraceへ複製する必要はない。

Food保存・request snapshot・入力fingerprint・backupの全経路へ同じnormalized evidenceを伝播する。出典だけの変更も旧結果を無効化する。食品保存とrequest/result/判断履歴は既存transaction内で完結する。過去食事snapshotを更新しない。食事snapshotへ証拠全体を追加する必要はない。

今回の入力は型付きFood/request/backup hookに限定し、通常フォームに証拠JSON欄や大きな手動配合エディタを追加しない。将来の確認済みsource取得pipelineがこの契約を使用する。通常のdraft編集/保存でも既存証拠は複製・保持し、古くなった宣言の証拠は上記の保留経路へ渡す。今回の範囲では市販品の添加量の自動取得・推定や調理補正の自動適用は存在しない。この制限を実装報告に明示する。

## 実装ファイルと受入ゲート

型は `src/types/index.ts`、純粋検証/正規化は新しい小さなevidenceサービス、計算adapterはestimator/profilesに分離する。store、foodRevision、formDrafts、Panel、App、backupへ同じ契約を渡す。RFを生成する場合だけ公開資料用の再生成scriptと24行の選択artifactを追加する。supplier資料の原本・数値artifactは追加しない。

1. **Step8**：全指定finished混合が手計算と一致。正確なprofile/state結合と実材料状態の出典がある非加熱dry mixは適用。重量と名前しかない群、未確認profile状態、期待ID以外の候補、焼成小麦粉→生小麦粉の状態不一致は保留。raw順序とfinished順序の逆転を受理。群の探索回数が増えない。部分/rawは保留理由付き。同名別path、二階層、0重量枝、null参照、宣言編集後の不一致、近接比率のID衝突を検証。
2. **Step9**：公式2151のB1 factor0.90と合成fixtureのR/Fで `C×R/F×0.90` に一致。R=Fで通常の率計算、F≠Rで濃縮/希釈を検証。単位を変えても確認済み製品質量による同じ基準換算になる。重量不足、状態不一致、ゆで卵への二重RF、C null、A/E/PFC RFなし、先頭0、率の二重/100変換を検証。
3. **Step10**：合成の製剤量d・含有量cでd×cと食品残量F-dが一致。製剤を食品欄/添加物欄へ置く両ケースで二重加算なし。全配合+別添加量の過剰重量を拒否。activeだけでは製剤重量を控除しない。minimumを点値にせず、published_referenceを保証rangeにしない。carrier不明PFCを0にせずfitに使わない。rawdoseの保留とfinished添加後のRF非適用を検証。
4. **統合**：Food→request→snapshot→JSON backupの往復でevidence/fingerprint/traceが一致。元配列変更後もsnapshotが変わらない。証拠変更で採用競合を拒否。通常draft編集で証拠が失われず、宣言変更時はstaleとして保留。全finished配合の一枝のsource mismatchでも部分値を完全推計へ昇格させない。不正backup/保存失敗は全rollback。証拠なしrequestの既存fixture結果・探索予算を維持。

改善の実商品件数や精度はこの設計・合成検証から主張しない。今回の受入は明示証拠の計算可能性、未確認寄与の欠損維持、保存再現性で判定する。

## Step9 実装用の限定契約

- evidenceの版2でprocessing配列とprocessing child bindingを導入し、版1の完成品配合は引き続き受理する。加工枝は全兄弟を確認したfinished群の一枝へIDで結合する。単一原材料にも1枝100%の根拠群を要求し、商品名から自動生成しない。raw群の自動変換・複数工程の連鎖は今回扱わない。
- 加工profileは通常候補から分離した `processing_mext_13003_v1`、`processing_mext_12004_v1`、`processing_mext_12005_v1` の3項目に限定する。基準は可食部100g。牛乳の追加約10分加熱と全卵のゆで工程をレビュー済み状態IDで照合し、葉の実finished重量とFが一致する場合だけ使用する。
- 普通牛乳の既存正規化データと通常候補は鉄0.02mgを保持しているが、2026-10-04に確認した公式MEXT普通牛乳の鉄は0mg。加工専用catalogでは、元値・修正値・公式ページ取得hash・日付・理由を持つ限定overrideで0へ修正する。現行ユーザー食品、一般食品マスター、過去食事はこの処理では更新しない。
- ゆで卵directをproof内で指定して状態を確認した場合は、MEXTゆで濃度を優先しRFを重ねない。指定しない場合は生の参照と0105で、対応6栄養素だけを計算する。RF未収録項目、入力参照欠損、R/F不足、状態不一致、無結合proofは補完せず保留または欠損にする。

### Step10実装結果（2026-10-04）

v3は`additives`と`kind: additive` binding、rootの`massScope`/`wholeParentMassG`に対応。contentsPerGの単位は各NutrientKeyのアプリ単位/g製剤で、質量%からの暗黙変換はしない。製剤量は`preparation_mass_g`、active直接量は`active_nutrient_amount`として分離する。今回activeだけの全体計算は保留し、確認できた直接寄与をtraceに残す。root以外の食品残量scopeは未対応として保留。下限/範囲を持つ製剤は当該栄養素を欠損寄与として扱い、食品の既知小計と製剤の出典境界を別に保持する。実製剤の全14項目が確認されなければ全項目完全値とは扱わない。通常フォームに根拠エディタを追加せず、型付きhook/backupに限定する。supplier numeric catalogの追加は0件。
