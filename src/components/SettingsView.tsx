import { useState } from 'react'
import { getSettings } from '../db/db'
import { formatNutrient } from '../services/nutrition'
import {
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  type ActivityLevel,
  type BiologicalSex,
  type EstimationSettings,
  type MealTimeMode,
  type NutrientKey,
  type NutritionGoals,
} from '../types'
import { formatDateTime } from '../utils/date'
import type { BodyProfileDraft } from './formDrafts'
import { InfoPopover } from './InfoPopover'

interface SettingsViewProps {
  settings: Awaited<ReturnType<typeof getSettings>>
  estimationSettings: EstimationSettings
  goalInputs: Record<NutrientKey, string>
  setGoalInputs: React.Dispatch<React.SetStateAction<Record<NutrientKey, string>>>
  onSaveGoals: (event: React.FormEvent<HTMLFormElement>) => void
  onToggleExternalApi: (enabled: boolean) => void
  onToggleNutrientEstimator: (enabled: boolean) => void
  onChangeDefaultMealTimeMode: (mode: MealTimeMode) => void
  onExportJson: () => void
  onRestoreJson: (event: React.ChangeEvent<HTMLInputElement>) => void
  onExportCsv: () => void
  onImportCsv: (event: React.ChangeEvent<HTMLInputElement>) => void
  onExportUnresolvedIngredients: (format: 'json' | 'csv') => void
  csvFrom: string
  csvTo: string
  setCsvFrom: (value: string) => void
  setCsvTo: (value: string) => void
  counts: { foods: number; meals: number; menus: number; generalMenus: number; menuSets: number }
  bodyProfileInputs: BodyProfileDraft
  setBodyProfileInputs: React.Dispatch<React.SetStateAction<BodyProfileDraft>>
  onSaveBodyProfile: (event: React.FormEvent<HTMLFormElement>) => void
  onOpenNewFood: () => void
  onOpenBarcodeRegister: () => void
  onOpenFoodMaster: () => void
  estimatedGoals: NutritionGoals | null
  bmi: number | null
}

export function SettingsView({ settings, estimationSettings, goalInputs, setGoalInputs, onSaveGoals, onToggleExternalApi, onToggleNutrientEstimator, onChangeDefaultMealTimeMode, onExportJson, onRestoreJson, onExportCsv, onImportCsv, onExportUnresolvedIngredients, csvFrom, csvTo, setCsvFrom, setCsvTo, counts, bodyProfileInputs, setBodyProfileInputs, onSaveBodyProfile, onOpenNewFood, onOpenBarcodeRegister, onOpenFoodMaster, estimatedGoals, bmi }: SettingsViewProps) {
  const configuredGoalCount = NUTRIENT_KEYS.filter((key) => settings.goals[key] !== null).length
  const [showFoodRegistrationMethods, setShowFoodRegistrationMethods] = useState(false)
  const chooseFoodRegistrationMethod = (method: 'manual' | 'barcode') => {
    setShowFoodRegistrationMethods(false)
    if (method === 'manual') onOpenNewFood()
    else onOpenBarcodeRegister()
  }
  return <>
    <section className="page-heading"><div><span className="eyebrow">SETTINGS</span><h1>設定・データ管理</h1></div></section>
    <details className="settings-card food-collapsible settings-goals-collapsible">
      <summary className="section-title collapsible-summary"><div><span className="eyebrow">GOALS</span><h2>栄養目標</h2></div><span className="count-label">{configuredGoalCount > 0 ? `${configuredGoalCount}項目を設定` : '未設定'}</span></summary>
      <form onSubmit={onSaveGoals} className="goal-form">
        {NUTRIENT_KEYS.map((key) => <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={goalInputs[key]} onChange={(event) => setGoalInputs((current) => ({ ...current, [key]: event.target.value }))} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div></label>)}
        <button className="button primary" type="submit">目標を保存</button>
      </form>
    </details>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">FOOD MASTER</span><h2>食品登録</h2></div></div>
      <div className="food-registration-actions"><button className="button primary" type="button" onClick={() => setShowFoodRegistrationMethods(true)}>食品を登録</button><button className="button secondary" type="button" onClick={onOpenFoodMaster}>食品を検索</button></div>
      <div className="settings-info-row settings-inline-row nutrient-estimate-setting">
        <label className="toggle-row"><input type="checkbox" checked={estimationSettings.enabled} onChange={(event) => onToggleNutrientEstimator(event.target.checked)} />欠損した飽和脂肪酸・食物繊維・ビタミン・ミネラルの参考推計を使う</label>
        <InfoPopover className="settings-info" label="参考推計について" text="確認済みの原材料表示と重量を使い、端末内だけで参考候補を計算します。未対応原材料、参照値欠損、栄養添加物の寄与割合不明がある場合は、該当分を加算しない既知原材料分の部分参考値を低信頼度で表示します。部分参考値は商品の保証下限ではありません。初期値は無効で、結果は確認後に手動採用し、既存値を上書きしません。" />
      </div>
      <div className="settings-info-row">
        <div className="settings-action-buttons">
          <button className="button ghost" type="button" onClick={() => onExportUnresolvedIngredients('json')}>未対応原材料 JSON</button>
          <button className="button ghost" type="button" onClick={() => onExportUnresolvedIngredients('csv')}>未対応原材料 CSV</button>
        </div>
        <InfoPopover className="settings-info" label="未対応原材料の出力について" text="推計できなかった原材料名を端末内で件数集計し、手動で出力します。商品名、メーカー、バーコード、食品・食事記録との紐付けは含みません。" />
      </div>
    </section>
    {showFoodRegistrationMethods && <div className="modal-backdrop food-registration-method-backdrop" role="dialog" aria-modal="true" aria-label="食品を登録"><section className="modal-card food-registration-method-modal"><div className="modal-heading"><h2>食品の登録方法</h2><button className="icon-button" type="button" onClick={() => setShowFoodRegistrationMethods(false)} aria-label="閉じる">×</button></div><div className="food-registration-method-actions"><button className="button primary full-width" type="button" onClick={() => chooseFoodRegistrationMethod('manual')}>手入力</button><button className="button secondary full-width" type="button" onClick={() => chooseFoodRegistrationMethod('barcode')}>バーコード</button></div></section></div>}
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h2>食事時刻</h2></div></div>
      <label>既定の時刻入力<select value={settings.mealTimeMode ?? 'auto'} onChange={(event) => onChangeDefaultMealTimeMode(event.target.value as MealTimeMode)}><option value="auto">現在時刻を自動挿入</option><option value="manual">自分で入力</option></select></label>
    </section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">BACKUP</span><h2>バックアップ</h2></div></div>
      <div className="data-stats">
        <div><strong>{counts.foods}</strong><span>食品</span></div>
        <div><strong>{counts.meals}</strong><span>食事記録</span></div>
        <div><strong>{settings.dataFormatVersion}</strong><span>データ形式</span></div>
        <div><strong>{counts.menus}</strong><span>Myメニュー</span></div>
        <div><strong>{counts.generalMenus}</strong><span>一般メニュー</span></div>
        <div><strong>{counts.menuSets}</strong><span>Myセット</span></div>
      </div>
      <p className="helper-text">最終バックアップ: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '未作成'}</p>
      <div className="settings-info-row settings-inline-row">
        <label className="toggle-row"><input type="checkbox" checked={settings.externalApiEnabled} onChange={(event) => onToggleExternalApi(event.target.checked)} />食品が見つからないときにOpen Food Factsを検索する</label>
        <InfoPopover className="settings-info" label="外部APIについて" text="外部APIにはバーコード番号のみを送り、商品情報と原材料を確認用に自動入力します。取得値はパッケージと照合してから保存してください。通信失敗時は手入力へ進みます。" />
      </div>
      <div className="settings-info-row backup-actions">
        <div className="settings-action-buttons">
          <button className="button primary" type="button" onClick={onExportJson}>JSONを出力</button>
          <label className="button secondary file-button">JSONを復元<input type="file" accept="application/json,.json" onChange={onRestoreJson} /></label>
        </div>
        <InfoPopover className="settings-info" label="JSONバックアップについて" text="JSONには食品、食事記録、お気に入り、Myメニュー、一般メニュー、Myセット、設定を含めます。復元前には現在データを自動退避します。" />
      </div>
    </section>
    <section className="settings-card">
      <div className="section-title"><div><span className="eyebrow">CSV EXPORT / IMPORT</span><h2>食事履歴CSV</h2></div></div>
      <div className="date-range"><label>開始日<input type="date" value={csvFrom} onChange={(event) => setCsvFrom(event.target.value)} /></label><span>〜</span><label>終了日<input type="date" value={csvTo} onChange={(event) => setCsvTo(event.target.value)} /></label></div>
      <div className="settings-info-row csv-action-row">
        <div className="settings-action-buttons">
          <button className="button secondary" type="button" onClick={onExportCsv}>CSVを出力</button>
          <label className="button secondary file-button csv-import-button">CSVを取り込む<input type="file" accept="text/csv,.csv" onChange={onImportCsv} /></label>
        </div>
        <InfoPopover className="settings-info" label="CSVについて" text="UTF-8 BOM付きです。このPWAで出力したCSVは食事履歴の復元に使えます。取り込み時は同じIDの記録を上書きします。" />
      </div>
    </section>
    <section className="settings-card body-profile-card">
      <div className="section-title"><div><span className="eyebrow">BODY PROFILE</span><h2>身体情報と推定目標</h2></div></div>
      <form onSubmit={onSaveBodyProfile} className="body-profile-form"><div className="two-fields"><label>身長（cm）<input type="number" min="1" max="300" step="0.1" value={bodyProfileInputs.heightCm} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, heightCm: event.target.value }))} placeholder="未設定" /></label><label>体重（kg）<input type="number" min="1" max="500" step="0.1" value={bodyProfileInputs.weightKg} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, weightKg: event.target.value }))} placeholder="未設定" /></label></div><div className="two-fields"><label>年齢（歳）<input type="number" min="1" max="120" step="1" value={bodyProfileInputs.ageYears} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, ageYears: event.target.value }))} placeholder="算出に使用" /></label><label>性別<select value={bodyProfileInputs.sex} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, sex: event.target.value as BiologicalSex }))}><option value="unspecified">未選択</option><option value="male">男性</option><option value="female">女性</option></select></label></div><label>活動量<select value={bodyProfileInputs.activityLevel} onChange={(event) => setBodyProfileInputs((current) => ({ ...current, activityLevel: event.target.value as ActivityLevel }))}><option value="low">低い</option><option value="moderate">普通</option><option value="high">高い</option></select></label><button className="button primary" type="submit">身体情報を保存して目標を算出</button></form>
      <div className="estimated-target"><div><span>BMI</span><strong>{bmi === null ? '未計算' : bmi.toFixed(1)}</strong></div><div><span>推定エネルギー目標</span><strong>{estimatedGoals === null ? '未計算' : `${estimatedGoals.energyKcal ?? '未設定'} kcal`}</strong></div></div>{estimatedGoals && <div className="estimated-goals"><div className="estimated-goals-heading"><strong>栄養素の参考目標</strong><span>P15% / F25% / C60%</span></div><div className="estimated-goal-grid">{NUTRIENT_KEYS.filter((key) => key !== 'energyKcal').map((key) => <div key={key}><span>{NUTRIENT_LABELS[key]}</span><strong>{formatNutrient(estimatedGoals[key])}<small>{NUTRIENT_UNITS[key]}</small></strong></div>)}</div></div>}<div className="estimate-info-row"><span>参考目標の算出について</span><InfoPopover label="参考目標の算出について" text="算出値は一般的な推定式・栄養配分による参考値です。食塩は性別ごとの一般的な上限目安を表示しています。診断・治療・個別の栄養指導を目的とせず、体調や医療上の指示がある場合は専門家に相談してください。" /></div>
    </section>
    <section className="privacy-note"><strong>医療目的ではありません</strong><p>このアプリは日々の記録を支援するもので、診断・治療・個別の栄養指導を行いません。</p><span>Nutrition PWA v0.1.0 · 端末内のみで動作</span></section>
  </>
}
