import { describe, expect, it } from 'vitest'
import { commitCompare } from './git-handler-commit-diff-ops'

const COMMIT = 'c'.repeat(40)
const BASE = 'b'.repeat(40)
const PARENT = 'a'.repeat(40)

describe('relay commitCompare with a base commit', () => {
  it('diffs base..commit instead of the first parent', async () => {
    const calls: string[][] = []
    const git = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
      calls.push(args)
      if (args[0] === 'rev-list') {
        return { stdout: `${COMMIT} ${PARENT}\n`, stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: `${BASE}\n`, stderr: '' }
      }
      return { stdout: ':100644 100644 aaa bbb M\0src/a.ts\0', stderr: '' }
    }

    const result = await commitCompare(git, '/repo', COMMIT, BASE)

    expect(result.summary).toMatchObject({ status: 'ready', parentOid: BASE, commitOid: COMMIT })
    expect(calls.find((args) => args[0] === 'diff')?.slice(-3)).toEqual([BASE, COMMIT, '--'])
  })

  it('ignores an unreadable parent list when a base is given', async () => {
    const git = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (args[0] === 'rev-list') {
        throw new Error('bad parents')
      }
      if (args[0] === 'rev-parse') {
        return { stdout: `${args.at(-1)?.startsWith(BASE) ? BASE : COMMIT}\n`, stderr: '' }
      }
      return { stdout: ':100644 100644 aaa bbb M\0src/a.ts\0', stderr: '' }
    }

    const result = await commitCompare(git, '/repo', COMMIT, BASE)

    expect(result.summary).toMatchObject({ status: 'ready', parentOid: BASE, commitOid: COMMIT })
    expect(result.entries).toEqual([{ path: 'src/a.ts', status: 'modified' }])
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
