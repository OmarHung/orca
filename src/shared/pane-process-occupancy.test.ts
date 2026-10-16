import { describe, expect, it } from 'vitest'
import { paneShellOwnsEveryTtyProcessGroup } from './pane-process-occupancy'
import type { ProcessTableRow } from './process-table-snapshot'

function row(overrides: Partial<ProcessTableRow> & Pick<ProcessTableRow, 'pid'>): ProcessTableRow {
  return {
    ppid: 1,
    pgid: 100,
    tpgid: 100,
    tty: 'ttys001',
    stat: 'Ss',
    command: 'zsh -l',
    ...overrides
  }
}

describe('paneShellOwnsEveryTtyProcessGroup', () => {
  it('reads a shell alone in its terminal as owning the pane', () => {
    const shell = row({ pid: 100 })
    expect(paneShellOwnsEveryTtyProcessGroup([shell], shell)).toBe(true)
  })

  it('reads a command in the foreground group as something running', () => {
    const shell = row({ pid: 100, tpgid: 200 })
    const command = row({ pid: 200, ppid: 100, pgid: 200, tpgid: 200, command: 'node dev.js' })
    expect(paneShellOwnsEveryTtyProcessGroup([shell, command], shell)).toBe(false)
  })

  it('reads a backgrounded job on the same terminal as something running', () => {
    const shell = row({ pid: 100 })
    const job = row({ pid: 300, ppid: 100, pgid: 300, tpgid: 100, command: 'vite' })
    expect(paneShellOwnsEveryTtyProcessGroup([shell, job], shell)).toBe(false)
  })

  it('reads a suspended job as something running', () => {
    const shell = row({ pid: 100 })
    const stopped = row({ pid: 300, ppid: 100, pgid: 300, tpgid: 100, stat: 'T', command: 'vim' })
    expect(paneShellOwnsEveryTtyProcessGroup([shell, stopped], shell)).toBe(false)
  })

  it('reads a child that shares the shell group as something running', () => {
    const shell = row({ pid: 100 })
    const child = row({ pid: 101, ppid: 100, tty: undefined, tpgid: undefined, command: 'sleep 9' })
    expect(paneShellOwnsEveryTtyProcessGroup([shell, child], shell)).toBe(false)
  })

  it('reads a capture without process groups as unknown, never as owned', () => {
    const shell = row({ pid: 100, pgid: undefined })
    expect(paneShellOwnsEveryTtyProcessGroup([shell], shell)).toBe(false)
  })

  it('reads an idle shell under its login wrapper as owning the pane', () => {
    // Shape captured from a real idle terminal: login holds the tty in its own group.
    const login = row({
      pid: 4709,
      ppid: 1950,
      pgid: 4709,
      tpgid: 4729,
      command: 'login -flpq alice'
    })
    const shell = row({ pid: 4729, ppid: 4709, pgid: 4729, tpgid: 4729, command: '-zsh -l' })
    expect(paneShellOwnsEveryTtyProcessGroup([login, shell], shell)).toBe(true)
  })

  it('still reads a command under the login wrapper as something running', () => {
    const login = row({
      pid: 4709,
      ppid: 1950,
      pgid: 4709,
      tpgid: 4729,
      command: 'login -flpq alice'
    })
    const shell = row({ pid: 4729, ppid: 4709, pgid: 4729, tpgid: 4729, command: '-zsh -l' })
    const command = row({ pid: 4800, ppid: 4729, pgid: 4800, tpgid: 4729, command: 'node dev.js' })
    expect(paneShellOwnsEveryTtyProcessGroup([login, shell, command], shell)).toBe(false)
  })
})
