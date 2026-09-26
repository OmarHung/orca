import { describe, expect, it } from 'vitest'
import {
  readOutputEvent,
  readScopes,
  readStackFrames,
  readStoppedEvent,
  readThreadIds,
  readVariables
} from './debug-protocol-readers'

describe('debug protocol readers', () => {
  it('reads thread ids and skips malformed threads', () => {
    expect(readThreadIds({ threads: [{ id: 1, name: 'main' }, { name: 'x' }] })).toEqual([1])
  })

  it('reads stack frames with their source path', () => {
    expect(
      readStackFrames({
        stackFrames: [
          {
            id: 3,
            name: 'main',
            line: 7,
            column: 1,
            source: { path: '/p/app.py', name: 'app.py' }
          },
          { id: 'bad', name: 'x', line: 1 }
        ]
      })
    ).toEqual([
      { id: 3, name: 'main', line: 7, column: 1, source: { path: '/p/app.py', name: 'app.py' } }
    ])
  })

  it('reads scopes and variables', () => {
    expect(readScopes({ scopes: [{ name: 'Locals', variablesReference: 5 }] })).toEqual([
      { name: 'Locals', variablesReference: 5, expensive: false }
    ])
    expect(
      readVariables({
        variables: [{ name: 'answer', value: '41', type: 'int', variablesReference: 0 }]
      })
    ).toEqual([{ name: 'answer', value: '41', type: 'int', variablesReference: 0 }])
  })

  it('returns empty lists for bodies that are not objects', () => {
    expect(readStackFrames(null)).toEqual([])
    expect(readVariables('oops')).toEqual([])
  })

  it('maps output categories and hides telemetry', () => {
    expect(readOutputEvent({ category: 'stdout', output: '42\n' })).toEqual({
      category: 'stdout',
      text: '42\n'
    })
    expect(readOutputEvent({ category: 'telemetry', output: '{}' })).toBeNull()
    expect(readOutputEvent({ output: 'hello' })).toEqual({ category: 'console', text: 'hello' })
  })

  it('reads stopped events with or without a thread id', () => {
    expect(readStoppedEvent({ reason: 'breakpoint', threadId: 1 })).toEqual({
      threadId: 1,
      reason: 'breakpoint'
    })
    expect(readStoppedEvent({ reason: 'pause' })).toEqual({ threadId: null, reason: 'pause' })
  })
})
