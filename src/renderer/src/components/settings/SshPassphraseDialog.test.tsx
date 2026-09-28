// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshCredentialSubmitResult } from '../../../../shared/ssh-saved-passphrase-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import type { SshCredentialRequest } from '../../store/slices/ssh'
import { SshPassphraseDialog } from './SshPassphraseDialog'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const submitCredential =
  vi.fn<
    (args: {
      requestId: string
      value: string | null
      remember?: boolean
    }) => Promise<SshCredentialSubmitResult>
  >()

function showRequest(request: Partial<SshCredentialRequest> = {}): void {
  useAppStore.setState({
    sshTargetLabels: new Map([['target-1', 'FC-Beta']]),
    sshCredentialQueue: [
      {
        requestId: 'request-1',
        targetId: 'target-1',
        kind: 'passphrase',
        detail: '/Users/me/.ssh/chandra',
        canRemember: true,
        ...request
      }
    ]
  })
}

async function submitPassphrase(value: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), { target: { value } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  })
}

describe('SshPassphraseDialog remembering a passphrase', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    submitCredential.mockReset()
    toastError.mockReset()
    Object.assign(window, { api: { ssh: { submitCredential } } })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ sshCredentialQueue: [] })
  })

  it('sends the remember choice and closes once the passphrase is saved', async () => {
    submitCredential.mockResolvedValue({ status: 'accepted', remembered: true })
    showRequest()
    render(<SshPassphraseDialog />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember passphrase' }))
    await submitPassphrase('right')

    expect(submitCredential).toHaveBeenCalledWith({
      requestId: 'request-1',
      value: 'right',
      remember: true
    })
    expect(useAppStore.getState().sshCredentialQueue).toEqual([])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and flags the input when the passphrase is wrong', async () => {
    submitCredential.mockResolvedValue({ status: 'wrong-passphrase' })
    showRequest()
    render(<SshPassphraseDialog />)

    await submitPassphrase('wrong')

    expect(screen.getByRole('alert').textContent).toBe("That passphrase doesn't unlock this key.")
    const input = screen.getByPlaceholderText('Enter passphrase')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(useAppStore.getState().sshCredentialQueue).toHaveLength(1)

    fireEvent.change(input, { target: { value: 'wrong again' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns when a passphrase it was asked to remember could not be saved', async () => {
    submitCredential.mockResolvedValue({ status: 'accepted', remembered: false })
    showRequest()
    render(<SshPassphraseDialog />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember passphrase' }))
    await submitPassphrase('right')

    expect(toastError).toHaveBeenCalledWith(
      "The passphrase couldn't be saved, so Orca will ask for it next time."
    )
  })

  it('offers no remember option when main cannot seal the passphrase or for passwords', async () => {
    submitCredential.mockResolvedValue({ status: 'accepted', remembered: false })
    showRequest({ canRemember: false })
    const { unmount } = render(<SshPassphraseDialog />)
    expect(screen.queryByRole('checkbox')).toBeNull()

    await submitPassphrase('right')
    expect(submitCredential).toHaveBeenCalledWith({
      requestId: 'request-1',
      value: 'right',
      remember: false
    })
    unmount()

    showRequest({ kind: 'password', canRemember: true })
    render(<SshPassphraseDialog />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
