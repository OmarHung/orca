import { z } from 'zod'

export const databaseScriptOptionsSchema = z
  .object({
    /** Stop at the first failing statement, or run the rest and report every failure. */
    onError: z.enum(['stop', 'continue']),
    /** Runs every file in one transaction: committed at the end, rolled back on a failure. */
    transaction: z.boolean(),
    /** The database to run in (PostgreSQL, SQL Server); absent keeps the connection's. */
    database: z.string().min(1).max(256).optional(),
    /** The schema (MySQL database) to start in; absent keeps the connection's default. */
    schema: z.string().min(1).max(256).optional()
  })
  .strict()

export type DatabaseScriptOptions = z.infer<typeof databaseScriptOptionsSchema>

/** A script file the user picked; its path stays in main. */
export type DatabaseScriptFile = { name: string; size: number }

export type DatabasePickedScripts = { token: string; files: DatabaseScriptFile[] }

export type DatabaseScriptProgress = {
  fileIndex: number
  fileCount: number
  fileName: string
  /** Bytes read across every file so far, against `totalBytes`. */
  bytesDone: number
  totalBytes: number
  statements: number
  failed: number
}

/** What a background job reports while it runs. */
export type DatabaseJobProgress = { kind: 'script' } & DatabaseScriptProgress

export type DatabaseScriptFailure = {
  file: string
  /** 1-based line where the statement starts. */
  line: number
  message: string
  /** The statement's start, shortened. */
  statement: string
}

export type DatabaseScriptSummary = {
  statements: number
  failed: number
  cancelled: boolean
  durationMs: number
  failures: DatabaseScriptFailure[]
  /** Failures beyond the ones kept in `failures`. */
  failuresOmitted: number
  /**
   * What happened to the transaction the run ended in: committed (the run's own), rolled back
   * (after a failure or cancel, or one the script opened and never ended), or null for none.
   */
  transaction: 'committed' | 'rolled-back' | null
}

export const DATABASE_SCRIPT_MAX_FAILURES = 100
export const DATABASE_JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
