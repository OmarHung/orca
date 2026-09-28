import { ipcMain, type BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerCredentialHandler,
  requestCredential,
  requestSshCredential
} from './ssh-passphrase'
import {
  canRememberSshPassphrase,
  findSavedSshPassphrase,
  settleSubmittedSshPassphrase
} from './ssh-saved-passphrases'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

vi.mock('./ssh-saved-passphrases', () => ({
  findSavedSshPassphrase: vi.fn(() => null),
  canRememberSshPassphrase: vi.fn(() => false),
  settleSubmittedSshPassphrase: vi.fn(() => ({ status: 'accepted', remembered: false }))
}))

function credentialWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
}

function sentCredentialRequest(window: BrowserWindow): {
  requestId: string
  canRemember: unknown
} {
  const payload: unknown = vi.mocked(window.webContents.send).mock.calls[0]?.[1]
  const requestId: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'requestId') : null
  if (typeof payload !== 'object' || payload === null || typeof requestId !== 'string') {
    throw new Error('no credential request was sent')
  }
  return { requestId, canRemember: Reflect.get(payload, 'canRemember') }
}

type SubmitArgs = { requestId: string; value: string | null; remember?: boolean }

function submitHandler(): (args: SubmitArgs) => unknown {
  registerCredentialHandler()
  const call = vi.mocked(ipcMain.handle).mock.calls.findLast(([channel]) => {
    return channel === 'ssh:submitCredential'
  })
  if (!call) {
    throw new Error('ssh:submitCredential was not registered')
  }
  const handler = call[1]
  return (args) => Reflect.apply(handler, undefined, [{}, args])
}

describe('SSH credential requests', () => {
  beforeEach(() => {
    vi.mocked(findSavedSshPassphrase).mockReturnValue(null)
    vi.mocked(canRememberSshPassphrase).mockReturnValue(false)
    vi.mocked(settleSubmittedSshPassphrase).mockReturnValue({
      status: 'accepted',
      remembered: false
    })
  })

  it('resolves and removes the renderer prompt when its connection aborts', async () => {
    const window = credentialWindow()
    const controller = new AbortController()
    const pending = requestCredential(
      () => window,
      'target-1',
      'keyboard-interactive',
      'Duo response',
      undefined,
      controller.signal
    )
    const request = sentCredentialRequest(window)

    controller.abort()

    await expect(pending).resolves.toBeNull()
    expect(window.webContents.send).toHaveBeenLastCalledWith('ssh:credential-resolved', {
      requestId: request.requestId
    })
  })

  it('answers a passphrase prompt from a saved passphrase without asking', async () => {
    vi.mocked(findSavedSshPassphrase).mockReturnValue('saved-secret')
    const window = credentialWindow()

    const answer = await requestSshCredential(
      () => window,
      'target-1',
      'passphrase',
      '/keys/id_ed25519'
    )

    expect(answer).toEqual({ value: 'saved-secret', asksAgain: false })
    expect(findSavedSshPassphrase).toHaveBeenCalledWith('/keys/id_ed25519')
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('never looks up a saved passphrase for a password prompt', async () => {
    const window = credentialWindow()
    const pending = requestSshCredential(() => window, 'target-1', 'password', 'example.com')
    const request = sentCredentialRequest(window)

    expect(findSavedSshPassphrase).toHaveBeenCalledWith(null)
    await submitHandler()({ requestId: request.requestId, value: 'pw', remember: true })
    await expect(pending).resolves.toEqual({ value: 'pw', asksAgain: true })
  })

  it('keeps the prompt open for a wrong passphrase, then stops asking once it is remembered', async () => {
    vi.mocked(canRememberSshPassphrase).mockReturnValue(true)
    const window = credentialWindow()
    const pending = requestSshCredential(() => window, 'target-1', 'passphrase', '/keys/id_rsa')
    const request = sentCredentialRequest(window)
    expect(request.canRemember).toBe(true)
    const submit = submitHandler()

    vi.mocked(settleSubmittedSshPassphrase).mockReturnValueOnce({ status: 'wrong-passphrase' })
    expect(await submit({ requestId: request.requestId, value: 'bad', remember: true })).toEqual({
      status: 'wrong-passphrase'
    })
    expect(window.webContents.send).not.toHaveBeenCalledWith('ssh:credential-resolved', {
      requestId: request.requestId
    })

    vi.mocked(settleSubmittedSshPassphrase).mockReturnValueOnce({
      status: 'accepted',
      remembered: true
    })
    await submit({ requestId: request.requestId, value: 'good', remember: true })

    expect(settleSubmittedSshPassphrase).toHaveBeenLastCalledWith('/keys/id_rsa', 'good', true)
    await expect(pending).resolves.toEqual({ value: 'good', asksAgain: false })
  })
})
