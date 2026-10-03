import { describe, expect, it } from 'vitest'
import { initialConnectionForm, NO_VPN } from './database-connection-form-state'
import { pendingSshHostVpn, shownVpnProfileId } from './database-ssh-host-vpn'

const base = initialConnectionForm(null, true)
const assignments = { 'ssh-1': 'vpn-office' }

describe('shownVpnProfileId', () => {
  it('shows the connection’s own VPN without an SSH tunnel', () => {
    const form = { ...base, vpnProfileId: 'vpn-home' }
    expect(shownVpnProfileId(form, assignments)).toBe('vpn-home')
  })

  it('shows the SSH host’s saved VPN, then the one picked for it', () => {
    const form = { ...base, sshTargetId: 'ssh-1', vpnProfileId: 'vpn-home' }
    expect(shownVpnProfileId(form, assignments)).toBe('vpn-office')
    const picked = { ...form, sshHostVpn: { targetId: 'ssh-1', profileId: NO_VPN } }
    expect(shownVpnProfileId(picked, assignments)).toBe(NO_VPN)
  })
})

describe('pendingSshHostVpn', () => {
  it('reports a pick that differs from the host’s saved VPN', () => {
    const form = {
      ...base,
      sshTargetId: 'ssh-1',
      sshHostVpn: { targetId: 'ssh-1', profileId: NO_VPN }
    }
    expect(pendingSshHostVpn(form, assignments)).toEqual({ targetId: 'ssh-1', profileId: null })
  })

  it('ignores a pick equal to the saved VPN, made for another host, or without a tunnel', () => {
    const same = { targetId: 'ssh-1', profileId: 'vpn-office' }
    expect(
      pendingSshHostVpn({ ...base, sshTargetId: 'ssh-1', sshHostVpn: same }, assignments)
    ).toBe(null)
    const other = { targetId: 'ssh-2', profileId: 'vpn-home' }
    expect(
      pendingSshHostVpn({ ...base, sshTargetId: 'ssh-1', sshHostVpn: other }, assignments)
    ).toBe(null)
    expect(pendingSshHostVpn({ ...base, sshHostVpn: other }, assignments)).toBe(null)
  })
})
