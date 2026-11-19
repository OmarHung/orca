import { describe, expect, it } from 'vitest'
import { parseRedisCommandWords, splitRedisCommands } from './redis-command-text'

describe('splitRedisCommands', () => {
  it('takes one command per line, skipping blank and comment lines', () => {
    const text = '# keys\nGET a\n\n  // later\n  HGETALL "user:1"  \n'
    expect(splitRedisCommands(text).map(({ start, text: command }) => [start, command])).toEqual([
      [7, 'GET a'],
      [27, 'HGETALL "user:1"']
    ])
  })

  it('keeps a quoted value that runs onto the next line in its command', () => {
    expect(splitRedisCommands('ECHO "one\ntwo"\nPING').map((command) => command.text)).toEqual([
      'ECHO "one\ntwo"',
      'PING'
    ])
  })
})

describe('parseRedisCommandWords', () => {
  it('splits words and unquotes them the way redis-cli does', () => {
    expect(parseRedisCommandWords(`SET "a b" 'it\\'s' "tab\\there\\x41"`)).toEqual([
      'SET',
      'a b',
      "it's",
      'tab\thereA'
    ])
  })

  it('refuses an unterminated quote', () => {
    expect(() => parseRedisCommandWords('GET "open')).toThrow('Unterminated double quote.')
  })
})
