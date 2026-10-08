import { describe, expect, it } from 'vitest'
import { getEditorHeaderOpenFileState } from './editor-header'
import type { OpenFile } from '@/store/slices/editor/types/open-file'

function makeOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('getEditorHeaderOpenFileState', () => {
  it('enables opening the working-tree file from a commit diff', () => {
    expect(
      getEditorHeaderOpenFileState(
        makeOpenFile({
          id: 'wt-1::diff::commit::v1::file.ts',
          mode: 'diff',
          diffSource: 'commit'
        })
      )
    ).toEqual({ canOpen: true })
  })
})
