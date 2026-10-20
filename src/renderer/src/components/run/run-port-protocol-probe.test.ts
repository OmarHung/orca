import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import type { RunPortClaim } from './run-port-claims'

const portProtocol = vi.fn(async ({ port }: { host: string; port: number }) =>
  port === 41443 ? 'https' : port === 41080 ? 'http' : null
)
vi.stubGlobal('window', { api: { debug: { portProtocol } } })

const { probeRunPortProtocols, withProbedProtocol } = await import('./run-port-protocol-probe')
const { useRunPortStore } = await import('./run-port-store')

function workspacePort(port: number, advertisedUrl?: string): WorkspacePort {
  return {
    id: `127.0.0.1:${port}:42`,
    bindHost: '127.0.0.1',
    connectHost: '127.0.0.1',
    port,
    pid: 42,
    protocol: 'http',
    kind: 'workspace',
    owner: {
      worktreeId: 'wt',
      repoId: 'repo',
      displayName: 'wt',
      path: '/repo',
      confidence: 'cwd'
    },
    ...(advertisedUrl ? { advertisedUrl } : {})
  }
}

function scansOf(ports: WorkspacePort[]): Record<string, WorkspacePortScanResult> {
  return { 'local:all': { platform: 'darwin', scannedAt: 0, ports } }
}

const scans = scansOf([workspacePort(41080), workspacePort(41443), workspacePort(4000)])

function claim(ports: number[]): RunPortClaim {
  return { worktreeId: 'wt', attemptId: 'a1', ptyId: null, startedAt: 0, ports }
}

async function settle(): Promise<void> {
  await vi.waitFor(() =>
    expect(Object.values(useRunPortStore.getState().protocolsByPortId)).not.toContain('pending')
  )
}

beforeEach(() => {
  useRunPortStore.setState({ protocolsByPortId: {} })
  portProtocol.mockClear()
})

describe('probeRunPortProtocols', () => {
  it('records the scheme each run port answers a handshake with', async () => {
    probeRunPortProtocols({ 'run:wt\u0000dev': claim([41080, 41443]) }, scans, () => true)
    await settle()

    expect(useRunPortStore.getState().protocolsByPortId).toEqual({
      '127.0.0.1:41080:42': 'http',
      '127.0.0.1:41443:42': 'https'
    })
  })

  it('probes each listener once, and again later when nothing answered', async () => {
    const owners = { 'run:wt\u0000dev': claim([41443, 4000]) }
    probeRunPortProtocols(owners, scans, () => true)
    await settle()
    probeRunPortProtocols(owners, scans, () => true)
    await settle()

    expect(portProtocol.mock.calls.map(([args]) => args.port)).toEqual([41443, 4000, 4000])
  })

  it('skips remote worktrees and ports whose terminal URL already names the scheme', () => {
    probeRunPortProtocols({ 'run:wt\u0000dev': claim([41443]) }, scans, () => false)
    const advertised = scansOf([workspacePort(41443, 'https://localhost:41443')])
    probeRunPortProtocols({ 'run:wt\u0000dev': claim([41443]) }, advertised, () => true)

    expect(portProtocol).not.toHaveBeenCalled()
  })

  it('forgets listeners that went away', () => {
    useRunPortStore.setState({ protocolsByPortId: { '127.0.0.1:3000:7': 'https' } })

    probeRunPortProtocols({}, scans, () => true)

    expect(useRunPortStore.getState().protocolsByPortId).toEqual({})
  })
})

describe('withProbedProtocol', () => {
  it('replaces the scanner guess only once a probe has answered', () => {
    const port = workspacePort(41443)

    expect(withProbedProtocol(port, { [port.id]: 'https' }).protocol).toBe('https')
    expect(withProbedProtocol(port, { [port.id]: 'pending' })).toBe(port)
  })
})
