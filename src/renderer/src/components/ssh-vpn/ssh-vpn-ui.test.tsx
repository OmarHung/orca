// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SshVpnCredentialRequest,
  SshVpnProfile,
  SshVpnSnapshot
} from '../../../../shared/ssh-vpn-types'
import { SshHostVpnBadge } from './SshHostVpnMenu'
import { SshVpnLoginPromptHost } from './SshVpnLoginPromptHost'
import { SshVpnProfilesPanel } from './SshVpnProfilesPanel'
import { useSshVpnStore } from './ssh-vpn-store'

const PROFILE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'taipei',
  ovpnPath: '/Users/me/Downloads/taipei.ovpn',
  idleMinutes: 10
}

const SNAPSHOT: SshVpnSnapshot = {
  profiles: [PROFILE],
  assignments: { 'fc-beta': PROFILE.id, 'db-1': PROFILE.id },
  states: [
    {
      profileId: PROFILE.id,
      status: 'error',
      error: 'TLS Error: TLS handshake failed',
      logTail: ['2026-09-29 10:00:00 TLS Error: TLS handshake failed']
    }
  ],
  savedPasswordProfileIds: [],
  canStorePasswords: true
}

const api = {
  snapshot: vi.fn(async () => ({ ok: true as const, value: SNAPSHOT })),
  inspectOvpn: vi.fn(async () => ({ ok: true as const, value: { needsCredentials: false } })),
  listContainers: vi.fn(async () => ({
    ok: true as const,
    value: [{ name: 'vpn-office-1', image: 'openvpn-socks:local', status: 'Up 2 hours (healthy)' }]
  })),
  saveProfile: vi.fn(),
  connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
  onState: vi.fn(() => () => undefined),
  onChanged: vi.fn(() => () => undefined),
  answerCredentials: vi.fn(async () => undefined),
  onCredentialRequest: vi.fn(
    (_callback: (request: SshVpnCredentialRequest) => void) => () => undefined
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('api', { sshVpn: api })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => root.render(node))
}

function setInputValue(id: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) {
    throw new Error(`missing ${id}`)
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) => button.textContent === name)
}

describe('SshHostVpnBadge', () => {
  it('names the VPN a host goes through, with its status, and nothing for direct hosts', async () => {
    useSshVpnStore.setState({
      profiles: [PROFILE],
      assignments: { 'fc-beta': PROFILE.id },
      states: { [PROFILE.id]: { profileId: PROFILE.id, status: 'ready', logTail: [] } }
    })

    await render(
      <>
        <SshHostVpnBadge targetId="fc-beta" />
        <SshHostVpnBadge targetId="direct-host" />
      </>
    )

    const badges = container.querySelectorAll('[data-ssh-host-vpn]')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('taipei')
    expect(
      badges[0].querySelector('[data-ssh-vpn-status]')?.getAttribute('data-ssh-vpn-status')
    ).toBe('ready')
  })
})

describe('SshVpnProfilesPanel', () => {
  it('loads profiles and shows status, host count and the failure', async () => {
    await render(<SshVpnProfilesPanel />)

    const row = container.querySelector(`[data-ssh-vpn-profile="${PROFILE.id}"]`)
    expect(row?.textContent).toContain('taipei')
    expect(row?.textContent).toContain('2 hosts')
    expect(row?.textContent).toContain('TLS Error: TLS handshake failed')
    expect(row?.textContent).toContain('Show OpenVPN log')
  })

  it('shows why a profile could not be saved, inline', async () => {
    api.saveProfile.mockResolvedValue({
      ok: false,
      error: { message: 'This profile needs username/password login' }
    })
    await render(<SshVpnProfilesPanel />)
    const addButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Add VPN profile'
    )
    await act(async () => addButton?.click())

    const setValue = (id: string, value: string): void => {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)
      if (!input) {
        throw new Error(`missing ${id}`)
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => {
      setValue('ssh-vpn-profile-name', '  Office  ')
      setValue('ssh-vpn-profile-path', '/vpn/office.ovpn')
    })
    const form = container.querySelector<HTMLFormElement>('[data-ssh-vpn-profile-form]')
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.saveProfile).toHaveBeenCalledWith({
      draft: { name: 'Office', ovpnPath: '/vpn/office.ovpn', idleMinutes: 10 }
    })
    expect(form?.textContent).toContain('This profile needs username/password login')
  })
})

describe('borrowed VPN containers', () => {
  const BORROWED: SshVpnProfile = {
    id: 'profile-0002',
    kind: 'container',
    name: 'Office (shared)',
    containerName: 'vpn-office-1'
  }

  // Why setState: the store syncs from the snapshot once per test file, already done above.
  beforeEach(() => {
    useSshVpnStore.setState({
      loaded: true,
      profiles: [BORROWED],
      assignments: { 'fc-beta': BORROWED.id },
      states: { [BORROWED.id]: { profileId: BORROWED.id, status: 'ready', logTail: [] } }
    })
  })

  it('shows the container and offers a check instead of a disconnect', async () => {
    await render(<SshVpnProfilesPanel />)

    const row = container.querySelector(`[data-ssh-vpn-profile="${BORROWED.id}"]`)
    expect(row?.textContent).toContain('Container: vpn-office-1')
    expect(row?.textContent).toContain('Started and stopped outside Orca')
    expect(buttonNamed('Disconnect')).toBeUndefined()
    await act(async () => buttonNamed('Check')?.click())
    expect(api.connect).toHaveBeenCalledWith(BORROWED.id)
  })

  it('edits a borrowed profile without asking for an .ovpn', async () => {
    api.saveProfile.mockResolvedValue({ ok: true, value: BORROWED })
    await render(<SshVpnProfilesPanel />)
    await act(async () => buttonNamed('Edit')?.click())

    expect(container.querySelector('#ssh-vpn-profile-path')).toBeNull()
    expect(container.textContent).toContain(
      'docker exec -i --user tunnel vpn-office-1 nc <host> <port>'
    )
    await act(async () => setInputValue('ssh-vpn-profile-name', 'Shared office'))
    await act(async () => {
      container
        .querySelector('[data-ssh-vpn-profile-form]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.saveProfile).toHaveBeenLastCalledWith({
      id: BORROWED.id,
      draft: { kind: 'container', name: 'Shared office', containerName: 'vpn-office-1' }
    })
  })
})

describe('VPN logins', () => {
  it('asks for a username and keeps the password as chosen when the .ovpn needs a login', async () => {
    api.inspectOvpn.mockResolvedValue({ ok: true, value: { needsCredentials: true } })
    api.saveProfile.mockResolvedValue({ ok: true, value: PROFILE })
    await render(<SshVpnProfilesPanel />)
    await act(async () => buttonNamed('Add VPN profile')?.click())
    await act(async () => {
      setInputValue('ssh-vpn-profile-name', 'Toyota')
      setInputValue('ssh-vpn-profile-path', '/vpn/toyota.ovpn')
    })
    await act(async () => {
      document
        .querySelector('#ssh-vpn-profile-path')
        ?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(container.querySelector('[data-ssh-vpn-login-fields]')).not.toBeNull()
    await act(async () => {
      setInputValue('ssh-vpn-login-username', 'omar')
      setInputValue('ssh-vpn-login-password', 'hunter2')
    })
    await act(async () => {
      container
        .querySelector('[data-ssh-vpn-profile-form]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(api.saveProfile).toHaveBeenLastCalledWith({
      draft: {
        name: 'Toyota',
        ovpnPath: '/vpn/toyota.ovpn',
        idleMinutes: 10,
        username: 'omar',
        passwordStorage: 'forever'
      },
      password: 'hunter2'
    })
  })

  it('answers a login request with what was typed, and a dismissal with null', async () => {
    let deliver: (request: SshVpnCredentialRequest) => void = () => undefined
    api.onCredentialRequest.mockImplementation((callback) => {
      deliver = callback
      return () => undefined
    })
    await render(<SshVpnLoginPromptHost />)
    const request: SshVpnCredentialRequest = {
      requestId: 'r1',
      profileName: 'Toyota',
      username: 'omar',
      hostLabel: 'FC-Beta',
      error: 'The VPN server rejected the last username or password.'
    }

    await act(async () => deliver(request))
    expect(document.body.textContent).toContain(
      'The VPN server rejected the last username or password.'
    )
    await act(async () => setInputValue('ssh-vpn-prompt-password', 'fixed'))
    await act(async () => {
      document
        .querySelector('[data-ssh-vpn-login-prompt] form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.answerCredentials).toHaveBeenLastCalledWith({
      requestId: 'r1',
      credentials: { username: 'omar', password: 'fixed' }
    })

    await act(async () => deliver({ ...request, requestId: 'r2' }))
    await act(async () => buttonNamed('Cancel')?.click())
    expect(api.answerCredentials).toHaveBeenLastCalledWith({ requestId: 'r2', credentials: null })
  })
})
