import type { ConsoleTransactions } from './console-transactions'
import { DatabaseWireError } from './database-error-mapping'

type PooledConsole = { readonly transactions: ConsoleTransactions; close(): Promise<void> }

const LOST_TRANSACTION_MESSAGE =
  'The server closed this console’s connection, so its open transaction was rolled back. Nothing from it was saved.'

/**
 * One server session per console, opened on first use. A session the server drops reconnects
 * on the console's next statement, but not silently when it held an open transaction.
 */
export class ConsolePool<C extends PooledConsole> {
  private readonly consoles = new Map<string, Promise<C>>()
  private readonly lostInTransaction = new Set<string>()

  constructor(private readonly open: (onLost: () => void) => Promise<C>) {}

  acquire(consoleId: string): Promise<C> {
    if (this.lostInTransaction.delete(consoleId)) {
      return Promise.reject(
        new DatabaseWireError({ message: LOST_TRANSACTION_MESSAGE, transaction: 'none' })
      )
    }
    const existing = this.consoles.get(consoleId)
    if (existing) {
      return existing
    }
    const forget = (): void => {
      if (this.consoles.get(consoleId) !== created) {
        return
      }
      this.consoles.delete(consoleId)
      void created.then(
        (target) => target.transactions.isOpen && this.lostInTransaction.add(consoleId),
        () => undefined
      )
    }
    const created = this.open(forget)
    this.consoles.set(consoleId, created)
    created.catch(forget)
    return created
  }

  /** The console's current session, without opening one. */
  current(consoleId: string): Promise<C> | undefined {
    return this.consoles.get(consoleId)
  }

  async close(consoleId: string): Promise<void> {
    const pending = this.consoles.get(consoleId)
    this.consoles.delete(consoleId)
    this.lostInTransaction.delete(consoleId)
    await pending?.then((target) => target.close()).catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.consoles.keys()].map((consoleId) => this.close(consoleId)))
  }
}
