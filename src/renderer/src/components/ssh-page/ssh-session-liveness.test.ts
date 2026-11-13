import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVENESS_START_GRACE_MS,
  canReconnectInPlace,
  isSshProcess,
  useSshSessionLivenessStore
} from './ssh-session-liveness'

const platform = vi.hoisted(() => ({ current: 'darwin' }))

vi.mock('@/lib/keyboard/shortcut-platform', () => ({ getShortcutPlatform: () => platform.current }))

const T0 = 1_000_000

function observe(foreground: string | null, now: number): void {
  useSshSessionLivenessStore.getState().recordForeground('tab', foreground, now)
}

function liveness(): string | undefined {
  return useSshSessionLivenessStore.getState().byTab.tab?.liveness
}

beforeEach(() => {
  platform.current = 'darwin'
  useSshSessionLivenessStore.setState({ byTab: {} })
})

describe('ssh session liveness', () => {
  it('counts a tab as connected while ssh is in the foreground', () => {
    observe('ssh', T0)

    expect(liveness()).toBe('connected')
  })

  it('reports the end of a session as soon as a shell returns', () => {
    observe('ssh', T0)
    observe('zsh', T0 + 1)

    expect(liveness()).toBe('ended')
  })

  it('reports the end too when a local program replaced the shell afterwards', () => {
    observe('ssh', T0)
    observe('sleep', T0 + 1)

    expect(liveness()).toBe('ended')
  })

  it('gives a new tab time to start its login shell and type the command', () => {
    observe('zsh', T0)
    expect(liveness()).toBe('starting')

    observe('zsh', T0 + LIVENESS_START_GRACE_MS - 1)
    expect(liveness()).toBe('starting')
  })

  it('counts a tab as ended when ssh never showed up, such as an instant refusal', () => {
    observe('zsh', T0)
    observe('zsh', T0 + LIVENESS_START_GRACE_MS)

    expect(liveness()).toBe('ended')
  })

  it('recovers when ssh appears after the grace period, on a slow login shell', () => {
    observe('zsh', T0)
    observe('zsh', T0 + LIVENESS_START_GRACE_MS)
    observe('ssh', T0 + LIVENESS_START_GRACE_MS + 1)

    expect(liveness()).toBe('connected')
  })

  it('draws no conclusion when the foreground cannot be read', () => {
    observe('ssh', T0)
    observe(null, T0 + 1)

    expect(liveness()).toBe('unknown')
  })

  it('still knows ssh ran after an unreadable moment', () => {
    observe('ssh', T0)
    observe(null, T0 + 1)
    observe('zsh', T0 + 2)

    expect(liveness()).toBe('ended')
  })

  it('starts over after a reconnect, so the old ssh does not count', () => {
    observe('ssh', T0)
    observe('zsh', T0 + 1)

    useSshSessionLivenessStore.getState().markStarting('tab', T0 + 2)
    expect(liveness()).toBe('starting')

    observe('zsh', T0 + 3)
    expect(liveness()).toBe('starting')
  })

  it('draws no conclusion from a program it does not know, which may be an ssh wrapper', () => {
    observe('autossh', T0)
    observe('autossh', T0 + LIVENESS_START_GRACE_MS + 1)

    expect(liveness()).toBe('unknown')
  })

  it('never says a session ended on Windows, where the shell stays in front of ssh', () => {
    platform.current = 'win32'

    observe('pwsh.exe', T0)
    observe('pwsh.exe', T0 + LIVENESS_START_GRACE_MS + 1)
    expect(liveness()).toBe('unknown')

    observe('ssh.exe', T0 + LIVENESS_START_GRACE_MS + 2)
    expect(liveness()).toBe('connected')

    observe('pwsh.exe', T0 + LIVENESS_START_GRACE_MS + 3)
    expect(liveness()).toBe('unknown')
  })

  it('notices a new ssh nobody asked Orca for, which may go to another host', () => {
    observe('ssh', T0)
    expect(useSshSessionLivenessStore.getState().byTab.tab.hasManualSsh).toBe(false)

    observe('zsh', T0 + 1)
    observe('ssh', T0 + 2)

    expect(liveness()).toBe('connected')
    expect(useSshSessionLivenessStore.getState().byTab.tab.hasManualSsh).toBe(true)
  })

  it('does not count a reconnect through Orca as manual', () => {
    observe('ssh', T0)
    observe('zsh', T0 + 1)

    useSshSessionLivenessStore.getState().markStarting('tab', T0 + 2)
    observe('ssh', T0 + 3)

    expect(useSshSessionLivenessStore.getState().byTab.tab.hasManualSsh).toBe(false)
  })

  it('counts an ssh first seen after the start grace as manual, since it may not be the one asked for', () => {
    observe('zsh', T0)
    observe('zsh', T0 + LIVENESS_START_GRACE_MS)
    observe('ssh', T0 + LIVENESS_START_GRACE_MS + 1)

    expect(useSshSessionLivenessStore.getState().byTab.tab.hasManualSsh).toBe(true)
  })

  it('still notices a new ssh when a look in between could not be read', () => {
    observe('ssh', T0)
    observe('zsh', T0 + 1)
    observe(null, T0 + 2)
    observe('ssh', T0 + 3)

    expect(useSshSessionLivenessStore.getState().byTab.tab.hasManualSsh).toBe(true)
  })

  it('says at once that an older tab ended, instead of waiting as if it just started', () => {
    useSshSessionLivenessStore
      .getState()
      .recordForeground('tab', 'zsh', T0, T0 - LIVENESS_START_GRACE_MS)

    expect(liveness()).toBe('ended')
  })

  it('still gives a tab opened moments ago time to start', () => {
    useSshSessionLivenessStore.getState().recordForeground('tab', 'zsh', T0, T0 - 1)

    expect(liveness()).toBe('starting')
  })

  it('forgets closed tabs', () => {
    observe('ssh', T0)
    useSshSessionLivenessStore.getState().recordForeground('other', 'ssh', T0)

    useSshSessionLivenessStore.getState().prune(new Set(['other']))

    expect(Object.keys(useSshSessionLivenessStore.getState().byTab)).toEqual(['other'])
  })
})

describe('isSshProcess', () => {
  it('recognizes ssh by name, path and Windows extension only', () => {
    expect(isSshProcess('ssh')).toBe(true)
    expect(isSshProcess('/usr/bin/ssh')).toBe(true)
    expect(isSshProcess('C:\\Windows\\System32\\OpenSSH\\ssh.exe')).toBe(true)
    expect(isSshProcess('sshd')).toBe(false)
    expect(isSshProcess('zsh')).toBe(false)
  })
})

describe('canReconnectInPlace', () => {
  it('allows typing only into a shell, never into a program that would read it', () => {
    expect(canReconnectInPlace('zsh')).toBe(true)
    expect(canReconnectInPlace('pwsh.exe')).toBe(true)
    expect(canReconnectInPlace('vim')).toBe(false)
    expect(canReconnectInPlace('ssh')).toBe(false)
    expect(canReconnectInPlace(null)).toBe(false)
  })
})
