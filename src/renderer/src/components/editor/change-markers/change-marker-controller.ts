import * as monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import type { DiffNavigationTarget } from '../diff-navigation-context'
import {
  computeChangeMarkerHunks,
  findAdjacentChangeMarkerHunk,
  findChangeMarkerHunkAtLine,
  getChangeMarkerAnchorLine,
  splitChangeMarkerBaseline,
  type ChangeMarkerHunk
} from './change-marker-hunks'
import {
  buildChangeMarkerCurrentHighlight,
  buildChangeMarkerGutterDecorations,
  hunkLineSpan,
  readChangeMarkerColors,
  wholeLines
} from './change-marker-decorations'
import { buildChangeMarkerRollbackEdit } from './change-marker-rollback'
import { computeChangeMarkerWordRanges } from './change-marker-word-diff'
import { createChangeMarkerPeek, type ChangeMarkerPeek } from './change-marker-peek'
import './change-markers.css'

const RECOMPUTE_DELAY_MS = 150
// Why: Monaco's folding controller claims gutter clicks from 4px into the
// decorations lane, so lines with a fold chevron keep only that sliver.
const CLICK_WIDTH_BESIDE_FOLDING_PX = 4
const CLICK_WIDTH_PX = 12
const PEEK_VISIBLE_CONTEXT_KEY = 'orcaChangeMarkerPeekVisible'

export type ChangeMarkerController = {
  navigation: DiffNavigationTarget
  refreshColors: () => void
  dispose: () => void
}

function isSameHunk(a: ChangeMarkerHunk, b: ChangeMarkerHunk): boolean {
  return a.kind === b.kind && a.startLine === b.startLine && a.endLine === b.endLine
}

function clickWidthFor(element: HTMLElement | null): number {
  const row = element?.classList.contains('cldr') ? element.parentElement : element
  return row?.querySelector('[class*="codicon-folding"]')
    ? CLICK_WIDTH_BESIDE_FOLDING_PX
    : CLICK_WIDTH_PX
}

/**
 * JetBrains-style change markers for one Monaco editor: gutter bars for lines
 * that differ from `baseline` (the HEAD text), and a click-to-expand preview of
 * what each change replaced, with rollback.
 */
export function createChangeMarkerController(
  host: editor.IStandaloneCodeEditor,
  baseline: string,
  languageId: string
): ChangeMarkerController {
  const originalLines = splitChangeMarkerBaseline(baseline)
  const updates = new monaco.Emitter<void>()
  const gutter = host.createDecorationsCollection()
  const highlight = host.createDecorationsCollection()
  // Why: a tracked range follows the open hunk through edits, so the preview can
  // re-find it after the next diff instead of guessing from stale line numbers.
  const openHunkTracker = host.createDecorationsCollection()
  const peekVisible = host.createContextKey<boolean>(PEEK_VISIBLE_CONTEXT_KEY, false)
  let hunks: ChangeMarkerHunk[] = []
  let openHunk: ChangeMarkerHunk | null = null
  let peek: ChangeMarkerPeek | null = null
  let recomputeTimer: ReturnType<typeof setTimeout> | null = null

  const renderGutter = (): void => {
    gutter.set(
      buildChangeMarkerGutterDecorations(
        hunks,
        readChangeMarkerColors(host.getDomNode() ?? document.documentElement),
        translate('changeMarkers.gutterTooltip', 'Click to show what changed')
      )
    )
  }

  const closePeek = (): void => {
    openHunk = null
    peekVisible.set(false)
    highlight.clear()
    openHunkTracker.clear()
    peek?.dispose()
    peek = null
  }

  const closePeekAndFocus = (): void => {
    closePeek()
    host.focus()
  }

  const copyOriginal = async (hunk: ChangeMarkerHunk): Promise<boolean> => {
    const eol = host.getModel()?.getEOL() ?? '\n'
    try {
      await window.api.ui.writeClipboardText(hunk.originalLines.join(eol))
      return true
    } catch (error) {
      console.warn('[change-markers] Copying the original lines failed', error)
      return false
    }
  }

  const openPeek = (index: number): void => {
    const model = host.getModel()
    const hunk = hunks[index]
    if (!model || !hunk) {
      return
    }
    const currentLines =
      hunk.kind === 'modified'
        ? Array.from({ length: hunk.endLine - hunk.startLine + 1 }, (_, offset) =>
            model.getLineContent(hunk.startLine + offset)
          )
        : []
    const wordRanges =
      hunk.kind === 'modified'
        ? computeChangeMarkerWordRanges(hunk.originalLines, currentLines)
        : null
    const span = hunkLineSpan(hunk)
    openHunk = hunk
    peekVisible.set(true)
    openHunkTracker.set([
      {
        range: { ...wholeLines(span.start, span.end), endColumn: model.getLineMaxColumn(span.end) },
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
        }
      }
    ])
    highlight.set(buildChangeMarkerCurrentHighlight(hunk, wordRanges?.current ?? []))
    peek ??= createChangeMarkerPeek(host, languageId, closePeekAndFocus)
    peek.show({
      hunk,
      originalWordRanges: wordRanges?.original ?? [],
      toolbar: {
        kind: hunk.kind,
        position: index + 1,
        total: hunks.length,
        canRollback: !host.getOption(monaco.editor.EditorOption.readOnly),
        onPrevious: () => goTo('previous'),
        onNext: () => goTo('next'),
        onRollback: rollbackOpenHunk,
        onCopy: hunk.originalLines.length > 0 ? () => copyOriginal(hunk) : null,
        onClose: closePeekAndFocus
      }
    })
  }

  const recompute = (): void => {
    if (recomputeTimer !== null) {
      clearTimeout(recomputeTimer)
      recomputeTimer = null
    }
    const model = host.getModel()
    hunks = model ? (computeChangeMarkerHunks(originalLines, model.getLinesContent()) ?? []) : []
    renderGutter()
    updates.fire()
    if (!openHunk) {
      return
    }
    const tracked = openHunkTracker.getRange(0)
    const index = tracked
      ? hunks.findIndex((hunk) => {
          const span = hunkLineSpan(hunk)
          return span.start <= tracked.endLineNumber && span.end >= tracked.startLineNumber
        })
      : -1
    if (index === -1) {
      closePeek()
    } else {
      openPeek(index)
    }
  }

  const flushPendingRecompute = (): void => {
    if (recomputeTimer !== null) {
      recompute()
    }
  }

  const goTo = (direction: 'next' | 'previous'): void => {
    flushPendingRecompute()
    const fromLine = openHunk
      ? getChangeMarkerAnchorLine(openHunk)
      : (host.getPosition()?.lineNumber ?? 1)
    const index = findAdjacentChangeMarkerHunk(hunks, fromLine, direction)
    if (index === -1) {
      return
    }
    const line = getChangeMarkerAnchorLine(hunks[index])
    host.setPosition({ lineNumber: line, column: 1 })
    host.revealLineInCenterIfOutsideViewport(line)
    if (openHunk) {
      openPeek(index)
    }
    host.focus()
  }

  function rollbackOpenHunk(): void {
    flushPendingRecompute()
    const model = host.getModel()
    if (!model || !openHunk || host.getOption(monaco.editor.EditorOption.readOnly)) {
      return
    }
    const edit = buildChangeMarkerRollbackEdit(openHunk, {
      lineCount: model.getLineCount(),
      getLineMaxColumn: (line) => model.getLineMaxColumn(line),
      eol: model.getEOL()
    })
    closePeek()
    host.pushUndoStop()
    host.executeEdits('orca.changeMarkers.rollback', [
      { range: edit.range, text: edit.text, forceMoveMarkers: true }
    ])
    host.pushUndoStop()
    recompute()
    host.focus()
  }

  const listeners: IDisposable[] = [
    host.onDidChangeModelContent(() => {
      if (recomputeTimer !== null) {
        clearTimeout(recomputeTimer)
      }
      recomputeTimer = setTimeout(recompute, RECOMPUTE_DELAY_MS)
    }),
    host.onDidChangeModel(() => {
      closePeek()
      recompute()
    }),
    host.onMouseDown((event) => {
      const target = event.target
      if (
        !event.event.leftButton ||
        target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
      ) {
        return
      }
      const line = target.position?.lineNumber
      const offset = target.detail.offsetX - host.getLayoutInfo().decorationsLeft
      if (!line || offset < 0 || offset >= clickWidthFor(target.element)) {
        return
      }
      flushPendingRecompute()
      const index = findChangeMarkerHunkAtLine(hunks, line)
      if (index === -1) {
        return
      }
      if (openHunk && isSameHunk(openHunk, hunks[index])) {
        closePeek()
      } else {
        openPeek(index)
      }
    }),
    host.addAction({
      id: 'orca.changeMarkers.closePreview',
      label: translate('changeMarkers.closePreview', 'Close Change Preview'),
      keybindings: [monaco.KeyCode.Escape],
      precondition: PEEK_VISIBLE_CONTEXT_KEY,
      keybindingContext: `${PEEK_VISIBLE_CONTEXT_KEY} && !suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !renameInputVisible && !editorHasMultipleSelections`,
      run: closePeek
    })
  ]

  recompute()

  return {
    navigation: {
      getContainerDomNode: () => host.getContainerDomNode(),
      goToDiff: goTo,
      getLineChanges: () => hunks,
      onDidUpdateDiff: (listener) => updates.event(listener)
    },
    refreshColors: renderGutter,
    dispose: () => {
      if (recomputeTimer !== null) {
        clearTimeout(recomputeTimer)
        recomputeTimer = null
      }
      closePeek()
      for (const listener of listeners) {
        listener.dispose()
      }
      gutter.clear()
      peekVisible.reset()
      updates.dispose()
    }
  }
}
