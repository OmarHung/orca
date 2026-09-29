import { describe, expect, it } from 'vitest'
import { baseName, isValidEntryName, localParent, remoteJoin, remoteParent } from './sftp-paths'

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
})
