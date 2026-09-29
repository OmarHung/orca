import { describe, expect, it } from 'vitest'
import {
  baseName,
  isRemotePathWithin,
  isValidEntryName,
  localParent,
  remoteJoin,
  remoteParent,
  remoteFolderName,
  resolveRemotePath
} from './sftp-paths'

describe('sftp paths', () => {
  it('walks up remote paths and stops at the root', () => {
    expect(remoteParent('/srv/app/logs')).toBe('/srv/app')
    expect(remoteParent('/srv/')).toBe('/')
    expect(remoteParent('/')).toBe('/')
  })

  it('joins remote names without doubling slashes', () => {
    expect(remoteJoin('/srv', 'app')).toBe('/srv/app')
    expect(remoteJoin('/', 'srv')).toBe('/srv')
  })

  it('walks up local paths on POSIX and Windows and keeps the root', () => {
    expect(localParent('/Users/dev/Downloads')).toBe('/Users/dev')
    expect(localParent('/Users')).toBe('/')
    expect(localParent('C:\\Users\\dev')).toBe('C:\\Users')
    expect(localParent('C:\\Users')).toBe('C:\\')
  })

  it('takes the last segment of either kind of path', () => {
    expect(baseName('/srv/app/log.txt')).toBe('log.txt')
    expect(baseName('C:\\Users\\dev\\report.csv')).toBe('report.csv')
    expect(baseName('/srv/app/')).toBe('app')
  })

  it('accepts only a single real name for new and renamed entries', () => {
    expect(isValidEntryName('backup-2026')).toBe(true)
    expect(isValidEntryName('  ')).toBe(false)
    expect(isValidEntryName('..')).toBe(false)
    expect(isValidEntryName('a/b')).toBe(false)
  })

  it('names a remote folder by its last segment, keeping backslashes in names', () => {
    expect(remoteFolderName('/root/.ssh/')).toBe('.ssh')
    expect(remoteFolderName('/')).toBe('/')
    expect(remoteFolderName('/srv/a\\b')).toBe('a\\b')
  })

  it('resolves typed remote paths against the current folder', () => {
    expect(resolveRemotePath('/srv/app', 'logs')).toBe('/srv/app/logs')
    expect(resolveRemotePath('/srv/app', '../backup/')).toBe('/srv/backup')
    expect(resolveRemotePath('/srv/app', ' /var//www/. ')).toBe('/var/www')
    expect(resolveRemotePath('/srv', '../../..')).toBe('/')
  })

  it('tells whether a remote path is a folder or inside it', () => {
    expect(isRemotePathWithin('/srv/app/sub', '/srv/app')).toBe(true)
    expect(isRemotePathWithin('/srv/app', '/srv/app')).toBe(true)
    expect(isRemotePathWithin('/srv/apps', '/srv/app')).toBe(false)
    expect(isRemotePathWithin('/srv', '/')).toBe(true)
  })
})
