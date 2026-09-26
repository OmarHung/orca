import { describe, expect, it } from 'vitest'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { navigationTreeToOutline, type OffsetToPosition } from './typescript-navigation-outline'

const FILE_NAME = '/file.tsx'

const JSX_PRESERVE = 1

// Why: this is the same TS build Monaco's worker runs, so the tree matches what the panel sees.
function navigationTree(source: string): unknown {
  const host = {
    getScriptFileNames: () => [FILE_NAME],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name: string) =>
      name === FILE_NAME ? ts.ScriptSnapshot.fromString(source) : undefined,
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({ jsx: JSX_PRESERVE }),
    getDefaultLibFileName: () => 'lib.d.ts',
    fileExists: (name: string) => name === FILE_NAME,
    readFile: () => undefined
  }
  return ts.createLanguageService(host).getNavigationTree(FILE_NAME)
}

function offsetToPosition(source: string): OffsetToPosition {
  return (offset) => {
    const before = source.slice(0, offset).split('\n')
    return { lineNumber: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
  }
}

describe('navigationTreeToOutline', () => {
  const source = [
    "import { x } from './x'",
    'export const LIMIT = 3',
    'export interface Shape { area(): number }',
    'export class Circle implements Shape {',
    '  radius = 1',
    '  constructor(r: number) { this.radius = r }',
    '  area(): number { return 3 }',
    '}',
    'export function render() {',
    '  items.map(() => 1)',
    '  return <div />',
    '}'
  ].join('\n')

  it('keeps declarations and named callbacks, drops imports', () => {
    const outline = navigationTreeToOutline(navigationTree(source), offsetToPosition(source))
    expect(
      outline.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        children: symbol.children.map((child) => `${child.kind}:${child.name}`)
      }))
    ).toEqual([
      { name: 'LIMIT', kind: 'constant', children: [] },
      { name: 'Shape', kind: 'interface', children: ['method:area'] },
      {
        name: 'Circle',
        kind: 'class',
        children: ['property:radius', 'constructor:constructor', 'method:area']
      },
      { name: 'render', kind: 'function', children: ['function:items.map() callback'] }
    ])
  })

  it('reveals the name and spans the whole declaration', () => {
    const circle = navigationTreeToOutline(navigationTree(source), offsetToPosition(source))[2]
    expect(circle).toMatchObject({ line: 4, column: 14, startLine: 4, endLine: 8 })
  })

  it('returns nothing for a malformed tree', () => {
    expect(navigationTreeToOutline({ text: 42 }, offsetToPosition(''))).toEqual([])
    expect(navigationTreeToOutline(undefined, offsetToPosition(''))).toEqual([])
  })
})
