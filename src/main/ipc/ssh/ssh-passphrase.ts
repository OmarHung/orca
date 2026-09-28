import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SshCredentialSubmitResult } from '../../../shared/ssh-saved-passphrase-types'
import { SSH_CREDENTIAL_TIMEOUT_MS } from '../../ssh/connection/ssh-connection-timing'
import type { SshCredentialKind } from '../../ssh/connection/ssh-connection-callbacks'
import { recordSshCredentialDeclined } from '../../ssh/ssh-credential-decline'
import { normalizeSshKeyPath } from '../../ssh/ssh-saved-passphrase-store'
import {
  canRememberSshPassphrase,
  findSavedSshPassphrase,
  settleSubmittedSshPassphrase
} from './ssh-saved-passphrases'

export type SshCredentialAnswer = {
  value: string | null
  /** False when the value came from, or was just saved to, the remembered passphrases. */
  asksAgain: boolean
}

type PendingRequest = {
  targetId: string
  resolve: (answer: SshCredentialAnswer) => void
  close: () => void
  /** The key a passphrase prompt unlocks; null for every other prompt. */
  keyPath: string | null
}

const pendingRequests = new Map<string, PendingRequest>()

function notifyCredentialResolved(
  getMainWindow: () => BrowserWindow | null,
  requestId: string
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('ssh:credential-resolved', { requestId })
  }
}

export function requestSshCredential(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  kind: SshCredentialKind,
  detail: string,
  echo?: boolean,
  signal?: AbortSignal
): Promise<SshCredentialAnswer> {
  const keyPath = kind === 'passphrase' ? normalizeSshKeyPath(detail) : null
  const saved = signal?.aborted ? null : findSavedSshPassphrase(keyPath)
  if (saved !== null) {
    return Promise.resolve({ value: saved, asksAgain: false })
  }
  const requestId = randomUUID()
  const { promise, resolve } = Promise.withResolvers<SshCredentialAnswer>()
  let timer: ReturnType<typeof setTimeout>
  const finish = (answer: SshCredentialAnswer): void => {
    if (!pendingRequests.delete(requestId)) {
      return
    }
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    notifyCredentialResolved(getMainWindow, requestId)
    resolve(answer)
  }
  const cancelled: SshCredentialAnswer = { value: null, asksAgain: true }
  const onAbort = (): void => finish(cancelled)
  // Teardown abort is not a credential decline; only user cancellation or timeout declines.
  const decline = (): void => {
    if (!pendingRequests.has(requestId)) {
      return
    }
    recordSshCredentialDeclined(targetId, signal)
    finish(cancelled)
    // One Cancel declines the host, including queued prompts that would otherwise open next.
    for (const [otherId, other] of pendingRequests) {
      if (otherId !== requestId && other.targetId === targetId) {
        other.close()
      }
    }
  }
  timer = setTimeout(decline, SSH_CREDENTIAL_TIMEOUT_MS)
  pendingRequests.set(requestId, {
    targetId,
    resolve: (answer) => (answer.value === null ? decline() : finish(answer)),
    close: () => finish(cancelled),
    keyPath
  })
  if (signal?.aborted) {
    finish(cancelled)
    return promise
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    const canRemember = canRememberSshPassphrase(keyPath)
    win.webContents.send('ssh:credential-request', {
      requestId,
      targetId,
      kind,
      detail,
      echo,
      canRemember
    })
  } else {
    finish(cancelled)
  }
  return promise
}

export function requestCredential(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  kind: SshCredentialKind,
  detail: string,
  echo?: boolean,
  signal?: AbortSignal
): Promise<string | null> {
  return requestSshCredential(getMainWindow, targetId, kind, detail, echo, signal).then(
    (answer) => answer.value
  )
}

export function registerCredentialHandler(): void {
  ipcMain.removeHandler('ssh:submitCredential')
  ipcMain.handle(
    'ssh:submitCredential',
    (
      _event,
      args: { requestId: string; value: string | null; remember?: boolean }
    ): SshCredentialSubmitResult => {
      const pending = pendingRequests.get(args.requestId)
      if (!pending) {
        return { status: 'accepted', remembered: false }
      }
      const result = settleSubmittedSshPassphrase(
        pending.keyPath,
        args.value,
        args.remember === true
      )
      if (result.status === 'accepted') {
        pending.resolve({ value: args.value, asksAgain: !result.remembered })
      }
      return result
    }
  )
}
