import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { loadCodeOutline } from './code-outline-source'

const TREE = {
  text: '<global>',
  kind: 'script',
  spans: [{ start: 0, length: 20 }],
  childItems: [{ text: 'main', kind: 'function', spans: [{ start: 0, length: 20 }] }]
}

function fakeMonaco(getWorker: () => Promise<unknown>): typeof Monaco {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the loader only touches `typescript.getTypeScriptWorker` and `json.getWorker`, which this fake provides.
  return {
    typescript: { getTypeScriptWorker: getWorker },
    json: { getWorker }
  } as unknown as typeof Monaco
}

function fakeModel(languageId = 'typescript'): Monaco.editor.ITextModel {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the loader only reads these members of the model.
  return {
    uri: { toString: () => 'file:///a.ts' },
    getLanguageId: () => languageId,
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

  it('recognises the bare string Monaco rejects with before registration', async () => {
    const getWorker = vi
      .fn()
      .mockRejectedValueOnce('TypeScript not registered!')
      .mockImplementation(readyWorker)

    const outline = await loadCodeOutline(fakeMonaco(getWorker), fakeModel())

    expect(outline?.map((symbol) => symbol.name)).toEqual(['main'])
  })

  it('does not retry other worker errors', async () => {
    const getWorker = vi.fn().mockRejectedValue(new Error('worker crashed'))

    await expect(loadCodeOutline(fakeMonaco(getWorker), fakeModel())).rejects.toThrow(
      'worker crashed'
    )
    expect(getWorker).toHaveBeenCalledTimes(1)
  })
})

describe('loadCodeOutline for JSON', () => {
  it('outlines the document the JSON worker parses, once it is registered', async () => {
    const root = {
      type: 'object',
      offset: 0,
      length: 12,
      properties: [
        {
          type: 'property',
          offset: 1,
          length: 10,
          keyNode: { type: 'string', offset: 1, length: 6, value: 'name' },
          valueNode: { type: 'string', offset: 9, length: 2, value: 'x' }
        }
      ]
    }
    const getWorker = vi
      .fn()
      .mockRejectedValueOnce('JSON not registered!')
      .mockImplementation(async () => async () => ({ parseJSONDocument: async () => ({ root }) }))

    const outline = await loadCodeOutline(fakeMonaco(getWorker), fakeModel('json'))

    expect(outline).toMatchObject([{ name: 'name', kind: 'property', detail: 'x' }])
  })
})
