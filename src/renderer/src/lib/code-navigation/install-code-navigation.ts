import type * as Monaco from 'monaco-editor'
import { registerCodeNavigationProviders } from './code-navigation-providers'
import { registerCodeNavigationEditorOpener } from './code-navigation-editor-opener'
import { installCodeNavigationDocumentLifecycle } from './code-navigation-document-lifecycle'
import { installCodeNavigationStatusToasts } from './code-navigation-status-toasts'
import { installCodeNavigationKeymap } from './code-navigation-keymap'
import { installCodeNavigationPrewarm } from './code-navigation-prewarm'
import { CodeNavigationActivation } from './code-navigation-activation'
import { installCodeNavigationPreviewModelCleanup } from './code-navigation-preview-models'
import { installExplicitNavigationArming } from './code-navigation-explicit-commands'

/** Go to definition / references / implementation across files, backed by language servers,
 * plus JetBrains-style navigation keys and Back/Forward history. */
export function installCodeNavigation(monaco: typeof Monaco): () => void {
  const activation = new CodeNavigationActivation()
  const disposeExplicitArming = installExplicitNavigationArming(activation)
  const providers = registerCodeNavigationProviders(monaco, activation)
  const opener = registerCodeNavigationEditorOpener(monaco)
  const disposeLifecycle = installCodeNavigationDocumentLifecycle(monaco)
  const disposeToasts = installCodeNavigationStatusToasts()
  const disposeKeymap = installCodeNavigationKeymap(monaco, activation)
  const disposePrewarm = installCodeNavigationPrewarm(monaco, activation)
  const disposePreviewCleanup = installCodeNavigationPreviewModelCleanup(monaco)
  return () => {
    for (const provider of providers) {
      provider.dispose()
    }
    opener.dispose()
    disposeLifecycle()
    disposeToasts()
    disposeKeymap()
    disposePrewarm()
    disposePreviewCleanup()
    disposeExplicitArming()
  }
}
