// @vitest-environment happy-dom

import { act, createContext, createElement, useContext, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SshVpnProfile,
  SshVpnResult,
  SshVpnSnapshot,
  SshVpnStartConfirmRequest,
  SshVpnStartPreview
} from '../../../../shared/ssh-vpn-types'
import { SshVpnStartConfirmHost } from './SshVpnStartConfirmHost'
import { useSshVpnStore } from './ssh-vpn-store'

// Why: Radix Select needs real pointer events to open; buttons that pick their value are enough here.
const PickContext = createContext<(value: string) => void>(() => {})
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange
  }: {
    children?: ReactNode
    onValueChange: (value: string) => void
  }) => createElement(PickContext.Provider, { value: onValueChange }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectItem: function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const pick = useContext(PickContext)
    return createElement(
      'button',
      { type: 'button', 'data-pick': value, onClick: () => pick(value) },
      children
    )
  }
}))

const OFFICE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10
}
const PINGTUNG: SshVpnProfile = {
  id: 'profile-0002',
  name: 'Pingtung',
  ovpnPath: '/vpn/pingtung.ovpn',
  idleMinutes: 10
}
const SNAPSHOT: SshVpnSnapshot = {
  profiles: [OFFICE, PINGTUNG],
  assignments: { 'fc-beta': OFFICE.id },
  states: [],
  savedPasswordProfileIds: [],
  canStorePasswords: true
}
const REQUEST: SshVpnStartConfirmRequest = {
  requestId: 'r1',
  profileId: OFFICE.id,
  profileName: 'Office',
  hostLabel: 'FC-Beta',
  switchable: true,
  commands: ['docker run office']
}

let deliver: (request: SshVpnStartConfirmRequest) => void = () => undefined
const api = {
  snapshot: vi.fn(async () => ({ ok: true as const, value: SNAPSHOT })),
  previewStart: vi.fn(async (_profileId: string): Promise<SshVpnResult<SshVpnStartPreview>> => ({
    ok: true,
    value: { kind: 'start', commands: ['docker run pingtung'] }
  })),
  answerStart: vi.fn(async () => undefined),
  onState: vi.fn(() => () => undefined),
  onChanged: vi.fn(() => () => undefined),
  onConfirmStart: vi.fn((callback: (request: SshVpnStartConfirmRequest) => void) => {
    deliver = callback
    return () => undefined
  }),
  onCredentialRequest: vi.fn(() => () => undefined)
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('api', { sshVpn: api })
  useSshVpnStore.setState({ profiles: SNAPSHOT.profiles, assignments: SNAPSHOT.assignments })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function ask(request: SshVpnStartConfirmRequest): Promise<void> {
  await act(async () => root.render(<SshVpnStartConfirmHost />))
  await act(async () => deliver(request))
}

function dialogText(): string {
  return document.querySelector('[data-ssh-vpn-start-confirm]')?.textContent ?? ''
}

async function click(selector: string): Promise<void> {
  await act(async () => document.querySelector<HTMLElement>(selector)?.click())
}

describe('SshVpnStartConfirmDialog', () => {
  it("previews another VPN's commands when picked, and approves the host's switch to it", async () => {
    await ask(REQUEST)
    expect(dialogText()).toContain('docker run office')

    await click(`[data-pick="${PINGTUNG.id}"]`)

    expect(api.previewStart).toHaveBeenCalledWith(PINGTUNG.id)
    expect(dialogText()).toContain('Start VPN "Pingtung"?')
    expect(dialogText()).toContain('docker run pingtung')
    expect(dialogText()).not.toContain('docker run office')
    expect(dialogText()).toContain('From now on FC-Beta connects through this VPN.')
    await click('[data-command-confirm-accept]')
    expect(api.answerStart).toHaveBeenCalledWith({
      requestId: 'r1',
      approved: true,
      switchTo: { profileId: PINGTUNG.id, commands: ['docker run pingtung'] }
    })
  })

  it('offers to connect without commands when the picked VPN is already up', async () => {
    api.previewStart.mockResolvedValueOnce({ ok: true, value: { kind: 'ready' } })
    await ask(REQUEST)

    await click(`[data-pick="${PINGTUNG.id}"]`)

    expect(dialogText()).toContain('Connect through VPN "Pingtung"?')
    expect(dialogText()).toContain('This VPN is already connected; nothing needs to run.')
    await click('[data-command-confirm-accept]')
    expect(api.answerStart).toHaveBeenCalledWith({
      requestId: 'r1',
      approved: true,
      switchTo: { profileId: PINGTUNG.id, commands: [] }
    })
  })

  it('approves the asked-about VPN as before when the user switches back to it', async () => {
    await ask(REQUEST)

    await click(`[data-pick="${PINGTUNG.id}"]`)
    await click(`[data-pick="${OFFICE.id}"]`)
    await click('[data-command-confirm-accept]')

    expect(api.answerStart).toHaveBeenCalledWith({ requestId: 'r1', approved: true })
  })

  it('shows why a picked VPN cannot be used and does not allow approving it', async () => {
    api.previewStart.mockResolvedValueOnce({
      ok: false,
      error: { message: 'Docker is not running' }
    })
    await ask(REQUEST)

    await click(`[data-pick="${PINGTUNG.id}"]`)

    expect(dialogText()).toContain('Docker is not running')
    expect(
      document.querySelector<HTMLButtonElement>('[data-command-confirm-accept]')?.disabled
    ).toBe(true)
  })

  it('offers no other VPN for a connection that names its VPN itself', async () => {
    await ask({ ...REQUEST, hostLabel: null, switchable: false })

    expect(document.querySelector('[data-pick]')).toBeNull()
    const cancel = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    )
    await act(async () => cancel?.click())
    expect(api.answerStart).toHaveBeenCalledWith({ requestId: 'r1', approved: false })
  })
})
