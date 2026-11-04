// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LayoutStoreModule from './remote-hosts-layout-store'

const STORAGE_KEY = 'orca.remoteHostsLayout'

async function loadStore(): Promise<typeof LayoutStoreModule> {
  vi.resetModules()
  return import('./remote-hosts-layout-store')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('remote hosts layout store', () => {
  it('shows the host list by default', async () => {
    const { useRemoteHostsLayout } = await loadStore()

    expect(useRemoteHostsLayout.getState().isHostListCollapsed).toBe(false)
  })

  it('remembers a collapsed list across reloads', async () => {
    const first = await loadStore()
    first.useRemoteHostsLayout.getState().toggleHostList()

    const reloaded = await loadStore()

    expect(reloaded.useRemoteHostsLayout.getState().isHostListCollapsed).toBe(true)
  })

  it('reads what the separate SSH and SFTP pages saved', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ssh: true, sftp: false }))

    const { useRemoteHostsLayout } = await loadStore()

    expect(useRemoteHostsLayout.getState().isHostListCollapsed).toBe(true)
  })

  it('falls back to showing the list when stored data is corrupt', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')

    const { useRemoteHostsLayout } = await loadStore()

    expect(useRemoteHostsLayout.getState().isHostListCollapsed).toBe(false)
  })
})
