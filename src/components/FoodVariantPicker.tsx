import { useEffect, useMemo, useRef, useState } from 'react'
import { applyConstrainedMextFoodAttributePreferences, applyConstrainedUserFoodSelectionPreferences, getFoodAttributePreferencesForGroup } from '../services/foodAttributePreferences'
import { applicableMextSearchAttributeHints, reconcileMextSearchAttributeHints } from '../services/mextSearchAttributeHints'
import { type FoodSearchResult } from '../services/foodSearch'
import { filterVariantsBySelection, getAvailableVariantOptionValues, getVariantOptionGroups, getVariantSelection, reconcileVariantSelection, resolveVariantForSelection, variantOptionText, type VariantOptionGroup } from '../services/foodVariants'
import {
  AmbiguousFoodVariant,
  FoodVariantNotFound,
  getAvailableFoodAttributeValueIds,
  getDefaultSelectedAttributes,
  getFoodAttributeDisplayName,
  getFoodVariantBySourceId,
  getSelectableAttributes,
  hasFoodGroup as hasMextFoodGroup,
  MissingRequiredAttribute,
  reconcileFoodAttributeSelection,
  resolveFoodVariantForUi,
} from '../services/mextFoodData'
import {
  getAvailableUserSelectionValueIds,
  reconcileUserFoodSelection,
  resolveFoodGroupId,
  type UserFoodSearchResult,
} from '../services/mextUserFoodData'
import { formatNutrient, getFoodQuantityUnits, incrementByQuantityUnit } from '../services/nutrition'
import {
  type Food,
  type FoodAttributePreference,
  type FoodAttributePreferences,
  type FoodGroup,
  type QuantityUnit,
} from '../types'
import { displayFoodName } from './foodPresentation'
import { buildMextFoodSearchResult } from './foodSearchModels'

interface FoodVariantPickerModalProps {
  result: FoodSearchResult | null
  userFoodResult?: UserFoodSearchResult
  foods?: Food[]
  foodGroups?: FoodGroup[]
  onSelect: (food: Food) => void
  onClose: () => void
  mealMode?: boolean
  onSubmitMeal?: (food: Food, amount: string, amountUnit: QuantityUnit) => void | Promise<void>
  initialFoodId?: string
  initialAmount?: string
  initialAmountUnit?: QuantityUnit
  submitLabel?: string
  foodAttributePreferences?: FoodAttributePreferences
  onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>
}

export function FoodVariantPickerModal(props: FoodVariantPickerModalProps) {
  if (!props.result && !props.userFoodResult) return null
  if (props.userFoodResult || (props.result && hasMextFoodGroup(props.result.group.id))) {
    return <MextFoodVariantPickerModal {...props} />
  }
  if (!props.result) return null
  return <LegacyFoodVariantPickerModal {...props} result={props.result} />
}

interface FoodAttributeVisibilityItem {
  key: string
  displayName: string
  checked: boolean
  disabled: boolean
  selectedValueName: string | null
  onToggle: (visible: boolean) => void
}

function FoodAttributeVisibilityPanel({ items, onClose }: {
  items: FoodAttributeVisibilityItem[]
  onClose: () => void
}) {
  return <div className="food-attribute-visibility-panel"><div className="food-attribute-visibility-heading"><strong>表示する項目</strong><button className="small-action" type="button" onClick={onClose}>閉じる</button></div><p className="helper-text">チェックした項目だけを食品選択画面に表示します。チェックを外すと、現在の選択を次回以降の既定値として使用します。</p><div className="food-attribute-visibility-list">{items.map((item) => <label className="food-attribute-visibility-row" key={item.key}><input type="checkbox" checked={item.checked} disabled={item.disabled} onChange={(event) => item.onToggle(event.target.checked)} /><span>{item.displayName}</span><small>{item.selectedValueName ? `既定: ${item.selectedValueName}` : '先に値を選択'}</small></label>)}</div></div>
}

function MextFoodVariantPickerModal({ result, userFoodResult, foods = [], foodGroups = [], onSelect, onClose, mealMode = false, onSubmitMeal, initialFoodId, initialAmount, initialAmountUnit, submitLabel = '食事として登録', foodAttributePreferences = {}, onSaveFoodAttributePreference }: FoodVariantPickerModalProps) {
  const initialFoodVariant = useMemo(() => initialFoodId ? getFoodVariantBySourceId(initialFoodId) : undefined, [initialFoodId])
  const initialUserSelection = useMemo(() => {
    if (!userFoodResult || !initialFoodVariant) return null
    return reconcileUserFoodSelection(userFoodResult.group.id, userFoodResult.presetSelection).selection
  }, [initialFoodVariant, userFoodResult])
  const userGroupPreferences = useMemo(() => userFoodResult ? (foodAttributePreferences[userFoodResult.group.id] ?? {}) : {}, [foodAttributePreferences, userFoodResult])
  const appliedUserPreferences = useMemo(() => userFoodResult
    ? applyConstrainedUserFoodSelectionPreferences(userFoodResult.group.id, userFoodResult.group.selectionDimensions, userFoodResult.presetSelection, userGroupPreferences)
    : { selection: {}, autoHiddenDimensionIds: new Set<string>(), invalidDimensionIds: new Set<string>(), incompatibleDimensionIds: new Set<string>() }, [userFoodResult, userGroupPreferences])
  const userSelectionOrder = useMemo(() => userFoodResult ? [
    ...userFoodResult.group.selectionDimensions.filter((dimension) => !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
    ...userFoodResult.group.selectionDimensions.filter((dimension) => appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)),
  ].map((dimension) => dimension.id) : [], [appliedUserPreferences.autoHiddenDimensionIds, userFoodResult])
  const [userSelection, setUserSelection] = useState<Record<string, string>>(() => initialUserSelection ?? appliedUserPreferences.selection)
  const [temporarilyVisibleUserDimensionIds, setTemporarilyVisibleUserDimensionIds] = useState<Set<string>>(new Set())
  const [constraintMessage, setConstraintMessage] = useState<string | null>(null)
  useEffect(() => {
    setUserSelection(initialUserSelection ?? appliedUserPreferences.selection)
    setTemporarilyVisibleUserDimensionIds(new Set(appliedUserPreferences.incompatibleDimensionIds))
    if (appliedUserPreferences.incompatibleDimensionIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [appliedUserPreferences, initialUserSelection])
  const visibleUserDimensions = useMemo(() => (userFoodResult?.group.selectionDimensions ?? []).filter((dimension) => {
    return !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id) || temporarilyVisibleUserDimensionIds.has(dimension.id)
  }), [appliedUserPreferences.autoHiddenDimensionIds, temporarilyVisibleUserDimensionIds, userFoodResult])
  const availableUserDimensionValues = useMemo(() => new Map((userFoodResult?.group.selectionDimensions ?? []).map((dimension) => [
    dimension.id,
    getAvailableUserSelectionValueIds(userFoodResult!.group.id, userSelection, dimension.id, userSelectionOrder),
  ])), [userFoodResult, userSelection, userSelectionOrder])
  const resolvedUserFoodGroupId = useMemo(() => {
    if (!userFoodResult) return result?.group.id ?? null
    try {
      return resolveFoodGroupId(userFoodResult.group.id, userSelection)
    } catch {
      return null
    }
  }, [result?.group.id, userFoodResult, userSelection])
  const activeResult = useMemo(() => {
    if (!userFoodResult) return result
    if (!resolvedUserFoodGroupId) return null
    return buildMextFoodSearchResult(resolvedUserFoodGroupId, foods, foodGroups, result?.score ?? 0)
  }, [foodGroups, foods, resolvedUserFoodGroupId, result, userFoodResult])
  const activeFoodGroupId = activeResult?.group.id ?? null
  const attributes = useMemo(() => activeFoodGroupId ? getSelectableAttributes(activeFoodGroupId) : [], [activeFoodGroupId])
  const [temporarilyVisibleAttributeIds, setTemporarilyVisibleAttributeIds] = useState<Set<string>>(new Set())
  const [showAttributeSettings, setShowAttributeSettings] = useState(false)
  const groupPreferences = useMemo(() => activeFoodGroupId ? getFoodAttributePreferencesForGroup(foodAttributePreferences, activeFoodGroupId) : {}, [activeFoodGroupId, foodAttributePreferences])
  const appliedPreferences = useMemo(() => activeFoodGroupId
    ? applyConstrainedMextFoodAttributePreferences(activeFoodGroupId, attributes, getDefaultSelectedAttributes(activeFoodGroupId), groupPreferences)
    : { selection: {}, autoHiddenAttributeIds: new Set<string>(), invalidAttributeIds: new Set<string>(), incompatibleAttributeIds: new Set<string>() }, [activeFoodGroupId, attributes, groupPreferences])
  const attributeSelectionOrder = useMemo(() => [
    ...attributes.filter((attribute) => attribute.visibility !== 'hidden' && !appliedPreferences.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => appliedPreferences.autoHiddenAttributeIds.has(attribute.id)),
    ...attributes.filter((attribute) => attribute.visibility === 'hidden'),
  ].map((attribute) => attribute.id), [appliedPreferences.autoHiddenAttributeIds, attributes])
  const searchAttributeSelection = applicableMextSearchAttributeHints(
    userFoodResult?.foodGroupId,
    activeFoodGroupId,
    userFoodResult?.attributeSelection,
  )
  const initialAttributeState = useMemo(() => {
    if (!activeFoodGroupId) {
      return { selection: appliedPreferences.selection, appliedHintAttributeIds: new Set<string>() }
    }
    return reconcileMextSearchAttributeHints(
      activeFoodGroupId,
      appliedPreferences.selection,
      searchAttributeSelection,
      attributeSelectionOrder,
      initialFoodVariant?.foodGroupId === activeFoodGroupId ? initialFoodVariant.attributes : undefined,
    )
  }, [activeFoodGroupId, appliedPreferences.selection, attributeSelectionOrder, initialFoodVariant, searchAttributeSelection])
  const hasAutoHiddenPreference = appliedPreferences.autoHiddenAttributeIds.size > 0
  const visibleAttributeIds = useMemo(() => new Set(attributes.filter((attribute) => {
    return attribute.visibility !== 'hidden' && (!appliedPreferences.autoHiddenAttributeIds.has(attribute.id) || temporarilyVisibleAttributeIds.has(attribute.id))
  }).map((attribute) => attribute.id)), [attributes, appliedPreferences.autoHiddenAttributeIds, temporarilyVisibleAttributeIds])
  const visibleAttributes = useMemo(() => attributes.filter((attribute) => visibleAttributeIds.has(attribute.id)), [attributes, visibleAttributeIds])
  const hiddenAttributes = useMemo(() => attributes.filter((attribute) => attribute.visibility === 'hidden'), [attributes])
  const supplementalFoods = useMemo(() => (activeResult?.variants ?? []).filter((food) => !getFoodVariantBySourceId(food.id)), [activeResult?.variants])
  const [selection, setSelection] = useState<Record<string, string>>(() => initialAttributeState.selection)
  const [selectionFoodGroupId, setSelectionFoodGroupId] = useState<string | null>(activeFoodGroupId)
  const initialSupplementalFoodId = supplementalFoods.find((food) => food.id === initialFoodId)?.id ?? null
  const [supplementalFoodId, setSupplementalFoodId] = useState<string | null>(initialSupplementalFoodId)
  const selectionForActiveGroup = selectionFoodGroupId === activeFoodGroupId ? selection : initialAttributeState.selection
  useEffect(() => {
    setSelection(initialAttributeState.selection)
    setSelectionFoodGroupId(activeFoodGroupId)
    setSupplementalFoodId(initialSupplementalFoodId)
    setTemporarilyVisibleAttributeIds(new Set([
      ...appliedPreferences.incompatibleAttributeIds,
      ...initialAttributeState.appliedHintAttributeIds,
    ]))
    if (appliedPreferences.incompatibleAttributeIds.size > 0) {
      setConstraintMessage('保存済みの既定値の組み合わせに該当する食品がないため、選択し直してください。')
    } else {
      setConstraintMessage(null)
    }
  }, [activeFoodGroupId, appliedPreferences, initialAttributeState, initialSupplementalFoodId])
  const resolution = useMemo(() => {
    if (!resolvedUserFoodGroupId) {
      return { variant: null, error: '種類を選択すると、属性を指定できます。', requiresHiddenSelection: false }
    }
    if (!activeResult || !activeFoodGroupId) {
      return { variant: null, error: '対象食品データを読み込めませんでした。食品データを再読み込みしてください。', requiresHiddenSelection: false }
    }
    try {
      return { variant: resolveFoodVariantForUi(activeFoodGroupId, selectionForActiveGroup), error: null, requiresHiddenSelection: false }
    } catch (error) {
      if (error instanceof MissingRequiredAttribute) return { variant: null, error: '必要な属性を選択してください。', requiresHiddenSelection: false }
      if (error instanceof AmbiguousFoodVariant) return { variant: null, error: '食品を一意に決めるため、追加の属性を選択してください。', requiresHiddenSelection: true }
      if (error instanceof FoodVariantNotFound && hasAutoHiddenPreference) return { variant: null, error: '自動適用した属性の組み合わせに該当する食品がありません。属性を確認してください。', requiresHiddenSelection: true }
      return { variant: null, error: error instanceof Error ? error.message : '食品を決定できません。', requiresHiddenSelection: false }
    }
  }, [activeFoodGroupId, activeResult, hasAutoHiddenPreference, resolvedUserFoodGroupId, selectionForActiveGroup])
  const supplementalFood = supplementalFoods.find((food) => food.id === supplementalFoodId) ?? null
  const resolvedMextFood = resolution.variant && activeResult
    ? activeResult.variants.find((food) => food.id === resolution.variant?.sourceId) ?? null
    : null
  const selectedFood = supplementalFood ?? resolvedMextFood
  const attributesToShow = resolution.requiresHiddenSelection ? attributes : visibleAttributes
  const availableAttributeValues = useMemo(() => new Map(attributesToShow.map((attribute) => [
    attribute.id,
    activeFoodGroupId
      ? getAvailableFoodAttributeValueIds(activeFoodGroupId, selectionForActiveGroup, attributeSelectionOrder, attribute.id)
      : new Set<string>(),
  ])), [activeFoodGroupId, attributeSelectionOrder, attributesToShow, selectionForActiveGroup])
  const autoAppliedAttributes = attributes.filter((attribute) => {
    const preference = groupPreferences[attribute.id]
    return appliedPreferences.autoHiddenAttributeIds.has(attribute.id)
      && preference !== undefined
      && selectionForActiveGroup[attribute.id] === preference.defaultValueId
      && !appliedPreferences.invalidAttributeIds.has(attribute.id)
  })
  const autoAppliedUserDimensions = (userFoodResult?.group.selectionDimensions ?? []).filter((dimension) => {
    const preference = userGroupPreferences[dimension.id]
    return appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id)
      && preference !== undefined
      && userSelection[dimension.id] === preference.defaultValueId
      && !appliedUserPreferences.invalidDimensionIds.has(dimension.id)
  })
  const autoHiddenAttributes = autoAppliedAttributes.filter((attribute) => !temporarilyVisibleAttributeIds.has(attribute.id))
  const autoHiddenUserDimensions = autoAppliedUserDimensions.filter((dimension) => !temporarilyVisibleUserDimensionIds.has(dimension.id))
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  const selectedFoodDefaultUnit = selectedFood ? (selectedFood.servingUnit ?? selectedFood.baseUnit) : ''
  const selectedFoodName = supplementalFood ? (supplementalFood.officialName ?? supplementalFood.name) : resolution.variant?.sourceName
  const editingAmount = initialAmount !== undefined
  const [amount, setAmount] = useState(initialAmount ?? selectedFoodDefaultAmount)
  const [amountUnit, setAmountUnit] = useState<QuantityUnit>(initialAmountUnit ?? selectedFoodDefaultUnit)
  useEffect(() => {
    if (!editingAmount) {
      setAmount(selectedFoodDefaultAmount)
      setAmountUnit(selectedFoodDefaultUnit)
      return
    }
    if (selectedFood && !getFoodQuantityUnits(selectedFood).includes(amountUnit)) setAmountUnit(selectedFoodDefaultUnit)
  }, [amountUnit, editingAmount, selectedFood, selectedFoodDefaultAmount, selectedFoodDefaultUnit, selectedFoodId])

  const chooseAttribute = (attributeId: string, valueId: string, hidden: boolean) => {
    if (!activeFoodGroupId) return
    setSupplementalFoodId(null)
    const next = { ...selectionForActiveGroup, [attributeId]: valueId }
    if (!hidden) hiddenAttributes.forEach((attribute) => { delete next[attribute.id] })
    const reconciled = reconcileFoodAttributeSelection(activeFoodGroupId, next, attributeSelectionOrder)
    setSelection(reconciled.selection)
    setSelectionFoodGroupId(activeFoodGroupId)
    if (reconciled.clearedAttributeIds.size > 0) {
      setTemporarilyVisibleAttributeIds((current) => new Set([...current, ...reconciled.clearedAttributeIds]))
      setConstraintMessage('選択条件が変わったため、利用できない下位の属性を解除しました。')
    } else {
      setConstraintMessage(null)
    }
  }

  const chooseUserDimension = (dimensionId: string, valueId: string) => {
    if (!userFoodResult) return
    const reconciled = reconcileUserFoodSelection(userFoodResult.group.id, { ...userSelection, [dimensionId]: valueId }, userSelectionOrder)
    setUserSelection(reconciled.selection)
    if (reconciled.clearedDimensionIds.size > 0) {
      setTemporarilyVisibleUserDimensionIds((current) => new Set([...current, ...reconciled.clearedDimensionIds]))
      setConstraintMessage('種類が変わったため、利用できない下位の選択を解除しました。')
    } else {
      setConstraintMessage(null)
    }
  }

  const showAutoAttribute = (attributeId: string) => setTemporarilyVisibleAttributeIds((current) => new Set(current).add(attributeId))
  const showAutoUserDimension = (dimensionId: string) => setTemporarilyVisibleUserDimensionIds((current) => new Set(current).add(dimensionId))
  const toggleUserDimensionVisibility = async (dimensionId: string, visible: boolean) => {
    const valueId = userSelection[dimensionId] ?? userGroupPreferences[dimensionId]?.defaultValueId
    if (!userFoodResult || !valueId || !onSaveFoodAttributePreference) return
    await onSaveFoodAttributePreference(userFoodResult.group.id, dimensionId, { defaultValueId: valueId, mode: visible ? 'prefill' : 'auto', visible })
  }
  const toggleAttributeVisibility = async (attributeId: string, visible: boolean) => {
    const valueId = selectionForActiveGroup[attributeId] ?? groupPreferences[attributeId]?.defaultValueId
    if (!activeFoodGroupId || !valueId || !onSaveFoodAttributePreference) return
    await onSaveFoodAttributePreference(activeFoodGroupId, attributeId, { defaultValueId: valueId, mode: visible ? 'prefill' : 'auto', visible })
  }
  const attributeDisplayName = (attribute: ReturnType<typeof getSelectableAttributes>[number]) => activeFoodGroupId
    ? getFoodAttributeDisplayName(activeFoodGroupId, attribute)
    : attribute.displayName
  const visibilityItems: FoodAttributeVisibilityItem[] = [
    ...(userFoodResult?.group.selectionDimensions ?? []).map((dimension) => {
      const selectedValueId = userSelection[dimension.id] ?? userGroupPreferences[dimension.id]?.defaultValueId
      const selectedValue = dimension.values.find((value) => value.id === selectedValueId)
      return {
        key: `user:${dimension.id}`,
        displayName: dimension.displayName,
        checked: !appliedUserPreferences.autoHiddenDimensionIds.has(dimension.id),
        disabled: selectedValue === undefined,
        selectedValueName: selectedValue?.displayName ?? null,
        onToggle: (visible: boolean) => { void toggleUserDimensionVisibility(dimension.id, visible) },
      }
    }),
    ...attributes.filter((attribute) => attribute.visibility !== 'hidden').map((attribute) => {
      const selectedValueId = selectionForActiveGroup[attribute.id] ?? groupPreferences[attribute.id]?.defaultValueId
      const selectedValue = attribute.values.find((value) => value.id === selectedValueId)
      return {
        key: `mext:${attribute.id}`,
        displayName: attributeDisplayName(attribute),
        checked: !appliedPreferences.autoHiddenAttributeIds.has(attribute.id),
        disabled: selectedValue === undefined,
        selectedValueName: selectedValue?.displayName ?? null,
        onToggle: (visible: boolean) => { void toggleAttributeVisibility(attribute.id, visible) },
      }
    }),
  ]
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品の種類と属性を選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">FOOD SELECTION</span><h2 className="variant-picker-title">{activeResult?.group.displayName ?? userFoodResult?.group.displayName ?? result?.group.displayName ?? '食品'}<button className="info-button variant-attribute-info" type="button" disabled={visibilityItems.length === 0} onClick={() => setShowAttributeSettings((current) => !current)} aria-expanded={showAttributeSettings} aria-label="表示する食品属性を設定">ⓘ</button></h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>{visibleUserDimensions.length > 0 && <div className="variant-choice-groups food-type-selection">{visibleUserDimensions.map((dimension) => <section className="variant-choice-group" key={dimension.id}><h3>{dimension.displayName}</h3><div className="variant-choice-buttons">{dimension.values.map((value) => { const available = availableUserDimensionValues.get(dimension.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${userSelection[dimension.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={userSelection[dimension.id] === value.id} key={`${dimension.id}:${value.id}`} disabled={!available} onClick={() => chooseUserDimension(dimension.id, value.id)}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{showAttributeSettings && <FoodAttributeVisibilityPanel items={visibilityItems} onClose={() => setShowAttributeSettings(false)} />}{supplementalFoods.length > 0 && <div className="variant-choice-groups"><section className="variant-choice-group"><h3>手動登録食品</h3><div className="variant-choice-buttons">{supplementalFoods.map((food) => <button className={`variant-choice-button${supplementalFoodId === food.id ? ' is-selected' : ''}`} type="button" aria-pressed={supplementalFoodId === food.id} key={food.id} onClick={() => setSupplementalFoodId(food.id)}>{food.officialName ?? food.name}</button>)}</div></section></div>}{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{autoAppliedUserDimensions.length + autoAppliedAttributes.length > 0 && <div className="variant-picker-auto-summary"><span>自動適用: {[...autoAppliedUserDimensions.map((dimension) => `${dimension.displayName}＝${dimension.values.find((value) => value.id === userSelection[dimension.id])?.displayName ?? ''}`), ...autoAppliedAttributes.map((attribute) => `${attributeDisplayName(attribute)}＝${attribute.values.find((value) => value.id === selectionForActiveGroup[attribute.id])?.displayName ?? ''}`)].join('、')}</span>{autoHiddenUserDimensions.length + autoHiddenAttributes.length > 0 && <button className="small-action" type="button" onClick={() => { autoHiddenUserDimensions.forEach((dimension) => showAutoUserDimension(dimension.id)); autoHiddenAttributes.forEach((attribute) => showAutoAttribute(attribute.id)) }}>今回だけ変更</button>}</div>}{attributesToShow.length > 0 && <div className="variant-choice-groups">{attributesToShow.map((attribute) => <section className="variant-choice-group" key={attribute.id}><h3>{attributeDisplayName(attribute)}</h3><div className="variant-choice-buttons">{attribute.values.map((value) => { const available = availableAttributeValues.get(attribute.id)?.has(value.id) ?? false; return <button className={`variant-choice-button${selectionForActiveGroup[attribute.id] === value.id ? ' is-selected' : ''}`} type="button" aria-pressed={selectionForActiveGroup[attribute.id] === value.id} key={`${attribute.id}:${value.id}`} disabled={!available} onClick={() => chooseAttribute(attribute.id, value.id, attribute.visibility === 'hidden')}><span>{value.displayName}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>}{userFoodResult && !activeResult && <p className="variant-picker-no-match">{resolution.error}</p>}{activeResult && selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{selectedFoodName}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}</small></div> : activeResult ? <p className="variant-picker-no-match">{resolution.error}</p> : null}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>{submitLabel}</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}

export function FoodAmountPickerModal({ food, amount, unit, onChangeAmount, onChangeUnit, onSubmit, onClose }: { food: Food; amount: string; unit: QuantityUnit; onChangeAmount: (value: string) => void; onChangeUnit: (value: QuantityUnit) => void; onSubmit?: (food: Food, amount: string, unit: QuantityUnit) => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品の分量を設定"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">FOOD AMOUNT</span><h2>{displayFoodName(food)}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="selected-food"><strong>{displayFoodName(food)}</strong><span>{food.maker || '一般食品'} · 基準量 {food.baseAmount}{food.baseUnit}</span></div><label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => onChangeAmount(event.target.value)} required /><select className="field-suffix" value={unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(food).map((option) => <option key={option} value={option}>{option}</option>)}</select></div></div></label><button className="button primary variant-picker-confirm" type="button" onClick={() => onSubmit?.(food, amount, unit)}>追加する</button><button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button></section></div>
}

function LegacyFoodVariantPickerModal({ result, onSelect, onClose, mealMode = false, onSubmitMeal, initialFoodId, initialAmount, initialAmountUnit, submitLabel = '食事として登録' }: Omit<FoodVariantPickerModalProps, 'result'> & { result: FoodSearchResult }) {
  const optionGroups = useMemo(() => getVariantOptionGroups(result.variants), [result.variants])
  const defaultVariant = result.variants.find((food) => food.id === initialFoodId) ?? result.variants.find((food) => food.id === result.group.defaultVariantId) ?? result.food
  const [selection, setSelection] = useState(() => getVariantSelection(defaultVariant, optionGroups))
  const [fallbackVariantId, setFallbackVariantId] = useState(defaultVariant.id)
  const [amount, setAmount] = useState(initialAmount ?? String(defaultVariant.servingAmount ?? defaultVariant.baseAmount))
  const [constraintMessage, setConstraintMessage] = useState<string | null>(null)
  const fallbackGroup: VariantOptionGroup = useMemo(() => ({ key: 'variant', label: 'バリエーション', options: result.variants.map((food) => ({ value: food.id, label: variantOptionText(food) })) }), [result.variants])
  const groups = optionGroups.length > 0 ? optionGroups : [fallbackGroup]
  const matchingVariants = optionGroups.length > 0 ? filterVariantsBySelection(result.variants, selection) : result.variants.filter((food) => food.id === fallbackVariantId)
  const selectedFood = optionGroups.length > 0 ? resolveVariantForSelection(result.variants, selection, fallbackVariantId) : matchingVariants[0] ?? null
  const availableOptionValues = useMemo(() => new Map(optionGroups.flatMap((group) => group.key === 'variant' ? [] : [[
    group.key,
    getAvailableVariantOptionValues(result.variants, optionGroups, selection, group.key),
  ]])), [optionGroups, result.variants, selection])
  const selectedFoodId = selectedFood?.id
  const selectedFoodDefaultAmount = selectedFood ? String(selectedFood.servingAmount ?? selectedFood.baseAmount) : ''
  const selectedFoodDefaultUnit = selectedFood ? (selectedFood.servingUnit ?? selectedFood.baseUnit) : ''
  const [amountUnit, setAmountUnit] = useState<QuantityUnit>(initialAmountUnit ?? selectedFoodDefaultUnit)
  const previousFoodId = useRef(selectedFoodId)
  useEffect(() => {
    if (previousFoodId.current === selectedFoodId) return
    previousFoodId.current = selectedFoodId
    setAmount(selectedFoodDefaultAmount)
    setAmountUnit(selectedFoodDefaultUnit)
  }, [selectedFoodDefaultAmount, selectedFoodDefaultUnit, selectedFoodId])
  const isSelected = (group: VariantOptionGroup, value: string | null) => group.key === 'variant' ? fallbackVariantId === value : selection[group.key] === value
  const chooseOption = (group: VariantOptionGroup, value: string | null) => {
    if (group.key === 'variant') setFallbackVariantId(value ?? '')
    else {
      const reconciled = reconcileVariantSelection(result.variants, optionGroups, { ...selection, [group.key]: value })
      setSelection(reconciled.selection)
      setConstraintMessage(reconciled.clearedKeys.size > 0 ? '選択条件が変わったため、利用できない下位の属性を解除しました。' : null)
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食品のバリエーションを選択"><section className="modal-card variant-picker-modal"><div className="modal-heading"><div><span className="eyebrow">VARIATIONS</span><h2>{result.group.displayName}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="variant-choice-groups">{groups.map((group) => <section className="variant-choice-group" key={group.key}><h3>{group.label}</h3><div className="variant-choice-buttons">{group.options.map((option) => { const available = group.key === 'variant' || (availableOptionValues.get(group.key)?.has(option.value) ?? false); return <button className={`variant-choice-button${isSelected(group, option.value) ? ' is-selected' : ''}`} type="button" aria-pressed={isSelected(group, option.value)} key={`${group.key}:${option.value ?? 'none'}`} disabled={!available} onClick={() => chooseOption(group, option.value)}><span>{option.label}</span>{!available && <small>該当なし</small>}</button> })}</div></section>)}</div>{constraintMessage && <p className="variant-constraint-message" role="status">{constraintMessage}</p>}{selectedFood ? <div className="variant-picker-summary"><span>選択中</span><strong>{variantOptionText(selectedFood)}</strong><small>{selectedFood.baseAmount}{selectedFood.baseUnit} · {formatNutrient(selectedFood.nutrients.energyKcal)}kcal{matchingVariants.length > 1 ? ` · ${matchingVariants.length}件が該当` : ''}</small></div> : <p className="variant-picker-no-match">必要な属性を選択してください。</p>}{mealMode && selectedFood && <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力単位">{getFoodQuantityUnits(selectedFood).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={() => setAmount(String(incrementByQuantityUnit(Number(amount), selectedFood, amountUnit)))} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>}{mealMode && selectedFood ? <button className="button primary variant-picker-confirm" type="button" onClick={() => { void onSubmitMeal?.(selectedFood, amount, amountUnit) }}>{submitLabel}</button> : <button className="button primary variant-picker-confirm" type="button" onClick={() => { if (selectedFood) onSelect(selectedFood) }} disabled={!selectedFood}>この食品を選択</button>}</section></div>
}
