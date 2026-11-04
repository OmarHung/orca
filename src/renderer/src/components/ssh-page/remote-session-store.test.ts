// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RemoteSessionStoreModule from './remote-session-store'

const STORAGE_KEY = 'orca.remoteSessions'
const LEGACY_SFTP_TABS_KEY = 'orca.sftpTabs'

async function loadStore(): Promise<typeof RemoteSessionStoreModule> {
  vi.resetModules()
  return import('./remote-session-store')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('remote grid', () => {
  async function storeWithTabs(...tabIds: string[]) {
    const { useRemoteSessionStore, remoteLayoutForTab } = await loadStore()
    for (const tabId of tabIds) {
      useRemoteSessionStore
        .getState()
        .addSession({ tabId, targetId: tabId, layout: 'terminal', terminalStarted: true })
    }
    return { useRemoteSessionStore, remoteLayoutForTab }
  }

  it('is not a grid until there are two panes', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b')

    useRemoteSessionStore.getState().addToGrid(['a'])
    expect(useRemoteSessionStore.getState().grid).toBeNull()

    useRemoteSessionStore.getState().addToGrid(['a', 'b'])
    expect(useRemoteSessionStore.getState().grid?.tabIds).toEqual(['a', 'b'])
  })

  it('adds to the end, without duplicates, up to nine panes', async () => {
    const { useRemoteSessionStore } = await storeWithTabs()
    const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`)

    useRemoteSessionStore.getState().addToGrid(['t0', 't1'])
    useRemoteSessionStore.getState().addToGrid(['t1', ...eleven])

    const tabIds = useRemoteSessionStore.getState().grid?.tabIds
    expect(tabIds).toEqual(eleven.slice(0, 9))
  })

  it('leaves the grid when only one pane remains', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b', 'c')
    useRemoteSessionStore.getState().addToGrid(['a', 'b', 'c'])

    useRemoteSessionStore.getState().removeFromGrid('a')
    expect(useRemoteSessionStore.getState().grid?.tabIds).toEqual(['b', 'c'])

    useRemoteSessionStore.getState().removeFromGrid('b')
    expect(useRemoteSessionStore.getState().grid).toBeNull()
  })

  it('keeps a removed tab and its session', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b', 'c')
    useRemoteSessionStore.getState().addToGrid(['a', 'b', 'c'])

    useRemoteSessionStore.getState().removeFromGrid('a')

    expect(useRemoteSessionStore.getState().sessions.a.terminalStarted).toBe(true)
  })

  it('drops a closed tab from the grid', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b', 'c')
    useRemoteSessionStore.getState().addToGrid(['a', 'b', 'c'])

    useRemoteSessionStore.getState().prune(new Set(['b', 'c']))
    expect(useRemoteSessionStore.getState().grid?.tabIds).toEqual(['b', 'c'])

    useRemoteSessionStore.getState().prune(new Set(['c']))
    expect(useRemoteSessionStore.getState().grid).toBeNull()
  })

  it('gives every pane one layout, and leaves other tabs theirs', async () => {
    const { useRemoteSessionStore, remoteLayoutForTab } = await storeWithTabs('a', 'b', 'c')
    useRemoteSessionStore.getState().addToGrid(['a', 'b'])

    useRemoteSessionStore.getState().setLayout('a', 'split')
    useRemoteSessionStore.getState().setLayout('c', 'files')

    const { sessions, grid } = useRemoteSessionStore.getState()
    expect(remoteLayoutForTab(sessions, grid, 'a')).toBe('split')
    expect(remoteLayoutForTab(sessions, grid, 'b')).toBe('split')
    expect(remoteLayoutForTab(sessions, grid, 'c')).toBe('files')
  })

  it('gives the panes one dock height, and leaves their own until the grid ends', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b')
    const { remoteDockHeightForTab } = await import('./remote-session-store')
    const height = (tabId: string): number => {
      const { sessions, grid } = useRemoteSessionStore.getState()
      return remoteDockHeightForTab(sessions, grid, tabId)
    }
    useRemoteSessionStore.getState().setDockHeight('a', 400)
    useRemoteSessionStore.getState().addToGrid(['a', 'b'])

    useRemoteSessionStore.getState().setDockHeight('b', 500)
    expect(height('a')).toBe(500)
    expect(height('b')).toBe(500)

    useRemoteSessionStore.getState().clearGrid()
    expect(height('a')).toBe(400)
  })

  it('returns a tab to its own layout after the grid ends', async () => {
    const { useRemoteSessionStore, remoteLayoutForTab } = await storeWithTabs('a', 'b')
    useRemoteSessionStore.getState().setLayout('a', 'files')
    useRemoteSessionStore.getState().addToGrid(['a', 'b'])
    useRemoteSessionStore.getState().setLayout('a', 'split')

    useRemoteSessionStore.getState().clearGrid()

    const { sessions, grid } = useRemoteSessionStore.getState()
    expect(remoteLayoutForTab(sessions, grid, 'a')).toBe('files')
  })

  it('comes back after a reload', async () => {
    const { useRemoteSessionStore } = await storeWithTabs('a', 'b')
    useRemoteSessionStore.getState().addToGrid(['a', 'b'])
    useRemoteSessionStore.getState().setLayout('a', 'split')

    const reloaded = await loadStore()

    expect(reloaded.useRemoteSessionStore.getState().grid).toMatchObject({
      tabIds: ['a', 'b'],
      layout: 'split'
    })
  })

  it('reads sessions saved before grids existed', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessions: [
          {
            tabId: 'a',
            targetId: 'web',
            layout: 'terminal',
            dockHeight: 280,
            terminalStarted: true
          }
        ]
      })
    )

    const { useRemoteSessionStore } = await loadStore()

    expect(useRemoteSessionStore.getState().sessions.a.targetId).toBe('web')
    expect(useRemoteSessionStore.getState().grid).toBeNull()
  })

  it('ignores a saved grid it cannot trust, and keeps the sessions', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessions: [
          {
            tabId: 'a',
            targetId: 'web',
            layout: 'terminal',
            dockHeight: 280,
            terminalStarted: true
          }
        ],
        grid: { tabIds: ['a'], layout: 'nonsense' }
      })
    )

    const { useRemoteSessionStore } = await loadStore()

    expect(useRemoteSessionStore.getState().sessions.a).toBeDefined()
    expect(useRemoteSessionStore.getState().grid).toBeNull()
  })
})

describe('remote session store', () => {
  it('remembers a tab’s host and layout across reloads, but not its folder', async () => {
    const first = await loadStore()
    const store = first.useRemoteSessionStore.getState()
    store.addSession({ tabId: 'tab-1', targetId: 'web', layout: 'files', terminalStarted: false })
    store.setRemotePath('tab-1', '/var/log')

    const reloaded = await loadStore()
    const state = reloaded.useRemoteSessionStore.getState()

    expect(state.sessions['tab-1']).toMatchObject({
      targetId: 'web',
      layout: 'files',
      terminalStarted: false
    })
    expect(state.remotePathByTab).toEqual({})
  })

  it('treats a tab with no record as a running terminal, because older tabs have one', async () => {
    const { remoteSessionForTab, useRemoteSessionStore } = await loadStore()

    const session = remoteSessionForTab(useRemoteSessionStore.getState().sessions, 'old-tab')

    expect(session).toMatchObject({
      tabId: 'old-tab',
      targetId: '',
      layout: 'terminal',
      terminalStarted: true
    })
  })

  it('keeps the host of a record-less tab empty when its layout changes', async () => {
    const { useRemoteSessionStore } = await loadStore()

    useRemoteSessionStore.getState().setLayout('old-tab', 'split')

    expect(useRemoteSessionStore.getState().sessions['old-tab']).toMatchObject({
      targetId: '',
      layout: 'split',
      terminalStarted: true
    })
  })

  it('forgets closed tabs and keeps the rest', async () => {
    const { useRemoteSessionStore } = await loadStore()
    const store = useRemoteSessionStore.getState()
    store.addSession({ tabId: 'a', targetId: 'web', layout: 'terminal', terminalStarted: true })
    store.addSession({ tabId: 'b', targetId: 'db', layout: 'files', terminalStarted: false })
    store.setRemotePath('a', '/srv')
    store.setRemotePath('b', '/tmp')

    useRemoteSessionStore.getState().prune(new Set(['b']))

    const state = useRemoteSessionStore.getState()
    expect(Object.keys(state.sessions)).toEqual(['b'])
    expect(state.remotePathByTab).toEqual({ b: '/tmp' })
  })

  it('drops stored records it cannot trust and keeps the valid ones', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessions: [
          { tabId: 'ok', targetId: 'web', layout: 'split', dockHeight: 300, terminalStarted: true },
          { tabId: 'bad-layout', targetId: 'web', layout: 'grid', dockHeight: 300 },
          { tabId: 'bad-height', targetId: 'web', layout: 'files', dockHeight: -1 },
          'not an object'
        ]
      })
    )

    const { useRemoteSessionStore } = await loadStore()

    expect(Object.keys(useRemoteSessionStore.getState().sessions)).toEqual(['ok'])
  })

  it('starts empty when storage holds corrupt JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')

    const { useRemoteSessionStore } = await loadStore()

    expect(useRemoteSessionStore.getState().sessions).toEqual({})
  })
})

describe('findSessionTabOnHost', () => {
  it('prefers the active tab, then the first tab on that host in strip order', async () => {
    const { findSessionTabOnHost, remoteSessionForTab } = await loadStore()
    const sessions = {
      a: { ...remoteSessionForTab({}, 'a'), targetId: 'db' },
      b: { ...remoteSessionForTab({}, 'b'), targetId: 'web' },
      c: { ...remoteSessionForTab({}, 'c'), targetId: 'web' }
    }

    expect(findSessionTabOnHost(sessions, ['a', 'c', 'b'], 'b', 'web')).toBe('b')
    expect(findSessionTabOnHost(sessions, ['a', 'c', 'b'], 'a', 'web')).toBe('c')
    expect(findSessionTabOnHost(sessions, ['a', 'c', 'b'], 'a', 'api')).toBeNull()
  })
})

describe('legacy SFTP tabs', () => {
  it('reads the tabs the old SFTP page saved, and they are gone once cleared', async () => {
    window.localStorage.setItem(
      LEGACY_SFTP_TABS_KEY,
      JSON.stringify({
        tabs: [
          { id: 'old-1', targetId: 'web', label: 'web-prod' },
          { id: 'old-2', targetId: 'db' },
          { id: 'old-3', targetId: 'db', label: 'db-prod' }
        ],
        activeTabId: 'old-3'
      })
    )
    const { clearLegacySftpTabs, readLegacySftpTabs } = await loadStore()

    expect(readLegacySftpTabs()).toEqual({
      tabs: [
        { targetId: 'web', label: 'web-prod', wasActive: false },
        { targetId: 'db', label: 'db-prod', wasActive: true }
      ]
    })

    clearLegacySftpTabs()

    expect(readLegacySftpTabs()).toEqual({ tabs: [] })
  })

  it('finds nothing when the old key is missing or corrupt', async () => {
    const { readLegacySftpTabs } = await loadStore()
    expect(readLegacySftpTabs()).toEqual({ tabs: [] })

    window.localStorage.setItem(LEGACY_SFTP_TABS_KEY, '{not json')
    expect(readLegacySftpTabs()).toEqual({ tabs: [] })
  })
})
