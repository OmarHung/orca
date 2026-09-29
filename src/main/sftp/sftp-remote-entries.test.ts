import { describe, expect, it } from 'vitest'
import { ownerFromLongname } from './sftp-remote-entries'

describe('ownerFromLongname', () => {
  it('reads the owner column of the ls -l style line OpenSSH sends', () => {
    expect(
      ownerFromLongname('-rw-r--r--    1 deploy   www-data      571 Apr 11  2021 .bashrc', 1000)
    ).toBe('deploy')
    expect(
      ownerFromLongname('drwx------    2 root     root         4096 Sep 29 13:31 .ssh', 0)
    ).toBe('root')
  })

  it('falls back to the uid when the line is not in ls -l form', () => {
    expect(ownerFromLongname('a.txt', 1000)).toBe('1000')
    expect(ownerFromLongname('', 0)).toBe('0')
  })
})
