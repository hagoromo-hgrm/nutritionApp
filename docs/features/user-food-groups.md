# ユーザー向け食品グループ

確定済みのMEXT食品グループを変更せず、その上に日常語で検索・選択するための層を置きます。

```text
user_food_group
  → food_group（確定済みcanonical_name）
    → source_id（既存の属性選択で解決）
```

## 入力

- `data/mext/processed/mext_food_groups_v2.json`
- `data/mext/processed/mext_food_group_mappings_v2.json`
- `data/mext/processed/mext_food_group_summary_v2.json`
- `data/mext/user_food_group_decisions_v1.json`

文脈的な統合判断は最後のファイルだけで管理します。未指定の食品グループは自動的に`standalone`となり、既存IDや名称は変更されません。

## 再生成と検証

macOSまたはVisual Studio Codeのターミナルで、プロジェクトルートから実行します。

```bash
python3 scripts/build_mext_user_food_groups.py
python3 scripts/validate_mext_user_food_groups.py
python3 -m unittest tests/test_mext_user_food_groups.py
npm test -- --run tests/mext-user-food-data.test.ts
```

生成処理は原子的にJSONを書き込み、同じ入力から同じ内容を生成します。検証では1,494件の所属完全性・一意性、選択値と検索ショートカットの参照整合性、再生成結果の一致を確認します。

## 生成物

確認・集計用:

- `data/mext/processed/mext_user_food_groups_v1.json`
- `data/mext/processed/mext_user_food_group_mappings_v1.json`
- `data/mext/processed/mext_user_food_group_review_v1.json`
- `data/mext/processed/mext_user_food_group_summary_v1.json`

アプリ用:

- `data/mext/app/user_food_groups.json`
- `data/mext/app/user_food_group_mappings.json`
- `data/mext/app/user_food_search_index.json`

アプリは`src/services/mextUserFoodData.ts`からこれらを参照します。上位グループから`food_group_id`を決定した後は、`src/services/mextFoodData.ts`の既存属性定義と`source_id`解決処理を再利用します。

## 更新時の注意

- 確定済みの`food_group_id`、`canonical_name`、`source_id`は変更しません。
- 一つの`food_group_id`を複数のユーザー向けグループへ割り当てません。
- デフォルトは根拠を判断データへ明示できる場合だけ設定します。
- 「パン」「魚」「麺」のような広い分類は、直接記録する上位食品として追加しません。
