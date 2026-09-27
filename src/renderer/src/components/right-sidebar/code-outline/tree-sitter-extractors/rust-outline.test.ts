import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('rust')
})

describe('rust outline', () => {
  it('outlines items, impl blocks and modules', () => {
    const source = `use std::fmt;
const MAX: usize = 10;
static COUNTER: u32 = 0;

#[derive(Debug)]
pub struct Point<T> { pub x: T, y: T }
struct Tuple(i32, i32);
pub enum Shape { Circle { r: f64 }, Empty }
pub trait Area { fn area(&self) -> f64; type Output; }

impl<T> Point<T> {
    pub fn new(x: T, y: T) -> Self { Point { x, y } }
}

impl fmt::Display for Point<i32> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }
}

type Alias = Vec<u8>;
mod inner { pub fn nested() {} }
macro_rules! square { ($x:expr) => { $x * $x }; }
fn main() { fn local() {} }`
    expect(shape(outline(source))).toEqual([
      { name: 'MAX', kind: 'constant' },
      { name: 'COUNTER', kind: 'variable' },
      {
        name: 'Point',
        kind: 'struct',
        children: [
          { name: 'x', kind: 'field' },
          { name: 'y', kind: 'field' }
        ]
      },
      { name: 'Tuple', kind: 'struct' },
      {
        name: 'Shape',
        kind: 'enum',
        children: [
          { name: 'Circle', kind: 'enum-member' },
          { name: 'Empty', kind: 'enum-member' }
        ]
      },
      {
        name: 'Area',
        kind: 'interface',
        children: [
          { name: 'area', kind: 'method' },
          { name: 'Output', kind: 'type' }
        ]
      },
      { name: 'impl Point<T>', kind: 'namespace', children: [{ name: 'new', kind: 'method' }] },
      {
        name: 'impl fmt::Display for Point<i32>',
        kind: 'namespace',
        children: [{ name: 'fmt', kind: 'method' }]
      },
      { name: 'Alias', kind: 'type' },
      { name: 'inner', kind: 'namespace', children: [{ name: 'nested', kind: 'function' }] },
      { name: 'square!', kind: 'function' },
      { name: 'main', kind: 'function' }
    ])
  })

  it('points an impl block at its type', () => {
    const impl = outline('struct P;\nimpl Clone for P {\n}\n')[1]
    expect(impl).toMatchObject({ line: 2, column: 16, startLine: 2, endLine: 3 })
  })
})
