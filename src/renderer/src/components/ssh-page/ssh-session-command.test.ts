import { describe, expect, it } from 'vitest'
import { buildSshSessionCommand } from './ssh-session-command'

const base = { configHost: undefined, host: '203.0.113.10', port: 22, username: 'deploy' }

describe('buildSshSessionCommand', () => {
  it('connects through the ~/.ssh/config alias when there is one', () => {
    expect(buildSshSessionCommand({ ...base, configHost: 'web-prod-203.0.113.10' })).toBe(
      'ssh web-prod-203.0.113.10'
    )
  })

  it('spells out user, host and port for targets without an alias', () => {
    expect(buildSshSessionCommand(base)).toBe('ssh deploy@203.0.113.10')
    expect(buildSshSessionCommand({ ...base, port: 2222 })).toBe('ssh -p 2222 deploy@203.0.113.10')
    expect(buildSshSessionCommand({ ...base, username: '' })).toBe('ssh 203.0.113.10')
  })

  it('refuses values that a shell or ssh would reinterpret', () => {
    expect(buildSshSessionCommand({ ...base, configHost: 'web; rm -rf ~' })).toBeNull()
    expect(buildSshSessionCommand({ ...base, configHost: '$(whoami)' })).toBeNull()
    expect(buildSshSessionCommand({ ...base, configHost: '-oProxyCommand=sh' })).toBeNull()
    expect(buildSshSessionCommand({ ...base, host: '-oProxyCommand=sh' })).toBeNull()
    expect(buildSshSessionCommand({ ...base, username: 'a b' })).toBeNull()
  })

  it('refuses an out-of-range port', () => {
    expect(buildSshSessionCommand({ ...base, port: 0 })).toBeNull()
    expect(buildSshSessionCommand({ ...base, port: 70000 })).toBeNull()
  })
})
