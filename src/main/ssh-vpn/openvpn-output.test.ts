import { describe, expect, it } from 'vitest'
import { classifyOpenVpnLine, describeOpenVpnFailure, OpenVpnLogTail } from './openvpn-output'

describe('classifyOpenVpnLine', () => {
  it('recognises readiness and fatal lines', () => {
    expect(classifyOpenVpnLine('2026-09-29 10:00:00 Initialization Sequence Completed')).toEqual({
      kind: 'ready'
    })
    expect(classifyOpenVpnLine('AUTH: Received control message: AUTH_FAILED')).toEqual({
      kind: 'failed'
    })
    expect(classifyOpenVpnLine('Exiting due to fatal error')).toEqual({ kind: 'failed' })
    expect(classifyOpenVpnLine('TUN/TAP device tun0 opened')).toEqual({ kind: 'line' })
  })
})

describe('describeOpenVpnFailure', () => {
  it('names the cause that precedes the generic fatal line, without timestamps', () => {
    expect(
      describeOpenVpnFailure([
        '2026-09-29 10:00:00 OpenVPN 2.6.20',
        '2026-09-29 10:00:01 Cannot open TUN/TAP dev /dev/net/tun: No such file or directory',
        '2026-09-29 10:00:01 Exiting due to fatal error'
      ])
    ).toBe('Cannot open TUN/TAP dev /dev/net/tun: No such file or directory')
  })

  it('falls back to the last line, then to a generic message', () => {
    expect(describeOpenVpnFailure(['2026-09-29 10:00:00 SIGTERM received'])).toBe(
      'SIGTERM received'
    )
    expect(describeOpenVpnFailure([])).toBe('OpenVPN exited before the tunnel came up')
  })
})

describe('OpenVpnLogTail', () => {
  it('joins lines split across chunks and keeps only the most recent ones', () => {
    const tail = new OpenVpnLogTail()
    expect(tail.push('first li')).toEqual([])
    expect(tail.push('ne\r\nsecond\n\npart')).toEqual(['first line', 'second'])
    expect(tail.snapshot()).toEqual(['first line', 'second', 'part'])

    for (let index = 0; index < 50; index++) {
      tail.push(`line ${index}\n`)
    }
    const snapshot = tail.snapshot()
    expect(snapshot).toHaveLength(40)
    expect(snapshot.at(-1)).toBe('line 49')
  })
})
