import type * as Monaco from 'monaco-editor'
import { registerCodeNavigationProviders } from './code-navigation-providers'
import { registerCodeNavigationEditorOpener } from './code-navigation-editor-opener'
import { installCodeNavigationDocumentLifecycle } from './code-navigation-document-lifecycle'
import { installCodeNavigationStatusToasts } from './code-navigation-status-toasts'
import { installCodeNavigationKeymap } from './code-navigation-keymap'

/** Go to definition / references / implementation across files, backed by language servers,
 * plus JetBrains-style navigation keys and Back/Forward history. */
export function installCodeNavigation(monaco: typeof Monaco): () => void {
  const providers = registerCodeNavigationProviders(monaco)
  const opener = registerCodeNavigationEditorOpener(monaco)
  const disposeLifecycle = installCodeNavigationDocumentLifecycle(monaco)
  const disposeToasts = installCodeNavigationStatusToasts()
  const disposeKeymap = installCodeNavigationKeymap(monaco)
  return () => {
    for (const provider of providers) {
      provider.dispose()
    }
    opener.dispose()
    disposeLifecycle()
    disposeToasts()
    disposeKeymap()
  }
}
