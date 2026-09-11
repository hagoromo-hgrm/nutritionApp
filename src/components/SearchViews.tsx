import { useEffect, useRef, useState } from 'react'
import {
  FOOD_MASTER_SEARCH_CATEGORIES,
  MEAL_SEARCH_CATEGORIES,
  type FoodSearchCategory,
} from '../services/foodClassification'
import type { SearchPurpose, SearchResultGroup, SearchResultItem } from './foodSearchModels'

export function SearchInputView({ bars, setBars, onSearch, onBack }: { bars: string[]; setBars: React.Dispatch<React.SetStateAction<string[]>>; onSearch: () => void; onBack: () => void }) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [focusIndex, setFocusIndex] = useState<number | null>(0)

  useEffect(() => {
    if (focusIndex === null) return
    const input = inputRefs.current[focusIndex]
    if (!input) return
    input.focus()
    setFocusIndex(null)
  }, [bars.length, focusIndex])

  const addSearchBar = () => {
    setFocusIndex(bars.length)
    setBars((current) => [...current, ''])
  }

  return <><section className="page-heading"><div><span className="eyebrow">SEARCH</span><h1>食品・メニューを検索</h1></div></section><section className="settings-card search-input-card"><div className="search-bar-list">{bars.map((bar, index) => <div className="search-bar-row" key={index}><label><input ref={(element) => { inputRefs.current[index] = element }} aria-label="検索バー" maxLength={100} value={bar} onChange={(event) => setBars((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} placeholder="食品名・メーカー・メニュー名" /></label>{bars.length > 1 && <button className="small-action danger-text" type="button" onClick={() => setBars((current) => current.filter((_, currentIndex) => currentIndex !== index))}>削除</button>}</div>)}</div><div className="search-input-actions"><button className="button secondary" type="button" onClick={addSearchBar}>＋ 検索バーを追加</button><button className="button primary" type="button" onClick={onSearch}>検索する</button></div></section><button className="floating-back" type="button" onClick={onBack}><span aria-hidden="true">←</span>食品画面へ</button></>
}

const searchCategoryLabels: Record<FoodSearchCategory, string> = { all: '全て', general: '一般食材', menu: 'メニュー', commercial: '外食・市販' }

export function SearchResultsView({ groups, purpose, category, searching, onCategoryChange, onSelect, onAddFood, onLoadMore, onOpenConfirmation, onBack }: { groups: SearchResultGroup[]; purpose: SearchPurpose; category: FoodSearchCategory; searching: boolean; onCategoryChange: (category: FoodSearchCategory) => void; onSelect: (query: string, item: SearchResultItem) => void; onAddFood: (query: string) => void; onLoadMore: (index: number) => void; onOpenConfirmation: () => void; onBack: () => void }) {
  const categories = purpose === 'meal' ? MEAL_SEARCH_CATEGORIES : FOOD_MASTER_SEARCH_CATEGORIES
  const emptyLabel = category === 'all' ? '一致する食品・メニューがありません。' : category === 'menu' ? '一致するメニューがありません。' : `${searchCategoryLabels[category]}に一致する食品がありません。`
  return <>
    <section className="page-heading search-results-page-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h1>検索結果</h1></div></section>
    <div className="search-category-tabs" role="tablist" aria-label="検索結果の分類">{categories.map((value) => <button key={value} id={`search-category-${value}`} role="tab" type="button" aria-selected={category === value} aria-controls="search-category-panel" className={category === value ? 'active' : ''} disabled={searching} onClick={() => onCategoryChange(value)}>{searchCategoryLabels[value]}</button>)}</div>
    <div id="search-category-panel" role="tabpanel" aria-labelledby={`search-category-${category}`} aria-busy={searching} className="search-result-groups">
      {searching ? <div className="empty-state">検索中…</div> : <>
        {groups.map((group, groupIndex) => <section className="search-result-group" key={`${group.query}:${groupIndex}`}>
          <div className="search-result-heading"><strong>検索結果：</strong><span>{group.query}</span></div>
          <div className="food-results">
            {group.items.map((item) => <button className="search-result-row" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(group.query, item)}><span className="source-badge">{item.kind === 'food' || item.kind === 'user-food' ? '食品' : item.kind === 'menu' ? 'My' : item.kind === 'general-menu' ? '一般' : 'セット'}</span><span className="search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small>{(item.kind === 'food' || item.kind === 'user-food') && <span className="search-result-meta">{item.recentlyUsed && <em>最近使った</em>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_group' && item.userFoodResult.group.memberCount !== 1 && <span>{item.userFoodResult.group.memberCount}種類から選択</span>}{item.kind === 'user-food' && item.userFoodResult?.targetType === 'user_food_variant' && item.variants.length > 1 && <span>{item.variants.length}バリエーションから選択</span>}{item.kind === 'food' && item.variants.length > 1 && <span>{item.variants.length}種類から選択</span>}</span>}</span><b className={item.kind === 'set' ? 'batch-action' : undefined}>{item.kind === 'set' ? '一括登録' : '›'}</b></button>)}
            {group.items.length === 0 && <div className="search-empty-state"><p>{emptyLabel}</p>{category !== 'menu' && <button className="button secondary" type="button" onClick={() => onAddFood(group.query === '最近・お気に入り' ? '' : group.query)}>食品を追加</button>}</div>}
            {group.nextCursor && <button className="button secondary search-load-more" type="button" onClick={() => onLoadMore(groupIndex)}>さらに表示</button>}
          </div>
        </section>)}
        {groups.length === 0 && <div className="empty-state">検索結果はありません。検索画面へ戻って再検索してください。</div>}
      </>}
    </div>
    <button className="floating-back" type="button" onClick={onBack}><span aria-hidden="true">←</span>検索画面へ</button>{purpose === 'meal' && <button className="floating-next" type="button" onClick={onOpenConfirmation}>確認<span aria-hidden="true">→</span></button>}
  </>
}
