import { describe, expect, it } from 'vitest'
import {
  duplicateConfiguration,
  emptyDebugTarget,
  formatArgs,
  formatEnv,
  newConfiguration,
  parseArgs,
  parseEnv,
  referenceCandidates,
  validateDrafts
} from './run-configuration-drafts'

describe('newConfiguration', () => {
  it('creates a uniquely named draft of each type', () => {
    const first = newConfiguration('command', [], () => 'id1')
    expect(first).toEqual({ type: 'command', id: 'id1', name: 'Unnamed', command: '' })
    const second = newConfiguration('debug', [first], () => 'id2')
    expect(second).toMatchObject({
      type: 'debug',
      name: 'Unnamed (2)',
      target: { kind: 'python-file' }
    })
    expect(newConfiguration('compound', [], () => 'id3')).toMatchObject({ configurations: [] })
  })
})

describe('duplicateConfiguration', () => {
  it('copies with a new id and a distinct name', () => {
    const original = { type: 'command' as const, id: 'a', name: 'Build', command: 'make' }
    expect(duplicateConfiguration(original, [original], () => 'b')).toEqual({
      ...original,
      id: 'b',
      name: 'Build (copy)'
    })
  })
})

describe('emptyDebugTarget', () => {
  it('starts each kind with its required fields', () => {
    expect(emptyDebugTarget('node-script')).toEqual({
      kind: 'node-script',
      packageManager: 'npm',
      script: ''
    })
    expect(emptyDebugTarget('dotnet-program')).toEqual({ kind: 'dotnet-program', program: '' })
  })
})

describe('args and env text', () => {
  it('uses one argument per line', () => {
    expect(parseArgs('--port\n80\n\n')).toEqual(['--port', '80'])
    expect(formatArgs(['a', 'b'])).toBe('a\nb')
    expect(parseArgs('  ')).toBeUndefined()
  })

  it('uses KEY=VALUE lines and keeps = inside values', () => {
    expect(parseEnv('A=1\nB=x=y\nbad line\n')).toEqual({ A: '1', B: 'x=y' })
    expect(formatEnv({ A: '1' })).toBe('A=1')
    expect(parseEnv('')).toBeUndefined()
  })
})

describe('referenceCandidates', () => {
  it('offers other configurations of the allowed types', () => {
    const drafts = [
      { type: 'command' as const, id: 'a', name: 'A', command: 'a' },
      { type: 'command' as const, id: 'b', name: 'B', command: 'b' },
      { type: 'compound' as const, id: 'c', name: 'C', configurations: [] }
    ]
    expect(referenceCandidates(drafts, 'a', ['command']).map((entry) => entry.id)).toEqual(['b'])
  })
})

describe('validateDrafts', () => {
  it('lists what blocks saving', () => {
    const result = validateDrafts([
      { type: 'command', id: 'a', name: 'A', command: '' },
      { type: 'command', id: 'b', name: 'B', command: 'ls' }
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.messages).toEqual([expect.stringContaining('"A"')])
    }
  })

  it('returns the normalized configurations', () => {
    expect(
      validateDrafts([{ type: 'command', id: 'b', name: ' B ', command: 'ls', cwd: '' }])
    ).toEqual({
      ok: true,
      configurations: [{ type: 'command', id: 'b', name: 'B', command: 'ls' }]
    })
  })
})
