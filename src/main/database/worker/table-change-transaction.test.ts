import { describe, expect, it } from 'vitest'
import type { ParameterizedStatement } from '../../../shared/database/table-change-sql'
import { toDatabaseError } from './database-error-mapping'
import { applyTableChanges, type DatabaseChangeTransaction } from './table-change-transaction'

function fakeTransaction(outcomes: (number | Error)[]): {
  transaction: DatabaseChangeTransaction
  log: string[]
} {
  const log: string[] = []
  const transaction: DatabaseChangeTransaction = {
    run: async (statement) => {
      log.push(statement.sql)
      const outcome = outcomes.shift() ?? 1
      if (outcome instanceof Error) {
        throw outcome
      }
      return outcome
    },
    commit: async () => void log.push('COMMIT'),
    rollback: async () => void log.push('ROLLBACK')
  }
  return { transaction, log }
}

const update = (sql: string): ParameterizedStatement => ({ sql, params: [], expectOneRow: true })
const insert = (sql: string): ParameterizedStatement => ({ sql, params: [], expectOneRow: false })

describe('applyTableChanges', () => {
  it('commits when every row-targeted statement changed exactly one row', async () => {
    const { transaction, log } = fakeTransaction([1, 1])
    expect(await applyTableChanges(transaction, [update('u1'), insert('i1')])).toEqual({
      applied: 2
    })
    expect(log).toEqual(['u1', 'i1', 'COMMIT'])
  })

  it('rolls back and names the change when its row is gone', async () => {
    const { transaction, log } = fakeTransaction([1, 0])
    const failure = await applyTableChanges(transaction, [update('u1'), update('u2')]).catch(
      (error: unknown) => error
    )
    expect(log).toEqual(['u1', 'u2', 'ROLLBACK'])
    expect(toDatabaseError(failure)).toMatchObject({
      changeIndex: 1,
      message: expect.stringContaining('changed 0')
    })
  })

  it('keeps the server error and its code, adding which change failed', async () => {
    const serverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      position: '12'
    })
    const { transaction, log } = fakeTransaction([serverError])
    const failure = await applyTableChanges(transaction, [insert('i1')]).catch(
      (error: unknown) => error
    )
    expect(log).toEqual(['i1', 'ROLLBACK'])
    expect(toDatabaseError(failure)).toEqual({
      message: 'duplicate key value',
      sqlState: '23505',
      changeIndex: 0
    })
  })
})
