import { afterEach, describe, expect, it, vi } from 'vitest'
// The same module the public `monaco.Uri` re-exports, without loading the editor bundle.
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'

const goToCommands = vi.hoisted(() => {
  class SymbolNavigationAction {
    readonly desc?: { readonly id?: string }
    constructor(desc?: { readonly id?: string }) {
      this.desc = desc
    }
    runEditorCommand(_accessor: unknown, _codeEditor: unknown): Promise<string | undefined> {
      return Promise.resolve(this.desc?.id)
    }
  }
  class DefinitionAction extends SymbolNavigationAction {}
  return { SymbolNavigationAction, DefinitionAction }
})

vi.mock(
  'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js',
  () => goToCommands
)

import { installExplicitNavigationArming } from './code-navigation-explicit-commands'
import { CodeNavigationActivation } from './code-navigation-activation'

const { DefinitionAction, SymbolNavigationAction } = goToCommands
const model = { uri: URI.file('/repo/Controllers/OrdersController.cs') }
const codeEditor = { getModel: () => model }
const FEATURES = ['definition', 'typeDefinition', 'implementation', 'references'] as const

let dispose = (): void => {}
afterEach(() => dispose())

describe('installExplicitNavigationArming', () => {
  it('arms Cmd/Ctrl+click and the navigation commands F12 and the context menu run', async () => {
    const activation = new CodeNavigationActivation()
    dispose = installExplicitNavigationArming(activation)

    // Cmd/Ctrl+click: Monaco runs an unregistered DefinitionAction with an empty id.
    await expect(new DefinitionAction({ id: '' }).runEditorCommand(null, codeEditor)).resolves.toBe(
      ''
    )
    expect(activation.consume(model, 'definition')).toBe(true)

    for (const [id, feature] of [
      ['editor.action.peekTypeDefinition', 'typeDefinition'],
      ['editor.action.goToImplementation', 'implementation'],
      ['editor.action.referenceSearch.trigger', 'references']
    ] as const) {
      await new SymbolNavigationAction({ id }).runEditorCommand(null, codeEditor)
      expect(activation.consume(model, feature)).toBe(true)
    }
  })

  it('leaves other commands passive and restores Monaco when disposed', async () => {
    const activation = new CodeNavigationActivation()
    dispose = installExplicitNavigationArming(activation)

    await new SymbolNavigationAction({ id: 'editor.action.revealDeclaration' }).runEditorCommand(
      null,
      codeEditor
    )
    await expect(new SymbolNavigationAction().runEditorCommand(null, codeEditor)).resolves.toBe(
      undefined
    )
    dispose()
    await new DefinitionAction({ id: 'editor.action.revealDefinition' }).runEditorCommand(
      null,
      codeEditor
    )

    for (const feature of FEATURES) {
      expect(activation.consume(model, feature)).toBe(false)
    }
  })
})
