import { describe, expect, it } from 'vitest'
import { applyDebugLaunchOptions } from './debug-launch-options'

describe('applyDebugLaunchOptions', () => {
  it('returns the adapter arguments unchanged without options', () => {
    const base = { program: '/a.py', env: { A: '1' } }
    expect(applyDebugLaunchOptions(base, undefined)).toEqual(base)
  })

  it('replaces args and layers env over the adapter env', () => {
    const base = { program: '/a.dll', args: ['--profile'], env: { A: '1', B: '2' } }
    const result = applyDebugLaunchOptions(base, {
      args: ['--port', '80'],
      env: { B: 'x', C: '3' }
    })
    expect(result).toEqual({
      program: '/a.dll',
      args: ['--port', '80'],
      env: { A: '1', B: 'x', C: '3' }
    })
    expect(base.env).toEqual({ A: '1', B: '2' })
  })

  it('adds env when the adapter set none', () => {
    expect(applyDebugLaunchOptions({ program: '/a.js' }, { env: { C: '3' } })).toEqual({
      program: '/a.js',
      env: { C: '3' }
    })
  })
})
