import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshVpnProfile, SshVpnStartConfirmRequest } from '../../shared/ssh-vpn-types'
import { SshVpnStartApprovals } from './ssh-vpn-start-approvals'

const PROFILE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SshVpnStartApprovals', () => {
  it('sends the commands to the window and resolves with its answer', async () => {
    const sent: SshVpnStartConfirmRequest[] = []
    const approvals = new SshVpnStartApprovals((request) => {
      sent.push(request)
      return true
    })

    const answer = approvals.approve({
      profile: PROFILE,
      hostLabel: 'db',
      commands: ['docker info']
    })
    expect(sent).toEqual([
      {
        requestId: expect.any(String),
        profileName: 'Office',
        hostLabel: 'db',
        commands: ['docker info']
      }
    ])
    approvals.answer(sent[0].requestId, true)

    await expect(answer).resolves.toBe(true)
  })

  it('says no when there is no window, on timeout, and ignores unknown or repeated answers', async () => {
    vi.useFakeTimers()
    const noWindow = new SshVpnStartApprovals(() => false)
    await expect(
      noWindow.approve({ profile: PROFILE, hostLabel: null, commands: [] })
    ).resolves.toBe(false)

    const sent: SshVpnStartConfirmRequest[] = []
    const approvals = new SshVpnStartApprovals((request) => {
      sent.push(request)
      return true
    }, 1_000)
    const answer = approvals.approve({ profile: PROFILE, hostLabel: null, commands: [] })
    approvals.answer('unknown', true)
    await vi.advanceTimersByTimeAsync(1_000)
    approvals.answer(sent[0].requestId, true)

    await expect(answer).resolves.toBe(false)
  })
})
