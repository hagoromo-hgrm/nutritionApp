export interface SearchSelectionGroup {
  query: string
}

export interface SearchSelectionProgress<T extends SearchSelectionGroup> {
  matched: boolean
  remainingGroups: T[]
}

/**
 * 同じ検索語のバーが複数あっても、食品を選んだ1グループだけを完了扱いにする。
 */
export function consumeSearchSelectionGroup<T extends SearchSelectionGroup>(
  groups: T[],
  selectedQuery: string | null,
): SearchSelectionProgress<T> {
  if (selectedQuery === null) return { matched: false, remainingGroups: groups }
  const selectedIndex = groups.findIndex((group) => group.query === selectedQuery)
  if (selectedIndex < 0) return { matched: false, remainingGroups: groups }
  return {
    matched: true,
    remainingGroups: groups.filter((_, index) => index !== selectedIndex),
  }
}
