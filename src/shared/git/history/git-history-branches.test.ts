import { describe, expect, it } from 'vitest'
import {
  GIT_HISTORY_BRANCH_LIMIT,
  isGitHistoryBranchRefName,
  loadGitHistoryBranches,
  parseGitHistoryBranches
} from './git-history-branches'

const OID_A = 'a'.repeat(40)
const OID_B = 'b'.repeat(40)

function line(fullName: string, oid: string, head = ' ', upstream = ''): string {
  return [fullName, oid, head, upstream].join('\0')
}

describe('parseGitHistoryBranches', () => {
  it('parses local and remote branches with HEAD and upstream', () => {
    const stdout = [
      line('refs/heads/main', OID_A, '*', 'origin/main'),
      line('refs/heads/feature/login', OID_B),
      line('refs/remotes/origin/main', OID_A),
      line('refs/remotes/origin/HEAD', OID_A)
    ].join('\n')

    expect(parseGitHistoryBranches(stdout)).toEqual([
      {
        fullName: 'refs/heads/main',
        name: 'main',
        kind: 'local',
        revision: OID_A,
        isHead: true,
        upstream: 'origin/main'
      },
      {
        fullName: 'refs/heads/feature/login',
        name: 'feature/login',
        kind: 'local',
        revision: OID_B,
        isHead: false
      },
      {
        fullName: 'refs/remotes/origin/main',
        name: 'origin/main',
        kind: 'remote',
        revision: OID_A,
        isHead: false
      }
    ])
  })

  it('skips malformed lines and CRLF endings', () => {
    const stdout = `garbage\r\n${line('refs/tags/v1', OID_A)}\r\n${line('refs/heads/x', OID_B)}\r\n`
    expect(parseGitHistoryBranches(stdout).map((b) => b.fullName)).toEqual(['refs/heads/x'])
  })
})

describe('loadGitHistoryBranches', () => {
  it('bounds for-each-ref and reports truncation', async () => {
    const calls: string[][] = []
    const rows = Array.from({ length: GIT_HISTORY_BRANCH_LIMIT + 1 }, (_, i) =>
      line(`refs/heads/b${i}`, OID_A)
    )
    const result = await loadGitHistoryBranches(async (args) => {
      calls.push(args)
      return { stdout: rows.join('\n') }
    }, '/repo')

    expect(calls[0]).toContain(`--count=${GIT_HISTORY_BRANCH_LIMIT + 1}`)
    expect(calls[0]).toEqual(expect.arrayContaining(['refs/heads', 'refs/remotes']))
    expect(result.branches).toHaveLength(GIT_HISTORY_BRANCH_LIMIT)
    expect(result.truncated).toBe(true)
  })
})

describe('isGitHistoryBranchRefName', () => {
  it('accepts only branch namespaces and rejects option-like or range input', () => {
    expect(isGitHistoryBranchRefName('refs/heads/main')).toBe(true)
    expect(isGitHistoryBranchRefName('refs/remotes/origin/main')).toBe(true)
    expect(isGitHistoryBranchRefName('main')).toBe(false)
    expect(isGitHistoryBranchRefName('--all')).toBe(false)
    expect(isGitHistoryBranchRefName('refs/heads/a..b')).toBe(false)
    expect(isGitHistoryBranchRefName('refs/heads/')).toBe(false)
    expect(isGitHistoryBranchRefName('refs/tags/v1')).toBe(false)
  })
})
