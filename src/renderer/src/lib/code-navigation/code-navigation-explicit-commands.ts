import {
  DefinitionAction,
  SymbolNavigationAction
} from 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js'
import type { CodeNavigationFeature } from '../../../../shared/code-navigation/code-navigation-types'
import type { CodeNavigationActivation } from './code-navigation-activation'

type RunEditorCommand = NonNullable<SymbolNavigationAction['runEditorCommand']>

/** Monaco's registered navigation commands; Go to Definition's family is matched by class. */
const COMMAND_FEATURES = new Map<string, CodeNavigationFeature>([
  ['editor.action.goToTypeDefinition', 'typeDefinition'],
  ['editor.action.peekTypeDefinition', 'typeDefinition'],
  ['editor.action.goToImplementation', 'implementation'],
  ['editor.action.peekImplementation', 'implementation'],
  ['editor.action.goToReferences', 'references'],
  ['editor.action.referenceSearch.trigger', 'references']
])

function featureOf(command: SymbolNavigationAction): CodeNavigationFeature | null {
  // Why by class: Cmd/Ctrl+click runs an unregistered DefinitionAction with an empty id.
  if (command instanceof DefinitionAction) {
    return 'definition'
  }
  return COMMAND_FEATURES.get(command.desc?.id ?? '') ?? null
}

/**
 * Arms the activation for every Monaco navigation command the user runs: F12 and its variants, the
 * context menu, and Cmd/Ctrl+click. The Cmd+hover link preview queries providers without running
 * a command, so it stays passive.
 */
export function installExplicitNavigationArming(activation: CodeNavigationActivation): () => void {
  const prototype = SymbolNavigationAction.prototype
  const original = prototype.runEditorCommand
  if (!original) {
    return () => {}
  }
  const armed: RunEditorCommand = function runArmedNavigationCommand(
    accessor,
    codeEditor,
    ...args
  ) {
    const feature = featureOf(this)
    if (feature) {
      activation.arm(codeEditor, feature)
    }
    return original.call(this, accessor, codeEditor, ...args)
  }
  prototype.runEditorCommand = armed
  return () => {
    if (prototype.runEditorCommand === armed) {
      prototype.runEditorCommand = original
    }
  }
}
