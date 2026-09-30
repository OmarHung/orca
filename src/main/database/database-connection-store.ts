import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  databaseConnectionSchema,
  type DatabaseConnection,
  type DatabaseConnectionDraft
} from '../../shared/database/database-connection-types'
import { isUnreadableError, writeDurableSecureJsonFile } from '../../shared/secure-file'

type ConnectionsFile = { version: 1; connections: unknown[] }

/** Saved data sources in `userData/database/connections.json`. Never holds passwords. */
export class DatabaseConnectionStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  list(): DatabaseConnection[] {
    return this.read()
  }

  get(id: string): DatabaseConnection | null {
    return this.read().find((connection) => connection.id === id) ?? null
  }

  /** Replaces the connection with `id`, or adds one under `id` (a new id when none is given). */
  save(id: string | undefined, draft: DatabaseConnectionDraft): DatabaseConnection {
    const connections = this.read()
    const existing = id ? connections.find((connection) => connection.id === id) : undefined
    const timestamp = this.now()
    const saved: DatabaseConnection = {
      ...draft,
      id: id ?? randomUUID(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const next = existing
      ? connections.map((connection) => (connection.id === saved.id ? saved : connection))
      : [...connections, saved]
    this.write(next)
    return saved
  }

  /** Files the connections under `group` (null: the top level) in one write. */
  setGroup(ids: readonly string[], group: string | null): void {
    const moving = new Set(ids)
    const connections = this.read()
    const timestamp = this.now()
    const next = connections.map((connection) =>
      moving.has(connection.id) && (connection.group ?? null) !== group
        ? { ...connection, group, updatedAt: timestamp }
        : connection
    )
    if (next.some((connection, index) => connection !== connections[index])) {
      this.write(next)
    }
  }

  delete(id: string): void {
    const connections = this.read()
    const next = connections.filter((connection) => connection.id !== id)
    if (next.length !== connections.length) {
      this.write(next)
    }
  }

  private read(): DatabaseConnection[] {
    if (!existsSync(this.filePath)) {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Why throw: reading "empty" here would let the next save drop every saved connection.
      if (isUnreadableError(error)) {
        throw error
      }
      return []
    }
    const connections: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'connections') : null
    const entries: unknown[] = Array.isArray(connections) ? connections : []
    // Why per entry: one hand-edited or future-format record must not hide the rest.
    return entries.flatMap((entry) => {
      const result = databaseConnectionSchema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  }

  private write(connections: DatabaseConnection[]): void {
    const file: ConnectionsFile = { version: 1, connections }
    writeDurableSecureJsonFile(this.filePath, file)
  }
}
