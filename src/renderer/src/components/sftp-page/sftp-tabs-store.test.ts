// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { useSftpTabsStore } from './sftp-tabs-store'

const web = { id: 'web', label: 'web-prod' }
const db = { id: 'db', label: 'db-prod' }

beforeEach(() => {
  window.localStorage.clear()
  useSftpTabsStore.setState({ tabs: [], activeTabId: null, remotePathByTab: {} })
})

describe('useSftpTabsStore', () => {
  it('opens tabs, including several for the same host, and activates the newest', () => {
    const { openTab } = useSftpTabsStore.getState()
    const first = openTab(web)
    const second = openTab(web)

    const { tabs, activeTabId } = useSftpTabsStore.getState()
    expect(tabs.map((tab) => tab.targetId)).toEqual(['web', 'web'])
    expect(first).not.toBe(second)
    expect(activeTabId).toBe(second)
  })

  it('moves to the right neighbour when the active tab closes, else the left one', () => {
    const { openTab, activateTab, closeTab } = useSftpTabsStore.getState()
    const a = openTab(web)
    const b = openTab(db)
    const c = openTab(web)

    activateTab(b)
    closeTab(b)
    expect(useSftpTabsStore.getState().activeTabId).toBe(c)

    closeTab(c)
    expect(useSftpTabsStore.getState().activeTabId).toBe(a)

    closeTab(a)
    expect(useSftpTabsStore.getState()).toMatchObject({ tabs: [], activeTabId: null })
  })

  it('keeps the active tab when another one closes', () => {
    const { openTab, closeTab } = useSftpTabsStore.getState()
    const a = openTab(web)
    const b = openTab(db)

    closeTab(a)

    expect(useSftpTabsStore.getState().activeTabId).toBe(b)
  })

  it('opens a new tab right after the one it was asked for from', () => {
    const { openTab } = useSftpTabsStore.getState()
    const a = openTab(web)
    const b = openTab(db)

    const copy = openTab(web, a)

    expect(useSftpTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([a, copy, b])
    expect(useSftpTabsStore.getState().activeTabId).toBe(copy)
  })

  it('shows the host in a tab it already has instead of opening another', () => {
    const { openTab, showHost } = useSftpTabsStore.getState()
    const first = openTab(web)
    const dbTab = openTab(db)

    expect(showHost(web)).toBe(first)
    expect(useSftpTabsStore.getState()).toMatchObject({ activeTabId: first })
    expect(useSftpTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([first, dbTab])
  })

  it('stays on the active tab when it is already on the host', () => {
    const { openTab, showHost } = useSftpTabsStore.getState()
    openTab(web)
    const second = openTab(web)

    expect(showHost(web)).toBe(second)
    expect(useSftpTabsStore.getState().tabs).toHaveLength(2)
  })

  it('opens a tab when the host has none', () => {
    const { openTab, showHost } = useSftpTabsStore.getState()
    openTab(db)

    const webTab = showHost(web)

    expect(useSftpTabsStore.getState().tabs.map((tab) => tab.targetId)).toEqual(['db', 'web'])
    expect(useSftpTabsStore.getState().activeTabId).toBe(webTab)
  })

  it('saves the open tabs for the next launch', () => {
    const tabId = useSftpTabsStore.getState().openTab(web)

    expect(JSON.parse(window.localStorage.getItem('orca.sftpTabs') ?? '{}')).toEqual({
      tabs: [{ id: tabId, targetId: 'web', label: 'web-prod' }],
      activeTabId: tabId
    })
  })

  it('tracks the folder of each tab without saving it, and forgets it on close', () => {
    const { openTab, setTabRemotePath, closeTab } = useSftpTabsStore.getState()
    const tabId = openTab(web)

    setTabRemotePath(tabId, '/srv/logs')
    expect(useSftpTabsStore.getState().remotePathByTab).toEqual({ [tabId]: '/srv/logs' })
    expect(window.localStorage.getItem('orca.sftpTabs')).not.toContain('/srv/logs')

    closeTab(tabId)
    expect(useSftpTabsStore.getState().remotePathByTab).toEqual({})
  })
})
