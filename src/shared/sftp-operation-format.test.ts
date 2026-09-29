import { describe, expect, it } from 'vitest'
import { countSftpOperations, formatSftpOperation } from './sftp-operation-format'

describe('formatSftpOperation', () => {
  it('writes sftp batch lines with quoted paths and "-" for tolerated errors', () => {
    expect(formatSftpOperation({ op: 'mkdir', path: '/srv/new', keepExisting: false })).toBe(
      'mkdir "/srv/new"'
    )
    expect(formatSftpOperation({ op: 'mkdir', path: '/srv/app', keepExisting: true })).toBe(
      '-mkdir "/srv/app"'
    )
    expect(
      formatSftpOperation({
        op: 'put',
        local: '/Users/me/a b.txt',
        remote: '/srv/a b.txt',
        size: 1
      })
    ).toBe('put "/Users/me/a b.txt" "/srv/a b.txt"')
    expect(formatSftpOperation({ op: 'rm', path: '/srv/報告.txt' })).toBe('rm "/srv/報告.txt"')
  })

  it('escapes quotes, backslashes and newlines so a path cannot fake another line', () => {
    expect(formatSftpOperation({ op: 'rmdir', path: '/srv/a"b\\c\nrm "/etc"' })).toBe(
      'rmdir "/srv/a\\"b\\\\c\\nrm \\"/etc\\""'
    )
  })
})

describe('countSftpOperations', () => {
  it('counts each kind', () => {
    expect(
      countSftpOperations([
        { op: 'rm', path: '/a' },
        { op: 'rm', path: '/b' },
        { op: 'rmdir', path: '/' }
      ])
    ).toMatchObject({ rm: 2, rmdir: 1, put: 0 })
  })
})
