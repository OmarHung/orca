import { describe, expect, it } from 'vitest'
import { redisReadOnlyViolation } from './redis-read-only-commands'

describe('redisReadOnlyViolation', () => {
  it('lets commands that only read through, in any case', () => {
    for (const words of [
      ['get', 'a'],
      ['HGETALL', 'h'],
      ['config', 'get', 'maxmemory'],
      ['SELECT', '3'],
      ['ORCA.VIEW', 'k'],
      ['xread', 'BLOCK', '0', 'STREAMS', 's', '$']
    ]) {
      expect(redisReadOnlyViolation(words), words.join(' ')).toBeNull()
    }
  })

  it('names what it refuses: writes, write subcommands and unknown commands', () => {
    expect(redisReadOnlyViolation(['set', 'a', 'b'])).toBe('SET')
    expect(redisReadOnlyViolation(['CONFIG', 'set', 'x', '1'])).toBe('CONFIG SET')
    expect(redisReadOnlyViolation(['CLIENT'])).toBe('CLIENT')
    expect(redisReadOnlyViolation(['FLUSHALL'])).toBe('FLUSHALL')
    expect(redisReadOnlyViolation(['GETDEL', 'a'])).toBe('GETDEL')
    expect(redisReadOnlyViolation(['EVAL', 'return 1', '0'])).toBe('EVAL')
    expect(redisReadOnlyViolation(['MYMODULE.WRITE'])).toBe('MYMODULE.WRITE')
  })
})
