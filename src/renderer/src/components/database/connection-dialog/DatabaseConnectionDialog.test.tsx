// @vitest-environment happy-dom

import { act, createContext, createElement, useContext, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSshVpnStore } from '../../ssh-vpn/ssh-vpn-store'
import { DatabaseConnectionDialog } from './DatabaseConnectionDialog'

const mocks = vi.hoisted(() => ({ labels: new Map<string, string>() }))

vi.mock('@/store', () => {
  const state = (): { sshTargetLabels: Map<string, string> } => ({
    sshTargetLabels: mocks.labels
  })
  return {
    useAppStore: Object.assign(
      (selector: (current: ReturnType<typeof state>) => unknown) => selector(state()),
      { getState: state }
    )
  }
})

// Why: Radix Select needs real pointer events to open; buttons that pick their value are enough here.
const PickContext = createContext<(value: string) => void>(() => {})
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange
  }: {
    children?: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) =>
    createElement(
      'div',
      { 'data-select-value': value },
      createElement(PickContext.Provider, { value: onValueChange }, children)
    ),
  SelectTrigger: ({ 'aria-label': label }: { 'aria-label'?: string }) =>
    createElement('span', { 'data-select-label': label }),
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectItem: function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const pick = useContext(PickContext)
    return createElement('button', { type: 'button', onClick: () => pick(value) }, children)
  }
}))

vi.mock('../../sidebar/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: ({
    mode,
    onOpenChange
  }: {
    mode: 'ssh' | 'server' | null
    onOpenChange: (mode: null) => void
  }) =>
    mode === null
      ? null
      : createElement(
          'form',
          { onSubmit: (event: Event) => event.preventDefault() },
          createElement('button', { type: 'submit' }, 'Stub submit'),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                mocks.labels = new Map([...mocks.labels, ['target-new', 'bastion']])
                onOpenChange(null)
              }
            },
            'Stub save'
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                mocks.labels = new Map([...mocks.labels, ['target-a', 'a'], ['target-b', 'b']])
                onOpenChange(null)
              }
            },
            'Stub add all'
          ),
          createElement(
            'button',
            { type: 'button', onClick: () => onOpenChange(null) },
            'Stub cancel'
          )
        )
}))

const SSH_HINT = 'Host and port are as seen from the SSH host'
const SSH_EMPTY = 'No saved SSH hosts yet.'
const VPN_HINT = 'Host and port are as seen from inside the VPN.'
const VPN_VIA_SSH =
  'With an SSH tunnel, this sets the SSH host’s own VPN, used everywhere Orca connects to that host.'
const OFFICE = { id: 'vpn-0001', name: 'office', ovpnPath: '/vpn/office.ovpn', idleMinutes: 10 }
const HOME = { id: 'vpn-0002', name: 'home', ovpnPath: '/vpn/home.ovpn', idleMinutes: 10 }

let root: Root | null = null
let saveConnection: ReturnType<typeof vi.fn>
let testConnection: ReturnType<typeof vi.fn>
let setAssignment: ReturnType<typeof vi.fn>

beforeEach(() => {
  mocks.labels = new Map()
  useSshVpnStore.setState({ profiles: [], assignments: {} })
  saveConnection = vi.fn(async () => ({ ok: false, error: { message: 'not in this test' } }))
  testConnection = vi.fn(async () => ({ ok: true, value: { serverVersion: '10.5' } }))
  setAssignment = vi.fn(async () => ({ ok: true, value: undefined }))
  vi.stubGlobal('api', {
    database: {
      encryptionStatus: vi.fn(async () => ({ canStorePasswords: true })),
      saveConnection,
      testConnection
    },
    sshVpn: {
      // Why a failing snapshot: it leaves the profiles and assignments each test sets untouched.
      snapshot: vi.fn(async () => ({ ok: false, error: { message: 'not in this test' } })),
      onState: () => () => {},
      onChanged: () => () => {},
      setAssignment
    }
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function renderDialog(onClose: () => void = vi.fn()): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<DatabaseConnectionDialog existing={null} onClose={onClose} />)
  })
  // Why: Radix attaches its document pointerdown listener on a setTimeout(0).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function selectFor(label: string): HTMLElement {
  const select = document
    .querySelector(`[data-select-label="${label}"]`)
    ?.closest<HTMLElement>('[data-select-value]')
  if (!select) {
    throw new Error(`No select "${label}"`)
  }
  return select
}

function selectValue(label: string): string | undefined {
  return selectFor(label).dataset.selectValue
}

async function pick(label: string, option: string): Promise<void> {
  const button = [...selectFor(label).querySelectorAll('button')].find(
    (candidate) => candidate.textContent === option
  )
  if (!button) {
    throw new Error(`No option "${option}" in "${label}"`)
  }
  await act(async () => {
    button.click()
  })
}

async function clickButton(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) {
    throw new Error(`No button "${text}"`)
  }
  await act(async () => {
    button.click()
  })
}

describe('DatabaseConnectionDialog', () => {
  it('stays open when the user clicks outside it', async () => {
    const onClose = vi.fn()
    await renderDialog(onClose)

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
      )
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from the Cancel button', async () => {
    const onClose = vi.fn()
    await renderDialog(onClose)

    await clickButton('Cancel')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tunnels through the SSH host added from the SSH tunnel list', async () => {
    await renderDialog()
    expect(document.body.textContent).toContain(SSH_EMPTY)

    await clickButton('Add SSH host…')
    await clickButton('Stub save')

    expect(document.body.textContent).toContain(SSH_HINT)
    expect(document.body.textContent).not.toContain('Stub save')
  })

  it('keeps the tunnel choice when adding an SSH host is cancelled', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub cancel')

    expect(document.body.textContent).toContain(SSH_EMPTY)
    expect(document.body.textContent).not.toContain('Removed SSH host')
  })

  it('picks no host when several were added at once', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub add all')

    expect(document.body.textContent).not.toContain(SSH_HINT)
  })

  it('saves the VPN picked for a direct connection, and drops it once an SSH tunnel is picked', async () => {
    useSshVpnStore.setState({ profiles: [OFFICE] })
    mocks.labels = new Map([['ssh-1', 'bastion']])
    await renderDialog()
    expect(document.body.textContent).not.toContain(VPN_HINT)

    await clickButton('office')
    expect(document.body.textContent).toContain(VPN_HINT)
    await clickButton('Save')
    expect(saveConnection.mock.calls[0]?.[0]).toMatchObject({
      draft: { vpnProfileId: 'vpn-0001', sshTunnel: null }
    })

    await clickButton('bastion')
    expect(document.body.textContent).toContain(VPN_VIA_SSH)
    expect(selectValue('VPN')).toBe('none')
    await clickButton('Save')
    expect(saveConnection.mock.calls[1]?.[0]).toMatchObject({
      draft: { vpnProfileId: null, sshTunnel: { targetId: 'ssh-1' } }
    })
    expect(setAssignment).not.toHaveBeenCalled()
  })

  it('shows the SSH host’s own VPN and saves a new pick to that host', async () => {
    useSshVpnStore.setState({ profiles: [OFFICE, HOME], assignments: { 'ssh-1': OFFICE.id } })
    mocks.labels = new Map([['ssh-1', 'bastion']])
    await renderDialog()

    await pick('SSH tunnel', 'bastion')
    expect(selectValue('VPN')).toBe(OFFICE.id)
    await pick('VPN', 'home')
    expect(selectValue('VPN')).toBe(HOME.id)
    await clickButton('Save')

    expect(setAssignment).toHaveBeenCalledWith({ targetId: 'ssh-1', profileId: HOME.id })
    expect(saveConnection.mock.calls[0]?.[0]).toMatchObject({
      draft: { vpnProfileId: null, sshTunnel: { targetId: 'ssh-1' } }
    })
  })

  it('applies the SSH host’s VPN pick before testing the connection', async () => {
    useSshVpnStore.setState({ profiles: [OFFICE], assignments: { 'ssh-1': OFFICE.id } })
    mocks.labels = new Map([['ssh-1', 'bastion']])
    await renderDialog()

    await pick('SSH tunnel', 'bastion')
    await pick('VPN', 'None — connect directly')
    await clickButton('Test Connection')

    expect(setAssignment).toHaveBeenCalledWith({ targetId: 'ssh-1', profileId: null })
    expect(setAssignment.mock.invocationCallOrder[0]).toBeLessThan(
      testConnection.mock.invocationCallOrder[0] ?? 0
    )
  })

  it('shows the next SSH host’s own VPN, dropping the pick made for the previous one', async () => {
    useSshVpnStore.setState({ profiles: [OFFICE, HOME], assignments: { 'ssh-1': OFFICE.id } })
    mocks.labels = new Map([
      ['ssh-1', 'bastion'],
      ['ssh-2', 'jump']
    ])
    await renderDialog()

    await pick('SSH tunnel', 'bastion')
    await pick('VPN', 'home')
    await pick('SSH tunnel', 'jump')
    expect(selectValue('VPN')).toBe('none')
    await clickButton('Save')

    expect(setAssignment).not.toHaveBeenCalled()
    expect(saveConnection).toHaveBeenCalledTimes(1)
  })

  it('does not save the connection when the SSH host’s VPN cannot be changed', async () => {
    setAssignment.mockResolvedValue({
      ok: false,
      error: { message: 'This VPN profile no longer exists' }
    })
    useSshVpnStore.setState({ profiles: [OFFICE] })
    mocks.labels = new Map([['ssh-1', 'bastion']])
    await renderDialog()

    await pick('SSH tunnel', 'bastion')
    await pick('VPN', 'office')
    await clickButton('Save')

    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('This VPN profile no longer exists')
  })

  it('does not save the connection when the SSH host form is submitted', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub submit')

    expect(saveConnection).not.toHaveBeenCalled()
  })
})
