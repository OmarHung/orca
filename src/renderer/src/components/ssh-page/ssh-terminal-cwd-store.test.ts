import { describe, expect, it } from 'vitest'
import { nextCwdReport, readCwdReport } from './ssh-terminal-cwd-store'

const LOCAL = 'my-laptop.local'
const REMOTE = { host: 'web-1', path: '/srv/app' }

describe('readCwdReport', () => {
  it('reads the host and the decoded folder', () => {
    expect(readCwdReport('file://web-1/srv/my%20app')).toEqual({
      host: 'web-1',
      path: '/srv/my app'
    })
  })

  it.each(['file:///srv/app', 'file://win-1/C:/Users/deploy', 'http://web-1/srv', 'nonsense'])(
    'has nothing to say for %j',
    (payload) => {
      expect(readCwdReport(payload)).toBeNull()
    }
  )
})

describe('nextCwdReport', () => {
  it('takes the first report from another machine', () => {
    expect(nextCwdReport(undefined, REMOTE, LOCAL)).toEqual(REMOTE)
  })

  it('follows the same host to another folder', () => {
    const report = nextCwdReport(REMOTE, { host: 'web-1', path: '/tmp' }, LOCAL)

    expect(report).toEqual({ host: 'web-1', path: '/tmp' })
  })

  it('counts a host named with or without its domain as the same', () => {
    const report = nextCwdReport(REMOTE, { host: 'WEB-1.example.test', path: '/tmp' }, LOCAL)

    expect(report?.path).toBe('/tmp')
  })

  it.each(['my-laptop', 'my-laptop.local', 'MY-LAPTOP', 'localhost'])(
    'ignores %j, the local shell left once ssh ends',
    (host) => {
      expect(nextCwdReport(REMOTE, { host, path: '/Users/me' }, LOCAL)).toEqual(REMOTE)
      expect(nextCwdReport(undefined, { host, path: '/Users/me' }, LOCAL)).toBeUndefined()
    }
  )

  it('ignores a different host, which means ssh went onward from this one', () => {
    expect(nextCwdReport(REMOTE, { host: 'db-1', path: '/var/lib' }, LOCAL)).toEqual(REMOTE)
  })

  it('trusts nothing until it knows the local host name', () => {
    expect(nextCwdReport(undefined, REMOTE, null)).toBeUndefined()
  })
})
