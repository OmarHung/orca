import { describe, expect, it, vi } from 'vitest'
import { listNewForkCommits, parseLocalBuildCommit } from './fork-update-changelog-commits'

const SEP = '\u001f'
const log = (...commits: [string, string][]) =>
  commits.map(([sha, subject]) => `${sha}${SEP}${subject}`).join('\n')

describe('listNewForkCommits', () => {
  it('returns the new build commits whose subjects the previous build lacked', async () => {
    const git = vi.fn(async (args: string[]) =>
      args.includes('v1.4.219..f0feeec927')
        ? log(['n3', 'chore(i18n): regenerate'], ['n2', 'feat: changelog'], ['n1', 'feat: old'])
        : log(['o1', 'feat: old'])
    )
    const commits = await listNewForkCommits(git, {
      fromTag: 'v1.4.218',
      fromCommit: 'e1d7c76c5c',
      toTag: 'v1.4.219',
      toCommit: 'f0feeec927'
    })
    expect(commits).toEqual([
      { sha: 'n3', subject: 'chore(i18n): regenerate' },
      { sha: 'n2', subject: 'feat: changelog' }
    ])
    expect(git).toHaveBeenCalledWith(expect.arrayContaining(['v1.4.218..e1d7c76c5c', '--']))
  })

  it('is null when a build commit is unknown', async () => {
    const git = vi.fn(async () => '')
    const input = { fromTag: 'v1.4.218', toTag: 'v1.4.219', toCommit: 'f0feeec927' }
    expect(await listNewForkCommits(git, { ...input, fromCommit: null })).toBeNull()
    expect(git).not.toHaveBeenCalled()
  })

  it('is null when the previous commit is gone from the checkout', async () => {
    const git = vi.fn(async (args: string[]) => {
      if (args.some((arg) => arg.startsWith('v1.4.218..'))) {
        throw new Error('fatal: bad revision')
      }
      return log(['n1', 'feat: new'])
    })
    expect(
      await listNewForkCommits(git, {
        fromTag: 'v1.4.218',
        fromCommit: 'deadbeef',
        toTag: 'v1.4.219',
        toCommit: 'f0feeec927'
      })
    ).toBeNull()
  })
})

describe('parseLocalBuildCommit', () => {
  it('reads the commit from a local build version', () => {
    expect(parseLocalBuildCommit('1.4.219-local.1790995293506.f0feeec92724')).toBe('f0feeec92724')
  })

  it('is null for release versions', () => {
    expect(parseLocalBuildCommit('1.4.219')).toBeNull()
    expect(parseLocalBuildCommit('1.4.219-rc.1')).toBeNull()
  })
})
