import { describe, expect, it } from 'vitest'
import { commitCompare } from './git-handler-commit-diff-ops'

const COMMIT = 'c'.repeat(40)
const BASE = 'b'.repeat(40)

describe('relay commitCompare with a base commit', () => {
  it('diffs base..commit without asking for the first parent', async () => {
    const calls: string[][] = []
    const git = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
      calls.push(args)
      if (args[0] === 'rev-parse') {
        return { stdout: `${args.at(-1)?.startsWith(BASE) ? BASE : COMMIT}\n`, stderr: '' }
      }
      if (args.includes('--name-status')) {
        return { stdout: 'M\tsrc/a.ts\n', stderr: '' }
      }
      return { stdout: '1\t1\tsrc/a.ts\n', stderr: '' }
    }

    const result = await commitCompare(git, '/repo', COMMIT, BASE)

    expect(result.summary).toMatchObject({ status: 'ready', parentOid: BASE, commitOid: COMMIT })
    expect(calls.some((args) => args[0] === 'rev-list')).toBe(false)
    expect(calls.find((args) => args.includes('--name-status'))?.slice(-2)).toEqual([BASE, COMMIT])
  })

  it('rejects a base that is not a full object id', async () => {
    const git = async (): Promise<{ stdout: string; stderr: string }> => ({
      stdout: '',
      stderr: ''
    })
    await expect(commitCompare(git, '/repo', COMMIT, 'main')).rejects.toThrow(
      'baseCommitId must be a full git object id'
    )
  })
})
