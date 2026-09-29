import { describe, expect, it, vi } from 'vitest'
import type { SshVpnProfile } from '../../shared/ssh-vpn-types'
import { SshVpnLogins, type SshVpnLoginPrompt } from './ssh-vpn-logins'

const PROFILE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'Toyota',
  ovpnPath: '/vpn/toyota.ovpn',
  idleMinutes: 10,
  username: 'omar',
  passwordStorage: 'forever'
}

function createLogins(saved: string | null, prompt?: SshVpnLoginPrompt) {
  const vault = {
    get: vi.fn(() => saved),
    remember: vi.fn(),
    forget: vi.fn()
  }
  const store = { saveProfile: vi.fn() }
  const onProfileChanged = vi.fn()
  const logins = new SshVpnLogins({ vault, store, prompt, onProfileChanged })
  return { logins, vault, store, onProfileChanged }
}

describe('SshVpnLogins', () => {
  it('uses the saved password without asking', async () => {
    const prompt = vi.fn()
    const { logins } = createLogins('secret', prompt)

    await expect(logins.startOptions(PROFILE, 'db').credentials?.()).resolves.toEqual({
      username: 'omar',
      password: 'secret'
    })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('asks when nothing is saved and keeps the answer the way the profile says', async () => {
    const prompt = vi.fn(async () => ({ username: 'omar', password: 'typed' }))
    const { logins, vault } = createLogins(null, prompt)

    await expect(logins.startOptions(PROFILE, 'db').credentials?.()).resolves.toEqual({
      username: 'omar',
      password: 'typed'
    })
    expect(prompt).toHaveBeenCalledWith({ profile: PROFILE, hostLabel: 'db', error: null })
    expect(vault.remember).toHaveBeenCalledWith(PROFILE.id, 'forever', 'typed')
  })

  it('after a rejected login, forgets the password and asks again saying why', async () => {
    const prompt = vi.fn(async () => ({ username: 'omar', password: 'fixed' }))
    const { logins, vault } = createLogins('stale', prompt)
    const options = logins.startOptions(PROFILE, null)

    options.onLoginRejected?.()
    await options.credentials?.()

    expect(vault.forget).toHaveBeenCalledWith(PROFILE.id)
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'The VPN server rejected the last username or password.' })
    )
  })

  it('saves a username changed in the prompt, and treats a cancelled prompt as no login', async () => {
    const { logins, store, onProfileChanged } = createLogins(
      null,
      vi.fn(async () => ({ username: 'other', password: 'p' }))
    )
    await logins.startOptions(PROFILE, null).credentials?.()
    expect(store.saveProfile).toHaveBeenCalledWith(
      PROFILE.id,
      expect.objectContaining({ username: 'other' })
    )
    expect(onProfileChanged).toHaveBeenCalled()

    const cancelled = createLogins(
      null,
      vi.fn(async () => null)
    )
    await expect(cancelled.logins.startOptions(PROFILE, null).credentials?.()).resolves.toBeNull()
  })

  it('falls back to keeping the password until quit when the keychain is unavailable', async () => {
    const { logins, vault } = createLogins(
      null,
      vi.fn(async () => ({ username: 'omar', password: 'p' }))
    )
    vault.remember.mockImplementationOnce(() => {
      throw new Error('no keychain')
    })

    await logins.startOptions(PROFILE, null).credentials?.()

    expect(vault.remember).toHaveBeenLastCalledWith(PROFILE.id, 'session', 'p')
  })
})
