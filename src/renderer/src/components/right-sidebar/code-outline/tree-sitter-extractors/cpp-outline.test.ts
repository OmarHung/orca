import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('cpp')
})

describe('c++ outline', () => {
  it('outlines namespaces, classes and their members', () => {
    const source = `#include <vector>
namespace geo {
template <typename T>
class Point : public Base {
public:
    Point(int x);
    ~Point();
    virtual double area() const override;
    static int count;
    int x, y;
    Point& operator+=(const Point& o);
    void (*on_change)(int);
private:
    struct Inner { int z; };
};
enum class Color { Red, Green = 2 };
using Alias = std::vector<int>;
double Point<int>::area() const { return 0; }
namespace { int hidden; }
}`
    expect(shape(outline(source))).toEqual([
      {
        name: 'geo',
        kind: 'namespace',
        children: [
          {
            name: 'Point',
            kind: 'class',
            children: [
              { name: 'Point', kind: 'constructor' },
              { name: '~Point', kind: 'method' },
              { name: 'area', kind: 'method' },
              { name: 'count', kind: 'field' },
              { name: 'x', kind: 'field' },
              { name: 'y', kind: 'field' },
              { name: 'operator+=', kind: 'method' },
              { name: 'on_change', kind: 'field' },
              { name: 'Inner', kind: 'struct', children: [{ name: 'z', kind: 'field' }] }
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
          { name: 'Alias', kind: 'type' },
          { name: 'Point<int>::area', kind: 'method' },
          {
            name: '(anonymous)',
            kind: 'namespace',
            children: [{ name: 'hidden', kind: 'variable' }]
          }
        ]
      }
    ])
  })

  it('spans the template header', () => {
    const point = outline('template <typename T>\nclass Box {\n};\n')[0]
    expect(point).toMatchObject({ name: 'Box', line: 2, startLine: 1, endLine: 3 })
  })
})

describe('c outline', () => {
  const source = [
    '#ifndef SHAPES_H',
    '#define SHAPES_H',
    '#define MAX_SIZE 10',
    '#define SQUARE(x) ((x) * (x))',
    '',
    '#ifdef __cplusplus',
    'extern "C" {',
    '#endif',
    '',
    'typedef struct { double x, y; } Point;',
    'typedef unsigned int u32;',
    'struct node { int value; struct node *next; };',
    'static int counter = 0;',
    'int *make_buffer(size_t size);',
    'void (*callback)(int);',
    'int main(int argc, char **argv) { return 0; }',
    '',
    '#ifdef __cplusplus',
    '}',
    '#endif',
    '#endif'
  ].join('\n')

  it('reads declarations through header guards and extern "C"', () => {
    expect(shape(outline(source))).toEqual([
      { name: 'MAX_SIZE', kind: 'constant' },
      { name: 'SQUARE', kind: 'function' },
      {
        name: 'Point',
        kind: 'struct',
        children: [
          { name: 'x', kind: 'field' },
          { name: 'y', kind: 'field' }
        ]
      },
      { name: 'u32', kind: 'type' },
      {
        name: 'node',
        kind: 'struct',
        children: [
          { name: 'value', kind: 'field' },
          { name: 'next', kind: 'field' }
        ]
      },
      { name: 'counter', kind: 'variable' },
      { name: 'make_buffer', kind: 'function' },
      { name: 'callback', kind: 'variable' },
      { name: 'main', kind: 'function' }
    ])
  })

  it('keeps a #define to its own line', () => {
    const [maxSize, square] = outline(source)
    expect(maxSize).toMatchObject({ startLine: 3, endLine: 3 })
    expect(square).toMatchObject({ detail: '(x)', startLine: 4, endLine: 4 })
  })
})
