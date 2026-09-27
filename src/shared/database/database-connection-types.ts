import { z } from 'zod'

export const DATABASE_PASSWORD_STORAGE_MODES = ['forever', 'session', 'never'] as const
export type DatabasePasswordStorage = (typeof DATABASE_PASSWORD_STORAGE_MODES)[number]

// Same names and semantics as libpq's sslmode so users can copy them from connection strings.
export const POSTGRES_SSL_MODES = ['disable', 'prefer', 'require', 'verify-full'] as const
export type PostgresSslMode = (typeof POSTGRES_SSL_MODES)[number]

export const DATABASE_CONNECTION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export const databaseConnectionIdSchema = z.string().regex(DATABASE_CONNECTION_ID_PATTERN)

const postgresConnectionDraftSchema = z
  .object({
    driver: z.literal('postgres'),
    name: z.string().trim().min(1).max(120),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    database: z.string().trim().max(128),
    user: z.string().max(128),
    sslMode: z.enum(POSTGRES_SSL_MODES),
    readOnly: z.boolean(),
    passwordStorage: z.enum(DATABASE_PASSWORD_STORAGE_MODES)
  })
  .strict()

// Why a discriminated union with one member: MySQL, SQL Server and SQLite join it in Phase 1.
export const databaseConnectionDraftSchema = z.discriminatedUnion('driver', [
  postgresConnectionDraftSchema
])

export type DatabaseConnectionDraft = z.infer<typeof databaseConnectionDraftSchema>
export type DatabaseDriver = DatabaseConnectionDraft['driver']

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

export const DEFAULT_POSTGRES_PORT = 5432

export function describeDatabaseConnectionTarget(connection: DatabaseConnectionDraft): string {
  const database = connection.database ? `/${connection.database}` : ''
  return `${connection.host}:${connection.port}${database}`
}
