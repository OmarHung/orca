import { describe, expect, it } from 'vitest'
import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import {
  claimNewPorts,
  fastScanInterval,
  liveClaimedPorts,
  PREEXISTING_PORT_SIGHTING,
  recordPortSightings,
  syncPortClaims,
  type RunPortClaim
} from './run-port-claims'

const HOST = 'local:all'

function workspacePort(
  port: number,
  options: { pid?: number; worktreeId?: string; bindHost?: string; advertisedUrl?: string } = {}
): WorkspacePort {
  const pid = options.pid ?? port
  const bindHost = options.bindHost ?? '127.0.0.1'
  return {
    id: `${bindHost}:${port}:${pid}`,
    bindHost,
    connectHost: bindHost === '127.0.0.1' ? '127.0.0.1' : 'localhost',
    port,
    pid,
    protocol: 'http',
    kind: 'workspace',
    owner: {
      worktreeId: options.worktreeId ?? 'wt',
      repoId: 'repo',
      displayName: 'wt',
      path: '/repo',
      confidence: 'cwd'
    },
    ...(options.advertisedUrl ? { advertisedUrl: options.advertisedUrl } : {})
  }
}

function scan(...ports: WorkspacePort[]): WorkspacePortScanResult {
  return { platform: 'darwin', scannedAt: 0, ports }
}

function claim(overrides: Partial<RunPortClaim> = {}): RunPortClaim {
  return {
    worktreeId: 'wt',
    attemptId: 'a1',
    ptyId: null,
    startedAt: 1_000,
    ports: [],
    ...overrides
  }
}

describe('recordPortSightings', () => {
  it('marks every listener in a host first scan as already listening', () => {
    const sightings = recordPortSightings({}, { [HOST]: scan(workspacePort(3000)) }, 5_000)

    expect(sightings[HOST]).toEqual({ '127.0.0.1:3000:3000': PREEXISTING_PORT_SIGHTING })
  })

  it('stamps listeners that appear in a later scan and forgets ones that went away', () => {
    const first = recordPortSightings({}, { [HOST]: scan(workspacePort(3000)) }, 5_000)

    const second = recordPortSightings(first, { [HOST]: scan(workspacePort(5173)) }, 7_000)

    expect(second[HOST]).toEqual({ '127.0.0.1:5173:5173': 7_000 })
  })

  it('stamps a listener that appeared while restored sightings were saved, and keeps unscanned hosts', () => {
    const restored = { [HOST]: { '127.0.0.1:3000:3000': 500 }, 'environment:e1:all': { x: 1 } }

    const next = recordPortSightings(
      restored,
      { [HOST]: scan(workspacePort(3000), workspacePort(50080)) },
      9_000
    )

    expect(next).toEqual({
      [HOST]: { '127.0.0.1:3000:3000': 500, '127.0.0.1:50080:50080': 9_000 },
      'environment:e1:all': { x: 1 }
    })
  })

  it('keeps the previous sightings when a scan failed', () => {
    const first = recordPortSightings({}, { [HOST]: scan(workspacePort(3000)) }, 5_000)
    const failed = { ...scan(), unavailableReason: 'lsof timed out' }

    expect(recordPortSightings(first, { [HOST]: failed }, 7_000)).toBe(first)
  })

  it('returns the same object when nothing changed', () => {
    const scans = { [HOST]: scan(workspacePort(3000)) }
    const first = recordPortSightings({}, scans, 5_000)

    expect(recordPortSightings(first, scans, 9_000)).toBe(first)
  })
})

describe('claimNewPorts', () => {
  it('claims workspace listeners that appeared after the attempt started', () => {
    const old = workspacePort(3000)
    const fresh = workspacePort(5173)
    const scans = { [HOST]: scan(old, fresh) }
    const sightings = { [HOST]: { [old.id]: 500, [fresh.id]: 1_500 } }

    expect(claimNewPorts(claim(), sightings, scans).ports).toEqual([5173])
  })

  it('ignores listeners of another workspace', () => {
    const other = workspacePort(5173, { worktreeId: 'other' })
    const scans = { [HOST]: scan(other) }

    expect(claimNewPorts(claim(), { [HOST]: { [other.id]: 2_000 } }, scans).ports).toEqual([])
  })

  it('claims one port number once even when bound on IPv4 and IPv6', () => {
    const v4 = workspacePort(5173, { bindHost: '127.0.0.1' })
    const v6 = workspacePort(5173, { bindHost: '::1' })
    const scans = { [HOST]: scan(v4, v6) }
    const sightings = { [HOST]: { [v4.id]: 2_000, [v6.id]: 2_000 } }

    expect(claimNewPorts(claim(), sightings, scans).ports).toEqual([5173])
  })

  it('claims nothing new for a session restored after a restart', () => {
    const restored = claim({ startedAt: null, ports: [3000] })
    const fresh = workspacePort(5173)

    const result = claimNewPorts(
      restored,
      { [HOST]: { [fresh.id]: 9_000 } },
      {
        [HOST]: scan(fresh)
      }
    )

    expect(result).toBe(restored)
  })

  it('treats a rerun that binds the same port with a new pid as a new listener', () => {
    const rerun = workspacePort(5173, { pid: 42 })
    const scans = { [HOST]: scan(rerun) }
    const sightings = { [HOST]: { [rerun.id]: 3_000 } }

    const result = claimNewPorts(claim({ attemptId: 'a2', startedAt: 2_500 }), sightings, scans)

    expect(result.ports).toEqual([5173])
  })
})

describe('claimNewPorts with listener terminals', () => {
  // Three runs share one workspace and all started before any of these ports appeared.
  const api = workspacePort(5016, { pid: 11 })
  const admin = workspacePort(4000, { pid: 22 })
  const shop = workspacePort(3000, { pid: 33 })
  const scans = { [HOST]: scan(api, admin, shop) }
  const sightings = { [HOST]: { [api.id]: 5_000, [admin.id]: 5_000, [shop.id]: 5_000 } }
  const terminals: Record<string, string> = {
    [api.id]: 'pty-api',
    [admin.id]: 'pty-admin',
    [shop.id]: 'pty-shop'
  }
  const terminalOf = (port: WorkspacePort): string | null | undefined => terminals[port.id]

  it('gives each run only the listeners under its own terminal', () => {
    const claimed = ['pty-api', 'pty-admin', 'pty-shop'].map(
      (ptyId) => claimNewPorts(claim({ ptyId }), sightings, scans, terminalOf).ports
    )

    expect(claimed).toEqual([[5016], [4000], [3000]])
  })

  it('releases a port it claimed by time once another terminal is seen to hold it', () => {
    const stale = claim({ ptyId: 'pty-api', ports: [5016, 4000, 3000] })

    expect(claimNewPorts(stale, sightings, scans, terminalOf).ports).toEqual([5016])
  })

  it('lets a run restored after a long gap claim its own terminal ports', () => {
    const restored = claim({ ptyId: 'pty-shop', startedAt: null })

    expect(claimNewPorts(restored, sightings, scans, terminalOf).ports).toEqual([3000])
  })

  it('waits while a listener terminal is still being looked up', () => {
    expect(claimNewPorts(claim({ ptyId: 'pty-api' }), sightings, scans, () => undefined)).toEqual(
      claim({ ptyId: 'pty-api' })
    )
  })

  it('falls back to time for a listener outside every terminal, such as a container port', () => {
    const forwarded = workspacePort(50080, { pid: 45 })
    const result = claimNewPorts(
      claim({ ptyId: 'pty-mvc' }),
      { [HOST]: { [forwarded.id]: 2_000 } },
      { [HOST]: scan(forwarded) },
      () => null
    )

    expect(result.ports).toEqual([50080])
  })
})

describe('liveClaimedPorts', () => {
  it('lists only claimed ports still listening, one row per port, preferring an advertised URL', () => {
    const v4 = workspacePort(5173, { bindHost: '127.0.0.1' })
    const advertised = workspacePort(5173, {
      bindHost: '0.0.0.0',
      advertisedUrl: 'http://localhost:5173'
    })
    const scans = { [HOST]: scan(v4, advertised, workspacePort(8080)) }

    const ports = liveClaimedPorts([claim({ ports: [5173, 9000] })], scans)

    expect(ports).toEqual([advertised])
  })
})

describe('liveClaimedPorts hiding', () => {
  it('leaves out ports the caller hides, such as a debuggee inspector', () => {
    const program = workspacePort(5173)
    const inspector = workspacePort(9229)
    const scans = { [HOST]: scan(program, inspector) }

    const ports = liveClaimedPorts(
      [claim({ ports: [5173, 9229] })],
      scans,
      (port) => port.port === 9229
    )

    expect(ports).toEqual([program])
  })
})

describe('syncPortClaims', () => {
  const owner = { key: 'run:wt\u0000dev', worktreeId: 'wt', attemptId: 'a1', ptyId: null }

  it('starts an empty claim for a new attempt and keeps the current one', () => {
    const started = syncPortClaims({}, [owner], 1_000, false)
    expect(started[owner.key]).toEqual(claim())

    const kept = { [owner.key]: claim({ ports: [5173] }) }
    expect(syncPortClaims(kept, [owner], 2_000, false)).toBe(kept)

    const rerun = syncPortClaims(kept, [{ ...owner, attemptId: 'a2' }], 3_000, false)
    expect(rerun[owner.key]).toEqual(claim({ attemptId: 'a2', startedAt: 3_000 }))
  })

  it('drops the claims of sessions that ended', () => {
    expect(syncPortClaims({ [owner.key]: claim() }, [], 2_000, false)).toEqual({})
  })

  it('gives sessions found while restoring no start time', () => {
    expect(syncPortClaims({}, [owner], 1_000, true)[owner.key]?.startedAt).toBeNull()
  })
})

describe('fastScanInterval', () => {
  it('scans every second right after a start and backs off to ten seconds', () => {
    expect(fastScanInterval(0)).toBe(1_000)
    expect(fastScanInterval(20_000)).toBe(5_000)
    expect(fastScanInterval(100_000)).toBe(10_000)
  })
})
