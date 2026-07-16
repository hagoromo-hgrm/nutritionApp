# 日本食品標準成分表データ

食品データ収集の初回取得分です。元データは文部科学省が公開する「日本食品標準成分表（八訂）増補2023年」第2章データです。

- 取得元: <https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html>
- 取得日: 2026-07-17
- 元ファイル: `raw/mext_food_composition_2023_supplement.xlsx`
- SHA-256: `0d5a77077dd6cd91cbc2e6e317b8b218a38728c409eed452f1c10635a0d3099c`
- 対象: 食品番号、食品名、エネルギー、三大栄養素、食物繊維、食塩相当量、カルシウム、鉄、ビタミンA・E・B1・B2・C
- 基準量: 元データの可食部100g当たりを `100g` として保持
- 飽和脂肪酸: 一般成分表に含まれないため、推測せず未設定

文部科学省の案内に従い、アプリ内の出典は「日本食品標準成分表（八訂）増補2023年から引用」とします。括弧付きの推定値は数値として扱い、`-`・`Tr`・`(Tr)`は未設定として扱います。`0`・`(0)`は元データの意味を保って0として扱います。

変換:

```bash
python scripts/extract_mext_xlsx.py data/mext/raw/mext_food_composition_2023_supplement.xlsx data/mext/processed/mext_foods.csv
python scripts/convert_food_data.py data/mext/processed/mext_foods.csv data/mext/processed/mext_foods.json \
  --source-version '日本食品標準成分表（八訂）増補2023年（2026年3月27日正誤表対応）' \
  --source-url 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html' \
  --acquired-date 2026-07-17
```

`extract_mext_xlsx.py`の実行には、`requirements-data.txt`のデータ変換用依存関係が必要です。アプリのバンドルには含めません。
