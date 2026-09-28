import { useState } from 'react'

/**
 * Selected commits in click order. `primary` is the last one clicked (its row
 * gets keyboard focus); `anchor` is where a Shift-click range starts.
 */
export type GitLogSelection = {
  ids: readonly string[]
  primary: string | null
  anchor: string | null
}

export type GitLogClickModifiers = Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>

const EMPTY_SELECTION: GitLogSelection = { ids: [], primary: null, anchor: null }

export function isToggleSelectionClick(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function rangeBetween(logOrder: readonly string[], from: string, to: string): string[] | null {
  const start = logOrder.indexOf(from)
  const end = logOrder.indexOf(to)
  if (start === -1 || end === -1) {
    return null
  }
  return logOrder.slice(Math.min(start, end), Math.max(start, end) + 1)
}

/** JetBrains-style list selection: click replaces, ⌘/Ctrl toggles, Shift selects a range. */
export function nextGitLogSelection(
  current: GitLogSelection,
  id: string,
  modifiers: { toggle: boolean; range: boolean },
  logOrder: readonly string[]
): GitLogSelection {
  if (modifiers.range && current.anchor) {
    const range = rangeBetween(logOrder, current.anchor, id)
    if (range) {
      const ids = modifiers.toggle ? [...new Set([...current.ids, ...range])] : range
      return { ids, primary: id, anchor: current.anchor }
    }
  }
  if (!modifiers.toggle) {
    return { ids: [id], primary: id, anchor: id }
  }
  if (current.ids.includes(id)) {
    const ids = current.ids.filter((selected) => selected !== id)
    return { ids, primary: ids.at(-1) ?? null, anchor: ids.at(-1) ?? null }
  }
  return { ids: [...current.ids, id], primary: id, anchor: id }
}

export function useGitLogSelection(logOrder: readonly string[]) {
  const [selection, setSelection] = useState<GitLogSelection>(EMPTY_SELECTION)
  const selectedIds = new Set(selection.ids)
  return {
    selectedId: selection.primary,
    /** Selected ids in log order (newest first), limited to rows still shown. */
    orderedIds: logOrder.filter((id) => selectedIds.has(id)),
    isSelected: (id: string): boolean => selectedIds.has(id),
    selectedPair:
      selection.ids.length === 2 ? ([selection.ids[0], selection.ids[1]] as const) : null,
    selectOnly: (id: string): void => setSelection({ ids: [id], primary: id, anchor: id }),
    handleClick: (id: string, event: GitLogClickModifiers): void => {
      const modifiers = {
        toggle: isToggleSelectionClick(event, navigator.userAgent.includes('Mac')),
        range: event.shiftKey
      }
      setSelection((prev) => nextGitLogSelection(prev, id, modifiers, logOrder))
    }
  }
}
