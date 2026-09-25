import { describe, expect, it } from 'vitest'
import type { GitHistoryItem } from '../../../../../shared/git-history'
import { collectGitLogAuthors, filterGitLogItems, isGitLogFilterActive } from './git-log-filter'

function commit(overrides: Partial<GitHistoryItem> & { id: string }): GitHistoryItem {
  return { parentIds: [], subject: '', message: '', ...overrides }
}

const items: GitHistoryItem[] = [
  commit({
    id: 'aaaa1111',
    subject: 'fix: login',
    message: 'fix: login\n\nbody',
    author: 'Omar'
  }),
  commit({
    id: 'bbbb2222',
    subject: 'feat: 新增 Git Log',
    message: 'feat',
    author: 'Mike'
  }),
  commit({
    id: 'cccc3333',
    subject: 'chore',
    message: 'chore\n\nmentions LOGIN',
    author: 'Omar'
  })
]

describe('filterGitLogItems', () => {
  it('returns every item when no filter is set', () => {
    expect(filterGitLogItems(items, { text: '', author: null })).toBe(items)
  })

  it('matches subject and full message case-insensitively', () => {
    const ids = filterGitLogItems(items, { text: 'login', author: null }).map((i) => i.id)
    expect(ids).toEqual(['aaaa1111', 'cccc3333'])
  })

  it('matches a hash prefix', () => {
    const ids = filterGitLogItems(items, { text: 'bbbb', author: null }).map((i) => i.id)
    expect(ids).toEqual(['bbbb2222'])
  })

  it('matches non-ASCII text', () => {
    const ids = filterGitLogItems(items, { text: '新增', author: null }).map((i) => i.id)
    expect(ids).toEqual(['bbbb2222'])
  })

  it('combines text and author', () => {
    const ids = filterGitLogItems(items, { text: 'login', author: 'Mike' }).map((i) => i.id)
    expect(ids).toEqual([])
    expect(filterGitLogItems(items, { text: '', author: 'Omar' })).toHaveLength(2)
  })
})

describe('collectGitLogAuthors', () => {
  it('returns unique authors sorted by name', () => {
    expect(collectGitLogAuthors(items)).toEqual(['Mike', 'Omar'])
  })
})

describe('isGitLogFilterActive', () => {
  it('ignores whitespace-only text', () => {
    expect(isGitLogFilterActive({ text: '  ', author: null })).toBe(false)
    expect(isGitLogFilterActive({ text: '', author: 'Omar' })).toBe(true)
  })
})
