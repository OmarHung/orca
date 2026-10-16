import { describe, expect, it } from 'vitest'
import { resolveRemoteForegroundEvidence } from './agent-foreground-process-batch'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'

const metadata = {
  ptyId: 'pty-1',
  ptyIncarnationId: 'inc-1',
  authorityGeneration: 'host-a',
  observationEpoch: 1,
  capturedAgeMs: 0,
  platform: 'linux' as const
}

describe('host-stamped remote foreground resolver', () => {
  it('attests an idle shell when the PTY root is the macOS login wrapper', () => {
    const tty = 'ttys003'
    const rows = [
      {
        pid: 4585,
        ppid: 1921,
        pgid: 4585,
        tpgid: 4616,
        tty,
        startTime: 'login-start',
        stat: 'Ss',
        command: '/usr/bin/login -flpq alice /bin/bash --noprofile --norc -p -c exec /bin/zsh -l'
      },
      {
        pid: 4616,
        ppid: 4585,
        pgid: 4616,
        tpgid: 4616,
        tty,
        startTime: 'shell-start',
        stat: 'S+',
        command: '-/bin/zsh -l'
      }
    ] satisfies ProcessTableRow[]
    const evidence = resolveRemoteForegroundEvidence(
      { rootPid: 4585, fallbackProcess: 'login' },
      { ...metadata, platform: 'darwin' },
      rows
    )
    expect(evidence).toMatchObject({
      verdict: 'live',
      processName: null,
      shellOwnsEveryTtyProcessGroup: true
    })
  })
})
