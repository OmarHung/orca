import { describe, expect, it } from 'vitest'
import {
  childNodesFor,
  connectionNode,
  flattenDatabaseExplorer,
  introspectTargetFor
} from './database-explorer-tree'

const root = connectionNode('conn-0001')

describe('database explorer tree', () => {
  const schemas = childNodesFor(root, {
    level: 'schemas',
    schemas: [
      { name: 'public', isCurrent: true },
      { name: 'a/b', isCurrent: false }
    ]
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

  it('adds a Routines folder to schemas unless the database has none', () => {
    const relations = {
      level: 'relations' as const,
      relations: [{ name: 't', kind: 'table' as const }]
    }
    const withRoutines = childNodesFor(publicSchema!, relations)
    expect(withRoutines.map((node) => node.kind)).toEqual(['relation', 'folder'])
    expect(introspectTargetFor(withRoutines[1]!)).toEqual({ level: 'routines', schema: 'public' })
    expect(childNodesFor(publicSchema!, relations, { routines: false })).toHaveLength(1)
  })

  it('adds Keys and Indexes folders only where the relation kind has them', () => {
    const columns = { level: 'columns' as const, columns: [] }
    const relationOf = (kind: 'table' | 'view' | 'materialized-view') =>
      childNodesFor(publicSchema!, { level: 'relations', relations: [{ name: 't', kind }] })[0]!
    const folders = (kind: 'table' | 'view' | 'materialized-view') =>
      childNodesFor(relationOf(kind), columns).map((node) =>
        node.kind === 'folder' ? node.folder : node.kind
      )
    expect(folders('table')).toEqual(['keys', 'indexes'])
    expect(folders('materialized-view')).toEqual(['indexes'])
    expect(folders('view')).toEqual([])
    const [keys] = childNodesFor(relationOf('table'), columns)
    expect(introspectTargetFor(keys!)).toEqual({ level: 'keys', schema: 'public', relation: 't' })
  })

  it('keys unnamed constraints apart by position', () => {
    const table = childNodesFor(publicSchema!, {
      level: 'relations',
      relations: [{ name: 't', kind: 'table' }]
    })[0]!
    const [keysFolder] = childNodesFor(table, { level: 'columns', columns: [] })
    const unnamed = { name: '', kind: 'foreign' as const, columns: ['a'], references: null }
    const keys = childNodesFor(keysFolder!, { level: 'keys', keys: [unnamed, unnamed] })
    expect(new Set(keys.map((node) => node.key)).size).toBe(2)
    expect(keys.every((node) => node.kind === 'constraint')).toBe(true)
  })
})
