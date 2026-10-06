import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContainerListener } from '../dotnet-container/dotnet-container-ports'
import { killWorkspacePort } from './workspace-port-ownership'

const scanWorkspacePortsMock = vi.hoisted(() => vi.fn())
const containerPorts = vi.hoisted(() => ({
  forwardedContainerListener: vi.fn(
    (_pid: number, _port: number): ContainerListener | null => null
  ),
  stopForwardedContainerListener: vi.fn(async () => true),
  isContainerPortForwarder: vi.fn(
    (port: { processName?: string }) => port.processName === 'com.docker.backend'
  )
}))

vi.mock('./local-workspace-port-scanner', () => ({
  scanWorkspacePorts: scanWorkspacePortsMock
}))
vi.mock('../dotnet-container/dotnet-container-ports', () => containerPorts)

function workspacePortScan(pid: number, port: number, processName?: string) {
  return {
    platform: 'win32' as const,
    scannedAt: 0,
    ports: [
      {
        id: `127.0.0.1:${port}:${pid}`,
        bindHost: '127.0.0.1',
        connectHost: '127.0.0.1',
        port,
        pid,
        protocol: 'http' as const,
        kind: 'workspace' as const,
        worktreeId: worktrees[0]!.id,
        ...(processName ? { processName } : {})
      }
    ]
  }
}

const worktrees = [{ id: 'repo::/repo', repoId: 'repo', displayName: 'main', path: '/repo' }]

describe('killWorkspacePort', () => {
  afterEach(() => {
    scanWorkspacePortsMock.mockReset()
    vi.restoreAllMocks()
  })

  it("stops a .NET container program inside the container, never Docker's own backend", async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const listener = { port: 5000, pid: 412, cwd: '/repo', commandLine: 'dotnet App.dll' }
    containerPorts.forwardedContainerListener.mockReturnValueOnce(listener)
    scanWorkspacePortsMock.mockResolvedValue(workspacePortScan(900, 5000))

    expect(await killWorkspacePort(worktrees, { pid: 900, port: 5000 })).toEqual({ ok: true })
    expect(containerPorts.forwardedContainerListener).toHaveBeenCalledWith(900, 5000)
    expect(containerPorts.stopForwardedContainerListener).toHaveBeenCalledWith(listener)
    expect(killSpy).not.toHaveBeenCalled()
  })

  it('refuses a Docker-forwarded port it cannot trace into the .NET container', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    scanWorkspacePortsMock.mockResolvedValue(workspacePortScan(900, 5000, 'com.docker.backend'))

    expect(await killWorkspacePort(worktrees, { pid: 900, port: 5000 })).toMatchObject({
      ok: false
    })
    expect(killSpy).not.toHaveBeenCalled()
  })
})
