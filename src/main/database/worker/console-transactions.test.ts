import { describe, expect, it } from 'vitest'
import type {
  DatabaseExecuteResult,
  DatabaseTransactionState
} from '../../../shared/database/database-query-types'
import {
  ConsoleTransactions,
  beginsImplicitTransaction,
  mayChangeTransaction,
  type ConsoleTransactionControl
} from './console-transactions'
import { toDatabaseError } from './database-error-mapping'

const COMMAND: DatabaseExecuteResult = {
  results: [{ kind: 'command', command: 'INSERT', rowCount: 1, durationMs: 1 }]
}
const PAGED: DatabaseExecuteResult = {
  results: [{ kind: 'rows', resultId: 'r', columns: [], rows: [], hasMore: true, durationMs: 1 }]
}

function fakeControl(options: { serverSideMode: boolean }) {
  const calls: string[] = []
  let state: DatabaseTransactionState = 'none'
  const control: ConsoleTransactionControl = {
    state: async () => {
      calls.push('state')
      return state
    },
    ...(options.serverSideMode
      ? { setManual: async (manual) => void calls.push(`manual=${manual}`) }
      : {
          begin: async () => {
            calls.push('BEGIN')
            state = 'open'
          }
        })
  }
  return { control, calls, setState: (next: DatabaseTransactionState) => (state = next) }
}

describe('ConsoleTransactions', () => {
  it('sends BEGIN in manual mode where the server has no manual mode, and reports the state', async () => {
    const { control, calls } = fakeControl({ serverSideMode: false })
    const transactions = new ConsoleTransactions(control)
    const result = await transactions.run('manual', 'insert into t values (1)', async () => COMMAND)
    expect(result.transaction).toBe('open')
    expect(calls).toEqual(['BEGIN', 'state'])
    await transactions.run('manual', 'insert into t values (2)', async () => COMMAND)
    expect(calls).toEqual(['BEGIN', 'state', 'state'])
  })

  it('switches server-side mode once and refuses auto-commit while a transaction is open', async () => {
    const { control, calls, setState } = fakeControl({ serverSideMode: true })
    const transactions = new ConsoleTransactions(control)
    await transactions.run('auto', 'select 1', async () => COMMAND)
    expect(calls).toEqual(['manual=false'])
    setState('open')
    await transactions.run('manual', 'update t set a = 1', async () => COMMAND)
    await transactions.run('manual', 'update t set a = 2', async () => COMMAND)
    expect(calls).toEqual(['manual=false', 'manual=true', 'state', 'state'])
    const refused = await transactions
      .run('auto', 'select 1', async () => COMMAND)
      .catch(toDatabaseError)
    expect(refused).toMatchObject({ message: /Commit or roll back/, transaction: 'open' })
    setState('none')
    await transactions.run('manual', 'commit', async () => COMMAND)
    expect(
      (await transactions.run('auto', 'select 1', async () => COMMAND)).transaction
    ).toBeUndefined()
  })

  it('checks auto mode only while a transaction is open or a statement could start one', async () => {
    const { control, calls, setState } = fakeControl({ serverSideMode: false })
    const transactions = new ConsoleTransactions(control)
    expect(
      (await transactions.run('auto', 'select * from t', async () => COMMAND)).transaction
    ).toBe(undefined)
    setState('open')
    expect((await transactions.run('auto', 'begin', async () => COMMAND)).transaction).toBe('open')
    expect(
      (await transactions.run('auto', 'select * from t', async () => COMMAND)).transaction
    ).toBe('open')
    expect(calls).toEqual(['state', 'state'])
  })

  it('reports the state with a failure and skips the check while a result is left open', async () => {
    const { control, calls, setState } = fakeControl({ serverSideMode: false })
    const transactions = new ConsoleTransactions(control)
    const paged = await transactions.run('manual', 'select * from big', async () => PAGED)
    expect(paged.transaction).toBe('open')
    expect(calls).toEqual(['BEGIN'])
    setState('failed')
    const failure = await transactions
      .run('manual', 'select 1/0', async () => {
        throw Object.assign(new Error('division by zero'), { code: '22012' })
      })
      .catch(toDatabaseError)
    expect(failure).toMatchObject({
      message: 'division by zero',
      sqlState: '22012',
      transaction: 'failed'
    })
    // A failed transaction still counts as open: no second BEGIN.
    await transactions.run('manual', 'rollback', async () => COMMAND)
    expect(calls.filter((call) => call === 'BEGIN')).toHaveLength(1)
  })

  it('knows which statements run outside a transaction and which may change one', () => {
    expect(beginsImplicitTransaction('insert into t values (1)')).toBe(true)
    for (const sql of [
      'commit',
      '  ROLLBACK',
      'begin',
      'vacuum',
      'create database x',
      'create unique index concurrently i on t (a)',
      'drop index concurrently i',
      'reindex table concurrently t',
      'alter system set work_mem = 1',
      'pragma journal_mode = wal'
    ]) {
      expect(beginsImplicitTransaction(sql), sql).toBe(false)
    }
    expect(mayChangeTransaction('SELECT * FROM orders')).toBe(false)
    expect(mayChangeTransaction('start transaction')).toBe(true)
    expect(mayChangeTransaction('SET IMPLICIT_TRANSACTIONS ON')).toBe(true)
    expect(mayChangeTransaction('select * from t; commit')).toBe(true)
  })
})
