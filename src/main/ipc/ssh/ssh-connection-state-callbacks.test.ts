import { beforeEach, describe, expect, it, vi } from 'vitest'
import { credentialRequestedForTarget } from './ssh-connect-attempt-registry'
import { createSshConnectionCallbacks } from './ssh-connection-state-callbacks'
import { requestSshCredential } from './ssh-passphrase'

vi.mock('./ssh-passphrase', () => ({ requestSshCredential: vi.fn() }))

describe('SSH credential prompts and eager startup reconnect', () => {
  beforeEach(() => credentialRequestedForTarget.clear())

  it('flags a target whose credential will be asked for again', async () => {
    vi.mocked(requestSshCredential).mockResolvedValue({ value: 'typed', asksAgain: true })
    const { onCredentialRequest } = createSshConnectionCallbacks()

    await expect(onCredentialRequest!('target-1', 'passphrase', '/k', undefined)).resolves.toBe(
      'typed'
    )
    expect(credentialRequestedForTarget.has('target-1')).toBe(true)
  })

  it('leaves a target unflagged when its passphrase is remembered', async () => {
    vi.mocked(requestSshCredential).mockResolvedValue({ value: 'saved', asksAgain: false })
    const { onCredentialRequest } = createSshConnectionCallbacks()

    await expect(onCredentialRequest!('target-1', 'passphrase', '/k', undefined)).resolves.toBe(
      'saved'
    )
    expect(credentialRequestedForTarget.has('target-1')).toBe(false)
  })

  it('does not flag a target for a prompt its superseded attempt abandoned', async () => {
    const controller = new AbortController()
    vi.mocked(requestSshCredential).mockImplementation(async () => {
      controller.abort()
      return { value: null, asksAgain: true }
    })
    const { onCredentialRequest } = createSshConnectionCallbacks()

    await onCredentialRequest!('target-1', 'passphrase', '/k', undefined, controller.signal)
    expect(credentialRequestedForTarget.has('target-1')).toBe(false)
  })
})
