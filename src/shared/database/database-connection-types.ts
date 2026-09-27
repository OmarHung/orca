import { z } from 'zod'

export const DATABASE_PASSWORD_STORAGE_MODES = ['forever', 'session', 'never'] as const
export type DatabasePasswordStorage = (typeof DATABASE_PASSWORD_STORAGE_MODES)[number]

// Same names and semantics as libpq's sslmode so users can copy them from connection strings.
export const DATABASE_SSL_MODES = ['disable', 'prefer', 'require', 'verify-full'] as const
export type DatabaseSslMode = (typeof DATABASE_SSL_MODES)[number]
// Why no `prefer`: TDS negotiates encryption up front, so there is no plaintext retry to fall back to.
export const SQLSERVER_SSL_MODES = ['disable', 'require', 'verify-full'] as const

export const DATABASE_CONNECTION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export const databaseConnectionIdSchema = z.string().regex(DATABASE_CONNECTION_ID_PATTERN)

/** POSIX, drive-letter or UNC absolute path; checked here so the renderer and main agree. */
export function isAbsoluteDatabaseFilePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

const nameSchema = z.string().trim().min(1).max(120)
/** Marks a connection (e.g. production) across the explorer, tabs and toolbars; null is none. */
const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/)
  .nullable()
  .optional()

const serverFields = {
  name: nameSchema,
  color: colorSchema,
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().max(128),
  user: z.string().max(128),
  passwordStorage: z.enum(DATABASE_PASSWORD_STORAGE_MODES),
  /** Reach the server through a saved SSH host; host and port are then as seen from it. */
  sshTunnel: z
    .object({ targetId: z.string().min(1).max(200) })
    .strict()
    .nullable()
    .optional()
}

export const databaseConnectionDraftSchema = z.discriminatedUnion('driver', [
  z
    .object({ driver: z.literal('postgres'), ...serverFields, sslMode: z.enum(DATABASE_SSL_MODES) })
    .strict(),
  z
    .object({ driver: z.literal('mysql'), ...serverFields, sslMode: z.enum(DATABASE_SSL_MODES) })
    .strict(),
  z
    .object({
      driver: z.literal('sqlserver'),
      ...serverFields,
      sslMode: z.enum(SQLSERVER_SSL_MODES)
    })
    .strict(),
  z
    .object({
      driver: z.literal('sqlite'),
      name: nameSchema,
      color: colorSchema,
      filePath: z.string().min(1).max(4096).refine(isAbsoluteDatabaseFilePath, 'absolute path')
    })
    .strict()
])

export type DatabaseConnectionDraft = z.infer<typeof databaseConnectionDraftSchema>
export type DatabaseDriver = DatabaseConnectionDraft['driver']
export type DatabaseServerConnectionDraft = Exclude<DatabaseConnectionDraft, { driver: 'sqlite' }>

export const DATABASE_DRIVERS = [
  'postgres',
  'mysql',
  'sqlserver',
  'sqlite'
] as const satisfies readonly DatabaseDriver[]

export const DATABASE_DRIVER_NAMES: Record<DatabaseDriver, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  sqlserver: 'SQL Server',
  sqlite: 'SQLite'
}

export const DEFAULT_DATABASE_PORTS: Record<DatabaseServerConnectionDraft['driver'], number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433
}

export function isServerConnection(
  draft: DatabaseConnectionDraft
): draft is DatabaseServerConnectionDraft {
  return draft.driver !== 'sqlite'
}

/** A PostgreSQL or SQL Server connection with no database lists all of the server's. */
export function listsAllDatabases(connection: DatabaseConnectionDraft): boolean {
  return (
    (connection.driver === 'postgres' || connection.driver === 'sqlserver') &&
    connection.database.trim() === ''
  )
}

/** SQLite files have no password, which behaves like "never store one". */
export function databasePasswordStorage(draft: DatabaseConnectionDraft): DatabasePasswordStorage {
  return isServerConnection(draft) ? draft.passwordStorage : 'never'
}

export const databaseConnectionSchema = z.intersection(
  databaseConnectionDraftSchema,
  z.object({
    id: databaseConnectionIdSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
)

export type DatabaseConnection = z.infer<typeof databaseConnectionSchema>

/** What the renderer sees: the stored config plus whether a password is available without asking. */
export type DatabaseConnectionSummary = DatabaseConnection & { hasSavedPassword: boolean }

export function describeDatabaseConnectionTarget(connection: DatabaseConnectionDraft): string {
  if (!isServerConnection(connection)) {
    return connection.filePath
  }
  const database = connection.database ? `/${connection.database}` : ''
  return `${connection.host}:${connection.port}${database}`
}
