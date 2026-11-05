import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../../../../../../shared/file-listing/directory-entry'

const readRuntimeDirectoryPage = vi.fn()
const readRuntimeDirectory = vi.fn()
let hostPages = true
vi.mock('@/runtime/files/reads/runtime-directory-page-client', () => ({
  readRuntimeDirectoryPage: (...args: unknown[]) => readRuntimeDirectoryPage(...args),
  runtimeDirectoryPagesSupported: () => hostPages
}))
vi.mock('@/runtime/files/reads/runtime-directory-read', () => ({
  readRuntimeDirectory: (...args: unknown[]) => readRuntimeDirectory(...args)
}))
vi.mock('../navigation/file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => ({ kind: 'local' }),
  getFileExplorerOperationRoute: () => ({ target: { kind: 'local' }, connectionId: null }),
  getFileExplorerOwnerUnresolvedMessage: () => 'unresolved'
}))

import { appendFileExplorerDirPage, fileExplorerRevealHiddenPath } from './file-explorer-dir-pages'

import type { DirCache } from './file-explorer-types'
import { fileNode } from './file-explorer-tree-node-test-fixtures'

const file = (name: string): DirEntry => ({ name, isDirectory: false, isSymlink: false })
const names = (count: number, from = 0): DirEntry[] =>
  Array.from({ length: count }, (_, index) => file(`f${String(from + index).padStart(5, '0')}`))

/** A host folder of `total` sorted files: refused whole past `wholeLimit`, served in pages. */

beforeEach(() => {
  readRuntimeDirectoryPage.mockReset()
  readRuntimeDirectory.mockReset()
  hostPages = true
})

describe('paged folder listing', () => {
  it('appends a page in order, keeping a row the watcher already added once', () => {
    const owner = { kind: 'local' as const }
    const cache: DirCache = {
      children: [
        { name: 'f00000', path: '/w/f00000', relativePath: 'f00000', isDirectory: false, depth: 0 },
        { name: 'f00003', path: '/w/f00003', relativePath: 'f00003', isDirectory: false, depth: 0 }
      ],
      operationOwner: owner,
      more: { after: { name: 'f00000', isDirectory: false } }
    }
    const appended = appendFileExplorerDirPage(
      cache,
      { entries: names(3, 1), operationOwner: owner },
      '/w',
      -1,
      '/w'
    )
    expect(appended.children.map((child) => child.name)).toEqual([
      'f00000',
      'f00001',
      'f00002',
      'f00003'
    ])
    expect(appended.more).toBeUndefined()
  })

  it('does not extend rows with a page from another host', () => {
    const cache: DirCache = {
      children: [],
      operationOwner: { kind: 'local' },
      more: { after: { name: 'f00000', isDirectory: false } }
    }
    const appended = appendFileExplorerDirPage(
      cache,
      { entries: names(1), operationOwner: { kind: 'ssh', connectionId: 'c' } },
      '/w',
      -1,
      '/w'
    )
    expect(appended).toEqual({ children: [], operationOwner: { kind: 'local' } })
  })
})

describe('fileExplorerRevealHiddenPath', () => {
  const cacheWith = (...childPaths: string[]): Record<string, DirCache> => ({
    '/repo': { children: childPaths.map((path) => ({ ...fileNode, path })) }
  })
  const listing = (...rows: string[]) => ({ hasPath: (path: string) => rows.includes(path) })

  it('names a path its folder lists but the tree does not show', () => {
    expect(
      fileExplorerRevealHiddenPath(cacheWith('/repo/.config'), listing(), [
        '/repo/.config',
        '/repo/.config/a.ts'
      ])
    ).toBe('/repo/.config')
  })

  it('keeps waiting on a path its folder has not listed', () => {
    expect(
      fileExplorerRevealHiddenPath(cacheWith('/repo/src'), listing('/repo/src'), [
        '/repo/new-folder',
        '/repo/new-folder/a.ts'
      ])
    ).toBeNull()
  })

  it('finds nothing hidden when every path is a row', () => {
    expect(
      fileExplorerRevealHiddenPath(cacheWith('/repo/a.ts'), listing('/repo/a.ts'), ['/repo/a.ts'])
    ).toBeNull()
  })
})
