import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('ruby')
})

describe('ruby outline', () => {
  it('outlines modules, classes, methods and constants', () => {
    const source = `require 'json'
MAX_SIZE = 10

module Geo
  class Point < Base
    attr_accessor :x, :y
    ORIGIN = [0, 0]
    def initialize(x, y = 0)
      @x = x
    end
    def self.build(*args) = new(*args)
    class << self
      def helper; end
    end
    private def secret; end
  end
end

class Geo::Circle; end

def main(argv)
end`
    expect(shape(outline(source))).toEqual([
      { name: 'MAX_SIZE', kind: 'constant' },
      {
        name: 'Geo',
        kind: 'namespace',
        children: [
          {
            name: 'Point',
            kind: 'class',
            children: [
              { name: 'x', kind: 'property' },
              { name: 'y', kind: 'property' },
              { name: 'ORIGIN', kind: 'constant' },
              { name: 'initialize', kind: 'constructor' },
              { name: 'self.build', kind: 'method' },
              { name: 'self.helper', kind: 'method' },
              { name: 'secret', kind: 'method' }
            ]
          }
        ]
      },
      { name: 'Geo::Circle', kind: 'class' },
      { name: 'main', kind: 'function' }
    ])
  })

  it('shows parameters as detail', () => {
    const [main] = outline('def main(argv, verbose: false)\nend')
    expect(main.detail).toBe('(argv, verbose: false)')
  })
})
