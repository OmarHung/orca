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

/** A local host's answer: the name is null for an idle shell and for an ordinary command. */
function owned(shellOwnsEveryTtyProcessGroup: boolean): TerminalProcessInspection {
  return {
    foregroundProcess: null,
    hasChildProcesses: !shellOwnsEveryTtyProcessGroup,
    foregroundProcessEvidence: {
      verdict: 'live',
      processName: null,
      fence: {
        platform: 'posix',
        shellPid: 100,
        shellStartTime: 'start',
        tty: '/dev/ttys001',
        foregroundPgid: 100
      },
      shellOwnsEveryTtyProcessGroup,
      ...observation
    }
  }
}

const noWait = async (): Promise<void> => {}

describe('restoredRunVerdict', () => {
  it('reads an idle pane as ended, even though no process name is reported', () => {
    expect(restoredRunVerdict(owned(true))).toBe('ended')
  })

  it('reads a pane with a command in it as running, named or not', () => {
    expect(restoredRunVerdict(owned(false))).toBe('running')
  })

  it('reads a host that predates the ownership flag as unknown, not as ended', () => {
    const withoutFlag: TerminalProcessInspection = {
      foregroundProcess: null,
      hasChildProcesses: false,
      foregroundProcessEvidence: {
        verdict: 'live',
        processName: null,
        fence: {
          platform: 'posix',
          shellPid: 100,
          shellStartTime: 'start',
          tty: '/dev/ttys001',
          foregroundPgid: 100
        },
        ...observation
      }
    }
    expect(restoredRunVerdict(withoutFlag)).toBe('unknown')
  })

  it('falls back to the name for a host with no evidence at all', () => {
    expect(restoredRunVerdict({ foregroundProcess: 'zsh', hasChildProcesses: false })).toBe('ended')
    expect(restoredRunVerdict({ foregroundProcess: 'node', hasChildProcesses: true })).toBe(
      'running'
    )
  })

  it('never reads an unobservable host as an ended run', () => {
    expect(restoredRunVerdict(clientOnlyUnverifiableInspection('transport_loss'))).toBe('unknown')
    expect(
      restoredRunVerdict({
        foregroundProcess: null,
        hasChildProcesses: false,
        foregroundProcessEvidence: { verdict: 'unverifiable', reason: 'stale', ...observation }
      })
    ).toBe('unknown')
  })
})

describe('verifyRestoredRun', () => {
  it('ends a run once the pane is idle on two reads in a row', async () => {
    const inspect = vi.fn(async () => owned(true))
    await expect(verifyRestoredRun(inspect, noWait)).resolves.toBe('ended')
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('does not end a run on a single idle read between busy ones', async () => {
    const reads = [false, true, false, false].map(owned)
    const inspect = vi.fn(async () => reads.shift() ?? owned(false))
    await expect(verifyRestoredRun(inspect, noWait)).resolves.toBe('running')
  })

  it('ends a run after a compound command briefly hands the pane back to the shell', async () => {
    const reads = [false, true, true].map(owned)
    const inspect = vi.fn(async () => reads.shift() ?? owned(true))
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
