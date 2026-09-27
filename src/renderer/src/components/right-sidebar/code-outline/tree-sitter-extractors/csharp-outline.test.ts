import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('csharp')
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
    expect(shape(outline(source))).toEqual([
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
    const repo = outline('class R { void Save() {} void Save(string path) {} }')[0]
    expect(repo.children.map((child) => child.detail)).toEqual(['()', '(string path)'])
  })

  it('nests declarations after a file-scoped namespace under it', () => {
    const symbols = outline('using System;\nnamespace App;\nclass A {}\n\nclass B {}\n')
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
