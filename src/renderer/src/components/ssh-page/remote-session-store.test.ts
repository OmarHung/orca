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
