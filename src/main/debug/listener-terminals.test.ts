import { describe, expect, it } from 'vitest'
import { terminalsOfPids } from './listener-terminals'

describe('terminalsOfPids', () => {
  const terminals = new Map([
    [100, 'pty-api'],
    [200, 'pty-shop']
  ])
  // launchd(1) → shell(100) → dotnet(110) → Api(120); shell(200) → pnpm(210) → node(220); OrbStack(300)
  const parents = new Map([
    [100, 1],
    [110, 100],
    [120, 110],
    [200, 1],
    [210, 200],
    [220, 210],
    [300, 1]
  ])

  it('finds the terminal each listener descends from', () => {
    expect(terminalsOfPids([120, 220], terminals, parents)).toEqual({
      120: 'pty-api',
      220: 'pty-shop'
    })
  })

  it('reports null for a process outside every terminal, such as a container forwarder', () => {
    expect(terminalsOfPids([300, 999], terminals, parents)).toEqual({ 300: null, 999: null })
  })

  it('stops on a parent cycle', () => {
    const cycle = new Map([
      [5, 6],
      [6, 5]
    ])
    expect(terminalsOfPids([5], terminals, cycle)).toEqual({ 5: null })
  })
})
