import { z } from 'zod'

const nameSchema = z.string().min(1).max(256)

/** One object to dump; routines are told apart by `identity` (their signature). */
export const databaseDumpObjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), schema: nameSchema, name: nameSchema }).strict(),
  z.object({ kind: z.literal('view'), schema: nameSchema, name: nameSchema }).strict(),
  z
    .object({
      kind: z.literal('routine'),
      schema: nameSchema,
      name: nameSchema,
      identity: z.string().min(1).max(4096),
      routineKind: z.enum(['function', 'procedure'])
    })
    .strict()
])

export type DatabaseDumpObject = z.infer<typeof databaseDumpObjectSchema>

export const DATABASE_DUMP_MAX_ROWS_PER_INSERT = 1000

export const databaseDumpOptionsSchema = z
  .object({
    /** `data` alone is the SQL INSERT export. */
    contents: z.enum(['structure-and-data', 'structure', 'data']),
    /**
     * Lets the file load in any order: MySQL and SQLite switch foreign key checks off around it,
     * PostgreSQL and SQL Server add the foreign keys after the data instead.
     */
    disableForeignKeys: z.boolean(),
    layout: z.enum(['single-file', 'file-per-table']),
    rowsPerInsert: z.number().int().min(1).max(DATABASE_DUMP_MAX_ROWS_PER_INSERT),
    /** DROP … IF EXISTS before each CREATE. */
    dropExisting: z.boolean(),
    /** `native` runs pg_dump or mysqldump; absent is Orca's own. */
    engine: z.enum(['builtin', 'native']).optional()
  })
  .strict()

export type DatabaseDumpOptions = z.infer<typeof databaseDumpOptionsSchema>

export const databaseDumpRequestSchema = z
  .object({
    /** The database to read (PostgreSQL, SQL Server); absent keeps the connection's. */
    database: nameSchema.optional(),
    objects: z.array(databaseDumpObjectSchema).min(1).max(10_000),
    options: databaseDumpOptionsSchema,
    /**
     * Schemas whose every object is in `objects`. Native tools dump those whole (with their
     * types and functions) and can only pick single tables elsewhere.
     */
    completeSchemas: z.array(nameSchema).max(10_000).optional()
  })
  .strict()

export type DatabaseDumpRequest = z.infer<typeof databaseDumpRequestSchema>

export type DatabaseDumpProgress = {
  /** Tables whose rows are written, against `tableCount`. */
  tablesDone: number
  tableCount: number
  currentTable: string | null
  /** Null when a native tool writes the rows and doesn't report how many. */
  rows: number | null
  bytes: number
}

export type DatabaseDumpSummary = {
  cancelled: boolean
  files: string[]
  tables: number
  rows: number | null
  bytes: number
  durationMs: number
  /** Things the dump could not carry over, e.g. a column type it wrote as text. */
  notes: string[]
}

/** What a background job reports while it runs. */
export type DatabaseJobProgress = { kind: 'dump' } & DatabaseDumpProgress

export type DatabaseJobRef = { connectionId: string; jobId: string }

/** Pushed to the renderer while a job runs. */
export type DatabaseJobEvent = {
  kind: 'job-progress'
  connectionId: string
  jobId: string
  progress: DatabaseJobProgress
}

/** Where a dump goes, chosen in main's save dialog; the path itself stays in main. */
export type DatabaseDumpDestination = { token: string; label: string }

export type DatabasePickDumpDestinationRequest = {
  layout: DatabaseDumpOptions['layout']
  /** File (or folder) name the dialog starts with, without an extension. */
  suggestedName: string
}

export type DatabaseDumpJobRequest = DatabaseJobRef & {
  /** From `pickDumpDestination`; each is good for one dump. */
  token: string
  dump: DatabaseDumpRequest
}

export const DATABASE_JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export type DatabaseDumpToolKind = 'pg_dump' | 'mysqldump' | 'mariadb-dump'

/** The native dump tool Orca would run for a connection. */
export type DatabaseDumpTool = {
  kind: DatabaseDumpToolKind
  /** Whose client it is: a `mysqldump` can come from MariaDB, which takes other SSL options. */
  flavor: 'postgres' | 'mysql' | 'mariadb'
  path: string
  version: string
  /** Why it can't dump this server (e.g. a pg_dump older than the server); null when it can. */
  problem: string | null
}
