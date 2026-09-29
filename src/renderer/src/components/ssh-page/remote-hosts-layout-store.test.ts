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
  it('shows the host list on both pages by default', async () => {
    const { useRemoteHostsLayout } = await loadStore()

    expect(useRemoteHostsLayout.getState().hostListCollapsed).toEqual({ ssh: false, sftp: false })
  })

  it('collapses one page without touching the other and remembers it across reloads', async () => {
    const first = await loadStore()
    first.useRemoteHostsLayout.getState().toggleHostList('ssh')

    const reloaded = await loadStore()

    expect(reloaded.useRemoteHostsLayout.getState().hostListCollapsed).toEqual({
      ssh: true,
      sftp: false
    })
  })

  it('falls back to defaults when stored data is corrupt', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')

    const { useRemoteHostsLayout } = await loadStore()

    expect(useRemoteHostsLayout.getState().hostListCollapsed).toEqual({ ssh: false, sftp: false })
  })
})
