import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installCodeNavigationDocumentLifecycle,
  rememberSyncedDocument,
  toCodeNavigationFileChanges
} from './code-navigation-document-lifecycle'
import type { FsChangedPayload } from '../../../../shared/filesystem-entry-types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toCodeNavigationFileChanges', () => {
  it('splits renames, drops overflow and directories, and keeps only watched files', () => {
    expect(
      toCodeNavigationFileChanges([
        { kind: 'update', absolutePath: '/repo/src/app.ts' },
        { kind: 'rename', absolutePath: '/repo/src/new.cs', oldAbsolutePath: '/repo/src/old.cs' },
        { kind: 'create', absolutePath: '/repo/src', isDirectory: true },
        { kind: 'overflow', absolutePath: '/repo' },
        { kind: 'delete', absolutePath: '/repo/README.md' }
      ])
    ).toEqual([
      { kind: 'update', path: '/repo/src/app.ts' },
      { kind: 'delete', path: '/repo/src/old.cs' },
      { kind: 'create', path: '/repo/src/new.cs' }
    ])
  })
})

describe('installCodeNavigationDocumentLifecycle', () => {
  function install() {
    let disposeListener: ((model: { uri: { toString: () => string } }) => void) | null = null
    let fsListener: ((payload: FsChangedPayload) => void) | null = null
    const api = { closeDocument: vi.fn(async () => {}), filesChanged: vi.fn(async () => {}) }
    vi.stubGlobal('window', {
      api: {
        codeNavigation: api,
        fs: {
          onFsChanged: (listener: (payload: FsChangedPayload) => void) => {
            fsListener = listener
            return () => {}
          }
        }
      }
    })
    const fakeMonaco = {
      editor: {
        onWillDisposeModel: (listener: (model: { uri: { toString: () => string } }) => void) => {
          disposeListener = listener
          return { dispose: () => {} }
        }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lifecycle only calls onWillDisposeModel.
    const dispose = installCodeNavigationDocumentLifecycle(fakeMonaco as never)
    return {
      api,
      dispose,
      disposeModel: (uri: string) => disposeListener?.({ uri: { toString: () => uri } }),
      emitFsChange: (payload: FsChangedPayload) => fsListener?.(payload)
    }
  }

  it('closes a synced document once when its model is disposed', () => {
    const { api, disposeModel } = install()
    rememberSyncedDocument('file:///repo/a.ts', {
      kind: 'typescript',
      root: '/repo',
      path: '/repo/a.ts'
    })

    disposeModel('file:///repo/a.ts')
    disposeModel('file:///repo/a.ts')
    disposeModel('file:///repo/never-synced.ts')

    expect(api.closeDocument).toHaveBeenCalledTimes(1)
    expect(api.closeDocument).toHaveBeenCalledWith({
      kind: 'typescript',
      root: '/repo',
      path: '/repo/a.ts'
    })
  })

  it('forwards watched changes inside roots that have been queried', () => {
    const { api, emitFsChange } = install()
    rememberSyncedDocument('file:///repo/b.ts', {
      kind: 'typescript',
      root: '/repo',
      path: '/repo/b.ts'
    })

    emitFsChange({
      worktreePath: '/repo',
      events: [
        { kind: 'update', absolutePath: '/repo/src/c.ts' },
        { kind: 'update', absolutePath: '/elsewhere/d.ts' },
        { kind: 'update', absolutePath: '/repo/notes.txt' }
      ]
    })

    expect(api.filesChanged).toHaveBeenCalledWith({
      root: '/repo',
      changes: [{ kind: 'update', path: '/repo/src/c.ts' }]
    })
  })
})
