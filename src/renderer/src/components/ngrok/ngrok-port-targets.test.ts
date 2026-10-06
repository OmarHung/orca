import { describe, expect, it } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import {
  endpointsForPort,
  ngrokAgentPortsFromScan,
  publicHostOf,
  shareTargetForForward,
  shareTargetForPort
} from './ngrok-port-targets'

function port(overrides: {
  port: number
  connectHost?: string
  bindHost?: string
  processName?: string
  protocol?: WorkspacePort['protocol']
}): WorkspacePort {
  return {
    id: `p${overrides.port}`,
    kind: 'external',
    bindHost: '127.0.0.1',
    connectHost: '127.0.0.1',
    protocol: 'http',
    ...overrides
  }
}

describe('shareTargetForPort', () => {
  it('shares loopback and wildcard listeners on loopback', () => {
    expect(shareTargetForPort(port({ port: 5173 }))).toEqual({
      port: 5173,
      protocol: 'http',
      host: '127.0.0.1'
    })
    expect(shareTargetForPort(port({ port: 80, connectHost: '0.0.0.0' }))?.host).toBe('localhost')
    expect(shareTargetForPort(port({ port: 7016, connectHost: '::1', protocol: 'https' }))).toEqual(
      { port: 7016, protocol: 'https', host: '::1' }
    )
  })

  it('does not share a listener bound to another interface, or an ngrok inspector', () => {
    expect(shareTargetForPort(port({ port: 3000, connectHost: '192.168.1.4' }))).toBeNull()
    expect(shareTargetForPort(port({ port: 4040, processName: 'ngrok' }))).toBeNull()
  })
})

describe('shareTargetForForward', () => {
  it("shares an SSH forward's local end", () => {
    expect(
      shareTargetForForward({
        id: 'f',
        connectionId: 'c',
        localPort: 15432,
        remoteHost: 'localhost',
        remotePort: 5432,
        advertisedProtocol: 'https'
      })
    ).toEqual({ port: 15432, protocol: 'https', host: 'localhost' })
  })
})

describe('ngrokAgentPortsFromScan', () => {
  it('lists the ports of ngrok listeners once each', () => {
    const scan = {
      platform: 'darwin' as const,
      scannedAt: 0,
      ports: [
        port({ port: 4041, processName: 'ngrok' }),
        port({ port: 4040, processName: 'ngrok.exe' }),
        port({ port: 4040, processName: 'ngrok', bindHost: '::1' }),
        port({ port: 5173, processName: 'node' })
      ]
    }
    expect(ngrokAgentPortsFromScan(scan)).toEqual([4040, 4041])
    expect(ngrokAgentPortsFromScan(undefined)).toEqual([])
  })
})

describe('endpointsForPort', () => {
  it('matches endpoints by the local port they forward to', () => {
    const endpoint = {
      agentAddress: '127.0.0.1:4040',
      managed: false,
      name: '5016',
      publicUrl: 'https://lorelai.ngrok-free.dev',
      upstream: 'http://localhost:5016',
      upstreamPort: 5016
    }
    const snapshot = {
      installed: true,
      agent: { state: 'stopped' as const, error: null },
      endpoints: [endpoint],
      externalAgents: ['127.0.0.1:4040'],
      configured: [
        {
          name: 'api',
          url: 'https://fixed.ngrok-free.dev',
          upstream: '5016',
          upstreamPort: 5016,
          online: true
        }
      ]
    }
    expect(endpointsForPort(snapshot, 5016)).toEqual([endpoint])
    expect(endpointsForPort(snapshot, 5017)).toEqual([])
    expect(endpointsForPort(null, 5016)).toEqual([])
    expect(publicHostOf(endpoint)).toBe('lorelai.ngrok-free.dev')
  })
})
