import { describe, expect, it } from 'vitest'
import { getFileExplorerLocateTarget } from './file-explorer-locate-target'

type LocateState = Parameters<typeof getFileExplorerLocateTarget>[0]

const WORKTREE_PATH = '/repo'

function makeFile(
  id: string,
  filePath: string,
  overrides: Partial<LocateState['openFiles'][0]> = {}
): LocateState['openFiles'][0] {
  return {
    id,
    filePath,
    relativePath: filePath.slice(WORKTREE_PATH.length + 1),
    worktreeId: 'wt',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

function makeState(overrides: Partial<LocateState>): LocateState {
  return {
    activeFileId: null,
    activeTabType: 'editor',
    activeWorktreeId: 'wt',
    groupsByWorktree: {},
    openFiles: [],
    unifiedTabsByWorktree: {},
    ...overrides
  }
}

function makeSplitWithTerminalFocus(): Pick<
  LocateState,
  'activeTabType' | 'groupsByWorktree' | 'unifiedTabsByWorktree'
> {
  return {
    activeTabType: 'terminal',
    groupsByWorktree: {
      wt: [
        { id: 'left', worktreeId: 'wt', activeTabId: 'tab-terminal', tabOrder: ['tab-terminal'] },
        { id: 'right', worktreeId: 'wt', activeTabId: 'tab-editor', tabOrder: ['tab-editor'] }
      ]
    },
    unifiedTabsByWorktree: {
      wt: [
        {
          id: 'tab-terminal',
          entityId: 'pty-1',
          groupId: 'left',
          worktreeId: 'wt',
          contentType: 'terminal',
          label: 'Terminal',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        },
        {
          id: 'tab-editor',
          entityId: 'file-b',
          groupId: 'right',
          worktreeId: 'wt',
          contentType: 'editor',
          label: 'b.ts',
          customLabel: null,
          color: null,
          sortOrder: 1,
          createdAt: 0
        }
      ]
    }
  }
}

describe('getFileExplorerLocateTarget', () => {
  it('returns the focused editor file', () => {
    const state = makeState({
      activeFileId: 'file-a',
      openFiles: [makeFile('file-a', '/repo/src/a.ts')]
    })

    expect(getFileExplorerLocateTarget(state, WORKTREE_PATH)).toBe('/repo/src/a.ts')
  })

  it('finds the file shown beside a focused terminal split', () => {
    const state = makeState({
      ...makeSplitWithTerminalFocus(),
      activeFileId: 'file-b',
      openFiles: [makeFile('file-b', '/repo/src/b.ts')]
    })

    expect(getFileExplorerLocateTarget(state, WORKTREE_PATH)).toBe('/repo/src/b.ts')
  })

  it('ignores a stale active file that no pane is showing', () => {
    const state = makeState({
      activeTabType: 'terminal',
      activeFileId: 'file-a',
      openFiles: [makeFile('file-a', '/repo/src/a.ts')]
    })

    expect(getFileExplorerLocateTarget(state, WORKTREE_PATH)).toBeNull()
  })

  it('locates the file behind a single-file diff but not a combined diff', () => {
    const singleDiff = makeState({
      activeFileId: 'diff',
      openFiles: [makeFile('diff', '/repo/src/a.ts', { mode: 'diff', diffSource: 'unstaged' })]
    })
    const combinedDiff = makeState({
      activeFileId: 'combined',
      openFiles: [
        makeFile('combined', '/repo/src/a.ts', { mode: 'diff', diffSource: 'combined-branch' })
      ]
    })

    expect(getFileExplorerLocateTarget(singleDiff, WORKTREE_PATH)).toBe('/repo/src/a.ts')
    expect(getFileExplorerLocateTarget(combinedDiff, WORKTREE_PATH)).toBeNull()
  })

  it('returns null for a file outside the workspace', () => {
    const state = makeState({
      activeFileId: 'file-a',
      openFiles: [makeFile('file-a', '/elsewhere/a.ts')]
    })

    expect(getFileExplorerLocateTarget(state, WORKTREE_PATH)).toBeNull()
  })
})
