// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { installMonacoPeekReferencesPreviewOptions } from './monaco-peek-preview-options'
import {
  hasOpenMonacoPeekReferences,
  onDidCloseMonacoPeekReferences
} from './monaco-peek-references-lifecycle'

type FakeReferenceWidgetInstance = {
  _preview?: Pick<Monaco.editor.ICodeEditor, 'updateOptions'>
  _fillBody?: (containerElement: HTMLElement) => void
  _revealReference?: (...args: unknown[]) => Promise<unknown>
  dispose?: () => void
}

function createReferenceWidgetConstructor(): {
  prototype: FakeReferenceWidgetInstance &
    Required<Pick<FakeReferenceWidgetInstance, '_fillBody' | '_revealReference' | 'dispose'>>
} {
  return {
    prototype: {
      _fillBody(): void {},
      async _revealReference(): Promise<unknown> {
        return undefined
      },
      dispose(): void {}
    }
  }
}

describe('installMonacoPeekReferencesPreviewOptions', () => {
  it('reports the references widget lifecycle once', () => {
    const closed = vi.fn()
    const removeListener = onDidCloseMonacoPeekReferences(closed)
    const referenceWidget = createReferenceWidgetConstructor()
    installMonacoPeekReferencesPreviewOptions(referenceWidget)

    referenceWidget.prototype._fillBody(document.createElement('div'))
    referenceWidget.prototype._fillBody(document.createElement('div'))
    expect(hasOpenMonacoPeekReferences()).toBe(true)

    referenceWidget.prototype.dispose()
    referenceWidget.prototype.dispose()
    expect(hasOpenMonacoPeekReferences()).toBe(false)
    expect(closed).toHaveBeenCalledOnce()
    removeListener()
  })
})
