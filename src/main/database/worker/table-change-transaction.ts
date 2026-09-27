import type { ParameterizedStatement } from '../../../shared/database/table-change-sql'
import { toDatabaseError } from './database-error-mapping'

/** One driver session's transaction for applying table edits. */
export type DatabaseChangeTransaction = {
  /** Runs one statement and resolves how many rows it changed. */
  run(statement: ParameterizedStatement): Promise<number>
  commit(): Promise<void>
  rollback(): Promise<void>
}

/** Which change failed rides along as `changeIndex`, which `toDatabaseError` puts on the wire. */
class TableChangeError extends Error {
  constructor(
    message: string,
    readonly changeIndex: number,
    readonly details: { sqlState?: string; detail?: string; hint?: string } = {}
  ) {
    super(message)
  }

  get sqlState(): string | undefined {
    return this.details.sqlState
  }

  get detail(): string | undefined {
    return this.details.detail
  }

  get hint(): string | undefined {
    return this.details.hint
  }
}

// Why not the driver's position/line: they point into generated SQL the user never wrote.
function failedChange(error: unknown, changeIndex: number): TableChangeError {
  const { message, sqlState, detail, hint } = toDatabaseError(error)
  return new TableChangeError(message, changeIndex, { sqlState, detail, hint })
}

/**
 * Applies every statement in one transaction, or none: a failure, or an UPDATE/DELETE
 * that did not change exactly one row (someone else changed or removed it), rolls back.
 */
export async function applyTableChanges(
  transaction: DatabaseChangeTransaction,
  statements: readonly ParameterizedStatement[]
): Promise<{ applied: number }> {
  for (const [index, statement] of statements.entries()) {
    let changed: number
    try {
      changed = await transaction.run(statement)
    } catch (error) {
      await transaction.rollback().catch(() => undefined)
      throw failedChange(error, index)
    }
    if (statement.expectOneRow && changed !== 1) {
      await transaction.rollback().catch(() => undefined)
      throw new TableChangeError(
        `Expected to change 1 row but changed ${changed}. The row may have been changed or deleted since it was loaded; refresh and try again.`,
        index
      )
    }
  }
  await transaction.commit()
  return { applied: statements.length }
}
