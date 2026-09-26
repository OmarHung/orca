import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { loadCodeOutline } from './code-outline-source'

const TREE = {
  text: '<global>',
  kind: 'script',
  spans: [{ start: 0, length: 20 }],
  childItems: [{ text: 'main', kind: 'function', spans: [{ start: 0, length: 20 }] }]
}

function fakeMonaco(getTypeScriptWorker: () => Promise<unknown>): typeof Monaco {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the loader only touches `typescript.getTypeScriptWorker`, which this fake provides.
  return { typescript: { getTypeScriptWorker } } as unknown as typeof Monaco
}

function fakeModel(): Monaco.editor.ITextModel {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the loader only reads these members of the model.
  return {
    uri: { toString: () => 'file:///a.ts' },
    getLanguageId: () => 'typescript',
    isDisposed: () => false,
    getPositionAt: () => ({ lineNumber: 1, column: 1 })
  } as unknown as Monaco.editor.ITextModel
}

const readyWorker = async () => async () => ({ getNavigationTree: async () => TREE })

describe('loadCodeOutline for TypeScript', () => {
  it('waits for Monaco to register the TS worker instead of failing the outline', async () => {
    const getWorker = vi
      .fn()
      .mockRejectedValueOnce(new Error('TypeScript not registered!'))
      .mockRejectedValueOnce(new Error('TypeScript not registered!'))
      .mockImplementation(readyWorker)

    const outline = await loadCodeOutline(fakeMonaco(getWorker), fakeModel())

    expect(outline?.map((symbol) => symbol.name)).toEqual(['main'])
    expect(getWorker).toHaveBeenCalledTimes(3)
  })

  it('does not retry other worker errors', async () => {
    const getWorker = vi.fn().mockRejectedValue(new Error('worker crashed'))

    await expect(loadCodeOutline(fakeMonaco(getWorker), fakeModel())).rejects.toThrow(
      'worker crashed'
    )
    expect(getWorker).toHaveBeenCalledTimes(1)
  })
})
