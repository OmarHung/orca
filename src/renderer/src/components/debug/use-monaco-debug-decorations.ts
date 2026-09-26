import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { toggleDebugBreakpoint } from './breakpoint-sync'
import { useDebugStore } from './debug-store'
import { useBreakpointStore, type BreakpointSpec } from './breakpoint-store'
import './monaco-debug-decorations.css'

/** Languages with a debug adapter wired up; the gutter stays untouched elsewhere. */
const DEBUGGABLE_LANGUAGES = new Set(['python', 'javascript', 'typescript', 'csharp'])

const NO_BREAKPOINTS: readonly BreakpointSpec[] = []
const GUTTER_HOVER_CLASS = 'orca-debug-gutter-hover'

/** CSS class for a breakpoint's gutter glyph; `verified` is undefined while no session runs. */
export function breakpointGlyphClass(spec: BreakpointSpec, verified: boolean | undefined): string {
  const kindClass = spec.logMessage
    ? 'orca-debug-logpoint'
    : spec.condition || spec.hitCondition
      ? 'orca-debug-breakpoint orca-debug-breakpoint-conditional'
      : 'orca-debug-breakpoint'
  if (!spec.enabled) {
    return `${kindClass} orca-debug-breakpoint-disabled`
  }
  return verified === false ? `${kindClass} orca-debug-breakpoint-unverified` : kindClass
}

function breakpointHover(spec: BreakpointSpec): string | undefined {
  const parts = [
    spec.condition ? `Condition: \`${spec.condition}\`` : null,
    spec.hitCondition ? `Hit count: \`${spec.hitCondition}\`` : null,
    spec.logMessage ? `Logs: \`${spec.logMessage}\`` : null,
    spec.enabled ? null : 'Disabled'
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join('  \n') : undefined
}

export function buildDebugDecorations(
  breakpoints: readonly BreakpointSpec[],
  verified: Record<number, boolean> | undefined,
  executionLine: number | null
): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = breakpoints.map((spec) => {
    const hover = breakpointHover(spec)
    return {
      range: new monaco.Range(spec.line, 1, spec.line, 1),
      options: {
        glyphMarginClassName: breakpointGlyphClass(spec, verified?.[spec.line]),
        ...(hover ? { glyphMarginHoverMessage: { value: hover } } : {}),
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }
  })
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
  const breakpoints = useBreakpointStore((s) => s.breakpointsByFile[filePath] ?? NO_BREAKPOINTS)
  const verified = useBreakpointStore((s) => s.verifiedByFile[filePath])
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
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !line) {
        return
      }
      if (event.event.leftButton) {
        toggleDebugBreakpoint(filePath, line)
      } else if (event.event.rightButton) {
        // JetBrains-style: right-clicking the gutter edits that line's breakpoint, adding one first.
        event.event.preventDefault()
        const store = useBreakpointStore.getState()
        if (!(store.breakpointsByFile[filePath] ?? []).some((spec) => spec.line === line)) {
          toggleDebugBreakpoint(filePath, line)
        }
        store.openEditor({ path: filePath, line, x: event.event.posx, y: event.event.posy })
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
    collectionRef.current?.set(buildDebugDecorations(breakpoints, verified, executionLine))
  }, [breakpoints, verified, executionLine, enabled, filePath, mountedEditor])
}
