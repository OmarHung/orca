import { describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from './code-outline-types'
import { offsetToPositionIn } from './offset-position-fixture'
import { yamlOutline } from './yaml-outline'

function outline(text: string): CodeOutlineSymbol[] {
  return yamlOutline(text, offsetToPositionIn(text))
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

describe('yaml outline', () => {
  it('outlines a workflow, labelling sequence items by their name', () => {
    const text = `name: CI
on:
  push:
    branches: [main]
env: &defaults
  NODE_ENV: test
jobs:
  build:
    runs-on: ubuntu-latest
    env: *defaults
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: |
          pnpm install
          pnpm build
`
    expect(shape(outline(text))).toEqual([
      { name: 'name', kind: 'property', detail: 'CI' },
      {
        name: 'on',
        kind: 'namespace',
        children: [
          {
            name: 'push',
            kind: 'namespace',
            children: [
              {
                name: 'branches',
                kind: 'array',
                children: [{ name: '0', kind: 'property', detail: 'main' }]
              }
            ]
          }
        ]
      },
      {
        name: 'env',
        kind: 'namespace',
        children: [{ name: 'NODE_ENV', kind: 'property', detail: 'test' }]
      },
      {
        name: 'jobs',
        kind: 'namespace',
        children: [
          {
            name: 'build',
            kind: 'namespace',
            children: [
              { name: 'runs-on', kind: 'property', detail: 'ubuntu-latest' },
              { name: 'env', kind: 'property', detail: '*defaults' },
              {
                name: 'steps',
                kind: 'array',
                children: [
                  {
                    name: '0',
                    kind: 'namespace',
                    children: [{ name: 'uses', kind: 'property', detail: 'actions/checkout@v4' }]
                  },
                  {
                    name: '1',
                    kind: 'namespace',
                    detail: 'Install',
                    children: [
                      { name: 'name', kind: 'property', detail: 'Install' },
                      { name: 'run', kind: 'property', detail: 'pnpm install pnpm build' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ])
  })

  it('lists every document of a --- stream in order', () => {
    const text = 'kind: Service\n---\nkind: Deployment\nspec:\n  replicas: 2\n'
    expect(shape(outline(text))).toEqual([
      { name: 'kind', kind: 'property', detail: 'Service' },
      { name: 'kind', kind: 'property', detail: 'Deployment' },
      {
        name: 'spec',
        kind: 'namespace',
        children: [{ name: 'replicas', kind: 'property', detail: '2' }]
      }
    ])
  })

  it('points at the key and spans the nested block', () => {
    const [, spec] = outline('kind: Deployment\nspec:\n  replicas: 2\n  paused: false\n')
    expect(spec).toMatchObject({ line: 2, column: 1, startLine: 2, endLine: 4 })
  })

  it('keeps what parses when the file has an error', () => {
    expect(shape(outline('a: 1\nb: [unclosed\nc: 3\n')).map((symbol) => symbol.name)).toContain('a')
  })

  it('shows nothing for an empty file', () => {
    expect(outline('')).toEqual([])
  })
})
