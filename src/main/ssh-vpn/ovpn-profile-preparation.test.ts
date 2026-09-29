import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OvpnProfileError, prepareOvpnProfile, tokenizeOvpnLine } from './ovpn-profile-preparation'

const PROFILE_PATH = path.resolve('/vpn/office/client.ovpn')

function reader(files: Record<string, string>): (filePath: string) => Promise<Buffer> {
  return async (filePath) => {
    const content = files[filePath]
    if (content === undefined) {
      throw new Error('ENOENT: no such file or directory')
    }
    return Buffer.from(content)
  }
}

describe('tokenizeOvpnLine', () => {
  it('splits on whitespace and honours quotes, escapes and trailing comments', () => {
    expect(tokenizeOvpnLine('remote vpn.example.com 1194 udp')).toEqual([
      'remote',
      'vpn.example.com',
      '1194',
      'udp'
    ])
    expect(tokenizeOvpnLine('ca "my certs/ca.crt"')).toEqual(['ca', 'my certs/ca.crt'])
    expect(tokenizeOvpnLine("ca 'C:\\certs\\ca.crt'")).toEqual(['ca', 'C:\\certs\\ca.crt'])
    expect(tokenizeOvpnLine('ca my\\ certs/ca.crt # comment')).toEqual(['ca', 'my certs/ca.crt'])
    expect(tokenizeOvpnLine('verb 3 ; comment')).toEqual(['verb', '3'])
  })
})

describe('prepareOvpnProfile', () => {
  it('keeps an inline profile unchanged apart from dropped directives', async () => {
    const source = [
      'client',
      'dev tun',
      'remote vpn.example.com 1194',
      'daemon',
      'log /var/log/openvpn.log',
      'script-security 2',
      'up /etc/openvpn/update-resolv-conf',
      '<ca>',
      '-----BEGIN CERTIFICATE-----',
      'up not-a-directive-inside-a-block',
      '-----END CERTIFICATE-----',
      '</ca>'
    ].join('\n')

    const prepared = await prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: source }))

    expect(prepared.files).toEqual([])
    expect(prepared.config).toBe(
      [
        'client',
        'dev tun',
        'remote vpn.example.com 1194',
        '<ca>',
        '-----BEGIN CERTIFICATE-----',
        'up not-a-directive-inside-a-block',
        '-----END CERTIFICATE-----',
        '</ca>',
        ''
      ].join('\n')
    )
  })

  it('copies referenced files next to the profile and rewrites their paths', async () => {
    const caPath = path.resolve('/vpn/office/ca.crt')
    const taPath = path.resolve('/vpn/shared/ta key.pem')
    const source = ['ca ca.crt', 'tls-auth "../shared/ta key.pem" 1', 'cert [inline]'].join('\n')

    const prepared = await prepareOvpnProfile(
      PROFILE_PATH,
      reader({ [PROFILE_PATH]: source, [caPath]: 'CA', [taPath]: 'TA' })
    )

    expect(prepared.files).toEqual([
      { containerPath: '/run/orca/f0-ca.crt', content: Buffer.from('CA') },
      { containerPath: '/run/orca/f1-ta_key.pem', content: Buffer.from('TA') }
    ])
    expect(prepared.config).toBe(
      ['ca /run/orca/f0-ca.crt', 'tls-auth /run/orca/f1-ta_key.pem 1', 'cert [inline]', ''].join(
        '\n'
      )
    )
  })

  it('refuses username/password and MFA profiles with the reasons', async () => {
    const source = ['auth-user-pass', 'static-challenge "Enter OTP" 1'].join('\n')

    await expect(
      prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: source }))
    ).rejects.toThrow(/username\/password login, one-time codes \(MFA\)/)
  })

  it('refuses password-protected keys, inline or referenced', async () => {
    const keyPath = path.resolve('/vpn/office/client.key')
    const inline = ['<key>', '-----BEGIN ENCRYPTED PRIVATE KEY-----', '</key>'].join('\n')
    await expect(
      prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: inline }))
    ).rejects.toThrow(/password-protected/)

    await expect(
      prepareOvpnProfile(
        PROFILE_PATH,
        reader({ [PROFILE_PATH]: 'key client.key', [keyPath]: 'Proc-Type: 4,ENCRYPTED' })
      )
    ).rejects.toThrow(/password-protected/)
  })

  it('names the missing file when a referenced file cannot be read', async () => {
    await expect(
      prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: 'ca missing.crt' }))
    ).rejects.toThrow(OvpnProfileError)
    await expect(
      prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: 'ca missing.crt' }))
    ).rejects.toThrow(path.resolve('/vpn/office/missing.crt'))
  })

  it('refuses an inline block that is never closed', async () => {
    await expect(
      prepareOvpnProfile(PROFILE_PATH, reader({ [PROFILE_PATH]: '<ca>\nCERT' }))
    ).rejects.toThrow(/never closed/)
  })
})
