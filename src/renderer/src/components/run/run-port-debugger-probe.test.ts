import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import type { RunPortClaim } from './run-port-claims'

const isDebuggerPort = vi.fn(async ({ port }: { host: string; port: number }) => port === 9229)
vi.stubGlobal('window', { api: { debug: { isDebuggerPort } } })

const { probeDebugSessionPorts } = await import('./run-port-debugger-probe')
const { useRunPortStore } = await import('./run-port-store')

function workspacePort(port: number, connectHost = '127.0.0.1'): WorkspacePort {
  return {
    id: `${connectHost}:${port}:42`,
    bindHost: connectHost,
    connectHost,
    port,
    pid: 42,
    protocol: 'http',
    kind: 'workspace',
    owner: { worktreeId: 'wt', repoId: 'repo', displayName: 'wt', path: '/repo', confidence: 'cwd' }
  }
}

const scans: Record<string, WorkspacePortScanResult> = {
  'local:all': {
    platform: 'darwin',
    scannedAt: 0,
    ports: [workspacePort(5173), workspacePort(9229)]
  }
}

function claim(ports: number[]): RunPortClaim {
  return { worktreeId: 'wt', attemptId: 'a1', ptyId: null, startedAt: 0, ports }
}

beforeEach(() => {
  useRunPortStore.setState({ probesByPortId: {} })
  isDebuggerPort.mockClear()
})

describe('probeDebugSessionPorts', () => {
  it('hides a debug session port until its probe answers, then keeps only the program', async () => {
    probeDebugSessionPorts({ 'debug:s1': claim([5173, 9229]) }, scans, () => true)

    expect(useRunPortStore.getState().probesByPortId).toEqual({
      '127.0.0.1:5173:42': 'pending',
      '127.0.0.1:9229:42': 'pending'
    })
    await vi.waitFor(() =>
      expect(useRunPortStore.getState().probesByPortId).toEqual({
        '127.0.0.1:5173:42': 'program',
        '127.0.0.1:9229:42': 'debugger'
      })
    )
  })

  it('never probes a plain run, and probes each listener only once', async () => {
    probeDebugSessionPorts({ 'run:wt\u0000dev': claim([5173, 9229]) }, scans, () => true)
    expect(isDebuggerPort).not.toHaveBeenCalled()

    probeDebugSessionPorts({ 'debug:s1': claim([5173]) }, scans, () => true)
    probeDebugSessionPorts({ 'debug:s1': claim([5173]) }, scans, () => true)
    expect(isDebuggerPort).toHaveBeenCalledTimes(1)
  })

  it('shows the ports of a session on a host Orca cannot probe without asking', () => {
    probeDebugSessionPorts({ 'debug:s1': claim([9229]) }, scans, () => false)

    expect(isDebuggerPort).not.toHaveBeenCalled()
    expect(useRunPortStore.getState().probesByPortId).toEqual({ '127.0.0.1:9229:42': 'program' })
  })

  it('forgets the verdicts of listeners that went away', () => {
    useRunPortStore.setState({ probesByPortId: { '127.0.0.1:3000:7': 'program' } })

    probeDebugSessionPorts({}, scans, () => true)

    expect(useRunPortStore.getState().probesByPortId).toEqual({})
  })
})
