import { useState } from 'react'
import {
  NutrientEstimatePanel,
  type NutrientEstimateAdoption,
  type NutrientEstimateEvaluation,
} from '../components/NutrientEstimatePanel'
import {
  ESTIMATOR_GENRE_LABELS,
  ESTIMATOR_GENRE_OPTIONS,
  refreshEstimatorGenre,
} from '../services/estimatorGenre'
import { shouldFollowFoodName } from '../services/foodDraft'
import { ESTIMATABLE_NUTRIENT_KEYS, ESTIMATE_FIT_NUTRIENT_KEYS, GENRE_PRIOR_PARTIAL_METHOD, PARTIAL_METHOD } from '../services/nutrientEstimator'
import { recordUnresolvedIngredients } from '../services/unresolvedIngredients'
import {
  FOOD_UNITS,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  type EstimatorGenreId,
  type FoodAlias,
  type FoodAliasType,
  type FoodGroup,
  type FoodRelatedTerm,
  type FoodUnit,
  type NutrientKey,
  type Nutrients,
} from '../types'
import { isPositiveFinite } from '../utils/validation'
import { queueFoodEstimateAdoption, queueFoodEstimateEvaluation, queueFoodEstimateRejection, withoutPendingEstimation, variantAttributeKeys, variantAttributeLabels, type FoodDraft, type FoodFormReturnView } from './formDrafts'

export function FoodFormView({ draft, returnView, allowCommercialClassification, estimationEnabled, setDraft, foodGroups, foodAliases, foodRelatedTerms, externalNote, onRevertEstimate, onSubmit, onDelete, onClose }: { draft: FoodDraft; returnView: FoodFormReturnView; allowCommercialClassification: boolean; estimationEnabled: boolean; setDraft: React.Dispatch<React.SetStateAction<FoodDraft | null>>; foodGroups: FoodGroup[]; foodAliases: FoodAlias[]; foodRelatedTerms: FoodRelatedTerm[]; externalNote: string | null; onRevertEstimate: (foodId: string, nutrientKey: NutrientKey) => void; onSubmit: () => void | Promise<void>; onDelete?: () => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'basic' | 'nutrition' | 'search'>('basic')
  const update = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => {
    if (!current) return current
    return { ...withoutPendingEstimation(current), [key]: value }
  })
  const updateBaseUnit = (baseUnit: FoodUnit) => setDraft((current) => {
    if (!current) return current
    const inputUnitConversions = current.inputUnitConversions.filter((conversion) => conversion.unit.trim() && conversion.unit.trim() !== baseUnit)
    const allowed = [baseUnit, ...inputUnitConversions.map((conversion) => conversion.unit.trim())]
    return { ...withoutPendingEstimation(current), baseUnit, inputUnitConversions, servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : baseUnit }
  })
  const updateInputUnit = (index: number, inputUnit: string) => setDraft((current) => {
    if (!current) return current
    const normalized = inputUnit.trim()
    const inputUnitConversions = current.inputUnitConversions.map((conversion, conversionIndex) => conversionIndex === index
      ? { ...conversion, unit: inputUnit, baseAmount: normalized && normalized !== current.baseUnit ? conversion.baseAmount : '' }
      : conversion)
    const allowed = [current.baseUnit, ...inputUnitConversions.map((conversion) => conversion.unit.trim()).filter(Boolean)]
    return { ...withoutPendingEstimation(current), inputUnitConversions, servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : current.baseUnit }
  })
  const updateInputUnitBaseAmount = (index: number, baseAmount: string) => update('inputUnitConversions', draft.inputUnitConversions.map((conversion, conversionIndex) => conversionIndex === index ? { ...conversion, baseAmount } : conversion))
  const addInputUnit = () => update('inputUnitConversions', [...draft.inputUnitConversions, { unit: '', baseAmount: '' }])
  const removeInputUnit = (index: number) => {
    const inputUnitConversions = draft.inputUnitConversions.filter((_, conversionIndex) => conversionIndex !== index)
    const allowed = [draft.baseUnit, ...inputUnitConversions.map((conversion) => conversion.unit.trim()).filter(Boolean)]
    setDraft((current) => current
      ? { ...withoutPendingEstimation(current), inputUnitConversions, servingUnit: allowed.includes(current.servingUnit) ? current.servingUnit : current.baseUnit }
      : current)
  }
  const servingUnitOptions = [...new Set([draft.baseUnit, ...draft.inputUnitConversions.map((conversion) => conversion.unit.trim()).filter(Boolean), draft.servingUnit])]
  const updateProductName = (value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const genre = refreshEstimatorGenre(
      { id: cleared.estimatorGenreId, source: cleared.estimatorGenreSource },
      { productName: value, ingredientsText: cleared.ingredientsText },
    )
    return {
      ...cleared,
      name: value,
      groupDisplayName: shouldFollowFoodName(current.groupDisplayName, current.name) ? value : current.groupDisplayName,
      estimatorGenreId: genre.id,
      estimatorGenreSource: genre.source,
    }
  })
  const updateIngredientsText = (value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const genre = refreshEstimatorGenre(
      { id: cleared.estimatorGenreId, source: cleared.estimatorGenreSource },
      { productName: cleared.name, ingredientsText: value },
    )
    return { ...cleared, ingredientsText: value, estimatorGenreId: genre.id, estimatorGenreSource: genre.source }
  })
  const selectEstimatorGenre = (value: EstimatorGenreId) => setDraft((current) => current
    ? { ...withoutPendingEstimation(current), estimatorGenreId: value, estimatorGenreSource: 'user' }
    : current)
  const selectFamily = (value: string) => setDraft((current) => {
    if (!current) return current
    const group = foodGroups.find((item) => item.id === value)
    if (!group) return { ...current, foodGroupId: value }
    return {
      ...current, foodGroupId: value, groupDisplayName: group.displayName, groupReading: group.reading ?? '', groupCategory: group.category ?? '',
      aliases: foodAliases.filter((alias) => alias.foodGroupId === value && alias.isActive).map((alias) => ({ value: alias.alias, type: alias.aliasType })),
      relatedTerms: foodRelatedTerms.filter((term) => term.foodGroupId === value && term.isActive).map((term) => term.term),
    }
  })
  const addAlias = () => update('aliases', [...draft.aliases, { value: '', type: 'synonym' }])
  const addRelatedTerm = () => update('relatedTerms', [...draft.relatedTerms, ''])
  const referenceMassG = draft.baseUnit === 'g'
    ? (isPositiveFinite(Number(draft.baseAmount)) ? Number(draft.baseAmount) : null)
    : (draft.estimationReferenceMassG.trim() && isPositiveFinite(Number(draft.estimationReferenceMassG)) ? Number(draft.estimationReferenceMassG) : null)
  const referenceMassSource = draft.baseUnit === 'g' ? '基準単位がg' : (draft.estimationReferenceMassSource.trim() || null)
  const ingredientsSource = draft.ingredientsSourceProvider.trim()
    ? { provider: draft.ingredientsSourceProvider.trim(), verified: true as const }
    : null
  const currentEstimateNutrients = Object.fromEntries(ESTIMATABLE_NUTRIENT_KEYS.map((key) => [
    key,
    draft.nutrients[key].trim() === '' ? null : Number(draft.nutrients[key]),
  ])) as Pick<Nutrients, (typeof ESTIMATABLE_NUTRIENT_KEYS)[number]>
  const knownEstimateFitNutrients = Object.fromEntries(ESTIMATE_FIT_NUTRIENT_KEYS.map((key) => [
    key,
    draft.nutrients[key].trim() === '' ? null : Number(draft.nutrients[key]),
  ])) as Pick<Nutrients, (typeof ESTIMATE_FIT_NUTRIENT_KEYS)[number]>
  const hasEstimatableMissingValue = ESTIMATABLE_NUTRIENT_KEYS.some((key) => currentEstimateNutrients[key] === null)
  const queueEvaluation = (evaluation: NutrientEstimateEvaluation) => {
    if (evaluation.result.unresolvedIngredients.length > 0) {
      void recordUnresolvedIngredients(evaluation.result.unresolvedIngredients, draft.estimatorGenreId).catch(() => undefined)
    }
    setDraft((current) => {
      if (!current) return current
      return queueFoodEstimateEvaluation(current, evaluation)
    })
  }
  const queueAdoption = (adoption: NutrientEstimateAdoption) => setDraft((current) => {
    if (!current) return current
    return queueFoodEstimateAdoption(current, adoption)
  })
  const queueRejection = (evaluation: NutrientEstimateEvaluation, nutrientKeys: NutrientKey[]) => setDraft((current) => {
    if (!current) return current
    return queueFoodEstimateRejection(current, evaluation, nutrientKeys)
  })
  const updateNutrientValue = (key: NutrientKey, value: string) => setDraft((current) => {
    if (!current) return current
    const cleared = withoutPendingEstimation(current)
    const nutrientMetadata = { ...cleared.nutrientMetadata }
    if (nutrientMetadata[key]?.origin === 'estimated') delete nutrientMetadata[key]
    return { ...cleared, nutrients: { ...cleared.nutrients, [key]: value }, nutrientMetadata }
  })
  return <>
    <section className="page-heading food-form-heading"><div><span className="eyebrow">FOOD MASTER</span><h1>{draft.id ? '食品を編集' : '新しい食品を登録'}</h1></div><button className="button ghost" type="button" onClick={onClose}>{returnView === 'settings' ? '← 設定へ' : returnView === 'search-results' ? '← 検索結果へ' : '← 食品画面へ'}</button></section>
    <section className="settings-card food-form-card">
      {externalNote && <div className="external-warning">{externalNote}</div>}
      <form onSubmit={(event) => { event.preventDefault() }}>
        <div className="search-category-tabs food-form-tabs" role="tablist" aria-label="食品登録項目">
          <button className={activeTab === 'basic' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'basic'} onClick={() => setActiveTab('basic')}>基本情報</button>
          <button className={activeTab === 'nutrition' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'nutrition'} onClick={() => setActiveTab('nutrition')}>栄養値</button>
          <button className={activeTab === 'search' ? 'active' : ''} type="button" role="tab" aria-selected={activeTab === 'search'} onClick={() => setActiveTab('search')}>検索設定</button>
        </div>

        {activeTab === 'basic' && <div className="food-form-tab-panel" role="tabpanel">
          <label>食品名*<input value={draft.name} onChange={(event) => updateProductName(event.target.value)} required /></label>
          <label>メーカー<input value={draft.maker} onChange={(event) => update('maker', event.target.value)} /></label>
          <label>バーコード（JAN/GTIN）<input inputMode="numeric" value={draft.barcode} onChange={(event) => update('barcode', event.target.value)} placeholder="任意・8〜14桁" /></label>
          {allowCommercialClassification && <div className="food-commercial-setting"><label className="toggle-row"><input type="checkbox" checked={draft.isCommercial} onChange={(event) => update('isCommercial', event.target.checked)} />外食・市販として分類する</label></div>}
          <div className="two-fields"><label>基準量*<input type="number" min="0.01" step="any" value={draft.baseAmount} onChange={(event) => update('baseAmount', event.target.value)} required /></label><label>基準単位*<select value={draft.baseUnit} onChange={(event) => updateBaseUnit(event.target.value as FoodUnit)}>{FOOD_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
          <div className="food-form-subsection input-unit-editor">
            <div className="metadata-editor-heading"><strong>入力用単位（任意）</strong><button className="small-action" type="button" onClick={addInputUnit}>＋追加</button></div>
            {draft.inputUnitConversions.map((conversion, index) => <div className="metadata-input-row" key={`input-unit-${index}`}>
              <label><span className="sr-only">入力用単位</span><input list="food-input-unit-options" value={conversion.unit} onChange={(event) => updateInputUnit(index, event.target.value)} placeholder="例：個、杯、パック、切れ" /></label>
              <label><span className="sr-only">1入力単位あたりの基準量</span><input type="number" min="0.01" max="100000" step="any" value={conversion.baseAmount} onChange={(event) => updateInputUnitBaseAmount(index, event.target.value)} placeholder={`基準量（${draft.baseUnit}）`} /><span className="field-hint">{draft.baseUnit}で入力</span></label>
              <button className="small-action danger-text" type="button" onClick={() => removeInputUnit(index)}>削除</button>
            </div>)}
            <datalist id="food-input-unit-options">{FOOD_UNITS.map((unit) => <option key={unit} value={unit} />)}</datalist>
          </div>
          <div className="two-fields"><label>既定の入力分量<input type="number" min="0.01" step="any" value={draft.servingAmount} onChange={(event) => update('servingAmount', event.target.value)} placeholder="任意" /></label><label>既定の入力単位<select value={draft.servingUnit} onChange={(event) => update('servingUnit', event.target.value)}>{servingUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label></div>
          <div className="food-form-subsection ingredient-source-editor">
            <h3>原材料と推計用の確認情報</h3>
            <label>原材料表示<textarea rows={4} value={draft.ingredientsText} onChange={(event) => updateIngredientsText(event.target.value)} placeholder="例：小麦粉、砂糖、バター、ココアパウダー" /></label>
            <label>原材料の取得元<select value={draft.ingredientsSourceProvider} onChange={(event) => update('ingredientsSourceProvider', event.target.value)}>
              <option value="">未選択</option>
              <option value="パッケージ表示">パッケージ表示（確認済み）</option>
              <option value="端末内に保存済み">端末内に保存済み（確認済み）</option>
              <option value="Open Food Facts">Open Food Facts（保存前に要確認）</option>
              <option value="その他">その他（確認済み）</option>
            </select></label>
            <label>食品ジャンル
              <select value={draft.estimatorGenreId} onChange={(event) => selectEstimatorGenre(event.target.value as EstimatorGenreId)}>
                {ESTIMATOR_GENRE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <span className="field-hint">{draft.estimatorGenreSource === 'user' ? '確認済み' : `自動候補: ${ESTIMATOR_GENRE_LABELS[draft.estimatorGenreId]}`}</span>
            </label>
            {draft.baseUnit !== 'g' && <div className="two-fields">
                <label>基準量に対応する確認済み重量（g）<input type="number" min="0.01" step="any" value={draft.estimationReferenceMassG} onChange={(event) => update('estimationReferenceMassG', event.target.value)} placeholder="例：80" /></label>
                <label>重量の根拠<input value={draft.estimationReferenceMassSource} onChange={(event) => update('estimationReferenceMassSource', event.target.value)} placeholder="例：パッケージ内容量" /></label>
              </div>}
          </div>
          <p className="source-line">出典: {draft.sourceVersion}（保存前に内容を確認してください）</p>
        </div>}

        {activeTab === 'nutrition' && <div className="food-form-tab-panel" role="tabpanel">
          <div className="section-title"><div><span className="eyebrow">NUTRIENTS</span><h2>基準量あたりの栄養値</h2></div></div>
          <div className="nutrient-input-grid">{NUTRIENT_KEYS.map((key) => {
            const metadata = draft.nutrientMetadata[key]
            return <label key={key}>{NUTRIENT_LABELS[key]}<div className="unit-input"><input type="number" min="0" step="any" value={draft.nutrients[key]} onChange={(event) => updateNutrientValue(key, event.target.value)} placeholder="未設定" /><span>{NUTRIENT_UNITS[key]}</span></div>
              {metadata?.origin === 'estimated' && <span className="estimated-origin-row"><small>{metadata.method === GENRE_PRIOR_PARTIAL_METHOD ? 'ジャンル補完参考推計' : metadata.method === PARTIAL_METHOD ? '部分参考推計' : '参考推計'} · 信頼度 {metadata.confidence ?? '不明'}</small>{draft.id && <button type="button" className="small-action" onClick={() => onRevertEstimate(draft.id!, key)}>採用を取り消す</button>}</span>}
            </label>
          })}</div>
          {estimationEnabled && hasEstimatableMissingValue && <NutrientEstimatePanel
            basis={{ baseAmount: Number(draft.baseAmount), baseUnit: draft.baseUnit }}
            productName={draft.name.trim() || null}
            estimatorGenreId={draft.estimatorGenreId}
            ingredientsText={draft.ingredientsText.trim() || null}
            ingredientsSource={ingredientsSource}
            referenceMassG={referenceMassG}
            referenceMassSource={referenceMassSource}
            currentNutrients={currentEstimateNutrients}
            knownNutrients={knownEstimateFitNutrients}
            onEvaluated={queueEvaluation}
            onAdopt={queueAdoption}
            onRejectAll={queueRejection}
            disabled={!isPositiveFinite(Number(draft.baseAmount))}
          />}
          {draft.pendingEstimation?.adoption && <p className="nutrient-estimate-queued" role="status">推計候補を入力欄へ反映済みです。画面下の「保存する」で採用と履歴保存を確定します。</p>}
        </div>}

        {activeTab === 'search' && <div className="food-form-tab-panel" role="tabpanel">
          <div className="section-title"><div><span className="eyebrow">SEARCH</span><h2>検索表示とバリエーション</h2></div></div>
          <label>所属するfamily<select value={draft.foodGroupId} onChange={(event) => selectFamily(event.target.value)}><option value="">新しいfamilyを作成</option>{foodGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName}{group.needsReview ? '（要確認）' : ''}</option>)}</select></label>
          <label>表示名<input value={draft.groupDisplayName} onChange={(event) => update('groupDisplayName', event.target.value)} placeholder="未入力時は食品名を使用" /></label>
          <div className="two-fields"><label>読み仮名<input value={draft.groupReading} onChange={(event) => update('groupReading', event.target.value)} placeholder="ひらがな" /></label><label>食品区分<input value={draft.groupCategory} onChange={(event) => update('groupCategory', event.target.value)} placeholder="例：主菜" /></label></div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>別名</strong><button className="small-action" type="button" onClick={addAlias}>＋追加</button></div>{draft.aliases.map((alias, index) => <div className="metadata-input-row" key={`alias-${index}`}><input value={alias.value} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="例：とりむね" /><select value={alias.type} onChange={(event) => update('aliases', draft.aliases.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FoodAliasType } : item))}><option value="synonym">通称</option><option value="reading">読み</option><option value="abbreviation">略称</option></select><button className="small-action danger-text" type="button" onClick={() => update('aliases', draft.aliases.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="metadata-editor"><div className="metadata-editor-heading"><strong>関連語</strong><button className="small-action" type="button" onClick={addRelatedTerm}>＋追加</button></div>{draft.relatedTerms.map((term, index) => <div className="metadata-input-row" key={`related-term-${index}`}><input value={term} onChange={(event) => update('relatedTerms', draft.relatedTerms.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="同じ食品ではないが関連する語" /><button className="small-action danger-text" type="button" onClick={() => update('relatedTerms', draft.relatedTerms.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}</div>
          <div className="food-form-subsection"><h3>バリエーション属性</h3><div className="two-fields variant-attribute-inputs">{variantAttributeKeys.map((key) => <label key={key}>{variantAttributeLabels[key]}<input value={draft.variantAttributes[key]} onChange={(event) => update('variantAttributes', { ...draft.variantAttributes, [key]: event.target.value })} placeholder="任意" /></label>)}</div></div>
        </div>}

        <div className="food-form-actions"><button className="button primary full-width" type="button" onClick={() => { if (!draft.name.trim() || !isPositiveFinite(Number(draft.baseAmount))) setActiveTab('basic'); void onSubmit() }}>保存する</button>{onDelete && <button className="button ghost full-width danger-text" type="button" onClick={onDelete}>食品を削除</button>}<button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></div>
      </form>
    </section>
  </>
}
