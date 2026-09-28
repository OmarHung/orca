import * as monaco from 'monaco-editor'
import type { GitBlameCommit } from '../../../../../shared/git-blame'
import {
  formatInlineBlameHover,
  INLINE_BLAME_COPY_SHA_COMMAND,
  INLINE_BLAME_OPEN_COMMIT_COMMAND
} from './inline-blame-format'

export type InlineBlameHoverEntry = {
  line: number
  commit: GitBlameCommit
  openCommit: (sha: string, summary: string) => void
}

// Why: hover providers and commands are registered per language/app, not per
// editor, so each editor publishes its caret line's blame here by model URI.
const entriesByModelUri = new Map<string, InlineBlameHoverEntry>()
let installed = false

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function install(): void {
  monaco.languages.registerHoverProvider('*', {
    provideHover(model, position) {
      const entry = entriesByModelUri.get(model.uri.toString())
      const maxColumn = entry ? model.getLineMaxColumn(entry.line) : 0
      // Why: only the annotation after the line's end is ours; the code itself keeps its hovers.
      if (!entry || position.lineNumber !== entry.line || position.column < maxColumn) {
        return null
      }
      return {
        range: new monaco.Range(entry.line, maxColumn, entry.line, maxColumn),
        contents: [
          {
            value: formatInlineBlameHover(entry.commit, Date.now(), model.uri.toString()),
            isTrusted: true
          }
        ]
      }
    }
  })
  monaco.editor.registerCommand(INLINE_BLAME_OPEN_COMMIT_COMMAND, (_accessor, modelUri, sha) => {
    const entry = entriesByModelUri.get(asString(modelUri) ?? '')
    const commitSha = asString(sha)
    if (entry && commitSha) {
      entry.openCommit(commitSha, entry.commit.sha === commitSha ? entry.commit.summary : '')
    }
  })
  monaco.editor.registerCommand(INLINE_BLAME_COPY_SHA_COMMAND, (_accessor, sha) => {
    const commitSha = asString(sha)
    if (commitSha) {
      void window.api.ui.writeClipboardText(commitSha).catch((error: unknown) => {
        console.warn('[inline-blame] Copying the commit hash failed', error)
      })
    }
  })
}

export function setInlineBlameHoverEntry(
  modelUri: string,
  entry: InlineBlameHoverEntry | null
): void {
  if (!installed) {
    installed = true
    install()
  }
  if (entry) {
    entriesByModelUri.set(modelUri, entry)
  } else {
    entriesByModelUri.delete(modelUri)
  }
}
