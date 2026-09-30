// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FavoriteFolders from './sftp-favorite-folders'

const KEY = 'orca.sftpFavoriteFolders'

async function loadStore(): Promise<typeof FavoriteFolders> {
  vi.resetModules()
  return import('./sftp-favorite-folders')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SFTP favorite folders', () => {
  it('keeps shared local, per-connection local and remote favorites apart and saves them', async () => {
    const {
      hostLocalFavoritesScope,
      LOCAL_FAVORITES_SCOPE,
      remoteFavoritesScope,
      useSftpFavoriteFolders
    } = await loadStore()
    const { add } = useSftpFavoriteFolders.getState()

    add(LOCAL_FAVORITES_SCOPE, '/Users/dev/uploads')
    add(hostLocalFavoritesScope('web'), '/Users/dev/web-builds')
    add(remoteFavoritesScope('web'), '/var/www')
    add(remoteFavoritesScope('db'), '/var/lib/mysql')

    expect(useSftpFavoriteFolders.getState().foldersByScope).toEqual({
      local: ['/Users/dev/uploads'],
      'local:web': ['/Users/dev/web-builds'],
      'remote:web': ['/var/www'],
      'remote:db': ['/var/lib/mysql']
    })
    const reloaded = await loadStore()
    expect(reloaded.useSftpFavoriteFolders.getState().foldersByScope['remote:web']).toEqual([
      '/var/www'
    ])
  })

  it('adds a folder once and removes only that folder', async () => {
    const { useSftpFavoriteFolders } = await loadStore()
    const { add, remove } = useSftpFavoriteFolders.getState()

    add('local', '/a')
    add('local', '/b')
    add('local', '/a')
    remove('local', '/a')

    expect(useSftpFavoriteFolders.getState().foldersByScope.local).toEqual(['/b'])
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ local: ['/b'] })
  })

  it('ignores stored values that are not lists of folders', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ local: ['/ok', 3, ''], 'remote:web': 'nope', 'remote:db': ['/srv'] })
    )

    const { useSftpFavoriteFolders } = await loadStore()

    expect(useSftpFavoriteFolders.getState().foldersByScope).toEqual({
      local: ['/ok'],
      'remote:db': ['/srv']
    })
  })

  it('starts empty when the stored value is not JSON', async () => {
    window.localStorage.setItem(KEY, '{broken')

    const { useSftpFavoriteFolders } = await loadStore()

    expect(useSftpFavoriteFolders.getState().foldersByScope).toEqual({})
  })
})
