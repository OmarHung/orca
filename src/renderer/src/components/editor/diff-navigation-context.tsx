import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { editor } from 'monaco-editor'
import { installMonacoDiffChangeNavigationShortcut } from './editor-shortcuts'
import {
  stepDiffChange,
  type DiffChangeCursorEditor,
  type DiffChangeDirection
} from './diff-change-step'

// Why: the change-marker gutter drives the same header controls without a diff editor.
export type DiffNavigationTarget = Pick<
  editor.IStandaloneDiffEditor,
  'getContainerDomNode' | 'goToDiff'
> & {
  getLineChanges: () => readonly unknown[] | null
  onDidUpdateDiff: (listener: () => void) => { dispose: () => void }
  // Why: optional so change-marker navigation, which has no per-file diff cursor, keeps plain goToDiff.
  getModifiedEditor?: () => DiffChangeCursorEditor
}

export type DiffEditorRegistrationContextValue = {
  registerDiffEditor: (editor: DiffNavigationTarget) => void
  unregisterDiffEditor: (editor: DiffNavigationTarget) => void
}

export type DiffNavigationContextValue = {
  goToPreviousDiff: () => void
  goToNextDiff: () => void
  changeCount: number
}

const noop = (): void => {}

// Why: registration stays separate from changeCount so diff recomputation only
// rerenders the header controls, not the heavy Monaco DiffViewer consumer.
const DiffEditorRegistrationContext = createContext<DiffEditorRegistrationContextValue>({
  registerDiffEditor: noop,
  unregisterDiffEditor: noop
})

const DiffNavigationContext = createContext<DiffNavigationContextValue>({
  goToPreviousDiff: noop,
  goToNextDiff: noop,
  changeCount: 0
})

function countChanges(diffEditor: DiffNavigationTarget): number {
  return diffEditor.getLineChanges()?.length ?? 0
}

function boundaryNoticeText(direction: DiffChangeDirection): string {
  return direction === 'next'
    ? translate(
        'diffNavigation.fileEnd',
        'Last change in this file. Press again to open the next file.'
      )
    : translate(
        'diffNavigation.fileStart',
        'First change in this file. Press again to open the previous file.'
      )
}

function edgeFileNoticeText(direction: DiffChangeDirection): string {
  return direction === 'next'
    ? translate('diffNavigation.lastFile', 'This is the last changed file.')
    : translate('diffNavigation.firstFile', 'This is the first changed file.')
}

export function DiffNavigationProvider({
  children,
  resolveAdjacentFileOpener
}: {
  children: React.ReactNode
  // Why: returns null when there is no neighbouring changed file in that direction.
  resolveAdjacentFileOpener?: (direction: DiffChangeDirection) => (() => void) | null
}): React.JSX.Element {
  const editorRef = useRef<DiffNavigationTarget | null>(null)
  const resolveAdjacentFileOpenerRef = useRef(resolveAdjacentFileOpener)
  useLayoutEffect(() => {
    resolveAdjacentFileOpenerRef.current = resolveAdjacentFileOpener
  }, [resolveAdjacentFileOpener])
  // Why: the target and direction that showed the boundary notice; a repeat press crosses to the next file.
  const boundaryArmedRef = useRef<{
    target: DiffNavigationTarget
    direction: DiffChangeDirection
  } | null>(null)
  const updateSubRef = useRef<{ dispose: () => void } | null>(null)
  // Why: F7/Shift+F7 change navigation shares the registered editor with the
  // header buttons, so the keyboard listener lives here rather than in DiffViewer.
  const shortcutCleanupRef = useRef<(() => void) | null>(null)
  // Why: changeCount must be state, not a ref — the header is a sibling consumer
  // and only re-renders (enabling the buttons) when the value object identity
  // changes on the 0 -> N flip once the diff computation lands.
  const [changeCount, setChangeCount] = useState(0)

  const navigateDiffChange = useCallback((direction: DiffChangeDirection) => {
    const target = editorRef.current
    if (!target) {
      return
    }
    if (stepDiffChange(target, direction) === 'moved') {
      boundaryArmedRef.current = null
      return
    }
    const armed = boundaryArmedRef.current
    boundaryArmedRef.current = null
    const openAdjacentFile = resolveAdjacentFileOpenerRef.current?.(direction) ?? null
    if (!openAdjacentFile) {
      toast(edgeFileNoticeText(direction))
      return
    }
    if (armed?.target === target && armed.direction === direction) {
      openAdjacentFile()
      return
    }
    boundaryArmedRef.current = { target, direction }
    toast(boundaryNoticeText(direction))
  }, [])

  const registerDiffEditor = useCallback(
    (diffEditor: DiffNavigationTarget) => {
      editorRef.current = diffEditor
      // Hold at most one update subscription; replace any prior editor's.
      updateSubRef.current?.dispose()
      updateSubRef.current = diffEditor.onDidUpdateDiff(() => {
        // Why: ignore updates from an editor that is no longer current so a stale
        // subscription in the fast-swap case can't write a wrong count.
        if (editorRef.current === diffEditor) {
          setChangeCount(countChanges(diffEditor))
        }
      })
      // Hold at most one keyboard listener; replace any prior editor's.
      shortcutCleanupRef.current?.()
      shortcutCleanupRef.current = installMonacoDiffChangeNavigationShortcut(
        diffEditor,
        navigateDiffChange
      )
      setChangeCount(countChanges(diffEditor))
    },
    [navigateDiffChange]
  )

  const unregisterDiffEditor = useCallback((diffEditor: DiffNavigationTarget) => {
    // Why: identity guard for the fast-swap race — a stale dispose carrying the
    // old editor must not wipe a freshly-registered new one.
    if (editorRef.current !== diffEditor) {
      return
    }
    updateSubRef.current?.dispose()
    updateSubRef.current = null
    shortcutCleanupRef.current?.()
    shortcutCleanupRef.current = null
    editorRef.current = null
    setChangeCount(0)
  }, [])

  const goToPreviousDiff = useCallback(() => {
    navigateDiffChange('previous')
  }, [navigateDiffChange])

  const goToNextDiff = useCallback(() => {
    navigateDiffChange('next')
  }, [navigateDiffChange])

  useEffect(() => {
    return () => {
      updateSubRef.current?.dispose()
      updateSubRef.current = null
      shortcutCleanupRef.current?.()
      shortcutCleanupRef.current = null
    }
  }, [])

  const registrationValue = useMemo(
    () => ({ registerDiffEditor, unregisterDiffEditor }),
    [registerDiffEditor, unregisterDiffEditor]
  )
  const navigationValue = useMemo(
    () => ({
      goToPreviousDiff,
      goToNextDiff,
      changeCount
    }),
    [goToPreviousDiff, goToNextDiff, changeCount]
  )

  return (
    <DiffEditorRegistrationContext.Provider value={registrationValue}>
      <DiffNavigationContext.Provider value={navigationValue}>
        {children}
      </DiffNavigationContext.Provider>
    </DiffEditorRegistrationContext.Provider>
  )
}

export function useDiffEditorRegistration(): DiffEditorRegistrationContextValue {
  return useContext(DiffEditorRegistrationContext)
}

export function useDiffNavigation(): DiffNavigationContextValue {
  return useContext(DiffNavigationContext)
}
