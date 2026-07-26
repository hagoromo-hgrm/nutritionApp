import { useId, useState } from 'react'
import {
  ESTIMATABLE_NUTRIENT_KEYS,
  estimateNutrients,
  isEstimateAdoptable,
  type AvailableNutrientEstimate,
  type EstimatableNutrientKey,
  type NutrientEstimateBasis,
  type NutrientEstimateRequest,
  type NutrientEstimateResult,
} from '../services/nutrientEstimator'
import { NUTRIENT_LABELS, NUTRIENT_UNITS, type IngredientsSource, type Nutrients } from '../types'

type CurrentEstimateNutrients = Pick<Nutrients, EstimatableNutrientKey>

export interface NutrientEstimateAdoption {
  requestId: string
  request: NutrientEstimateRequest
  basis: NutrientEstimateBasis
  values: Partial<Record<EstimatableNutrientKey, number>>
  result: NutrientEstimateResult
}

export interface NutrientEstimateEvaluation {
  request: NutrientEstimateRequest
  result: NutrientEstimateResult
}

export interface NutrientEstimatePanelProps {
  basis: NutrientEstimateBasis
  ingredientsText: string | null
  referenceMassG: number | null
  referenceMassSource: string | null
  ingredientsSource: IngredientsSource | null
  currentNutrients: CurrentEstimateNutrients
  onEvaluated?: (evaluation: NutrientEstimateEvaluation) => void
  onAdopt: (adoption: NutrientEstimateAdoption) => void
  onRejectAll?: (evaluation: NutrientEstimateEvaluation, nutrientKeys: EstimatableNutrientKey[]) => void
  disabled?: boolean
}

const CONFIDENCE_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
  unavailable: '推計不可',
} as const

function format(value: number): string {
  return value.toFixed(1)
}

function requestKey(props: NutrientEstimatePanelProps): string {
  return JSON.stringify([
    props.basis.baseAmount,
    props.basis.baseUnit,
    props.ingredientsText,
    props.referenceMassG,
    props.referenceMassSource,
    props.ingredientsSource,
  ])
}

export function NutrientEstimatePanel(props: NutrientEstimatePanelProps) {
  const id = useId()
  const [evaluation, setEvaluation] = useState<{ key: string; request: NutrientEstimateRequest; result: NutrientEstimateResult } | null>(null)
  const [selected, setSelected] = useState<Set<EstimatableNutrientKey>>(new Set())
  const [queuedAction, setQueuedAction] = useState<'adopt' | 'reject' | null>(null)
  const currentKey = requestKey(props)
  const result = evaluation?.key === currentKey ? evaluation.result : null

  const selectableKeys = result
    ? ESTIMATABLE_NUTRIENT_KEYS.filter((key) =>
        isEstimateAdoptable(props.currentNutrients[key], result.estimates[key]))
    : []
  const selectedCount = [...selected].filter((key) => selectableKeys.includes(key)).length

  function runEstimate() {
    const requestedNutrients = ESTIMATABLE_NUTRIENT_KEYS.filter((key) => props.currentNutrients[key] === null)
    const request: NutrientEstimateRequest = {
      requestId: `browser-estimate-${Date.now()}`,
      baseAmount: props.basis.baseAmount,
      baseUnit: props.basis.baseUnit,
      ingredientsText: props.ingredientsText,
      ingredientsSource: props.ingredientsSource,
      referenceMassG: props.referenceMassG,
      referenceMassSource: props.referenceMassSource,
      requestedNutrients,
      requestedAt: new Date().toISOString(),
    }
    const estimated = estimateNutrients(request)
    setEvaluation({ key: currentKey, request, result: estimated })
    setSelected(new Set())
    setQueuedAction(null)
    props.onEvaluated?.({ request, result: estimated })
  }

  function toggle(key: EstimatableNutrientKey) {
    if (!selectableKeys.includes(key)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(selectableKeys))
  }

  function adopt() {
    if (!result) return
    const values: Partial<Record<EstimatableNutrientKey, number>> = {}
    for (const key of selected) {
      const estimate = result.estimates[key]
      // 推計後に親の現在値が変わった場合も、既存値を上書きするイベントを発火しない。
      if (isEstimateAdoptable(props.currentNutrients[key], estimate)) values[key] = estimate.value
    }
    if (Object.keys(values).length === 0) return
    if (!evaluation) return
    props.onAdopt({ requestId: result.requestId, request: evaluation.request, basis: result.basis, values, result })
    setQueuedAction('adopt')
  }

  function rejectAll() {
    if (!evaluation || !result) return
    const nutrientKeys = ESTIMATABLE_NUTRIENT_KEYS.filter((key) => (
      props.currentNutrients[key] === null && result.estimates[key].status === 'available'
    ))
    if (nutrientKeys.length === 0) return
    props.onRejectAll?.({ request: evaluation.request, result }, nutrientKeys)
    setSelected(new Set())
    setQueuedAction('reject')
  }

  function rejectSelected() {
    if (!evaluation || !result) return
    const nutrientKeys = [...selected].filter((key) => selectableKeys.includes(key))
    if (nutrientKeys.length === 0) return
    props.onRejectAll?.({ request: evaluation.request, result }, nutrientKeys)
    setSelected(new Set())
    setQueuedAction('reject')
  }

  return (
    <section
      className="nutrient-estimate-panel"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
    >
      <div className="nutrient-estimate-heading">
        <div>
          <span className="eyebrow">REFERENCE ESTIMATE</span>
          <h3 id={`${id}-title`}>欠損値を参考推計</h3>
        </div>
        <span className="nutrient-estimate-badge">端末内</span>
      </div>
      <p className="nutrient-estimate-intro" id={`${id}-intro`}>
        原材料表示と確認済み重量から、飽和脂肪酸、食物繊維、カルシウム、鉄、ビタミンA・E・B1・B2・Cのうち、未入力の栄養素だけを参考推計します。外部へ情報を送信せず、現在値は上書きしません。
      </p>
      <dl className="nutrient-estimate-basis">
        <div><dt>表示基準</dt><dd>{props.basis.baseAmount}{props.basis.baseUnit}当たり</dd></div>
        <div><dt>確認済み重量</dt><dd>{props.referenceMassG === null ? '未入力' : `${props.referenceMassG}g`}</dd></div>
      </dl>
      <button className="button secondary nutrient-estimate-run" type="button" onClick={runEstimate} disabled={props.disabled}>
        欠損値を推計
      </button>

      {result && (
        <div className="nutrient-estimate-results" aria-live="polite">
          <div className="nutrient-estimate-result-heading">
            <strong>{result.status === 'completed' ? '推計結果' : result.status === 'partial' ? '一部を推計しました' : '推計できませんでした'}</strong>
            <small>{result.basis.baseAmount}{result.basis.baseUnit}当たり</small>
          </div>
          {ESTIMATABLE_NUTRIENT_KEYS.map((key) => {
            const estimate = result.estimates[key]
            const currentValue = props.currentNutrients[key]
            const canSelect = isEstimateAdoptable(currentValue, estimate)
            return (
              <article
                className={`nutrient-estimate-item${canSelect ? '' : ' is-disabled'}`}
                key={key}
                aria-labelledby={`${id}-${key}-label`}
              >
                <label className="nutrient-estimate-select" htmlFor={`${id}-${key}`}>
                  <input
                    id={`${id}-${key}`}
                    type="checkbox"
                    checked={selected.has(key) && canSelect}
                    disabled={!canSelect}
                    onChange={() => toggle(key)}
                    aria-label={`${NUTRIENT_LABELS[key]}の推計値を採用対象にする`}
                  />
                  <span>
                    <strong id={`${id}-${key}-label`}>{NUTRIENT_LABELS[key]}</strong>
                    <small>現在値 {currentValue === null ? '未入力' : `${format(currentValue)}${NUTRIENT_UNITS[key]}`}</small>
                  </span>
                </label>
                {estimate.status === 'available'
                  ? <AvailableEstimateDetails estimate={estimate} unit={NUTRIENT_UNITS[key]} />
                  : (
                    <div className="nutrient-estimate-unavailable" role="status">
                      <strong>推計不可</strong>
                      <p>{estimate.reason}</p>
                      <small>{estimate.nextAction}</small>
                    </div>
                  )}
                {currentValue !== null && <p className="nutrient-estimate-existing-note">現在値があるため採用できません。パッケージ表示または入力値を維持します。</p>}
              </article>
            )
          })}
          {result.globalWarnings.map((warning) => <p className="nutrient-estimate-global-warning" key={warning}>※ {warning}</p>)}
          <p className="nutrient-estimate-medical-note">医療上の判断、診断、治療、個別の栄養指導には使用できません。</p>
          <div className="nutrient-estimate-selection-actions" aria-label="推計値の選択操作">
            <button className="button secondary" type="button" onClick={selectAll} disabled={selectableKeys.length === 0}>採用可能を一括選択</button>
            <button className="button ghost" type="button" onClick={() => setSelected(new Set())} disabled={selectedCount === 0}>全解除</button>
            <button className="button ghost" type="button" onClick={rejectSelected} disabled={!props.onRejectAll || selectedCount === 0}>選択を不採用</button>
            <button className="button ghost" type="button" onClick={rejectAll} disabled={!props.onRejectAll || selectableKeys.length === 0}>すべて不採用</button>
          </div>
          <button className="button primary nutrient-estimate-adopt" type="button" onClick={adopt} disabled={selectedCount === 0}>
            選択した推計値を入力欄へ反映
          </button>
          {queuedAction && <p className="nutrient-estimate-queued" role="status">
            {queuedAction === 'adopt'
              ? '候補を入力欄へ反映しました。画面下の「保存する」で採用を確定します。'
              : '不採用を選択しました。画面下の「保存する」で判断履歴を保存します。'}
          </p>}
          <p className="nutrient-estimate-snapshot-note">採用しても、保存済みの食事記録と栄養値には遡って反映されません。</p>
        </div>
      )}
    </section>
  )
}

function AvailableEstimateDetails({ estimate, unit }: { estimate: AvailableNutrientEstimate; unit: string }) {
  return (
    <div className="nutrient-estimate-values">
      <div><span>参考推計</span><strong>{format(estimate.value)}<small>{unit}</small></strong></div>
      <dl>
        <div><dt>範囲</dt><dd>{format(estimate.range.min)}〜{format(estimate.range.max)}{unit}</dd></div>
        <div><dt>信頼度</dt><dd>{CONFIDENCE_LABELS[estimate.confidence]}</dd></div>
        <div><dt>方法</dt><dd>原材料表示順による端末内推計</dd></div>
        <div><dt>出典</dt><dd>{estimate.source}</dd></div>
      </dl>
      {estimate.warnings.length > 0 && (
        <ul className="nutrient-estimate-warnings" aria-label="推計上の注意">
          {estimate.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </div>
  )
}
