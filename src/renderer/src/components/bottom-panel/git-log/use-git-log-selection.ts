import { useState } from 'react'

/** The clicked commit, plus one more picked with ⌘/Ctrl+click for "Compare Versions". */
export type GitLogSelection = { primary: string | null; secondary: string | null }

const EMPTY_SELECTION: GitLogSelection = { primary: null, secondary: null }

export function isToggleSelectionClick(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function nextGitLogSelection(
  current: GitLogSelection,
  id: string,
  toggle: boolean
): GitLogSelection {
  if (!toggle) {
    return { primary: id, secondary: null }
  }
  if (id === current.primary) {
    return { primary: current.secondary, secondary: null }
  }
  if (id === current.secondary) {
    return { primary: current.primary, secondary: null }
  }
  // Why: at most two commits compare, so a third ⌘-click drops the oldest pick.
  return { primary: id, secondary: current.primary }
}

export function useGitLogSelection() {
  const [selection, setSelection] = useState<GitLogSelection>(EMPTY_SELECTION)
  const { primary, secondary } = selection
  return {
    selectedId: primary,
    isSelected: (id: string): boolean => id === primary || id === secondary,
    selectedPair: primary && secondary ? ([primary, secondary] as const) : null,
    selectOnly: (id: string): void => setSelection({ primary: id, secondary: null }),
    handleClick: (id: string, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): void => {
      const toggle = isToggleSelectionClick(event, navigator.userAgent.includes('Mac'))
      setSelection((prev) => nextGitLogSelection(prev, id, toggle))
    }
  }
}
