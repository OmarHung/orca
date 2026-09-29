import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readOvpnProfileFile } from './ovpn-profile-files'

describe('readOvpnProfileFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-vpn-files-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads regular files', async () => {
    writeFileSync(join(dir, 'client.ovpn'), 'client\n')

    await expect(readOvpnProfileFile(join(dir, 'client.ovpn'))).resolves.toEqual(
      Buffer.from('client\n')
    )
  })

  it('refuses directories, devices and files over 1 MB before reading them', async () => {
    writeFileSync(join(dir, 'huge.crt'), Buffer.alloc(1024 * 1024 + 1))

    await expect(readOvpnProfileFile(dir)).rejects.toThrow('not a regular file')
    await expect(readOvpnProfileFile(join(dir, 'huge.crt'))).rejects.toThrow('larger than 1 MB')
    if (process.platform !== 'win32') {
      await expect(readOvpnProfileFile('/dev/zero')).rejects.toThrow('not a regular file')
    }
  })
})
