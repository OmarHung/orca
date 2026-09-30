import type * as Monaco from 'monaco-editor'
import { registerCodeNavigationProviders } from './code-navigation-providers'
import { registerCodeNavigationEditorOpener } from './code-navigation-editor-opener'
import { installCodeNavigationDocumentLifecycle } from './code-navigation-document-lifecycle'
import { installCodeNavigationStatusToasts } from './code-navigation-status-toasts'

/** Go to definition / references / implementation across files, backed by language servers. */
export function installCodeNavigation(monaco: typeof Monaco): () => void {
  const providers = registerCodeNavigationProviders(monaco)
  const opener = registerCodeNavigationEditorOpener(monaco)
  const disposeLifecycle = installCodeNavigationDocumentLifecycle(monaco)
  const disposeToasts = installCodeNavigationStatusToasts()
  return () => {
    for (const provider of providers) {
      provider.dispose()
    }
    opener.dispose()
    disposeLifecycle()
    disposeToasts()
  }
}
