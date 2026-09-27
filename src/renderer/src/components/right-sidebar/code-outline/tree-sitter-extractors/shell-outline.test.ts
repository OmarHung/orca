import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('bash')
})

describe('shell outline', () => {
  it('lists top-level variables once and functions wherever they are defined', () => {
    const source = `#!/usr/bin/env bash
set -e
readonly VERSION="1.0"
export PREFIX=/usr
count=0

usage() {
  echo "usage"
}

function build {
  inner() { :; }
}

if [ -n "$CI" ]; then
  ci_only() { :; }
fi
count=$((count + 1))`
    expect(shape(outline(source))).toEqual([
      { name: 'VERSION', kind: 'constant' },
      { name: 'PREFIX', kind: 'variable' },
      { name: 'count', kind: 'variable' },
      { name: 'usage', kind: 'function' },
      { name: 'build', kind: 'function', children: [{ name: 'inner', kind: 'function' }] },
      { name: 'ci_only', kind: 'function' }
    ])
  })

  it('spans the whole function body', () => {
    const [usage] = outline('usage() {\n  echo hi\n}\n')
    expect(usage).toMatchObject({ line: 1, startLine: 1, endLine: 3 })
  })
})
