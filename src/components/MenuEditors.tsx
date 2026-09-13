import { getFoodDefaultServing, getFoodQuantityUnits } from '../services/nutrition'
import {
  MENU_CATEGORIES,
  type Food,
  type FoodAttributePreference,
  type FoodAttributePreferences,
  type FoodGroup,
  type GeneralMenu,
  type Menu,
  type MenuCategory,
  type QuantityUnit,
} from '../types'
import { displayFoodName } from './foodPresentation'
import type { MenuDraft, MenuIngredientDraft, MenuSetDraft, MenuSetFoodItemDraft } from './formDrafts'
import { MenuFoodSelection, MenuIngredientRow, MenuSetSelectedItemRow } from './MenuFoodSelection'

function MenuSetSelectedFoodRow({ food, item, onChangeAmount, onChangeUnit, onRemove }: { food: Food | undefined; item: MenuSetFoodItemDraft; onChangeAmount: (amount: string) => void; onChangeUnit: (unit: QuantityUnit) => void; onRemove: () => void }) {
  const name = food ? displayFoodName(food) : '削除済み食品'
  const availableUnits = food ? getFoodQuantityUnits(food) : [item.unit]
  const unitOptions = availableUnits.includes(item.unit) ? availableUnits : [...availableUnits, item.unit]
  return <div className="menu-set-selected-row menu-set-selected-food-row"><div className="menu-set-selected-food-copy"><div><span className="source-badge">食品</span><strong>{name}</strong></div><label><span className="sr-only">{name}の分量</span><input type="number" min="0.01" max="100000" step="any" value={item.amount} onChange={(event) => onChangeAmount(event.target.value)} required /><select value={item.unit} onChange={(event) => onChangeUnit(event.target.value)} aria-label={`${name}の入力単位`}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}{!availableUnits.includes(unit) ? '（未登録）' : ''}</option>)}</select></label></div><button type="button" className="small-action danger-text" onClick={onRemove} aria-label={`${name}を削除`}>削除</button></div>
}

export function MenuEditorModal({ draft, setDraft, menus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose, mode = 'my' }: { draft: MenuDraft; setDraft: React.Dispatch<React.SetStateAction<MenuDraft | null>>; menus: Menu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void; mode?: 'my' | 'general' | 'temporary' }) {
  const menuTypeLabel = mode === 'general' ? '一般メニュー' : mode === 'temporary' ? '一時メニュー' : 'Myメニュー'
  const addFood = (food: Food) => setDraft((current) => {
    if (!current || current.ingredients.some((ingredient) => ingredient.kind === 'food' && ingredient.itemId === food.id)) return current
    const serving = getFoodDefaultServing(food)
    return { ...current, ingredients: [...current.ingredients, { kind: 'food', itemId: food.id, amount: String(serving.amount), unit: serving.unit }] }
  })
  const addMenu = (menu: Menu) => setDraft((current) => current && !current.ingredients.some((ingredient) => ingredient.kind === 'menu' && ingredient.itemId === menu.id) ? { ...current, ingredients: [...current.ingredients, { kind: 'menu', itemId: menu.id, amount: '1', unit: '食' }] } : current)
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.kind !== 'food' || ingredient.itemId !== food.id) } : current)
  const removeIngredient = (target: MenuIngredientDraft) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.kind !== target.kind || ingredient.itemId !== target.itemId) } : current)
  const changeIngredientAmount = (target: MenuIngredientDraft, amount: string) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((ingredient) => ingredient.kind === target.kind && ingredient.itemId === target.itemId ? { ...ingredient, amount } : ingredient) } : current)
  const changeIngredientUnit = (target: MenuIngredientDraft, unit: QuantityUnit) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((ingredient) => ingredient.kind === target.kind && ingredient.itemId === target.itemId ? { ...ingredient, unit } : ingredient) } : current)
  const updateMenuConversion = (index: number, key: 'unit' | 'baseAmount', value: string) => setDraft((current) => {
    if (!current) return current
    const previousUnit = current.inputUnitConversions[index]?.unit
    return {
      ...current,
      inputUnitConversions: current.inputUnitConversions.map((conversion, conversionIndex) => conversionIndex === index ? { ...conversion, [key]: value } : conversion),
      servingUnit: key === 'unit' && current.servingUnit === previousUnit ? value : current.servingUnit,
    }
  })
  const addMenuConversion = () => setDraft((current) => current ? { ...current, inputUnitConversions: [...current.inputUnitConversions, { unit: '', baseAmount: '' }] } : current)
  const removeMenuConversion = (index: number) => setDraft((current) => {
    if (!current) return current
    const removedUnit = current.inputUnitConversions[index]?.unit
    return {
      ...current,
      inputUnitConversions: current.inputUnitConversions.filter((_, conversionIndex) => conversionIndex !== index),
      servingUnit: current.servingUnit === removedUnit ? '食' : current.servingUnit,
    }
  })
  const selectedFoodIds = draft.ingredients.filter((ingredient) => ingredient.kind === 'food').map((ingredient) => ingredient.itemId)
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${menuTypeLabel}を設定`}>
      <section className="modal-card menu-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">{mode === 'temporary' ? 'ONE-TIME MENU' : mode === 'general' ? 'GENERAL MENU' : 'MY MENU'}</span><h2>{draft.id ? `${menuTypeLabel}を編集` : `${menuTypeLabel}を設定`}</h2>{mode === 'temporary' && <p className="muted">この食事にだけ保存され、メニュー一覧には追加されません。</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="menu-editor-form" onSubmit={onSubmit}>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">BASIC</span><h3>基本情報</h3></div>
            </div>
            <div className="menu-editor-basic-fields">
              <label className="menu-editor-name-field">メニュー名*<input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} required /></label>
              {mode !== 'temporary' && <label>区分<select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as MenuCategory } : current)}>{MENU_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
              {mode !== 'temporary' && <label className="menu-editor-alias-field">検索用エイリアス（任意）<input value={draft.aliases.join('、')} onChange={(event) => setDraft((current) => current ? { ...current, aliases: event.target.value.split(/[、,，]/).map((alias) => alias.trim()).filter(Boolean) } : current)} placeholder="例：おにぎり、朝ごはん" /></label>}
              {mode === 'my' && <label className="menu-editor-memo-field">メモ（任意）<textarea rows={4} value={draft.memo ?? ''} onChange={(event) => setDraft((current) => current ? { ...current, memo: event.target.value } : current)} placeholder="作り方や次回の調整点などを自由に記録できます。" /></label>}
            </div>
            <div className="food-form-subsection input-unit-editor">
              <div className="metadata-editor-heading"><strong>メニュー全体の入力単位（任意）</strong><button className="small-action" type="button" onClick={addMenuConversion}>＋追加</button></div>
              <p className="field-hint">基準単位は「食」です。1入力単位が何食分かを明示してください。</p>
              {draft.inputUnitConversions.map((conversion, index) => <div className="metadata-input-row" key={`menu-input-unit-${index}`}>
                <label><span className="sr-only">メニュー入力単位</span><input value={conversion.unit} onChange={(event) => updateMenuConversion(index, 'unit', event.target.value)} placeholder="例：皿、パック" /></label>
                <label><span className="sr-only">1入力単位あたりの食数</span><input type="number" min="0.01" max="100000" step="any" value={conversion.baseAmount} onChange={(event) => updateMenuConversion(index, 'baseAmount', event.target.value)} placeholder="食数" /><span className="field-hint">食</span></label>
                <button className="small-action danger-text" type="button" onClick={() => removeMenuConversion(index)}>削除</button>
              </div>)}
            </div>
            <div className="two-fields"><label>既定の入力分量<input type="number" min="0.01" max="100000" step="any" value={draft.servingAmount} onChange={(event) => setDraft((current) => current ? { ...current, servingAmount: event.target.value } : current)} /></label><label>既定の入力単位<select value={draft.servingUnit} onChange={(event) => setDraft((current) => current ? { ...current, servingUnit: event.target.value } : current)}><option value="食">食</option>{draft.inputUnitConversions.filter((conversion) => conversion.unit.trim()).map((conversion) => <option key={conversion.unit} value={conversion.unit}>{conversion.unit}</option>)}</select></label></div>
          </section>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">SELECTED</span><h3>追加済み食材</h3></div>
              <span className="menu-editor-count">{draft.ingredients.length}件</span>
            </div>
            {draft.ingredients.length > 0
              ? <div className="menu-editor-selected-list">{draft.ingredients.map((ingredient) => <MenuIngredientRow key={`${ingredient.kind}:${ingredient.itemId}`} ingredient={ingredient} foods={foods} menus={menus} onChangeAmount={(amount) => changeIngredientAmount(ingredient, amount)} onChangeUnit={(unit) => changeIngredientUnit(ingredient, unit)} onRemove={() => removeIngredient(ingredient)} />)}</div>
              : <p className="menu-editor-empty">まだ食材がありません。下の「食材を追加」から選択してください。</p>}
          </section>
          <section className="menu-editor-section menu-editor-add-section">
            <MenuFoodSelection selectedIds={selectedFoodIds} selectedIngredients={draft.ingredients} menus={menus} editingMenuId={draft.id} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onRemove={removeFood} onAddMenu={addMenu} showSelectedList={false} pickerTitle="食材を追加" />
          </section>
          <div className="menu-editor-actions">
            <button className="button primary full-width" type="submit">{mode === 'temporary' ? 'この食事に追加' : '保存する'}</button>
            <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function MenuSetEditorModal({ draft, setDraft, menus, generalMenus, foods, foodGroups, recentFoods, favoriteFoods, favoriteIds, onToggleFavorite, foodAttributePreferences, onSaveFoodAttributePreference, onSubmit, onClose }: { draft: MenuSetDraft; setDraft: React.Dispatch<React.SetStateAction<MenuSetDraft | null>>; menus: Menu[]; generalMenus: GeneralMenu[]; foods: Food[]; foodGroups: FoodGroup[]; recentFoods: Food[]; favoriteFoods: Food[]; favoriteIds: Set<string>; onToggleFavorite: (food: Food) => void; foodAttributePreferences?: FoodAttributePreferences; onSaveFoodAttributePreference?: (foodGroupId: string, attributeId: string, preference: FoodAttributePreference | null) => Promise<boolean>; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const addFood = (food: Food) => setDraft((current) => current && !current.foodIds.includes(food.id) ? { ...current, foodIds: [...current.foodIds, food.id] } : current)
  const addFoodWithAmount = (food: Food, amount: string, unit: QuantityUnit) => setDraft((current) => {
    if (!current || current.foodItems.some((item) => item.foodId === food.id)) return current
    const nextItem = { foodId: food.id, amount, unit }
    return { ...current, foodIds: [...current.foodIds, food.id], foodItems: [...current.foodItems, nextItem] }
  })
  const removeFood = (food: Food) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== food.id) } : current)
  const addMenu = (menu: Menu) => setDraft((current) => current && !current.menuIds.includes(menu.id) ? { ...current, menuIds: [...current.menuIds, menu.id] } : current)
  const removeMenu = (menuId: string) => setDraft((current) => current ? { ...current, menuIds: current.menuIds.filter((id) => id !== menuId) } : current)
  const addGeneralMenu = (menu: GeneralMenu) => setDraft((current) => current && !current.generalMenuIds.includes(menu.id) ? { ...current, generalMenuIds: [...current.generalMenuIds, menu.id] } : current)
  const removeGeneralMenu = (menuId: string) => setDraft((current) => current ? { ...current, generalMenuIds: current.generalMenuIds.filter((id) => id !== menuId) } : current)
  const removeFoodItem = (foodId: string) => setDraft((current) => current ? { ...current, foodIds: current.foodIds.filter((id) => id !== foodId), foodItems: current.foodItems.filter((item) => item.foodId !== foodId) } : current)
  const changeFoodAmount = (foodId: string, amount: string) => setDraft((current) => current ? { ...current, foodItems: current.foodItems.map((item) => item.foodId === foodId ? { ...item, amount } : item) } : current)
  const changeFoodUnit = (foodId: string, unit: QuantityUnit) => setDraft((current) => current ? { ...current, foodItems: current.foodItems.map((item) => item.foodId === foodId ? { ...item, unit } : item) } : current)
  const selectedCount = draft.foodItems.length + draft.menuIds.length + draft.generalMenuIds.length
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Myセットを設定">
      <section className="modal-card menu-editor-modal menu-set-editor-modal">
        <div className="modal-heading">
          <div><span className="eyebrow">MY SET</span><h2>{draft.id ? 'Myセットを編集' : 'Myセットを設定'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="menu-editor-form" onSubmit={onSubmit}>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">NAME</span><h3>セット名</h3></div>
            </div>
            <label className="menu-editor-name-field"><span className="sr-only">セット名</span><input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} placeholder="例：いつもの朝食" required /></label>
          </section>
          <section className="menu-editor-section">
            <div className="menu-editor-section-heading">
              <div><span className="eyebrow">SELECTED</span><h3>追加済み食品・メニュー</h3></div>
              <span className="menu-editor-count">{selectedCount}件</span>
            </div>
            {selectedCount > 0
              ? <div className="menu-set-selected-list">
                {draft.menuIds.map((menuId) => {
                  const menu = menus.find((item) => item.id === menuId)
                  return <MenuSetSelectedItemRow key={`menu:${menuId}`} kind="menu" name={menu?.name ?? '削除済みMyメニュー'} onRemove={() => removeMenu(menuId)} />
                })}
                {draft.generalMenuIds.map((menuId) => {
                  const menu = generalMenus.find((item) => item.id === menuId)
                  return <MenuSetSelectedItemRow key={`general-menu:${menuId}`} kind="general-menu" name={menu?.name ?? '削除済み一般メニュー'} onRemove={() => removeGeneralMenu(menuId)} />
                })}
                {draft.foodItems.map((item) => <MenuSetSelectedFoodRow key={`food:${item.foodId}`} food={foods.find((food) => food.id === item.foodId)} item={item} onChangeAmount={(amount) => changeFoodAmount(item.foodId, amount)} onChangeUnit={(unit) => changeFoodUnit(item.foodId, unit)} onRemove={() => removeFoodItem(item.foodId)} />)}
              </div>
              : <p className="menu-editor-empty">まだ食品やメニューがありません。下の追加欄から選択してください。</p>}
          </section>
          <section className="menu-editor-section menu-editor-add-section">
            <MenuFoodSelection selectedIds={draft.foodIds} selectedMenuIds={draft.menuIds} selectedGeneralMenuIds={draft.generalMenuIds} menus={menus} generalMenus={generalMenus} foods={foods} foodGroups={foodGroups} recentFoods={recentFoods} favoriteFoods={favoriteFoods} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} foodAttributePreferences={foodAttributePreferences} onSaveFoodAttributePreference={onSaveFoodAttributePreference} onAdd={addFood} onAddWithAmount={addFoodWithAmount} onRemove={removeFood} onAddMenu={addMenu} onAddGeneralMenu={addGeneralMenu} showSelectedList={false} pickerTitle="食品・メニューを追加" allowFoodCategoryFilter />
          </section>
          <div className="menu-editor-actions">
            <button className="button primary full-width" type="submit">保存する</button>
            <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  )
}
