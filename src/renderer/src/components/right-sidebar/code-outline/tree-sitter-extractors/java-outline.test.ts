import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('java')
})

describe('java outline', () => {
  it('outlines types, members and nested types', () => {
    const source = `package com.example;

@Entity
public class Point extends Base {
    public static final int MAX = 10;
    private int x, y;
    public Point(int x) { this.x = x; }
    @Override
    public double area() { return 0; }
    static class Inner {}
    interface Visitor { int LIMIT = 1; void visit(Point p); }
}

enum Color { RED, GREEN; void paint() {} }

record Pair(int a, int b) { Pair { } int sum() { return a + b; } }

@interface Marker { String value() default ""; }`
    expect(shape(outline(source))).toEqual([
      {
        name: 'Point',
        kind: 'class',
        children: [
          { name: 'MAX', kind: 'constant' },
          { name: 'x', kind: 'field' },
          { name: 'y', kind: 'field' },
          { name: 'Point', kind: 'constructor' },
          { name: 'area', kind: 'method' },
          { name: 'Inner', kind: 'class' },
          {
            name: 'Visitor',
            kind: 'interface',
            children: [
              { name: 'LIMIT', kind: 'constant' },
              { name: 'visit', kind: 'method' }
            ]
          }
        ]
      },
      {
        name: 'Color',
        kind: 'enum',
        children: [
          { name: 'RED', kind: 'enum-member' },
          { name: 'GREEN', kind: 'enum-member' },
          { name: 'paint', kind: 'method' }
        ]
      },
      {
        name: 'Pair',
        kind: 'record',
        children: [
          { name: 'a', kind: 'field' },
          { name: 'b', kind: 'field' },
          { name: 'Pair', kind: 'constructor' },
          { name: 'sum', kind: 'method' }
        ]
      },
      { name: 'Marker', kind: 'interface', children: [{ name: 'value', kind: 'method' }] }
    ])
  })

  it('spans annotations and shows parameters as detail', () => {
    const point = outline('class P {\n  @Override\n  void save(String path, int n) {}\n}')[0]
    expect(point.children[0]).toMatchObject({
      detail: '(String path, int n)',
      line: 3,
      startLine: 2,
      endLine: 3
    })
  })
})
