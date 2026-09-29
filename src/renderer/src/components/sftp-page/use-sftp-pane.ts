import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SftpEntry, SftpResult } from '../../../../shared/sftp-types'
import {
  applySelectionClick,
  EMPTY_SELECTION,
  pruneSelection,
  type PaneSelection,
  type SelectionModifiers
} from './sftp-selection'

export type SftpPaneSource = {
  initialPath: () => Promise<SftpResult<string>>
  list: (path: string) => Promise<SftpResult<SftpEntry[]>>
  parent: (path: string) => string
}

export type SftpPaneState = {
  path: string | null
  entries: SftpEntry[]
  /** Only the first load can fail the whole pane; later failures keep the listing and toast. */
  status: 'loading' | 'ready' | 'error'
  error: string | null
  selection: PaneSelection
  selectedEntries: SftpEntry[]
  /** Null at the filesystem root, where the ".." row is hidden. */
  parentPath: string | null
  navigate: (path: string) => void
  goUp: () => void
  refresh: () => void
  refreshIfShowing: (path: string) => void
  /** `orderedPaths` is the listing as displayed, so Shift-ranges follow the current sort. */
  select: (entry: SftpEntry, modifiers: SelectionModifiers, orderedPaths: readonly string[]) => void
}

/** One side of the SFTP page: where it is, what it lists, and what is selected. */
export function useSftpPane(source: SftpPaneSource): SftpPaneState {
  const [path, setPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [status, setStatus] = useState<SftpPaneState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<PaneSelection>(EMPTY_SELECTION)
  const requestRef = useRef(0)
  const pathRef = useRef<string | null>(null)

  const load = useCallback(
    async (nextPath: string, keepSelection: boolean) => {
      const request = ++requestRef.current
      const result = await source.list(nextPath)
      // Why: a slower answer for an earlier folder must not replace the one the user opened last.
      if (request !== requestRef.current) {
        return
      }
      if (!result.ok) {
        if (pathRef.current === null) {
          setStatus('error')
          setError(result.error.message)
        } else {
          toast.error(result.error.message)
        }
        return
      }
      pathRef.current = nextPath
      setPath(nextPath)
      setEntries(result.value)
      setStatus('ready')
      setError(null)
      const ordered = result.value.map((entry) => entry.path)
      setSelection((current) =>
        keepSelection ? pruneSelection(current, ordered) : EMPTY_SELECTION
      )
    },
    [source]
  )

  const start = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const initial = await source.initialPath()
    if (initial.ok) {
      await load(initial.value, false)
    } else {
      setStatus('error')
      setError(initial.error.message)
    }
  }, [load, source])

  useEffect(() => {
    void start()
  }, [start])

  const navigate = useCallback((nextPath: string) => void load(nextPath, false), [load])
  const refresh = useCallback(() => {
    if (pathRef.current === null) {
      void start()
    } else {
      void load(pathRef.current, true)
    }
  }, [load, start])
  const refreshIfShowing = useCallback(
    (shownPath: string) => {
      if (pathRef.current === shownPath) {
        void load(shownPath, true)
      }
    },
    [load]
  )
  const goUp = useCallback(() => {
    if (pathRef.current !== null) {
      void load(source.parent(pathRef.current), false)
    }
  }, [load, source])
  const select = useCallback(
    (entry: SftpEntry, modifiers: SelectionModifiers, orderedPaths: readonly string[]) =>
      setSelection((current) => applySelectionClick(current, orderedPaths, entry.path, modifiers)),
    []
  )

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection.selected.has(entry.path)),
    [entries, selection]
  )

  return {
    path,
    entries,
    status,
    error,
    selection,
    selectedEntries,
    parentPath: path !== null && source.parent(path) !== path ? source.parent(path) : null,
    navigate,
    goUp,
    refresh,
    refreshIfShowing,
    select
  }
}
