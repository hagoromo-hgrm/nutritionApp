#!/usr/bin/env python3
"""Audit raw official CSVs without promoting them to reviewed/model teacher data."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import re
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse
try:
 from .build_spu_estimator_training import _source_config_for,clean_nutrition_text,first_nutrient_offset,normalize_row,parse_nutrient,validate_columns
except ImportError:
 from build_spu_estimator_training import _source_config_for,clean_nutrition_text,first_nutrient_offset,normalize_row,parse_nutrient,validate_columns
MAJOR=('energyKcal','proteinG','fatG','carbohydrateG','saltG')
TARGET=('saturatedFatG','fiberG','calciumMg','ironMg','vitaminAMcg','vitaminEMg','vitaminB1Mg','vitaminB2Mg','vitaminCMg')
class CsvAuditError(ValueError):pass

def audit_csv(path:Path)->tuple[dict,list[dict]]:
 config,_=_source_config_for(path)
 host=urlparse(config['url']).hostname
 accepted=[];private=[];reasons=Counter();target_counts=Counter();kind_counts=Counter();seen=set()
 if path.stat().st_size > 16 * 1024 * 1024:raise CsvAuditError('CSV exceeds audit size budget')
 source_bytes=path.read_bytes()
 with io.StringIO(source_bytes.decode('utf-8-sig'),newline='') as handle:
  reader=csv.DictReader(handle);validate_columns(path,reader.fieldnames)
  for row_number,row in enumerate(reader,2):
   if None in row or any(row.get(key) is None or not row[key].strip() for key in ('カテゴリ','商品名','栄養素','原材料','製品URL')):
    raise CsvAuditError(f'row {row_number}: missing field or CSV column mismatch')
   if any('\ufffd' in value or '<script' in value.lower() for value in row.values()):raise CsvAuditError(f'row {row_number}: invalid decoded/source text')
   url=urlparse(row['製品URL'])
   if url.scheme!='https' or url.username or url.password or url.hostname is None or url.hostname.removeprefix('www.')!=host.removeprefix('www.'):
    raise CsvAuditError(f'row {row_number}: product URL differs from registered official host')
   text=clean_nutrition_text(row['栄養素']);offset=first_nutrient_offset(text)
   if offset is None or not re.search(r'\d',text[:offset]):raise CsvAuditError(f'row {row_number}: missing explicit displayed basis')
   if any(parse_nutrient(text,key,'displayed_basis',False) is None for key in MAJOR):raise CsvAuditError(f'row {row_number}: missing/malformed major nutrient')
   identity=(row['商品名'],row['栄養素'],row['原材料'])
   if identity in seen:raise CsvAuditError(f'row {row_number}: exact duplicate')
   seen.add(identity)
   stamp=datetime.now(timezone.utc).isoformat()
   record,reason=normalize_row(row,filename=path.name,row_number=row_number,source_config=config,verified_at=stamp)
   if reason:reasons[reason]+=1
   else:
    accepted.append(record)
    for key in TARGET:
     if key in record['nutrients']:target_counts[key]+=1;kind_counts[record['nutrients'][key]['valueKind']]+=1
   private.append({'rowNumber':row_number,'productName':row['商品名'],'productUrl':row['製品URL'],'teacherCandidateAccepted':reason is None,'deferralReason':reason})
 summary={'csvFile':path.name,'csvSha256':hashlib.sha256(source_bytes).hexdigest(),'maker':config['maker'],'rawRows':len(private),'completeMajorNutrientRows':len(private),'normalizationAcceptedRows':len(accepted),'normalizationDeferralReasons':dict(sorted(reasons.items())),'targetLabelCounts':dict(sorted(target_counts.items())),'targetLabelKindCounts':dict(sorted(kind_counts.items())),'humanFamilyReview':'not_completed','modelOrPriorUpdated':False}
 return summary,private

def main()->int:
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('csv',nargs='+',type=Path);parser.add_argument('--public-report',type=Path,required=True);parser.add_argument('--private-report',type=Path)
 args=parser.parse_args()
 if args.private_report and not args.private_report.resolve().is_relative_to(Path(__file__).resolve().parents[1]/'data/estimator/private'):parser.error('individual detail output must remain in data/estimator/private')
 if args.public_report.resolve() in {p.resolve() for p in args.csv}:parser.error('report must not overwrite an input CSV')
 summaries=[];details=[]
 for path in args.csv:
  summary,detail=audit_csv(path);summaries.append(summary);details.append({'csvFile':path.name,'rows':detail})
 report={'format':'nutrition-spu-source-csv-audit','formatVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'files':summaries,'rawRows':sum(s['rawRows'] for s in summaries),'normalizationAcceptedRows':sum(s['normalizationAcceptedRows'] for s in summaries),'scope':'private_local_collection; not reviewed independent families or authorized model adoption'}
 args.public_report.parent.mkdir(parents=True,exist_ok=True);args.public_report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 if args.private_report:args.private_report.parent.mkdir(parents=True,exist_ok=True);args.private_report.write_text(json.dumps(details,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'rawRows':report['rawRows'],'normalizationAcceptedRows':report['normalizationAcceptedRows']}))
 return 0
if __name__=='__main__':raise SystemExit(main())
