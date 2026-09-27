import { describe, expect, it } from 'vitest'
import { ConsolePool } from './console-pool'

type FakeConsole = { id: number; close: () => Promise<void>; drop: () => void }

function fakePool() {
  let opened = 0
  const pool = new ConsolePool<FakeConsole>(async (_consoleId, onLost) => {
    opened += 1
    return { id: opened, close: async () => undefined, drop: onLost }
  })
  return { pool, opened: () => opened }
}

describe('ConsolePool', () => {
  it('reuses a console’s session and reconnects after the server drops it', async () => {
    const { pool } = fakePool()
    const first = await pool.acquire('c1')
    expect(await pool.acquire('c1')).toBe(first)
    first.drop()
    await Promise.resolve()
    expect((await pool.acquire('c1')).id).toBe(2)
  })

  it('forgets a closed console, so a late drop of its old session changes nothing', async () => {
    const { pool } = fakePool()
    const target = await pool.acquire('c1')
    await pool.close('c1')
    target.drop()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.current('c1')).toBeUndefined()
    expect((await pool.acquire('c1')).id).toBe(2)
  })
})
