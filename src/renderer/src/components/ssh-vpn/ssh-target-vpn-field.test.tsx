// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveSshHostVpnDraft, SshTargetVpnField, useSshHostVpnDraft } from './SshTargetVpnField'
import { useSshVpnStore } from './ssh-vpn-store'

const setAssignment = vi.fn(async () => ({ ok: true as const, value: undefined }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('api', {
    sshVpn: {
      snapshot: vi.fn(async () => ({ ok: false as const, error: { message: 'not loaded' } })),
      setAssignment,
      onState: () => () => undefined,
      onChanged: () => () => undefined
    }
  })
  useSshVpnStore.setState({
    profiles: [{ id: 'profile-0001', name: 'Toyota', ovpnPath: '/vpn/t.ovpn', idleMinutes: 10 }],
    assignments: { 'fc-beta': 'profile-0001' }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setAssignment.mockClear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('SshTargetVpnField', () => {
  it("starts from the host's current VPN and saves nothing when unchanged", async () => {
    await act(async () => root.render(<SshTargetVpnField open targetId="fc-beta" />))

    expect(container.textContent).toContain('VPN: Toyota')
    await saveSshHostVpnDraft('fc-beta')
    expect(setAssignment).not.toHaveBeenCalled()
  })

  it('assigns the picked VPN when the form saves', async () => {
    await act(async () => root.render(<SshTargetVpnField open targetId="db-1" />))
    expect(container.textContent).toContain('Direct connection (no VPN)')

    act(() => useSshHostVpnDraft.setState({ profileId: 'profile-0001' }))
    await saveSshHostVpnDraft('db-1')

    expect(setAssignment).toHaveBeenCalledWith({ targetId: 'db-1', profileId: 'profile-0001' })
  })

  it('is disabled while adding a host, which has no id to assign yet', async () => {
    await act(async () => root.render(<SshTargetVpnField open targetId={null} />))

    expect(container.querySelector('#ssh-target-vpn')?.hasAttribute('disabled')).toBe(true)
    expect(container.textContent).toContain('Save the host first')
  })

  it('clears the VPN when the form switches the host back to a direct connection', async () => {
    await act(async () => root.render(<SshTargetVpnField open targetId="fc-beta" />))

    act(() => useSshHostVpnDraft.setState({ profileId: null }))
    await saveSshHostVpnDraft('fc-beta')

    expect(setAssignment).toHaveBeenCalledWith({ targetId: 'fc-beta', profileId: null })
  })
})
