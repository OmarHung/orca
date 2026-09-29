// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshVpnProfile, SshVpnSnapshot } from '../../../../shared/ssh-vpn-types'
import { SshHostVpnBadge } from './SshHostVpnMenu'
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
  ]
}

const api = {
  snapshot: vi.fn(async () => SNAPSHOT),
  saveProfile: vi.fn(),
  onState: vi.fn(() => () => undefined),
  onChanged: vi.fn(() => () => undefined)
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
