import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser } from '@vscode/tree-sitter-wasm'
import type { CodeOutlineSymbol } from './code-outline-types'
import {
  extractTreeSitterOutline,
  type TreeSitterOutlineLanguage
} from './tree-sitter-outline-extract'

const wasmDir = dirname(createRequire(import.meta.url).resolve('@vscode/tree-sitter-wasm'))
const parsers = new Map<TreeSitterOutlineLanguage, Parser>()

beforeAll(async () => {
  await Parser.init({ locateFile: () => join(wasmDir, 'tree-sitter.wasm') })
  for (const [language, file] of [
    ['python', 'tree-sitter-python.wasm'],
    ['csharp', 'tree-sitter-c-sharp.wasm']
  ] as const) {
    const parser = new Parser()
    parser.setLanguage(await Language.load(readFileSync(join(wasmDir, file))))
    parsers.set(language, parser)
  }
})

function outline(language: TreeSitterOutlineLanguage, source: string): CodeOutlineSymbol[] {
  const tree = parsers.get(language)?.parse(source)
  if (!tree) {
    throw new Error('parse failed')
  }
  return extractTreeSitterOutline(language, tree.rootNode)
}

type Shape = { name: string; kind: string; children?: Shape[] }

function shape(symbols: CodeOutlineSymbol[]): Shape[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.children.length > 0 ? { children: shape(symbol.children) } : {})
  }))
}

describe('python outline', () => {
  const source = [
    'import os',
    'MAX_SIZE = 10',
    'counter = 0',
    '',
    '@dataclass',
    'class Point(Base):',
    '    x: int = 0',
    '    def __init__(self, x):',
    '        self.x = x',
    '    async def move(self, dx: int) -> None:',
    '        def clamp(v):',
    '            return v',
    '',
    'def main(argv=None):',
    '    pass'
  ].join('\n')

  it('nests methods under classes and keeps module-level names', () => {
    expect(shape(outline('python', source))).toEqual([
      { name: 'MAX_SIZE', kind: 'constant' },
      { name: 'counter', kind: 'variable' },
      {
        name: 'Point',
        kind: 'class',
        children: [
          { name: 'x', kind: 'field' },
          { name: '__init__', kind: 'constructor' },
          { name: 'move', kind: 'method', children: [{ name: 'clamp', kind: 'function' }] }
        ]
      },
      { name: 'main', kind: 'function' }
    ])
  })

  it('spans the decorator and points at the name', () => {
    const point = outline('python', source)[2]
    expect(point).toMatchObject({ line: 6, column: 7, startLine: 5, endLine: 12 })
  })

  it('shows parameters as detail', () => {
    expect(outline('python', source)[3].detail).toBe('(argv=None)')
  })
})

describe('csharp outline', () => {
  it('outlines namespaces, types and members', () => {
    const source = `
namespace App.Core {
  public interface IRepo { void Save(); int Count { get; } }
  public enum Color { Red, Green }
  public record Person(string Name);
  public class Repo<T> : IRepo {
    private int _a, _b;
    public event EventHandler Changed;
    public Repo(int size) {}
    public int Count { get; set; }
    public int this[int i] => 0;
    public static Repo<T> operator +(Repo<T> a, Repo<T> b) => a;
    public void Save() {}
    public void Save(string path) {}
    private class Nested {}
  }
  struct Size {}
}`
    expect(shape(outline('csharp', source))).toEqual([
      {
        name: 'App.Core',
        kind: 'namespace',
        children: [
          {
            name: 'IRepo',
            kind: 'interface',
            children: [
              { name: 'Save', kind: 'method' },
              { name: 'Count', kind: 'property' }
            ]
          },
          {
            name: 'Color',
            kind: 'enum',
            children: [
              { name: 'Red', kind: 'enum-member' },
              { name: 'Green', kind: 'enum-member' }
            ]
          },
          { name: 'Person', kind: 'record' },
          {
            name: 'Repo',
            kind: 'class',
            children: [
              { name: '_a', kind: 'field' },
              { name: '_b', kind: 'field' },
              { name: 'Changed', kind: 'event' },
              { name: 'Repo', kind: 'constructor' },
              { name: 'Count', kind: 'property' },
              { name: 'this[]', kind: 'property' },
              { name: 'operator +', kind: 'method' },
              { name: 'Save', kind: 'method' },
              { name: 'Save', kind: 'method' },
              { name: 'Nested', kind: 'class' }
            ]
          },
          { name: 'Size', kind: 'struct' }
        ]
      }
    ])
  })

  it('distinguishes overloads by their parameters', () => {
    const repo = outline('csharp', 'class R { void Save() {} void Save(string path) {} }')[0]
    expect(repo.children.map((child) => child.detail)).toEqual(['()', '(string path)'])
  })

  it('nests declarations after a file-scoped namespace under it', () => {
    const symbols = outline('csharp', 'using System;\nnamespace App;\nclass A {}\n\nclass B {}\n')
    expect(shape(symbols)).toEqual([
      {
        name: 'App',
        kind: 'namespace',
        children: [
          { name: 'A', kind: 'class' },
          { name: 'B', kind: 'class' }
        ]
      }
    ])
    expect(symbols[0]).toMatchObject({ startLine: 2, endLine: 5 })
  })
})
