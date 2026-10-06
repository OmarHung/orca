import { describe, expect, it } from 'vitest'
import { classifyNgrokLogLine, createLineSplitter, describeNgrokError } from './ngrok-agent-log'

// Captured from ngrok 3.39.6 run with `start --none --log stdout --log-format json`.
const AUTH_ERROR =
  'authentication failed: This ngrok session is not authenticated. ngrok requires an account and a valid credential to start a session.\n\nSign up for an account: https://dashboard.ngrok.com/signup\nGet your credential: https://dashboard.ngrok.com/get-started/your-authtoken\r\n\r\nERR_NGROK_4018\r\n'

describe('classifyNgrokLogLine', () => {
  it('reads the web address the agent fell back to', () => {
    expect(
      classifyNgrokLogLine(
        '{"addr":"127.0.0.1:4041","allow_hosts":null,"lvl":"info","msg":"starting web service","obj":"web","t":"2026-10-06T15:51:23.310827+08:00"}'
      )
    ).toEqual({ kind: 'web-address', address: '127.0.0.1:4041' })
  })

  it('treats an established session as ready', () => {
    expect(
      classifyNgrokLogLine(
        '{"lvl":"info","msg":"client session established","obj":"tunnels.session","t":"2026-10-06T15:51:23.518155+08:00"}'
      )
    ).toEqual({ kind: 'ready' })
  })

  it('fails on a critical line with the error ngrok gave', () => {
    const line = JSON.stringify({ err: AUTH_ERROR, lvl: 'crit', msg: 'command failed' })
    expect(classifyNgrokLogLine(line)).toEqual({
      kind: 'failed',
      message:
        'authentication failed: This ngrok session is not authenticated. ngrok requires an account and a valid credential to start a session. (ERR_NGROK_4018)'
    })
  })

  it('keeps a reconnect error non-fatal', () => {
    const line = JSON.stringify({
      err: AUTH_ERROR,
      lvl: 'eror',
      msg: 'failed to reconnect session'
    })
    expect(classifyNgrokLogLine(line).kind).toBe('error')
  })

  it('ignores warnings, a nil error and lines that are not JSON', () => {
    expect(
      classifyNgrokLogLine(
        '{"addr":"127.0.0.1:4040","lvl":"warn","msg":"can\'t bind default web address, trying alternatives","obj":"web"}'
      )
    ).toEqual({ kind: 'other' })
    expect(classifyNgrokLogLine('{"err":"<nil>","lvl":"info","msg":"open config file"}')).toEqual({
      kind: 'other'
    })
    expect(classifyNgrokLogLine('ERROR:  ERR_NGROK_4018')).toEqual({ kind: 'other' })
  })
})

describe('describeNgrokError', () => {
  it('keeps a code already in the first line once', () => {
    expect(describeNgrokError('ERR_NGROK_108: too many sessions\nmore')).toBe(
      'ERR_NGROK_108: too many sessions'
    )
  })
})

describe('createLineSplitter', () => {
  it('holds back a partial line until it ends', () => {
    const split = createLineSplitter()
    expect(split('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(split(':2}\r\n\n')).toEqual(['{"b":2}'])
  })
})
