import { describe, expect, it } from 'vitest'
import { resolveMealRegistrationTransition } from '../src/services/mealRegistrationFlow'

describe('meal registration transitions', () => {
  it('複数検索バーでは未選択グループが残る間だけ検索結果へ戻る', () => {
    expect(resolveMealRegistrationTransition({
      editing: false,
      source: 'search',
      searchMatched: true,
      remainingSearchGroups: 1,
    })).toEqual({ nextView: 'search-results', keepRecordingMealType: true })
  })

  it('最後の検索結果を保存した後は食品選択画面へ戻る', () => {
    expect(resolveMealRegistrationTransition({
      editing: false,
      source: 'search',
      searchMatched: true,
      remainingSearchGroups: 0,
    })).toEqual({ nextView: 'food-screen', keepRecordingMealType: true })
  })

  it('お気に入り・履歴・メニューからの通常追加は食品選択を継続する', () => {
    for (const source of ['selection', 'menu-set'] as const) {
      expect(resolveMealRegistrationTransition({
        editing: false,
        source,
        searchMatched: false,
        remainingSearchGroups: 0,
      })).toEqual({ nextView: 'food-screen', keepRecordingMealType: true })
    }
  })

  it('確認画面からの編集保存は確認画面へ戻る', () => {
    expect(resolveMealRegistrationTransition({
      editing: true,
      source: 'selection',
      searchMatched: false,
      remainingSearchGroups: 0,
    })).toEqual({ nextView: 'meal-confirmation', keepRecordingMealType: false })
  })
})
