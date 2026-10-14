import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import {
  buildDiffFileSequence,
  buildHistoryDiffFileSequence,
  findAdjacentDiffEntry,
  findAdjacentHistoryDiffEntry
} from './diff-adjacent-file'

function unstaged(path: string): GitStatusEntry {
  return { path, status: 'modified', area: 'unstaged' }
}

function staged(path: string): GitStatusEntry {
  return { path, status: 'modified', area: 'staged' }
}

function untracked(path: string): GitStatusEntry {
  return { path, status: 'untracked', area: 'untracked' }
}

describe('buildDiffFileSequence', () => {
  it('follows the changes-first section order with each section sorted by name', () => {
    // Arrange
    const entries = [staged('c.ts'), unstaged('b.ts'), untracked('d.ts'), unstaged('a.ts')]

    // Act
    const sequence = buildDiffFileSequence(entries, 'changes-first')

    // Assert
    expect(sequence.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  })

  it('follows the staged-first section order when the setting asks for it', () => {
    // Arrange
    const entries = [unstaged('a.ts'), staged('b.ts')]

    // Act
    const sequence = buildDiffFileSequence(entries, 'staged-first')

    // Assert
    expect(sequence.map((entry) => entry.path)).toEqual(['b.ts', 'a.ts'])
  })
})

describe('findAdjacentDiffEntry', () => {
  const sequence = [unstaged('a.ts'), unstaged('b.ts'), untracked('c.ts')]

  it('returns the next entry in the sequence', () => {
    // Arrange / Act
    const target = findAdjacentDiffEntry(
      sequence,
      { relativePath: 'a.ts', diffSource: 'unstaged' },
      'next'
    )

    // Assert
    expect(target?.path).toBe('b.ts')
  })

  it('returns the previous entry in the sequence', () => {
    // Arrange / Act
    const target = findAdjacentDiffEntry(
      sequence,
      { relativePath: 'b.ts', diffSource: 'unstaged' },
      'previous'
    )

    // Assert
    expect(target?.path).toBe('a.ts')
  })

  it('returns null at either end of the sequence', () => {
    // Arrange / Act / Assert
    expect(
      findAdjacentDiffEntry(sequence, { relativePath: 'c.ts', diffSource: 'unstaged' }, 'next')
    ).toBeNull()
    expect(
      findAdjacentDiffEntry(sequence, { relativePath: 'a.ts', diffSource: 'unstaged' }, 'previous')
    ).toBeNull()
  })

  it('treats untracked files as unstaged diffs', () => {
    // Arrange / Act
    const target = findAdjacentDiffEntry(
      sequence,
      { relativePath: 'b.ts', diffSource: 'unstaged' },
      'next'
    )

    // Assert
    expect(target?.path).toBe('c.ts')
  })

  it('matches the staged copy of a file that has both staged and unstaged changes', () => {
    // Arrange
    const both = [staged('x.ts'), unstaged('x.ts'), unstaged('y.ts')]

    // Act
    const target = findAdjacentDiffEntry(
      both,
      { relativePath: 'x.ts', diffSource: 'staged' },
      'next'
    )

    // Assert
    expect(target).toEqual(unstaged('x.ts'))
  })

  it('returns null when the current file is not in the sequence', () => {
    // Arrange / Act
    const target = findAdjacentDiffEntry(
      sequence,
      { relativePath: 'missing.ts', diffSource: 'unstaged' },
      'next'
    )

    // Assert
    expect(target).toBeNull()
  })
})

describe('history diff file sequence', () => {
  const entries: GitBranchChangeEntry[] = [
    { path: 'src/beta.ts', status: 'modified' },
    { path: 'docs/guide.md', status: 'modified' },
    { path: 'src/alpha.ts', status: 'modified' }
  ]

  it('sorts the compare entries by path', () => {
    // Arrange / Act
    const sequence = buildHistoryDiffFileSequence(entries)

    // Assert
    expect(sequence.map((entry) => entry.path)).toEqual([
      'docs/guide.md',
      'src/alpha.ts',
      'src/beta.ts'
    ])
  })

  it('steps to the next and previous entry and stops at the ends', () => {
    // Arrange
    const sequence = buildHistoryDiffFileSequence(entries)

    // Act / Assert
    expect(findAdjacentHistoryDiffEntry(sequence, 'src/alpha.ts', 'next')?.path).toBe('src/beta.ts')
    expect(findAdjacentHistoryDiffEntry(sequence, 'src/alpha.ts', 'previous')?.path).toBe(
      'docs/guide.md'
    )
    expect(findAdjacentHistoryDiffEntry(sequence, 'src/beta.ts', 'next')).toBeNull()
    expect(findAdjacentHistoryDiffEntry(sequence, 'missing.cs', 'next')).toBeNull()
  })
})
