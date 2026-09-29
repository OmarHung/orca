import { describe, expect, it } from 'vitest'
import { resolveSftpDropDir } from './sftp-drop-target'

describe('resolveSftpDropDir', () => {
  it('moves within the remote pane only onto another folder row', () => {
    const sources = ['/srv/app', '/srv/log.txt']
    expect(resolveSftpDropDir('remote', sources, 'remote', '/srv/data', '/srv')).toBe('/srv/data')
    expect(resolveSftpDropDir('remote', sources, 'remote', '/srv/app', '/srv')).toBeNull()
    expect(resolveSftpDropDir('remote', sources, 'remote', null, '/srv')).toBeNull()
  })

  it('never moves within the local pane', () => {
    expect(resolveSftpDropDir('local', ['/a/b'], 'local', '/a/c', '/a')).toBeNull()
  })

  it('transfers across panes into a folder row, else the folder shown', () => {
    expect(resolveSftpDropDir('local', ['/a/b'], 'remote', '/srv/app', '/srv')).toBe('/srv/app')
    expect(resolveSftpDropDir('local', ['/a/b'], 'remote', null, '/srv')).toBe('/srv')
    expect(resolveSftpDropDir('remote', ['/srv/x'], 'local', null, null)).toBeNull()
  })
})
