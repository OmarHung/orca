import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('php')
})

describe('php outline', () => {
  it('nests declarations after `namespace X;` under it', () => {
    const source = `<?php
namespace App\\Models;

use Foo\\Bar;

const VERSION = '1.0';

interface Shape { public function area(): float; }

trait Greets { public function hello() {} }

abstract class Point extends Base implements Shape {
    use Greets;
    public const MAX = 10;
    private int $x = 0, $y;
    public function __construct(private int $z) {}
    public static function make(int $x): static { return new static($x); }
}

enum Suit: string { case Hearts = 'H'; public function color() {} }

function helper($a, $b = null) {}
`
    const symbols = outline(source)
    expect(shape(symbols)).toEqual([
      {
        name: 'App\\Models',
        kind: 'namespace',
        children: [
          { name: 'VERSION', kind: 'constant' },
          { name: 'Shape', kind: 'interface', children: [{ name: 'area', kind: 'method' }] },
          { name: 'Greets', kind: 'class', children: [{ name: 'hello', kind: 'method' }] },
          {
            name: 'Point',
            kind: 'class',
            children: [
              { name: 'MAX', kind: 'constant' },
              { name: '$x', kind: 'property' },
              { name: '$y', kind: 'property' },
              { name: '__construct', kind: 'constructor' },
              { name: 'make', kind: 'method' }
            ]
          },
          {
            name: 'Suit',
            kind: 'enum',
            children: [
              { name: 'Hearts', kind: 'enum-member' },
              { name: 'color', kind: 'method' }
            ]
          },
          { name: 'helper', kind: 'function' }
        ]
      }
    ])
    expect(symbols[0]).toMatchObject({ startLine: 2, endLine: 22 })
  })

  it('keeps braced namespaces separate', () => {
    const source = '<?php\nnamespace A { function a() {} }\nnamespace B { class C {} }\n'
    expect(shape(outline(source))).toEqual([
      { name: 'A', kind: 'namespace', children: [{ name: 'a', kind: 'function' }] },
      { name: 'B', kind: 'namespace', children: [{ name: 'C', kind: 'class' }] }
    ])
  })
})
