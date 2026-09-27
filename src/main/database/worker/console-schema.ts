import type { DatabaseExecuteResult } from '../../../shared/database/database-query-types'

/** How one console session switches, and reports, where unqualified names resolve. */
export type ConsoleSchemaControl = {
  /** MySQL's USE, PostgreSQL's search_path; runs with no result left open. */
  apply(schema: string): Promise<void>
  current(): Promise<string | null>
  /** Whether a statement the user ran may have switched it (USE, SET search_path). */
  mayChange(sql: string): boolean
}

/**
 * Keeps a console on the schema its tab picked, and follows the user when a statement
 * switches it, so the picker can show where the console really is.
 */
export class ConsoleSchema {
  private applied: string | null = null

  constructor(private readonly control: ConsoleSchemaControl) {}

  async prepare(requested: string | undefined): Promise<void> {
    if (requested === undefined || requested === this.applied) {
      return
    }
    await this.control.apply(requested)
    this.applied = requested
  }

  /** The schema after a statement that may have switched it; undefined when unchanged or unknown. */
  async afterRun(sql: string, result: DatabaseExecuteResult): Promise<string | undefined> {
    // Why skip an open result: the query would queue behind it on the same session.
    const open = result.results.some((entry) => entry.kind === 'rows' && entry.hasMore)
    if (open || !this.control.mayChange(sql)) {
      return undefined
    }
    const current = await this.control.current().catch(() => null)
    if (current === null) {
      return undefined
    }
    this.applied = current
    return current
  }
}
