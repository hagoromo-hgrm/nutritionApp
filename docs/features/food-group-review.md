# 食品グループ再分類の準備状態

食品グループを完全にリセットし、新しい分類を開始するための初期状態です。分類判断はまだ反映していません。

## リセット状態

- `food_group_known_good.json` のfamily定義は空
- 旧LLM判定JSONは削除済み
- MEXT食品2538件はすべて `food:<食品ID>` の単独family
- すべて `needsReview: true`
- 旧familyの自動統合は行わない
- aliases・related termsは空
- 先頭語完全一致の `firstTokenReviewGroups` に再分類対象を収録
- 食品ID、食品名、基準量、栄養値は保持

生成には次のコマンドを使用します。

```bash
python3 scripts/build_food_search_metadata.py \
  data/mext/processed/mext_foods.json \
  data/mext/processed/mext_search_metadata.json \
  --known-good data/mext/food_group_known_good.json \
  --reset-groups \
  --review-output data/mext/food_group_review.json
```

新しい分類が確定した後は、`food_group_known_good.json` を更新して `--reset-groups` を外し、必要に応じて新しいLLM判定JSONを `--llm-review` で指定します。

## IndexedDBへの影響

アプリ更新時にはMEXT食品の `foodGroupId`、family、variant属性をリセット状態へ同期します。旧生成family、旧aliases、旧related terms、旧検索ログは新分類の前提にならないため整理します。一方、`food` 本体、食事記録の栄養スナップショット、お気に入り、食品利用統計、メニューの食品IDは保持します。

`manual-v1` のユーザー登録familyと、それに紐付く手動登録食品・aliases・related termsは保持します。新分類では、手動登録食品を必要に応じて新しいfamilyへ再所属させます。
