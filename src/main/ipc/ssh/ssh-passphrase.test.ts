import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestSshCredential, submitCredential } from './ssh-passphrase'
import { setSshDesktopHost, type SshDesktopHost } from '../../ssh/application/ssh-desktop-host'
import { resetSshCredentialDeclinesForTests } from '../../ssh/authentication/ssh-credential-decline'
import {
  canRememberSshPassphrase,
  findSavedSshPassphrase,
  settleSubmittedSshPassphrase
} from './ssh-saved-passphrases'

vi.mock('./ssh-saved-passphrases', () => ({
  findSavedSshPassphrase: vi.fn(() => null),
  canRememberSshPassphrase: vi.fn(() => false),
  settleSubmittedSshPassphrase: vi.fn(() => ({ status: 'accepted', remembered: false }))
}))

function credentialHost() {
  const host = {
    publish: vi.fn(() => true),
    hasDocument: () => true,
    reposChanged: () => {},
    onHostResume: () => () => {},
    clearTargetBrowserStorage: async () => {}
  } satisfies SshDesktopHost
  setSshDesktopHost(host)
  return host
}

function sentCredentialRequest(host: ReturnType<typeof credentialHost>): {
  requestId: string
  canRemember: unknown
} {
  const call = host.publish.mock.calls.find(([channel]) => channel === 'ssh:credential-request')
  const payload: unknown = call?.[1]
  const requestId: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'requestId') : null
  if (typeof payload !== 'object' || payload === null || typeof requestId !== 'string') {
    throw new Error('no credential request was sent')
  }
  return { requestId, canRemember: Reflect.get(payload, 'canRemember') }
}

describe('SSH credential requests', () => {
  beforeEach(() => {
    resetSshCredentialDeclinesForTests()
    vi.mocked(findSavedSshPassphrase).mockReturnValue(null)
    vi.mocked(canRememberSshPassphrase).mockReturnValue(false)
    vi.mocked(settleSubmittedSshPassphrase).mockReturnValue({
      status: 'accepted',
      remembered: false
    })
  })

  it('answers a passphrase prompt from a saved passphrase without asking', async () => {
    vi.mocked(findSavedSshPassphrase).mockReturnValue('saved-secret')
    const host = credentialHost()

    const answer = await requestSshCredential('target-1', 'passphrase', '/keys/id_ed25519')

    expect(answer).toEqual({ value: 'saved-secret', asksAgain: false })
    expect(findSavedSshPassphrase).toHaveBeenCalledWith('/keys/id_ed25519')
    expect(host.publish).not.toHaveBeenCalled()
  })

  it('never looks up a saved passphrase for a password prompt', async () => {
    const host = credentialHost()
    const pending = requestSshCredential('target-1', 'password', 'example.com')
    const request = sentCredentialRequest(host)

    expect(findSavedSshPassphrase).toHaveBeenCalledWith(null)
    submitCredential({ requestId: request.requestId, value: 'pw', remember: true })
    await expect(pending).resolves.toEqual({ value: 'pw', asksAgain: true })
  })

  it('keeps the prompt open for a wrong passphrase, then stops asking once it is remembered', async () => {
    vi.mocked(canRememberSshPassphrase).mockReturnValue(true)
    const host = credentialHost()
    const pending = requestSshCredential('target-1', 'passphrase', '/keys/id_rsa')
    const request = sentCredentialRequest(host)
    expect(request.canRemember).toBe(true)

    vi.mocked(settleSubmittedSshPassphrase).mockReturnValueOnce({ status: 'wrong-passphrase' })
    expect(
      submitCredential({ requestId: request.requestId, value: 'bad', remember: true })
    ).toEqual({ status: 'wrong-passphrase' })
    expect(host.publish).not.toHaveBeenCalledWith('ssh:credential-resolved', {
      requestId: request.requestId
    })

    vi.mocked(settleSubmittedSshPassphrase).mockReturnValueOnce({
      status: 'accepted',
      remembered: true
    })
    submitCredential({ requestId: request.requestId, value: 'good', remember: true })

    expect(settleSubmittedSshPassphrase).toHaveBeenLastCalledWith('/keys/id_rsa', 'good', true)
    await expect(pending).resolves.toEqual({ value: 'good', asksAgain: false })
  })
})
