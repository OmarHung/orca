import { describe, expect, it } from 'vitest'
import { ConsolePool } from './console-pool'
import { ConsoleTransactions } from './console-transactions'
import { toDatabaseError } from './database-error-mapping'

type FakeConsole = {
  id: number
  transactions: ConsoleTransactions
  close: () => Promise<void>
  drop: () => void
}

function fakePool(options: { openTransaction: boolean }) {
  let opened = 0
  const pool = new ConsolePool<FakeConsole>(async (_consoleId, onLost) => {
    opened += 1
    const transactions = new ConsoleTransactions({
      state: async () => (options.openTransaction ? 'open' : 'none'),
      begin: async () => undefined
    })
    await transactions.run('manual', 'insert into t values (1)', async () => ({ results: [] }))
    return { id: opened, transactions, close: async () => undefined, drop: onLost }
  })
  return { pool, opened: () => opened }
}

describe('ConsolePool', () => {
  it('reuses a console’s session and reconnects after the server drops it', async () => {
    const { pool } = fakePool({ openTransaction: false })
    const first = await pool.acquire('c1')
    expect(await pool.acquire('c1')).toBe(first)
    first.drop()
    await Promise.resolve()
    expect((await pool.acquire('c1')).id).toBe(2)
  })

  it('reports once that a dropped session took its open transaction with it', async () => {
    const { pool, opened } = fakePool({ openTransaction: true })
    ;(await pool.acquire('c1')).drop()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const failure = await pool.acquire('c1').catch(toDatabaseError)
    expect(failure).toMatchObject({ message: /rolled back/, transaction: 'none' })
    expect(opened()).toBe(1)
    expect((await pool.acquire('c1')).id).toBe(2)
  })

  it('treats closing a console as intended, not as a lost transaction', async () => {
    const { pool } = fakePool({ openTransaction: true })
    const target = await pool.acquire('c1')
    await pool.close('c1')
    target.drop()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.current('c1')).toBeUndefined()
    expect((await pool.acquire('c1')).id).toBe(2)
  })
})
