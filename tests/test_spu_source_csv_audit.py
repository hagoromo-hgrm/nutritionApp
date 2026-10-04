import csv
import tempfile
import unittest
from pathlib import Path
from scripts.audit_spu_source_csv import audit_csv,CsvAuditError
HEADERS=['カテゴリ','商品名','栄養素','原材料','製品URL']

def write(path,rows):
 with path.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(HEADERS);w.writerows(rows)
def row(basis='100g当たり',nutrition='カルシウム 20mg',url='https://www.kikkoman.co.jp/products/example.html'):
 return ['食品','検証用食品',basis+'; エネルギー 40kcal; たんぱく質 2g; 脂質 1g; 炭水化物 6g; 食塩相当量 0.1g; '+nutrition,'大豆、食塩',url]
class SourceCsvAuditTests(unittest.TestCase):
 def audit(self,rows):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'kikkoman_officialSite_261004.csv';write(p,rows);return audit_csv(p)
 def test_keeps_ml_raw_row_without_guessing_mass(self):
  summary,private=self.audit([row('200mlあたり')])
  self.assertEqual(summary['rawRows'],1)
  self.assertEqual(summary['normalizationAcceptedRows'],0)
  self.assertEqual(summary['normalizationDeferralReasons'],{'missing_explicit_reference_mass':1})
  self.assertNotIn('productName',summary)
  self.assertIn('productName',private[0])
 def test_preserves_major_only_rows_without_zero_filling_targets(self):
  summary,_=self.audit([row(nutrition='')])
  self.assertEqual(summary['normalizationDeferralReasons'],{'no_target_nutrient':1})
  self.assertEqual(summary['targetLabelCounts'],{})
 def test_range_and_estimated_target_counts_remain_distinct(self):
  summary,_=self.audit([row(nutrition='カルシウム 20～30mg; 食物繊維 1g（推定値）')])
  self.assertEqual(summary['normalizationAcceptedRows'],1)
  self.assertEqual(summary['targetLabelKindCounts'],{'declared_range':1,'estimated':1})
 def test_official_host_is_required(self):
  with self.assertRaisesRegex(CsvAuditError,'official host'):self.audit([row(url='https://unrelated.example/item')])
 def test_duplicate_row_is_rejected(self):
  with self.assertRaisesRegex(CsvAuditError,'duplicate'):self.audit([row(),row()])
 def test_wrong_major_unit_is_rejected(self):
  values=row();values[2]=values[2].replace('脂質 1g','脂質 1mg')
  with self.assertRaisesRegex(CsvAuditError,'major nutrient'):self.audit([values])
if __name__=='__main__':unittest.main()
