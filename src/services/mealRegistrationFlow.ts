export type MealRegistrationSaveSource = 'search' | 'selection' | 'menu-set'
export type MealRegistrationNextView = 'search-results' | 'food-screen' | 'meal-confirmation'

export interface MealRegistrationTransitionInput {
  editing: boolean
  source: MealRegistrationSaveSource
  searchMatched: boolean
  remainingSearchGroups: number
}

export interface MealRegistrationTransition {
  nextView: MealRegistrationNextView
  keepRecordingMealType: boolean
}

/**
 * 食品を都度保存するフローの保存後遷移を一箇所で決める。
 * 編集だけは確認画面へ戻し、新規追加は食品選択を継続する。
 */
export function resolveMealRegistrationTransition({
  editing,
  source,
  searchMatched,
  remainingSearchGroups,
}: MealRegistrationTransitionInput): MealRegistrationTransition {
  if (editing) return { nextView: 'meal-confirmation', keepRecordingMealType: false }
  if (source === 'search' && searchMatched && remainingSearchGroups > 0) {
    return { nextView: 'search-results', keepRecordingMealType: true }
  }
  return { nextView: 'food-screen', keepRecordingMealType: true }
}
