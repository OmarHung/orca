import { describe, expect, it, vi } from 'vitest'

vi.mock('@/runtime/files/reads/runtime-directory-page-client', () => ({
  readRuntimeDirectoryPage: vi.fn(),
  runtimeDirectoryPagesSupported: () => true
}))
vi.mock('@/runtime/files/reads/runtime-directory-read', () => ({
  readRuntimeDirectory: vi.fn()
}))
vi.mock('../navigation/file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => ({ kind: 'local' }),
  getFileExplorerOperationRoute: () => ({ target: { kind: 'local' }, connectionId: null }),
  getFileExplorerOwnerUnresolvedMessage: () => 'unresolved'
}))

import { fileExplorerRevealHiddenPath } from './file-explorer-dir-pages'
import type { DirCache } from './file-explorer-types'
import { fileNode } from './file-explorer-tree-node-test-fixtures'

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
