type PooledConsole = { close(): Promise<void> }

/**
 * One server session per console, opened on first use. A session the server drops reconnects
 * on the console's next statement.
 */
export class ConsolePool<C extends PooledConsole> {
  private readonly consoles = new Map<string, Promise<C>>()

  constructor(private readonly open: (consoleId: string, onLost: () => void) => Promise<C>) {}

  acquire(consoleId: string): Promise<C> {
    const existing = this.consoles.get(consoleId)
    if (existing) {
      return existing
    }
    const forget = (): void => {
      if (this.consoles.get(consoleId) === created) {
        this.consoles.delete(consoleId)
      }
    }
    const created = this.open(consoleId, forget)
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
    await pending?.then((target) => target.close()).catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.consoles.keys()].map((consoleId) => this.close(consoleId)))
  }
}
