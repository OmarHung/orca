import { describe, expect, it, vi } from 'vitest'
import type { TerminalProcessInspection } from '../../../../shared/terminal-process-inspection'
import { clientOnlyUnverifiableInspection } from '../../../../shared/terminal-process-inspection'
import { restoredRunVerdict, verifyRestoredRun } from './run-restore-verdict'

const observation = {
  authorityGeneration: 'gen',
  observationEpoch: 1,
  capturedAgeMs: 0,
  ptyId: 'pty-1',
  ptyIncarnationId: 'inc-1'
}
const fence = {
  platform: 'posix',
  shellPid: 100,
  shellStartTime: 'start',
  tty: '/dev/ttys001',
  foregroundPgid: 100
} as const

function local(foregroundProcess: string | null): TerminalProcessInspection {
  return { foregroundProcess, hasChildProcesses: false }
}

function remote(processName: string | null): TerminalProcessInspection {
  return {
    foregroundProcess: processName,
    hasChildProcesses: false,
    foregroundProcessEvidence: { verdict: 'live', processName, fence, ...observation }
  }
}

const noWait = async (): Promise<void> => {}

describe('restoredRunVerdict', () => {
  it('reads a shell in front as a run that ended', () => {
    expect(restoredRunVerdict(local('/bin/zsh'))).toBe('ended')
    expect(restoredRunVerdict(remote('bash'))).toBe('ended')
  })

  it('reads any other program in front as a run still going', () => {
    expect(restoredRunVerdict(local('node'))).toBe('running')
    expect(restoredRunVerdict(remote('dotnet'))).toBe('running')
  })

  it('never reads an unobservable host as an ended run', () => {
    expect(restoredRunVerdict(clientOnlyUnverifiableInspection('transport_loss'))).toBe('unknown')
    expect(restoredRunVerdict(local(null))).toBe('unknown')
    expect(
      restoredRunVerdict({
        foregroundProcess: 'zsh',
        hasChildProcesses: false,
        foregroundProcessEvidence: { verdict: 'unverifiable', reason: 'stale', ...observation }
      })
    ).toBe('unknown')
  })
})

describe('verifyRestoredRun', () => {
  it('ends a run once the shell is in front on two reads in a row', async () => {
    const inspect = vi.fn(async () => local('zsh'))
    await expect(verifyRestoredRun(inspect, noWait)).resolves.toBe('ended')
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('does not end a run on a single shell read between busy ones', async () => {
    const reads = ['node', 'zsh', 'node', 'node'].map(local)
    const inspect = vi.fn(async () => reads.shift() ?? local('node'))
    await expect(verifyRestoredRun(inspect, noWait)).resolves.toBe('running')
  })

  it('ends a run after a shell finishes sourcing its rc files', async () => {
    const reads = ['brew', 'zsh', 'zsh'].map(local)
    const inspect = vi.fn(async () => reads.shift() ?? local('zsh'))
    await expect(verifyRestoredRun(inspect, noWait)).resolves.toBe('ended')
  })

  it('gives up without ending the run when the host cannot be read', async () => {
    const failing = vi.fn(async (): Promise<TerminalProcessInspection> => {
      throw new Error('boom')
    })
    await expect(verifyRestoredRun(failing, noWait)).resolves.toBe('unknown')
    const unobservable = vi.fn(async () => clientOnlyUnverifiableInspection('timeout'))
    await expect(verifyRestoredRun(unobservable, noWait)).resolves.toBe('unknown')
    expect(unobservable).toHaveBeenCalledTimes(1)
  })
})
