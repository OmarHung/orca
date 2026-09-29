import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SshVpnResult, SshVpnTerminalRoute } from '../../../../shared/ssh-vpn-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { openSshSession } from './ssh-session-actions'
import { buildSshSessionCommand } from './ssh-session-command'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  queueTabStartupCommand: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  toastError: vi.fn(),
  prepareTerminal: vi.fn<(targetId: string) => Promise<SshVpnResult<SshVpnTerminalRoute | null>>>()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeGroupIdByWorktree: { [SSH_SESSIONS_WORKTREE_ID]: 'group-1' },
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand
    })
  }
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const target: SshTarget = {
  id: 'fc-beta',
  label: 'FC-Beta',
  configHost: 'FC-Beta',
  host: '34.81.215.150',
  port: 22,
  username: 'chandra'
}

const VPN_COMMAND =
  "ssh -S none -o 'ProxyCommand=/usr/local/bin/docker exec -i --user tunnel orca-ssh-vpn-t-p nc -w 30 %h %p' FC-Beta"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  vi.stubGlobal('window', { api: { sshVpn: { prepareTerminal: mocks.prepareTerminal } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildSshSessionCommand options', () => {
  it('puts pre-quoted options right after ssh, for aliases and explicit endpoints', () => {
    expect(buildSshSessionCommand(target, ["-o 'X=1'"])).toBe("ssh -o 'X=1' FC-Beta")
    expect(
      buildSshSessionCommand({ ...target, configHost: undefined, port: 2222 }, ["-o 'X=1'"])
    ).toBe("ssh -o 'X=1' -p 2222 chandra@34.81.215.150")
  })
})

describe('openSshSession through a VPN', () => {
  it('starts the VPN first, then shows and types ssh with its ProxyCommand', async () => {
    mocks.prepareTerminal.mockResolvedValue({
      ok: true,
      value: {
        profileName: 'taipei',
        dockerPath: '/usr/local/bin/docker',
        containerName: 'orca-ssh-vpn-t-p'
      }
    })
    const confirm = vi.fn(async () => true)

    await openSshSession(target, confirm)

    expect(mocks.prepareTerminal).toHaveBeenCalledWith('fc-beta')
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        commands: [VPN_COMMAND],
        details: expect.arrayContaining([expect.stringContaining('taipei')])
      })
    )
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', { command: VPN_COMMAND })
  })

  it('types plain ssh for hosts without a VPN', async () => {
    mocks.prepareTerminal.mockResolvedValue({ ok: true, value: null })

    await openSshSession(
      target,
      vi.fn(async () => true)
    )

    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', { command: 'ssh FC-Beta' })
  })

  it('opens nothing and stays quiet when the user declines the VPN start', async () => {
    mocks.prepareTerminal.mockResolvedValue({
      ok: false,
      error: { message: 'VPN "taipei" was not started', declined: true }
    })
    const confirm = vi.fn(async () => true)

    await openSshSession(target, confirm)

    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('reports a VPN that failed to start and opens nothing', async () => {
    mocks.prepareTerminal.mockResolvedValue({
      ok: false,
      error: { message: 'VPN "taipei": Docker is not running' }
    })

    await openSshSession(
      target,
      vi.fn(async () => true)
    )

    expect(mocks.toastError).toHaveBeenCalledWith('VPN "taipei": Docker is not running')
    expect(mocks.createTab).not.toHaveBeenCalled()
  })
})
