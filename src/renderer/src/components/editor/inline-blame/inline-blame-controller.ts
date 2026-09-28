import * as monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import type { GitBlameResult } from '../../../../../shared/git-blame'
import {
  computeChangeMarkerHunks,
  type ChangeMarkerHunk
} from '../change-markers/change-marker-hunks'
import { mapBufferLineToBlamedLine } from './blame-line-mapping'
import {
  formatInlineBlameAnnotation,
  toInlineBlameLine,
  type InlineBlameLine
} from './inline-blame-format'
import { setInlineBlameHoverEntry } from './inline-blame-hover'
import './inline-blame.css'

const CURSOR_SETTLE_MS = 60
const EDIT_SETTLE_MS = 300

type BlameData = Extract<GitBlameResult, { kind: 'blame' }>

export type InlineBlameController = {
  setBlame: (result: GitBlameResult | null) => void
  dispose: () => void
}

/**
 * GitLens-style current-line blame for one Monaco editor. Blame describes the
 * file as git last read it; a line diff against the live buffer keeps the
 * annotation on the right line through unsaved edits, and edited lines read
 * as uncommitted.
 */
export function createInlineBlameController(
  host: editor.IStandaloneCodeEditor,
  openCommit: (sha: string, summary: string) => void
): InlineBlameController {
  const annotation = host.createDecorationsCollection()
  let blame: BlameData | null = null
  let blamedLines: string[] = []
  let hunks: ChangeMarkerHunk[] | null = null
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  let editTimer: ReturnType<typeof setTimeout> | null = null
  let publishedModelUri: string | null = null

  const clearHover = (): void => {
    if (publishedModelUri) {
      setInlineBlameHoverEntry(publishedModelUri, null)
      publishedModelUri = null
    }
  }

  const clear = (): void => {
    annotation.clear()
    clearHover()
  }

  const recomputeHunks = (): void => {
    const model = host.getModel()
    hunks = blame && model ? computeChangeMarkerHunks(blamedLines, model.getLinesContent()) : null
  }

  const blameForLine = (line: number): InlineBlameLine | undefined => {
    if (!blame || !hunks) {
      return undefined
    }
    const blamedLine = mapBufferLineToBlamedLine(hunks, line)
    if (blamedLine === null) {
      return null
    }
    const commitIndex = blame.lineCommits[blamedLine - 1]
    return commitIndex === undefined ? undefined : toInlineBlameLine(blame.commits[commitIndex])
  }

  const render = (): void => {
    renderTimer = null
    const model = host.getModel()
    const position = host.getPosition()
    if (!model || !position) {
      clear()
      return
    }
    const line = position.lineNumber
    const info = blameForLine(line)
    if (info === undefined) {
      clear()
      return
    }
    const column = model.getLineMaxColumn(line)
    annotation.set([
      {
        range: {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column
        },
        options: {
          showIfCollapsed: true,
          after: {
            content: formatInlineBlameAnnotation(info, Date.now()),
            inlineClassName: 'orca-inline-blame',
            cursorStops: monaco.editor.InjectedTextCursorStops.None
          }
        }
      }
    ])
    const modelUri = model.uri.toString()
    if (publishedModelUri && publishedModelUri !== modelUri) {
      clearHover()
    }
    if (info) {
      setInlineBlameHoverEntry(modelUri, { line, commit: info, openCommit })
      publishedModelUri = modelUri
    } else {
      clearHover()
    }
  }

  const scheduleRender = (delayMs: number): void => {
    if (renderTimer !== null) {
      clearTimeout(renderTimer)
    }
    renderTimer = setTimeout(render, delayMs)
  }

  const listeners: IDisposable[] = [
    host.onDidChangeCursorPosition(() => scheduleRender(CURSOR_SETTLE_MS)),
    host.onDidChangeModelContent(() => {
      // Why: while typing, the annotation would trail the caret with stale text; bring it back once settled.
      clear()
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      if (editTimer !== null) {
        clearTimeout(editTimer)
      }
      editTimer = setTimeout(() => {
        editTimer = null
        recomputeHunks()
        render()
      }, EDIT_SETTLE_MS)
    }),
    host.onDidChangeModel(() => {
      clear()
      recomputeHunks()
      render()
    })
  ]

  return {
    setBlame: (result) => {
      blame = result?.kind === 'blame' ? result : null
      // Why: blame has no line for the final newline; pad so an unchanged trailing empty line isn't "edited".
      blamedLines = blame ? [...blame.lineContents, ''] : []
      recomputeHunks()
      render()
    },
    dispose: () => {
      for (const timer of [renderTimer, editTimer]) {
        if (timer !== null) {
          clearTimeout(timer)
        }
      }
      for (const listener of listeners) {
        listener.dispose()
      }
      clear()
    }
  }
}
