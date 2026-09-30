import type * as Monaco from 'monaco-editor'
import { getRelativePathInsideRoot } from '@/lib/path'
import {
  CODE_NAVIGATION_SERVER_KINDS,
  isCodeNavigationWatchedPath,
  type CodeNavigationFileChange,
  type CodeNavigationServerKind
} from '../../../../shared/code-navigation/code-navigation-types'
import type { FsChangedPayload, FsChangeEvent } from '../../../../shared/filesystem-entry-types'

type SyncedDocument = { kind: CodeNavigationServerKind; root: string; path: string }

const syncedDocuments = new Map<string, SyncedDocument>()
const queriedRoots = new Set<string>()

/** Records that a model's text was sent to a server, so disposing it closes the document there. */
export function rememberSyncedDocument(modelUri: string, document: SyncedDocument): void {
  syncedDocuments.set(modelUri, document)
  queriedRoots.add(document.root)
}

function isWatchedByAnyServer(path: string): boolean {
  return CODE_NAVIGATION_SERVER_KINDS.some((kind) => isCodeNavigationWatchedPath(kind, path))
}

/** Watcher events as LSP file changes: a rename is a delete plus a create; overflow carries none. */
export function toCodeNavigationFileChanges(
  events: readonly FsChangeEvent[]
): CodeNavigationFileChange[] {
  const changes: CodeNavigationFileChange[] = []
  for (const event of events) {
    if (event.isDirectory || event.kind === 'overflow') {
      continue
    }
    if (event.kind === 'rename') {
      if (event.oldAbsolutePath) {
        changes.push({ kind: 'delete', path: event.oldAbsolutePath })
      }
      changes.push({ kind: 'create', path: event.absolutePath })
      continue
    }
    changes.push({ kind: event.kind, path: event.absolutePath })
  }
  return changes.filter((change) => isWatchedByAnyServer(change.path))
}

function forwardFileChanges(payload: FsChangedPayload): void {
  const api = window.api?.codeNavigation
  if (!api || queriedRoots.size === 0) {
    return
  }
  const changes = toCodeNavigationFileChanges(payload.events)
  for (const root of queriedRoots) {
    const inRoot = changes.filter((change) => getRelativePathInsideRoot(change.path, root) !== null)
    if (inRoot.length > 0) {
      void api.filesChanged({ root, changes: inRoot })
    }
  }
}

/**
 * Closes server documents when their models go away and relays the editor's file watcher,
 * so servers see files changed by git, agents or other editors.
 */
export function installCodeNavigationDocumentLifecycle(
  monaco: Pick<typeof Monaco, 'editor'>
): () => void {
  const disposeListener = monaco.editor.onWillDisposeModel((model) => {
    const key = model.uri.toString()
    const document = syncedDocuments.get(key)
    if (document) {
      syncedDocuments.delete(key)
      void window.api?.codeNavigation?.closeDocument(document)
    }
  })
  const unsubscribeFsChanges = window.api?.fs?.onFsChanged?.(forwardFileChanges)
  return () => {
    disposeListener.dispose()
    unsubscribeFsChanges?.()
  }
}
