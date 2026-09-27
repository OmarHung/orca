import { describe, expect, it } from 'vitest'
import {
  childNodesFor,
  connectionNode,
  flattenDatabaseExplorer,
  introspectTargetFor,
  qualifiedRelationName
} from './database-explorer-tree'

const root = connectionNode('conn-0001')

describe('database explorer tree', () => {
  const schemas = childNodesFor(root, {
    level: 'schemas',
    schemas: [{ name: 'public' }, { name: 'a/b' }]
  })
  const [publicSchema, slashSchema] = schemas

  it('keys children uniquely even when names contain slashes', () => {
    expect(new Set(schemas.map((node) => node.key)).size).toBe(2)
    expect(slashSchema?.key).toContain('a%2Fb')
  })

  it('maps each node to the introspection level below it', () => {
    expect(introspectTargetFor(root)).toEqual({ level: 'schemas' })
    expect(introspectTargetFor(publicSchema!)).toEqual({ level: 'relations', schema: 'public' })
  })

  it('shows placeholders for loading, error and empty children', () => {
    const rows = flattenDatabaseExplorer(
      [root],
      { [root.key]: true, [publicSchema!.key]: true, [slashSchema!.key]: true },
      {
        [root.key]: { status: 'loaded', nodes: schemas },
        [publicSchema!.key]: { status: 'loading' },
        [slashSchema!.key]: { status: 'loaded', nodes: [] }
      }
    )
    expect(rows.map((row) => (row.type === 'node' ? row.node.kind : row.status))).toEqual([
      'connection',
      'schema',
      'loading',
      'schema',
      'empty'
    ])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 2])
  })

  it('hides children of collapsed nodes', () => {
    const rows = flattenDatabaseExplorer(
      [root],
      {},
      {
        [root.key]: { status: 'loaded', nodes: schemas }
      }
    )
    expect(rows).toHaveLength(1)
  })

  it('quotes identifiers only when needed, in each dialect’s style', () => {
    expect(qualifiedRelationName('public', 'users')).toBe('public.users')
    expect(qualifiedRelationName('Sales', 'order "items"')).toBe('"Sales"."order ""items"""')
    expect(qualifiedRelationName('shop', 'Order Items', 'mysql')).toBe('shop.`Order Items`')
    expect(qualifiedRelationName('dbo', 'a]b', 'sqlserver')).toBe('dbo.[a]]b]')
    expect(qualifiedRelationName('main', 'people', 'sqlite')).toBe('people')
  })
})
