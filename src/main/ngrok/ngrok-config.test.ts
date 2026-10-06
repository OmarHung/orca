import { describe, expect, it } from 'vitest'
import { configPathFromCheckOutput, parseNgrokConfigEndpoints } from './ngrok-config'

// The shape `ngrok config add-authtoken` plus a reserved dev domain produce, as on a real machine.
const V3_CONFIG = `version: "3"
agent:
    authtoken: 2abcSECRET
endpoints:
  - name: 5016
    url: https://lorelai-telescopic-pebbly.ngrok-free.dev
    upstream:
      url: 5016
  - name: no-upstream
    url: https://x.ngrok.app
`

describe('parseNgrokConfigEndpoints', () => {
  it('reads v3 endpoints, with numeric names and upstreams as YAML gives them', () => {
    expect(parseNgrokConfigEndpoints(V3_CONFIG)).toEqual([
      {
        name: '5016',
        url: 'https://lorelai-telescopic-pebbly.ngrok-free.dev',
        upstream: '5016',
        upstreamPort: 5016,
        request: {
          api: 'endpoints',
          body: {
            name: 'orca-config-5016',
            url: 'https://lorelai-telescopic-pebbly.ngrok-free.dev',
            upstream: { url: '5016' }
          }
        }
      }
    ])
  })

  it('keeps the whole definition, so a traffic policy comes along as with `ngrok start`', () => {
    const config = `endpoints:
  - name: api
    url: https://api.ngrok.app
    pooling_enabled: true
    traffic_policy:
      on_http_request:
        - actions:
            - type: basic-auth
              config:
                credentials: ["u:password1"]
    upstream:
      url: http://localhost:8080
      protocol: http2
`
    expect(parseNgrokConfigEndpoints(config)[0].request.body).toEqual({
      name: 'orca-config-api',
      url: 'https://api.ngrok.app',
      pooling_enabled: true,
      traffic_policy: {
        on_http_request: [
          { actions: [{ type: 'basic-auth', config: { credentials: ['u:password1'] } }] }
        ]
      },
      upstream: { url: 'http://localhost:8080', protocol: 'http2' }
    })
  })

  it('never carries the authtoken', () => {
    expect(JSON.stringify(parseNgrokConfigEndpoints(V3_CONFIG))).not.toContain('SECRET')
  })

  it('reads HTTP tunnels from the older map, with or without a domain', () => {
    const config = `tunnels:
  web:
    proto: http
    addr: localhost:3000
    hostname: web.example.com
  random:
    addr: 8080
  db:
    proto: tcp
    addr: 5432
`
    expect(parseNgrokConfigEndpoints(config)).toEqual([
      {
        name: 'web',
        url: 'https://web.example.com',
        upstream: 'localhost:3000',
        upstreamPort: 3000,
        request: {
          api: 'tunnels',
          body: {
            name: 'orca-config-web',
            proto: 'http',
            addr: 'localhost:3000',
            hostname: 'web.example.com'
          }
        }
      },
      {
        name: 'random',
        url: null,
        upstream: '8080',
        upstreamPort: 8080,
        request: {
          api: 'tunnels',
          body: { name: 'orca-config-random', proto: 'http', addr: '8080' }
        }
      }
    ])
  })

  it('has nothing for an invalid or empty file', () => {
    expect(parseNgrokConfigEndpoints('endpoints: [unclosed')).toEqual([])
    expect(parseNgrokConfigEndpoints('')).toEqual([])
  })
})

describe('configPathFromCheckOutput', () => {
  it('reads the path ngrok validated', () => {
    expect(
      configPathFromCheckOutput(
        'Valid configuration file at /Users/me/Library/Application Support/ngrok/ngrok.yml\n'
      )
    ).toBe('/Users/me/Library/Application Support/ngrok/ngrok.yml')
    expect(configPathFromCheckOutput('ERROR: invalid yaml')).toBeNull()
  })
})
