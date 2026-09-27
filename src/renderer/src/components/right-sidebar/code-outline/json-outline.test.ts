import { describe, expect, it } from 'vitest'
import { JSONWorker } from 'monaco-editor/esm/vs/language/json/jsonWorker.js'
import type { CodeOutlineSymbol } from './code-outline-types'
import { MAX_DATA_TREE_SYMBOLS } from './data-tree-outline'
import { jsonDocumentToOutline } from './json-outline'
import { offsetToPositionIn } from './offset-position-fixture'

const URI = 'file:///settings.json'

// Why: the same worker class the panel talks to; structuredClone mimics the trip back from it.
async function outline(text: string): Promise<CodeOutlineSymbol[]> {
  const model = { uri: { toString: () => URI }, version: 1, getValue: () => text }
  const worker = new JSONWorker(
    { getMirrorModels: () => [model] },
    { languageId: 'json', languageSettings: { validate: false }, enableSchemaRequest: false }
  )
  const document = structuredClone(await worker.parseJSONDocument(URI))
  return jsonDocumentToOutline(document?.root, offsetToPositionIn(text))
}

type Shape = { name: string; kind: string; detail?: string; children?: Shape[] }

function shape(symbols: CodeOutlineSymbol[]): Shape[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.detail ? { detail: symbol.detail } : {}),
    ...(symbol.children.length > 0 ? { children: shape(symbol.children) } : {})
  }))
}

describe('json outline', () => {
  it('outlines keys with their values, including comments and trailing commas', async () => {
    const text = `{
  // editor settings
  "name": "orca",
  "version": 3,
  "private": true,
  "main": null,
  "scripts": { "dev": "vite", "test": "vitest run" },
  "files": ["out", "resources"],
  "empty": {},
  "contributors": [{ "name": "Ada" }, { "role": "reviewer" }],
}`
    expect(shape(await outline(text))).toEqual([
      { name: 'name', kind: 'property', detail: 'orca' },
      { name: 'version', kind: 'property', detail: '3' },
      { name: 'private', kind: 'property', detail: 'true' },
      { name: 'main', kind: 'property', detail: 'null' },
      {
        name: 'scripts',
        kind: 'namespace',
        children: [
          { name: 'dev', kind: 'property', detail: 'vite' },
          { name: 'test', kind: 'property', detail: 'vitest run' }
        ]
      },
      {
        name: 'files',
        kind: 'array',
        children: [
          { name: '0', kind: 'property', detail: 'out' },
          { name: '1', kind: 'property', detail: 'resources' }
        ]
      },
      { name: 'empty', kind: 'namespace', detail: '{}' },
      {
        name: 'contributors',
        kind: 'array',
        children: [
          {
            name: '0',
            kind: 'namespace',
            detail: 'Ada',
            children: [{ name: 'name', kind: 'property', detail: 'Ada' }]
          },
          {
            name: '1',
            kind: 'namespace',
            children: [{ name: 'role', kind: 'property', detail: 'reviewer' }]
          }
        ]
      }
    ])
  })

  it('points at the key and spans the value', async () => {
    const [scripts] = await outline('{\n  "scripts": {\n    "dev": "vite"\n  }\n}')
    expect(scripts).toMatchObject({ line: 2, column: 3, startLine: 2, endLine: 4 })
  })

  it('shortens long values', async () => {
    const [description] = await outline(`{ "description": "${'a'.repeat(100)}" }`)
    expect(description.detail).toBe(`${'a'.repeat(60)}…`)
  })

  it('caps the outline breadth-first so every top-level key survives', async () => {
    const packages = Array.from({ length: MAX_DATA_TREE_SYMBOLS }, (_, i) => `"p${i}": { "v": 1 }`)
    const [first, last] = await outline(`{ "packages": { ${packages.join(', ')} }, "tail": 1 }`)
    expect(first.children).toHaveLength(MAX_DATA_TREE_SYMBOLS - 2)
    expect(first.children.every((child) => child.children.length === 0)).toBe(true)
    expect(last.name).toBe('tail')
  })
})
