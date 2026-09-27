import {
  DEFAULT_DATABASE_PORTS,
  databaseConnectionDraftSchema,
  isServerConnection,
  type DatabaseConnectionDraft,
  type DatabaseConnectionSummary,
  type DatabaseDriver,
  type DatabasePasswordStorage,
  type DatabaseSslMode
} from '../../../../../shared/database/database-connection-types'

export type DatabaseConnectionFormState = {
  driver: DatabaseDriver
  name: string
  host: string
  port: string
  database: string
  user: string
  /** Typed password; empty with `passwordEdited` false keeps the saved one. */
  password: string
  passwordEdited: boolean
  passwordStorage: DatabasePasswordStorage
  sslMode: DatabaseSslMode
  readOnly: boolean
  filePath: string
  /** Saved SSH host to tunnel through, or `NO_SSH_TUNNEL`. */
  sshTargetId: string
}

// Why not '': the select primitive reserves the empty value.
export const NO_SSH_TUNNEL = 'none'

type ServerDriver = Exclude<DatabaseDriver, 'sqlite'>

// What a fresh local install of each server usually answers to.
const SERVER_DEFAULTS: Record<ServerDriver, { database: string; user: string }> = {
  postgres: { database: 'postgres', user: 'postgres' },
  mysql: { database: '', user: 'root' },
  sqlserver: { database: 'master', user: 'sa' }
}

function serverDefaults(driver: DatabaseDriver): { port: string; database: string; user: string } {
  if (driver === 'sqlite') {
    return { port: '', database: '', user: '' }
  }
  return { port: String(DEFAULT_DATABASE_PORTS[driver]), ...SERVER_DEFAULTS[driver] }
}

export function initialConnectionForm(
  existing: DatabaseConnectionSummary | null,
  canStorePasswords: boolean
): DatabaseConnectionFormState {
  const base: DatabaseConnectionFormState = {
    driver: 'postgres',
    name: '',
    host: 'localhost',
    ...serverDefaults('postgres'),
    password: '',
    passwordEdited: false,
    passwordStorage: canStorePasswords ? 'forever' : 'session',
    sslMode: 'prefer',
    readOnly: false,
    filePath: '',
    sshTargetId: NO_SSH_TUNNEL
  }
  if (!existing) {
    return base
  }
  if (!isServerConnection(existing)) {
    return {
      ...base,
      driver: 'sqlite',
      name: existing.name,
      readOnly: existing.readOnly,
      filePath: existing.filePath
    }
  }
  return {
    ...base,
    driver: existing.driver,
    name: existing.name,
    host: existing.host,
    port: String(existing.port),
    database: existing.database,
    user: existing.user,
    passwordStorage: existing.passwordStorage,
    sslMode: existing.sslMode,
    readOnly: existing.readOnly,
    sshTargetId: existing.sshTunnel?.targetId ?? NO_SSH_TUNNEL
  }
}

/** Switches driver, replacing port/database/user only where they still hold the old defaults. */
export function changeConnectionDriver(
  form: DatabaseConnectionFormState,
  driver: DatabaseDriver
): DatabaseConnectionFormState {
  const previous = serverDefaults(form.driver)
  const next = serverDefaults(driver)
  const keepOrReset = (key: 'port' | 'database' | 'user'): string =>
    form[key] === previous[key] ? next[key] : form[key]
  return {
    ...form,
    driver,
    port: keepOrReset('port'),
    database: keepOrReset('database'),
    user: keepOrReset('user'),
    // SQL Server negotiates encryption up front; there is no plaintext fallback to prefer.
    sslMode: driver === 'sqlserver' && form.sslMode === 'prefer' ? 'require' : form.sslMode
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? ''
}

/** DataGrip-style default name, used when the Name field is left blank. */
export function defaultConnectionName(form: DatabaseConnectionFormState): string {
  if (form.driver === 'sqlite') {
    return fileName(form.filePath) || 'SQLite'
  }
  const database = form.database.trim() || form.user.trim() || form.driver
  return `${database}@${form.host.trim() || 'localhost'}`
}

function candidateDraft(form: DatabaseConnectionFormState): unknown {
  const name = form.name.trim() || defaultConnectionName(form)
  if (form.driver === 'sqlite') {
    return { driver: 'sqlite', name, filePath: form.filePath.trim(), readOnly: form.readOnly }
  }
  const port = Number(form.port)
  return {
    driver: form.driver,
    name,
    host: form.host.trim(),
    port: Number.isInteger(port) ? port : Number.NaN,
    database: form.database.trim(),
    user: form.user,
    sslMode: form.sslMode,
    readOnly: form.readOnly,
    passwordStorage: form.passwordStorage,
    sshTunnel: form.sshTargetId === NO_SSH_TUNNEL ? null : { targetId: form.sshTargetId }
  }
}

export type ConnectionFormParse =
  | { ok: true; draft: DatabaseConnectionDraft }
  | { ok: false; invalidFields: ReadonlySet<keyof DatabaseConnectionFormState> }

export function parseConnectionForm(form: DatabaseConnectionFormState): ConnectionFormParse {
  const result = databaseConnectionDraftSchema.safeParse(candidateDraft(form))
  if (result.success) {
    return { ok: true, draft: result.data }
  }
  const invalid = new Set<keyof DatabaseConnectionFormState>()
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (isFormField(field)) {
      invalid.add(field)
    }
  }
  return { ok: false, invalidFields: invalid }
}

/** `undefined` keeps the saved password; a string replaces it. SQLite has none. */
export function passwordToSave(form: DatabaseConnectionFormState): string | undefined {
  return form.driver !== 'sqlite' && form.passwordEdited ? form.password : undefined
}

const FORM_FIELDS = [
  'driver',
  'name',
  'host',
  'port',
  'database',
  'user',
  'password',
  'passwordEdited',
  'passwordStorage',
  'sslMode',
  'readOnly',
  'filePath'
] as const satisfies readonly (keyof DatabaseConnectionFormState)[]

function isFormField(value: unknown): value is keyof DatabaseConnectionFormState {
  return FORM_FIELDS.some((field) => field === value)
}
