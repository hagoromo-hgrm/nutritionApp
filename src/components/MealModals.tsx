import { useState } from 'react'
import { getFoodSnapshotDisplayName, getMealEntryDisplayName } from '../services/mealEntryDisplay'
import {
  calculateMealMenuEntryNutrients,
  createMealFoodIngredientSnapshot,
  createMealMenuIngredientSnapshot,
} from '../services/mealMenuSnapshots'
import { calculateNutrients, formatNutrient, getFoodQuantityUnits, incrementByQuantityUnit, sumAvailableNutrients } from '../services/nutrition'
import { getMenuBase } from '../services/menuIngredients'
import {
  MEAL_TYPES,
  type Food,
  type FoodAttributePreference,
  type FoodAttributePreferences,
  type FoodGroup,
  type MealEntry,
  type MealIngredientSnapshot,
  type MealMenuSnapshot,
  type MealType,
  type Menu,
  type Nutrients,
  type NutritionGoals,
  type QuantityUnit,
} from '../types'
import { toTokyoTimeInput } from '../utils/date'
import type { MenuIngredientDraft } from './formDrafts'
import { MEAL_ICON_ASSETS } from './mealPresentation'
import { MenuFoodSelection } from './MenuFoodSelection'
import { NutrientGoalGraphs } from './NutritionGraphs'

export function MealTypePickerModal({ food, recordedMealTypes, onSelect }: { food: Food | null; recordedMealTypes: MealType[]; onSelect: (type: MealType) => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を追加"><section className="modal-card meal-type-picker">{food && <p className="helper-text">「{food.displayName ?? food.name}」を記録する区分を選択してください。</p>}<div className="meal-type-options">{MEAL_TYPES.map((type) => { const recorded = recordedMealTypes.includes(type); return <button key={type} className={`meal-type-option${recorded ? ' is-recorded' : ''}`} type="button" onClick={() => onSelect(type)} aria-label={`${type}${recorded ? '（記録済み）' : ''}`}><img src={MEAL_ICON_ASSETS[type]} alt="" aria-hidden="true" />{recorded && <span className="meal-type-check" aria-hidden="true">✓</span>}</button> })}</div></section></div>
}

function MealSnapshotIngredientRow({ ingredient, onChange, onRemove }: { ingredient: MealIngredientSnapshot; onChange: (ingredient: MealIngredientSnapshot) => void; onRemove: () => void }) {
  const name = ingredient.kind === 'food' ? getFoodSnapshotDisplayName(ingredient.foodSnapshot) : ingredient.name
  const availableUnits = ingredient.kind === 'food'
    ? [ingredient.foodSnapshot.baseUnit, ...(ingredient.foodSnapshot.inputUnitConversions ?? []).map((conversion) => conversion.unit)]
    : ingredient.baseAmount !== undefined && ingredient.baseUnit !== undefined
      ? [ingredient.baseUnit]
      : ['食', ...(ingredient.inputUnitConversions ?? []).map((conversion) => conversion.unit)]
  const unitOptions = availableUnits.includes(ingredient.unit) ? availableUnits : [...availableUnits, ingredient.unit]
  const changeChild = (index: number, child: MealIngredientSnapshot) => {
    if (ingredient.kind !== 'menu') return
    onChange({ ...ingredient, ingredients: ingredient.ingredients.map((current, currentIndex) => currentIndex === index ? child : current) })
  }
  const removeChild = (index: number) => {
    if (ingredient.kind !== 'menu') return
    onChange({ ...ingredient, ingredients: ingredient.ingredients.filter((_, currentIndex) => currentIndex !== index) })
  }
  return <div className={`meal-snapshot-ingredient${ingredient.kind === 'menu' ? ' is-menu' : ''}`}><div className="menu-ingredient-row"><div className="menu-ingredient-copy"><span className="source-badge">{ingredient.kind === 'food' ? '食品' : '料理'}</span><strong>{name}</strong></div><label className="menu-ingredient-amount"><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={ingredient.amount > 0 ? ingredient.amount : ''} onChange={(event) => onChange({ ...ingredient, amount: Number(event.target.value) })} required /><select value={ingredient.unit} onChange={(event) => onChange({ ...ingredient, unit: event.target.value })} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select></label><button type="button" className="small-action danger-text" onClick={onRemove}>削除</button></div>{ingredient.kind === 'menu' && <details className="meal-snapshot-nested"><summary>{ingredient.name}の構成食材（{ingredient.ingredients.length}件）</summary><div>{ingredient.missing && <p className="menu-food-empty">原本は削除されています。保存済みの構成だけを使用します。</p>}{ingredient.ingredients.map((child, index) => <MealSnapshotIngredientRow key={`${child.kind}:${child.itemId}:${index}`} ingredient={child} onChange={(next) => changeChild(index, next)} onRemove={() => removeChild(index)} />)}</div></details>}</div>
}

export function MealModal({ food, amount, setAmount, amountUnit, setAmountUnit, menuSnapshot, setMenuSnapshot, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, editing, onSubmit, onClose }: { food: Food; amount: string; setAmount: (value: string) => void; amountUnit: QuantityUnit; setAmountUnit: (value: QuantityUnit) => void; menuSnapshot: MealMenuSnapshot | null; setMenuSnapshot: (snapshot: MealMenuSnapshot | null) => void; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; editing: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const preview = menuSnapshot
    ? calculateMealMenuEntryNutrients(menuSnapshot, Number(amount), amountUnit)
    : calculateNutrients(food, Number(amount), amountUnit)
  const [selectedIngredientsOpen, setSelectedIngredientsOpen] = useState(() => editing)
  const numericAmount = Number(amount)
  const canIncrement = !Number.isFinite(numericAmount) || numericAmount < 100000
  const incrementAmount = () => setAmount(String(incrementByQuantityUnit(numericAmount, food, amountUnit)))
  const changeIngredient = (index: number, ingredient: MealIngredientSnapshot) => setMenuSnapshot(menuSnapshot ? { ...menuSnapshot, ingredients: menuSnapshot.ingredients.map((current, currentIndex) => currentIndex === index ? ingredient : current) } : null)
  const removeIngredient = (index: number) => setMenuSnapshot(menuSnapshot ? { ...menuSnapshot, ingredients: menuSnapshot.ingredients.filter((_, currentIndex) => currentIndex !== index) } : null)
  const addFood = (ingredientFood: Food) => {
    if (!menuSnapshot || menuSnapshot.ingredients.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === ingredientFood.id)) return
    setMenuSnapshot({ ...menuSnapshot, ingredients: [...menuSnapshot.ingredients, createMealFoodIngredientSnapshot(ingredientFood)] })
  }
  const addMenu = (menu: Menu) => {
    if (!menuSnapshot || menuSnapshot.ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.itemId === menu.id)) return
    const base = getMenuBase(menu)
    setMenuSnapshot({ ...menuSnapshot, ingredients: [...menuSnapshot.ingredients, createMealMenuIngredientSnapshot(menu, menus, foods, base.amount, base.unit)] })
  }
  const selectedIngredients: MenuIngredientDraft[] = menuSnapshot?.ingredients.map((ingredient) => ({ kind: ingredient.kind, itemId: ingredient.itemId, amount: String(ingredient.amount), unit: ingredient.unit })) ?? []
  const selectedFoodIds = selectedIngredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="食事を記録">
    <section className={`modal-card${menuSnapshot ? ' meal-menu-modal' : ''}`}>
      <div className="modal-heading"><div><span className="eyebrow">ADD MEAL</span><h2>{editing ? '食事を編集' : '食事を記録'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div>
      <div className="selected-food"><strong>{menuSnapshot?.sourceMenuName ?? food.displayName ?? food.name}</strong><span>{menuSnapshot ? (menuSnapshot.sourceKind === 'temporary' ? '一時メニュー' : menuSnapshot.sourceKind === 'general-menu' ? '一般メニュー' : 'Myメニュー') : (food.maker || '一般食品')} · 基準量 {food.baseAmount}{food.baseUnit}{food.inputUnitConversions?.length ? ` · 入力用単位 ${food.inputUnitConversions.map((conversion) => `1${conversion.unit}=${conversion.baseAmount}${food.baseUnit}`).join('、')}` : ''}</span></div>
      <form onSubmit={onSubmit}>
        {menuSnapshot?.sourceKind === 'temporary' && <label>一時メニュー名<input value={menuSnapshot.sourceMenuName} onChange={(event) => setMenuSnapshot({ ...menuSnapshot, sourceMenuName: event.target.value })} required /></label>}
        <label>分量<div className="amount-input-row"><div className="amount-input"><input type="number" min="0.01" max="100000" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /><select className="field-suffix" value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)} aria-label="入力用単位">{getFoodQuantityUnits(food).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div><button className="amount-increment" type="button" onClick={incrementAmount} disabled={!canIncrement} aria-label="分量を既定分量1回分増やす">＋1</button></div></label>
        {menuSnapshot && <section className="meal-menu-snapshot-editor">
          <details className="meal-menu-selected-details" open={selectedIngredientsOpen} onToggle={(event) => setSelectedIngredientsOpen(event.currentTarget.open)}>
            <summary><div><span className="eyebrow">SELECTED</span><h3>追加済み食材</h3><p>表示中の分量はメニューの基準量分です。ここでの変更はこの食事だけに保存され、メニュー原本には反映されません。</p></div><span className="menu-editor-count">{menuSnapshot.ingredients.length}件</span><i aria-hidden="true" /></summary>
            <div className="meal-snapshot-ingredients menu-editor-selected-list">{menuSnapshot.ingredients.length > 0 ? menuSnapshot.ingredients.map((ingredient, index) => <MealSnapshotIngredientRow key={`${ingredient.kind}:${ingredient.itemId}:${index}`} ingredient={ingredient} onChange={(next) => changeIngredient(index, next)} onRemove={() => removeIngredient(index)} />) : <p className="menu-editor-empty">構成食材がありません。下から追加できます。</p>}</div>
          </details>
          <div className="menu-editor-add-section"><MenuFoodSelection selectedIds={selectedFoodIds} selectedIngredients={selectedIngredients} menus={menus} editingMenuId={menuSnapshot.sourceMenuId} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={() => undefined} onAddMenu={addMenu} showSelectedList={false} pickerTitle="食材を追加" /></div>
        </section>}
        <div className="preview-box calorie-preview"><div className="section-kicker">今回のカロリー</div><strong>{formatNutrient(preview.energyKcal)}<small> kcal</small></strong></div>
        <button className="button primary full-width" type="submit">{editing ? '変更を保存' : '食事として登録'}</button>
        <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
      </form>
    </section>
  </div>
}

export function MealDetailsModal({ details, goals, onUpdateTimes, onClose }: { details: { type: MealType; entries: MealEntry[]; subtotal: Nutrients }; goals: NutritionGoals; onUpdateTimes: (entryIds: string[], time: string) => void; onClose: () => void }) {
  const [sharedTime, setSharedTime] = useState(details.entries[0] ? toTokyoTimeInput(details.entries[0].eatenAt) : '')
  const [snackTimes, setSnackTimes] = useState<Record<string, string>>(() => Object.fromEntries(details.entries.map((entry) => [entry.id, toTokyoTimeInput(entry.eatenAt)])))
  const sharedEntryIds = details.entries.map((entry) => entry.id)
  const availableNutrients = sumAvailableNutrients(details.entries)
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${details.type}の栄養詳細`}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">NUTRIENTS</span><h2>{details.type}の詳細</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><div className="detail-total"><span>合計カロリー</span><strong>{formatNutrient(details.subtotal.energyKcal)}<small> kcal</small></strong></div><NutrientGoalGraphs nutrients={details.subtotal} availableNutrients={availableNutrients} goals={goals} /><section className="meal-time-editor"><div className="section-title"><div><span className="eyebrow">MEAL TIME</span><h3>食事時刻</h3></div></div>{details.type !== '間食' ? <form className="inline-time-form" onSubmit={(event) => { event.preventDefault(); onUpdateTimes(sharedEntryIds, sharedTime) }}><label><input aria-label="食事時刻" type="time" value={sharedTime} onChange={(event) => setSharedTime(event.target.value)} required /></label><button className="button secondary" type="submit">時刻を保存</button></form> : <div className="snack-time-list">{details.entries.map((entry) => <div className="snack-time-row" key={entry.id}><span>{getMealEntryDisplayName(entry)}</span><input type="time" value={snackTimes[entry.id] ?? ''} onChange={(event) => setSnackTimes((current) => ({ ...current, [entry.id]: event.target.value }))} /><button className="small-action" type="button" onClick={() => onUpdateTimes([entry.id], snackTimes[entry.id] ?? '')}>保存</button></div>)}</div>}</section><div className="detail-entry-list">{details.entries.map((entry) => <div className="detail-entry" key={entry.id}><span>{getMealEntryDisplayName(entry)} · {entry.amount}{entry.amountUnit}</span><strong>{formatNutrient(entry.calculatedNutrients.energyKcal)} kcal</strong></div>)}</div><button className="button ghost full-width" type="button" onClick={onClose}>閉じる</button></section></div>
}
