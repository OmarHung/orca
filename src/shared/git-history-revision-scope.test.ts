import { describe, expect, it } from 'vitest'
import { loadGitHistoryFromExecutor, type GitHistoryExecutor } from './git-history'

const HEAD_OID = 'a'.repeat(40)
const OTHER_OID = 'd'.repeat(40)

function record(hash: string, message: string): string {
  return `${[hash, 'Ada', 'ada@example.com', '1700000000', '1700000000', '', '', '', message].join('\n')}\0`
}

function createExecutor(options: { unborn?: boolean } = {}): {
  executor: GitHistoryExecutor
  calls: string[][]
} {
  const calls: string[][] = []
  const executor: GitHistoryExecutor = async (args) => {
    calls.push(args)
    const [command] = args
    if (command === 'rev-parse' && args.includes('HEAD^{commit}')) {
      if (options.unborn) {
        throw new Error('unborn')
      }
      return { stdout: `${HEAD_OID}\n` }
    }
    if (command === 'rev-parse' && args.includes('refs/heads/other^{commit}')) {
      return { stdout: `${OTHER_OID}\n` }
    }
    if (command === 'rev-parse') {
      throw new Error('unknown revision')
    }
    if (command === 'symbolic-ref') {
      return { stdout: 'main\n' }
    }
    if (command === 'for-each-ref' && args.includes('refs/heads/main')) {
      return { stdout: '' }
    }
    if (command === 'for-each-ref') {
      return {
        stdout: [
          ['refs/heads/main', HEAD_OID, '*', ''].join('\0'),
          ['refs/heads/other', OTHER_OID, ' ', ''].join('\0')
        ].join('\n')
      }
    }
    if (command === 'log') {
      return { stdout: record(args.includes(OTHER_OID) ? OTHER_OID : HEAD_OID, 'commit') }
    }
    throw new Error(`unexpected git command: ${args.join(' ')}`)
  }
  return { executor, calls }
}

function logCall(calls: string[][]): string[] | undefined {
  return calls.find((args) => args[0] === 'log')
}

describe('git history revision scope', () => {
  it('logs HEAD and reports the head scope by default', async () => {
    const { executor, calls } = createExecutor()
    const result = await loadGitHistoryFromExecutor(executor, '/repo', {})
    expect(result.revisionScope).toBe('head')
    expect(result.refs).toBeUndefined()
    expect(logCall(calls)).toContain(HEAD_OID)
  })

  it('logs a chosen branch by its resolved oid, never the raw name', async () => {
    const { executor, calls } = createExecutor()
    const result = await loadGitHistoryFromExecutor(executor, '/repo', {
      revision: 'refs/heads/other'
    })
    expect(result.revisionScope).toBe('ref')
    expect(logCall(calls)).toContain(OTHER_OID)
    expect(logCall(calls)).not.toContain('refs/heads/other')
    expect(result.items[0]?.id).toBe(OTHER_OID)
  })

  it('logs every branch when allBranches wins over revision', async () => {
    const { executor, calls } = createExecutor()
    const result = await loadGitHistoryFromExecutor(executor, '/repo', {
      allBranches: true,
      revision: 'refs/heads/other'
    })
    expect(result.revisionScope).toBe('all')
    expect(logCall(calls)).toEqual(expect.arrayContaining(['--branches', '--remotes', 'HEAD']))
  })

  it('rejects option-like or unknown revisions before running git log', async () => {
    const { executor, calls } = createExecutor()
    await expect(
      loadGitHistoryFromExecutor(executor, '/repo', { revision: '--output=/tmp/x' })
    ).rejects.toThrow('Not a branch')
    await expect(
      loadGitHistoryFromExecutor(executor, '/repo', { revision: 'refs/heads/missing' })
    ).rejects.toThrow('Branch not found')
    expect(logCall(calls)).toBeUndefined()
  })

  it('returns the branch list only when asked', async () => {
    const { executor } = createExecutor()
    const result = await loadGitHistoryFromExecutor(executor, '/repo', { includeRefs: true })
    expect(result.refs?.branches.map((branch) => [branch.name, branch.isHead])).toEqual([
      ['main', true],
      ['other', false]
    ])
  })

  it('still logs a chosen branch when HEAD is unborn', async () => {
    const { executor, calls } = createExecutor({ unborn: true })
    const result = await loadGitHistoryFromExecutor(executor, '/repo', {
      revision: 'refs/heads/other',
      includeRefs: true
    })
    expect(result.items[0]?.id).toBe(OTHER_OID)
    expect(result.refs?.branches).toHaveLength(2)
    expect(logCall(calls)).not.toContain('HEAD')
  })
})
