import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { toggleDebugBreakpoint } from './debug-session-controller'
import { useDebugStore } from './debug-store'
import './monaco-debug-decorations.css'

/** Languages with a debug adapter wired up; the gutter stays untouched elsewhere. */
const DEBUGGABLE_LANGUAGES = new Set(['python', 'javascript', 'typescript', 'csharp'])

const NO_LINES: readonly number[] = []
const GUTTER_HOVER_CLASS = 'orca-debug-gutter-hover'

export function buildDebugDecorations(
  breakpointLines: readonly number[],
  executionLine: number | null
): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = breakpointLines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      glyphMarginClassName: 'orca-debug-breakpoint',
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
    }
  }))
  if (executionLine !== null) {
    decorations.push({
      range: new monaco.Range(executionLine, 1, executionLine, 1),
      options: {
        isWholeLine: true,
        className: 'orca-debug-execution-line',
        glyphMarginClassName: 'orca-debug-execution-arrow'
      }
    })
  }
  return decorations
}

/** Breakpoint gutter and paused-line highlight for one Monaco editor. */
export function useMonacoDebugDecorations(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  filePath: string,
  language: string
): void {
  const enabled = DEBUGGABLE_LANGUAGES.has(language)
  const breakpointLines = useDebugStore((s) => s.breakpointsByFile[filePath] ?? NO_LINES)
  const executionLine = useDebugStore((s) =>
    s.executionLocation?.path === filePath ? s.executionLocation.line : null
  )
  const collectionRef = useRef<editor.IEditorDecorationsCollection | null>(null)

  useEffect(() => {
    if (!mountedEditor || !enabled) {
      return
    }
    mountedEditor.updateOptions({ glyphMargin: true })
    const mouseDown = mountedEditor.onMouseDown((event) => {
      const line = event.target.position?.lineNumber
      if (
        event.event.leftButton &&
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        line
      ) {
        toggleDebugBreakpoint(filePath, line)
      }
    })
    // Why a hover class: the glyph column shares its per-line DOM with the line numbers, so
    // CSS alone can't give only the breakpoint column a pointer cursor.
    const editorDom = mountedEditor.getDomNode()
    const mouseMove = mountedEditor.onMouseMove((event) => {
      editorDom?.classList.toggle(
        GUTTER_HOVER_CLASS,
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      )
    })
    const mouseLeave = mountedEditor.onMouseLeave(() => {
      editorDom?.classList.remove(GUTTER_HOVER_CLASS)
    })
    const collection = mountedEditor.createDecorationsCollection()
    collectionRef.current = collection
    return () => {
      mouseDown.dispose()
      mouseMove.dispose()
      mouseLeave.dispose()
      editorDom?.classList.remove(GUTTER_HOVER_CLASS)
      collection.clear()
      collectionRef.current = null
      mountedEditor.updateOptions({ glyphMargin: false })
    }
  }, [enabled, filePath, mountedEditor])

  useEffect(() => {
    collectionRef.current?.set(buildDebugDecorations(breakpointLines, executionLine))
  }, [breakpointLines, executionLine, enabled, filePath, mountedEditor])
}
