// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteSessionStore } from './remote-session-store'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import { markPaneDiverged, mirrorToOtherPanes, sendLineToPanes } from './ssh-sync-send'
import { useSshSyncStore } from './ssh-sync-store'

const CTRL_C = '\u0003'
const PROMPT = "deploy@web-1's password: "

const mocks = vi.hoisted(() => {
  const foreground: Record<string, string | null> = {}
  const cursorLines: Record<string, string> = {}
  const fullScreen: Record<string, boolean> = {}
  const paneCounts: Record<string, number> = {}
  const lockedPtys = new Set<string>()
  return {
    lockedPtys,
    foreground,
    cursorLines,
    fullScreen,
    paneCounts,
    writeAccepted: vi.fn(async (): Promise<boolean> => true),
    getForegroundProcess: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      tabsByWorktree: {
        'global-ssh-sessions': ['a', 'b', 'c'].map((id) => ({ id, ptyId: `pty-${id}` }))
      }
    })
  }
}))
vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => 'darwin' }))
vi.mock('@/lib/pane-manager/mobile-driver-state', () => ({
  isPtyLocked: (ptyId: string) => mocks.lockedPtys.has(ptyId)
}))
vi.mock('../terminal-pane/terminal-pane-manager-registry', () => ({
  readTerminalTabScreen: (tabId: string) => ({
    paneCount: mocks.paneCounts[tabId] ?? 1,
    isFullScreen: mocks.fullScreen[tabId] === true
  }),
  readTerminalTabCursorLine: (tabId: string) => mocks.cursorLines[tabId] ?? ''
}))

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function sent(): [string, string][] {
  return mocks.writeAccepted.mock.calls.map((call: unknown[]) => [String(call[0]), String(call[1])])
}

function sentTo(ptyId: string): string[] {
  return sent()
    .filter(([id]) => id === ptyId)
    .map(([, data]) => data)
}

async function type(tabId: string, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    mirrorToOtherPanes(tabId, key)
    await settle()
  }
}

function isFollowing(tabId: string): boolean {
  return useSshSyncStore.getState().lineByTab[tabId]?.isFollowing === true
}

/** Makes host b miss one key while a types it. */
async function missKeyOnB(key: string): Promise<void> {
  mocks.foreground['pty-b'] = 'zsh'
  await type('a', key)
  delete mocks.foreground['pty-b']
}

function holdNextRead(): () => void {
  let release: (value: string) => void = () => undefined
  mocks.getForegroundProcess.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  return () => release('ssh')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lockedPtys.clear()
  for (const record of [mocks.foreground, mocks.cursorLines, mocks.fullScreen, mocks.paneCounts]) {
    for (const key of Object.keys(record)) {
      delete record[key]
    }
  }
  mocks.getForegroundProcess.mockReset()
  mocks.getForegroundProcess.mockImplementation(async (ptyId: string) =>
    Object.hasOwn(mocks.foreground, ptyId) ? mocks.foreground[ptyId] : 'ssh'
  )
  mocks.writeAccepted.mockResolvedValue(true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      pty: {
        writeAccepted: mocks.writeAccepted,
        getForegroundProcess: mocks.getForegroundProcess
      }
    }
  })
  useRemoteSessionStore.setState({
    grid: { tabIds: ['a', 'b', 'c'], layout: 'terminal', dockHeight: 280 }
  })
  useSshSessionLivenessStore.setState({ byTab: {} })
  useSshSyncStore.getState().stop()
  useSshSyncStore.getState().start(['a', 'b', 'c'], 'keystroke')
})

describe('mirrorToOtherPanes', () => {
  it('sends to the other panes, not back to the one typed in', async () => {
    await type('a', 'x')

    expect(sent()).toEqual([
      ['pty-b', 'x'],
      ['pty-c', 'x']
    ])
  })

  it('reads each host’s foreground fresh, and sends nothing to a local shell', async () => {
    mocks.foreground['pty-b'] = 'zsh'

    await type('a', 'x')

    expect(sent()).toEqual([['pty-c', 'x']])
    expect(mocks.getForegroundProcess).toHaveBeenCalledWith('pty-b')
  })

  it('keeps keys in order on each host, however slow one read is', async () => {
    const release = holdNextRead()

    mirrorToOtherPanes('a', '1')
    mirrorToOtherPanes('a', '2')
    await settle()
    release()
    await settle()

    expect(sentTo('pty-b')).toEqual(['1', '2'])
  })

  it('drops keys still queued when sync stops', async () => {
    const release = holdNextRead()

    mirrorToOtherPanes('a', 'x')
    await settle()
    useSshSyncStore.getState().stop()
    release()
    await settle()

    expect(sent()).toEqual([])
  })

  it('does nothing when sync is off', async () => {
    useSshSyncStore.getState().stop()

    await type('a', 'x')

    expect(sent()).toEqual([])
  })

  it('leaves out a host nobody agreed to', async () => {
    useSshSyncStore.getState().start(['a', 'b'], 'keystroke')

    await type('a', 'x')

    expect(sent()).toEqual([['pty-b', 'x']])
  })

  it('keeps what is typed in a pane that never joined to that pane', async () => {
    useSshSyncStore.getState().start(['b', 'c'], 'keystroke')

    await type('a', 'x')

    expect(sent()).toEqual([])
  })

  it('holds back from a host whose screen differs from the source', async () => {
    mocks.fullScreen.b = true

    await type('a', 'x')

    expect(sent()).toEqual([['pty-c', 'x']])
  })

  it('does nothing outside the grid, where sync is paused', async () => {
    useRemoteSessionStore.setState({
      grid: { tabIds: ['b', 'c'], layout: 'terminal', dockHeight: 280 }
    })

    await type('a', 'x')

    expect(sent()).toEqual([])
  })

  it('stops sending to a pane removed from the grid', async () => {
    useRemoteSessionStore.setState({
      grid: { tabIds: ['a', 'c'], layout: 'terminal', dockHeight: 280 }
    })

    await type('a', 'x')

    expect(sent()).toEqual([['pty-c', 'x']])
  })
})

describe('the pane typed in', () => {
  it('sends nothing from a local shell, and leaves the hosts as they were', async () => {
    mocks.foreground['pty-a'] = 'zsh'
    await type('a', 'x', '\r')
    expect(sent()).toEqual([])
    expect(isFollowing('b')).toBe(true)

    delete mocks.foreground['pty-a']
    await type('a', 'y')
    expect(sentTo('pty-b')).toEqual(['y'])
  })

  it('stops hosts holding part of a line when ssh is gone from it, since nobody can finish it', async () => {
    await type('a', 'x')
    mocks.foreground['pty-a'] = 'zsh'

    await type('a', 'y')

    expect(sentTo('pty-b')).toEqual(['x'])
    expect(isFollowing('b')).toBe(false)
  })

  it('sends nothing more of a line once a read fails, even if the next read works', async () => {
    mocks.getForegroundProcess.mockRejectedValueOnce(new Error('gone'))

    mirrorToOtherPanes('a', '1')
    mirrorToOtherPanes('a', '2')
    await settle()

    expect(sent()).toEqual([])
  })

  it('gives up on a read that never answers, without sending that line or blocking the next', async () => {
    vi.useFakeTimers()
    try {
      mocks.getForegroundProcess.mockImplementationOnce(() => new Promise(() => undefined))

      mirrorToOtherPanes('a', '1')
      mirrorToOtherPanes('a', '\r')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(sent()).toEqual([])

      mirrorToOtherPanes('a', CTRL_C)
      mirrorToOtherPanes('a', '2')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(sentTo('pty-b')).toEqual(['2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('forgets an old failed check once its line starts afresh', async () => {
    mocks.foreground['pty-a'] = 'zsh'
    await type('a', 'x')
    delete mocks.foreground['pty-a']
    await type('a', CTRL_C)
    await type('c', 'y')

    await type('a', 'z')

    expect(sentTo('pty-c')).toEqual(['z'])
  })

  it('sends nothing from a split tab, where the source pane is unclear', async () => {
    mocks.paneCounts.a = 2

    await type('a', 'x')

    expect(sent()).toEqual([])
    expect(isFollowing('a')).toBe(false)
  })

  it('sends nothing while a phone is driving it, and asks to be cleared afterwards', async () => {
    mocks.lockedPtys.add('pty-a')
    await type('a', 'x')
    mocks.lockedPtys.clear()

    await type('a', 'y')

    expect(sent()).toEqual([])
  })
})

describe('login prompts', () => {
  it('keeps what is typed at one to that pane, and it follows again after Enter', async () => {
    mocks.cursorLines.a = PROMPT
    await type('a', 'h')
    mocks.cursorLines.a = 'typed with echo on'

    await type('a', 'i', '\r')
    expect(sent()).toEqual([])

    await type('a', 'z')
    expect(sentTo('pty-b')).toEqual(['z'])
  })

  it('holds even when keys were typed ahead of the prompt appearing', async () => {
    await type('a', 'h')
    mocks.cursorLines.a = PROMPT

    await type('a', 'u')

    expect(sentTo('pty-b')).toEqual(['h'])
  })

  it('holds inside tmux or screen too, which look full-screen', async () => {
    mocks.fullScreen.a = true
    mocks.fullScreen.b = true
    mocks.cursorLines.a = PROMPT

    await type('a', 'h')

    expect(sent()).toEqual([])
  })

  it('stops the hosts holding part of a line the prompt interrupted, since nobody will finish it', async () => {
    await type('a', 'l')
    mocks.cursorLines.a = PROMPT

    await type('a', 's', '\r')
    await type('b', 'x', '\r')

    expect(sentTo('pty-b')).toEqual(['l'])
    expect(sentTo('pty-c')).toEqual(['l'])
    expect(isFollowing('c')).toBe(false)
  })

  it('skips a host that is asking, whatever its line holds', async () => {
    await type('a', 'x')
    mocks.cursorLines.b = PROMPT

    await type('a', 'y')

    expect(sentTo('pty-b')).toEqual(['x'])
    expect(sentTo('pty-c')).toEqual(['x', 'y'])
  })

  it('brings back a host that answered its prompt itself', async () => {
    mocks.cursorLines.b = PROMPT
    await type('a', 'x', '\r')
    await type('b', 'p', '\r')
    delete mocks.cursorLines.b

    await type('a', 'y')

    expect(sentTo('pty-b')).toEqual(['y'])
  })
})

describe('a host that misses a key', () => {
  it('gets nothing more of a line it holds part of, not even Enter', async () => {
    await type('a', 'r')
    await missKeyOnB('m')

    await type('a', '\r', 'x')

    expect(sentTo('pty-b')).toEqual(['r'])
    expect(sentTo('pty-c')).toEqual(['r', 'm', '\r', 'x'])
  })

  it('stays stopped when the user agrees to it again, since its line still holds that text', async () => {
    await type('a', 'r')
    await missKeyOnB('m')

    useSshSyncStore.getState().join(['b'])
    await type('a', '\r', '\r')

    expect(sentTo('pty-b')).toEqual(['r'])
  })

  it('stays stopped across lines even if it held none of the one it missed', async () => {
    await missKeyOnB('x')

    await type('a', '\r', 'y', '\r')

    expect(sentTo('pty-b')).toEqual([])
  })

  it('comes back when the user clears its line, starting with the next key', async () => {
    await type('a', 'r')
    await missKeyOnB('m')
    await type('a', '\r')

    await type('b', CTRL_C)
    await type('a', 'x')

    expect(sentTo('pty-b')).toEqual(['r', 'x'])
  })

  it('cannot come back while the others are part way through a line', async () => {
    await missKeyOnB('x')

    await type('b', CTRL_C)
    await type('a', 'y')

    expect(sentTo('pty-b')).toEqual([])
    expect(isFollowing('b')).toBe(false)
  })

  it('does not send what is typed in it while stopped, or count that as clearing it', async () => {
    await missKeyOnB('x')
    await type('a', '\r')
    mocks.writeAccepted.mockClear()

    await type('b', 'r', 'm')

    expect(sent()).toEqual([])
    expect(isFollowing('b')).toBe(false)
  })

  it('does not come back on Enter in a full-screen program, only on Ctrl+C', async () => {
    await missKeyOnB('x')
    await type('a', '\r')
    mocks.fullScreen.b = true

    await type('b', '\r')
    expect(isFollowing('b')).toBe(false)

    await type('b', CTRL_C)
    expect(isFollowing('b')).toBe(true)
  })

  it('treats a write that fails as missing the key', async () => {
    mocks.writeAccepted.mockImplementation(async (...args: unknown[]) => args[0] !== 'pty-b')

    await type('a', 'r')

    expect(isFollowing('b')).toBe(false)
  })

  it('keeps Ctrl+C from a stopped host too, as the dialog says', async () => {
    await missKeyOnB('x')

    await type('a', CTRL_C)

    expect(sentTo('pty-b')).toEqual([])
    expect(sentTo('pty-c')).toEqual(['x', CTRL_C])
  })
})

describe('keys still queued when a line starts afresh', () => {
  it('never reach a host whose line the user just cleared', async () => {
    const release = holdNextRead()
    mirrorToOtherPanes('a', 'x')
    mirrorToOtherPanes('a', '\r')
    await settle()

    mirrorToOtherPanes('b', CTRL_C)
    release()
    await settle()

    expect(sentTo('pty-b')).toEqual([])
    expect(sentTo('pty-c')).toEqual(['x', '\r'])
    expect(isFollowing('b')).toBe(true)
  })

  it('never reach a pane let back in', async () => {
    useSshSyncStore.getState().setExcluded('b', true)
    const release = holdNextRead()
    mirrorToOtherPanes('a', 'x')
    mirrorToOtherPanes('a', '\r')
    await settle()

    useSshSyncStore.getState().setExcluded('b', false)
    release()
    await settle()

    expect(sentTo('pty-b')).toEqual([])
  })

  it('never reach a pane brought back after input that only reached it', async () => {
    const release = holdNextRead()
    mirrorToOtherPanes('a', 'x')
    mirrorToOtherPanes('a', '\r')
    await settle()

    markPaneDiverged('b', 'pasted')
    mirrorToOtherPanes('b', CTRL_C)
    release()
    await settle()

    expect(sentTo('pty-b')).toEqual([])
  })

  it('keep what is typed in a pane behind on them from going out of order', async () => {
    const release = holdNextRead()
    mirrorToOtherPanes('a', 'r')
    await settle()

    mirrorToOtherPanes('b', '\r')
    release()
    await settle()

    expect(sent().filter(([, data]) => data === '\r')).toEqual([])
    expect(sentTo('pty-b')).toEqual([])
    expect(isFollowing('b')).toBe(false)
  })
})

describe('joining', () => {
  it('gives a host nothing until the user clears its line, since nobody saw what it holds', async () => {
    useSshSyncStore.getState().start(['a', 'c'], 'keystroke')
    useSshSyncStore.getState().join(['b'])

    await type('a', 'y', '\r')
    expect(sentTo('pty-b')).toEqual([])

    await type('b', CTRL_C)
    await type('a', 'z')
    expect(sentTo('pty-b')).toEqual(['z'])
  })
})

describe('leaving a pane out', () => {
  it('sends it nothing, and it carries on if its line stayed empty', async () => {
    useSshSyncStore.getState().setExcluded('b', true)
    await type('a', 'x', '\r')
    expect(sentTo('pty-b')).toEqual([])

    useSshSyncStore.getState().setExcluded('b', false)
    await type('a', 'y')
    expect(sentTo('pty-b')).toEqual(['y'])
  })

  it('keeps what is typed in it to it', async () => {
    useSshSyncStore.getState().setExcluded('a', true)

    await type('a', 'x', '\r')

    expect(sent()).toEqual([])
    expect(isFollowing('a')).toBe(true)
  })

  it('stops it if it comes back while the others are mid-line', async () => {
    useSshSyncStore.getState().setExcluded('b', true)
    await type('a', 'x')

    useSshSyncStore.getState().setExcluded('b', false)
    await type('a', 'y', '\r')

    expect(sentTo('pty-b')).toEqual([])
    expect(isFollowing('b')).toBe(false)
  })

  it('stops it if it holds part of a line when left out', async () => {
    await type('a', 'x')

    useSshSyncStore.getState().setExcluded('b', true)
    await type('a', '\r')
    useSshSyncStore.getState().setExcluded('b', false)
    await type('a', 'z')

    expect(sentTo('pty-b')).toEqual(['x'])
  })

  it('stops it if text was left on its line meanwhile, typed or pasted', async () => {
    useSshSyncStore.getState().setExcluded('b', true)
    await type('b', 'x')
    useSshSyncStore.getState().setExcluded('c', true)
    markPaneDiverged('c', 'rm -rf ')
    useSshSyncStore.getState().setExcluded('b', false)
    useSshSyncStore.getState().setExcluded('c', false)

    await type('a', 'z')

    expect(sent()).toEqual([])
  })
})

describe('input that only reached one pane', () => {
  it('does not count Enter in a full-screen program as finishing a line', () => {
    mocks.fullScreen.b = true

    markPaneDiverged('b', 'pasted\r')

    expect(isFollowing('b')).toBe(false)
  })

  it('stops that pane sending or receiving until the user clears it', async () => {
    markPaneDiverged('b', 'pasted without Enter')

    await type('a', 'x')
    await type('b', 'y')

    expect(sentTo('pty-b')).toEqual([])
    expect(sentTo('pty-c')).toEqual(['x'])
  })

  it('changes nothing if it finished a line on an empty one', async () => {
    markPaneDiverged('b', 'uptime\r')

    await type('a', 'x')

    expect(sentTo('pty-b')).toEqual(['x'])
  })

  it('stops the pane if it finished a line the others are still on', async () => {
    await type('a', 'x')
    markPaneDiverged('b', 'uptime\r')

    await type('a', 'y')

    expect(sentTo('pty-b')).toEqual(['x'])
  })
})

describe('reconnecting', () => {
  it('brings a pane back on an empty line, without the tail of what it held', async () => {
    await type('a', 'x')
    useSshSyncStore.getState().markLineEmpty('b')
    await type('a', 'y', '\r')
    expect(sentTo('pty-b')).toEqual(['x'])

    useSshSyncStore.getState().markLineEmpty('b')
    await type('a', 'z')
    expect(sentTo('pty-b')).toEqual(['x', 'z'])
  })
})

describe('ssh started by hand', () => {
  function startSshByHand(tabId: string, now: number): void {
    const { recordForeground } = useSshSessionLivenessStore.getState()
    recordForeground(tabId, 'zsh', now)
    recordForeground(tabId, 'ssh', now + 1)
  }

  beforeEach(() => {
    useSshSessionLivenessStore.getState().recordForeground('b', 'ssh', 1)
  })

  it('holds back from one started after agreeing, until the user agrees again', async () => {
    startSshByHand('b', 2)
    await type('a', 'x', '\r')
    expect(sentTo('pty-b')).toEqual([])

    useSshSyncStore.getState().join(['b'])
    await type('b', CTRL_C)
    await type('a', 'y')
    expect(sentTo('pty-b')).toEqual(['y'])
  })

  it('asks again for the next one: agreeing covered only the one it was shown', async () => {
    startSshByHand('b', 2)
    useSshSyncStore.getState().join(['b'])
    await type('b', CTRL_C)
    startSshByHand('b', 4)

    await type('a', 'z')

    expect(sentTo('pty-b')).toEqual([])
  })

  it('does not let such a pane speak for the others', async () => {
    startSshByHand('b', 2)

    await type('b', 'x')

    expect(sent()).toEqual([])
  })
})

describe('sendLineToPanes', () => {
  beforeEach(() => {
    useSshSyncStore.getState().setMode('line')
  })

  it('sends the line and Enter to every pane, and reports each', async () => {
    const results = await sendLineToPanes('uptime')

    expect(sent()).toEqual([
      ['pty-a', 'uptime\r'],
      ['pty-b', 'uptime\r'],
      ['pty-c', 'uptime\r']
    ])
    expect(results.every(({ decision }) => decision.send)).toBe(true)
  })

  it('says why a host did not get it', async () => {
    mocks.foreground['pty-b'] = 'zsh'

    const results = await sendLineToPanes('uptime')

    expect(sent().map(([ptyId]) => ptyId)).toEqual(['pty-a', 'pty-c'])
    expect(results.find(({ tabId }) => tabId === 'b')?.decision).toEqual({
      send: false,
      reason: 'notSsh'
    })
  })

  it('sends nothing with sync off', async () => {
    useSshSyncStore.getState().stop()

    await expect(sendLineToPanes('uptime')).resolves.toEqual([])
    expect(sent()).toEqual([])
  })

  it('never goes into a full-screen program, where it would be taken as commands', async () => {
    mocks.fullScreen.b = true

    const results = await sendLineToPanes('uptime')

    expect(sent().map(([ptyId]) => ptyId)).toEqual(['pty-a', 'pty-c'])
    expect(results.find(({ tabId }) => tabId === 'b')?.decision).toEqual({
      send: false,
      reason: 'fullScreenMismatch'
    })
  })

  it('reports a write that failed as just that', async () => {
    mocks.writeAccepted.mockImplementation(async (...args: unknown[]) => args[0] !== 'pty-b')

    const results = await sendLineToPanes('uptime')

    expect(results.find(({ tabId }) => tabId === 'b')?.decision).toEqual({
      send: false,
      reason: 'writeFailed'
    })
  })

  it('keeps typing in a pane to it, and skips it until that line ends', async () => {
    await type('b', 'x')
    expect(sent()).toEqual([])

    await sendLineToPanes('first')
    expect(sentTo('pty-b')).toEqual([])

    await type('b', '\r')
    await sendLineToPanes('second')
    expect(sentTo('pty-b')).toEqual(['second\r'])
  })

  it('skips panes holding part of a line typed before switching to it', async () => {
    useSshSyncStore.getState().setMode('keystroke')
    await type('a', 'x')
    useSshSyncStore.getState().setMode('line')

    const results = await sendLineToPanes('uptime')

    expect(results.find(({ tabId }) => tabId === 'b')?.decision).toEqual({
      send: false,
      reason: 'outOfStep'
    })
  })
})
