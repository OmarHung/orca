import { describe, expect, it } from 'vitest'
import type { GitHistoryItem } from '../../../../../../shared/git-history'
import { resolveGitLogRange } from './git-log-range'

function item(id: string, parentIds: string[]): GitHistoryItem {
  return { id, parentIds, subject: id, message: id }
}

describe('resolveGitLogRange', () => {
  it('spans from the oldest selected commit’s parent to the newest one', () => {
    const range = resolveGitLogRange([
      item('c'.repeat(40), ['b'.repeat(40)]),
      item('a'.repeat(40), ['9'.repeat(40)])
    ])
    expect(range).toEqual({
      base: { oid: '9'.repeat(40), label: '9999999' },
      target: { oid: 'c'.repeat(40), label: 'ccccccc' }
    })
  })

  it('starts at a root commit that has no parent', () => {
    const range = resolveGitLogRange([
      item('c'.repeat(40), ['a'.repeat(40)]),
      item('a'.repeat(40), [])
    ])
    expect(range?.base.oid).toBe('a'.repeat(40))
  })

  it('needs at least two commits', () => {
    expect(resolveGitLogRange([item('c'.repeat(40), [])])).toBeNull()
    expect(resolveGitLogRange([])).toBeNull()
  })
})
