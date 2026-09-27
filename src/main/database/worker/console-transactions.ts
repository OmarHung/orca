import type {
  DatabaseExecuteResult,
  DatabaseTransactionMode,
  DatabaseTransactionState
} from '../../../shared/database/database-query-types'
import { DatabaseWireError, toDatabaseError } from './database-error-mapping'
import { leadingKeyword } from './statement-keyword'

/** How one console session reports and controls its transaction. */
export type ConsoleTransactionControl = {
  /** Asks the server; only called while no result is left open on the session. */
  state(): Promise<DatabaseTransactionState>
  /** Server-side manual mode: MySQL's autocommit, SQL Server's IMPLICIT_TRANSACTIONS. */
  setManual?(manual: boolean): Promise<void>
  /** Where the server has no manual mode (PostgreSQL, SQLite), BEGIN goes before a statement. */
  begin?(): Promise<void>
}

// Statements that control transactions themselves or can't run inside one.
const NO_BEGIN_KEYWORDS = new Set([
  'BEGIN',
  'START',
  'COMMIT',
  'END',
  'ROLLBACK',
  'ABORT',
  'SAVEPOINT',
  'RELEASE',
  'PREPARE',
  'VACUUM',
  'CHECKPOINT',
  'ATTACH',
  'DETACH',
  'PRAGMA'
])
const NO_BEGIN_PHRASES = [
  /^(create|drop)\s+(database|tablespace)\b/i,
  /^(create\s+(unique\s+)?|drop\s+)index\s+concurrently\b/i,
  /^reindex\b.*\bconcurrently\b/is,
  /^reindex\s+(database|system)\b/i,
  /^alter\s+system\b/i,
  /^discard\s+all\b/i
]
// Words that can start or end a transaction; with none open, auto mode checks after these only.
const TRANSACTION_WORDS =
  /\b(begin|start|commit|rollback|end|abort|savepoint|release|set|call|exec|execute|xa)\b/i

const LEAVE_MANUAL_MESSAGE =
  'Commit or roll back the open transaction before switching to auto-commit.'

/** False for statements manual mode must run outside a transaction (psql's AUTOCOMMIT off rule). */
export function beginsImplicitTransaction(sql: string): boolean {
  const text = sql.trimStart()
  return (
    !NO_BEGIN_KEYWORDS.has(leadingKeyword(text)) &&
    !NO_BEGIN_PHRASES.some((phrase) => phrase.test(text))
  )
}

export function mayChangeTransaction(sql: string): boolean {
  return TRANSACTION_WORDS.test(sql)
}

function leavesResultOpen(result: DatabaseExecuteResult): boolean {
  return result.results.some((entry) => entry.kind === 'rows' && entry.hasMore)
}

/**
 * Keeps one console session in the requested transaction mode and reports its transaction.
 * Checking costs a round trip, so auto mode checks only while one is open or might have begun.
 */
export class ConsoleTransactions {
  // Null until the first statement, so a server whose default differs is set explicitly.
  private mode: DatabaseTransactionMode | null = null
  private known: DatabaseTransactionState = 'none'

  constructor(private readonly control: ConsoleTransactionControl) {}

  /** Whether the last check saw a transaction the session would lose if it dropped. */
  get isOpen(): boolean {
    return this.known !== 'none'
  }

  async run(
    mode: DatabaseTransactionMode,
    sql: string,
    execute: () => Promise<DatabaseExecuteResult>
  ): Promise<DatabaseExecuteResult> {
    await this.applyMode(mode)
    if (mode === 'manual' && !this.isOpen && this.control.begin && beginsImplicitTransaction(sql)) {
      await this.control.begin()
      this.known = 'open'
    }
    const check = mode === 'manual' || this.isOpen || mayChangeTransaction(sql)
    let result: DatabaseExecuteResult
    try {
      result = await execute()
    } catch (error) {
      if (!check) {
        throw error
      }
      const transaction = await this.refresh()
      throw new DatabaseWireError({ ...toDatabaseError(error), transaction })
    }
    if (!check) {
      return result
    }
    // Why skip the check: the open result still holds the session, so a query would queue behind it.
    const transaction = leavesResultOpen(result) ? this.known : await this.refresh()
    return { ...result, transaction }
  }

  private async applyMode(mode: DatabaseTransactionMode): Promise<void> {
    if (mode === this.mode) {
      return
    }
    // Why refuse: turning autocommit back on would silently commit the open transaction.
    if (mode === 'auto' && this.isOpen) {
      throw new DatabaseWireError({ message: LEAVE_MANUAL_MESSAGE, transaction: this.known })
    }
    await this.control.setManual?.(mode === 'manual')
    this.mode = mode
  }

  private async refresh(): Promise<DatabaseTransactionState> {
    this.known = await this.control.state().catch(() => this.known)
    return this.known
  }
}
