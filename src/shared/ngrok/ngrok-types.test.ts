import { describe, expect, it } from 'vitest'
import { ngrokShareRequestSchema, ngrokUpstreamPort } from './ngrok-types'

describe('ngrokUpstreamPort', () => {
  it('reads the local port from every upstream form ngrok reports', () => {
    expect(ngrokUpstreamPort('http://localhost:5016')).toBe(5016)
    expect(ngrokUpstreamPort('https://127.0.0.1:7016')).toBe(7016)
    expect(ngrokUpstreamPort('http://[::1]:3000')).toBe(3000)
    expect(ngrokUpstreamPort('localhost:8080')).toBe(8080)
    expect(ngrokUpstreamPort('5016')).toBe(5016)
    expect(ngrokUpstreamPort('http://localhost')).toBe(80)
  })

  it('has no local port for an upstream on another host or an invalid one', () => {
    expect(ngrokUpstreamPort('http://192.168.1.20:3000')).toBeNull()
    expect(ngrokUpstreamPort('99999')).toBeNull()
    expect(ngrokUpstreamPort('not a url at all')).toBeNull()
  })
})

describe('ngrokShareRequestSchema', () => {
  it('accepts only loopback upstreams', () => {
    expect(
      ngrokShareRequestSchema.safeParse({ port: 5173, protocol: 'http', host: 'localhost' }).success
    ).toBe(true)
    expect(
      ngrokShareRequestSchema.safeParse({ port: 5173, protocol: 'http', host: '10.0.0.5' }).success
    ).toBe(false)
    expect(
      ngrokShareRequestSchema.safeParse({ port: 0, protocol: 'http', host: 'localhost' }).success
    ).toBe(false)
  })
})
