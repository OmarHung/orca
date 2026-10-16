import { describe, expect, it } from 'vitest'
import { paneHoldsOnlyItsShell, paneShellOwnsEveryTtyProcessGroup } from './pane-process-occupancy'
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

describe('paneHoldsOnlyItsShell', () => {
  // Shape captured from a real macOS daemon pane: the PTY's root process is `login`, not the shell.
  const LOGIN_COMMAND =
    '/usr/bin/login -flpq alice /bin/bash --noprofile --norc -p -c exec -l -- "$@" orca-tcc-login /bin/zsh /bin/zsh -l'

  function loginPane(
    tpgid: number,
    extra: ProcessTableRow[] = []
  ): { rows: ProcessTableRow[]; login: ProcessTableRow } {
    const login = row({ pid: 4585, ppid: 1921, pgid: 4585, tpgid, command: LOGIN_COMMAND })
    const shell = row({
      pid: 4616,
      ppid: 4585,
      pgid: 4616,
      tpgid,
      stat: 'S+',
      command: '-/bin/zsh -l'
    })
    return { rows: [login, shell, ...extra], login }
  }

  it('reads an idle shell under the login root as holding nothing else', () => {
    const { rows, login } = loginPane(4616)
    expect(paneHoldsOnlyItsShell(rows, login)).toBe(true)
  })

  it('reads a foreground command under the login root as something running', () => {
    const command = row({ pid: 7000, ppid: 4616, pgid: 7000, tpgid: 7000, command: 'node dev.js' })
    const { rows, login } = loginPane(7000, [command])
    expect(paneHoldsOnlyItsShell(rows, login)).toBe(false)
  })

  it('reads a background job under the login root as something running', () => {
    const job = row({ pid: 7000, ppid: 4616, pgid: 7000, tpgid: 4616, command: 'vite' })
    const { rows, login } = loginPane(4616, [job])
    expect(paneHoldsOnlyItsShell(rows, login)).toBe(false)
  })

  it('reads another member of the login group as something running', () => {
    const stray = row({ pid: 7000, ppid: 4585, pgid: 4585, tpgid: 4616, command: 'sleep 9' })
    const { rows, login } = loginPane(4616, [stray])
    expect(paneHoldsOnlyItsShell(rows, login)).toBe(false)
  })

  it('reads two shells under one login root as unknown, never as idle', () => {
    const second = row({ pid: 4617, ppid: 4585, pgid: 4617, tpgid: 4616, command: '-/bin/zsh -l' })
    const { rows, login } = loginPane(4616, [second])
    expect(paneHoldsOnlyItsShell(rows, login)).toBe(false)
  })

  it('reads a shell that is itself the root as before', () => {
    const shell = row({ pid: 100 })
    expect(paneHoldsOnlyItsShell([shell], shell)).toBe(true)
  })

  it('never looks past a root that is neither a shell nor login', () => {
    const program = row({ pid: 100, tpgid: 200, command: 'node server.js' })
    const shell = row({ pid: 200, ppid: 100, pgid: 200, tpgid: 200, command: 'bash -i' })
    expect(paneHoldsOnlyItsShell([program, shell], program)).toBe(false)
  })
})
