import type * as RunnerModule from '../runner'
import type * as GitExecFileModule from '../command-runner/git-exec-file'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitRunnerModuleMock } from './status-test-harness'

const { gitExecFileAsyncMock, gitExecFileAsyncBufferMock, gitStreamOptionsMock } = vi.hoisted(
  () => ({
    gitExecFileAsyncMock: vi.fn(),
    gitExecFileAsyncBufferMock: vi.fn(),
    gitStreamOptionsMock: vi.fn()
  })
)

vi.mock('../runner', () =>
  createGitRunnerModuleMock({
    gitExecFileAsyncMock,
    gitExecFileAsyncBufferMock,
    gitStreamOptionsMock
  })
)

vi.mock('../command-runner/git-exec-file', async (importOriginal) => {
  const runnerMocks = await vi.importMock<typeof RunnerModule>('../runner')
  return {
    ...(await importOriginal<typeof GitExecFileModule>()),
    gitExecFileAsync: runnerMocks.gitExecFileAsync,
    gitExecFileAsyncBuffer: runnerMocks.gitExecFileAsyncBuffer
  }
})

import { getCommitCompare } from './commit-compare'

describe('getCommitCompare', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncBufferMock.mockReset()
  })

  it('diffs against a given base commit instead of the first parent', async () => {
    gitExecFileAsyncMock.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') {
        const ref = args.find((arg) => arg.endsWith('^{commit}')) ?? ''
        return Promise.resolve({
          stdout: ref.startsWith('base-id') ? 'base-oid\n' : 'commit-oid\n'
        })
      }
      if (args.includes('--raw')) {
        return Promise.resolve({
          stdout: ':100644 100644 a b M\0src/a.ts\0' + '2\t1\tsrc/a.ts\0'
        })
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    })

    const result = await getCommitCompare('/repo', 'commit-id', {}, 'base-id')

    expect(result.summary).toMatchObject({ parentOid: 'base-oid', commitOid: 'commit-oid' })
    expect(result.entries.map((entry) => entry.path)).toEqual(['src/a.ts'])
    const calls: string[][] = gitExecFileAsyncMock.mock.calls.map(([args]) => args)
    expect(calls.some((args) => args[0] === 'rev-list')).toBe(false)
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['diff', '--raw', '--numstat', '-z', '-M', '-C', 'base-oid', 'commit-oid', '--'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })
})
