import {
  DEFAULT_POSTGRES_PORT,
  databaseConnectionDraftSchema,
  type DatabaseConnectionDraft,
  type DatabaseConnectionSummary,
  type DatabasePasswordStorage,
  type PostgresSslMode
} from '../../../../../shared/database/database-connection-types'

export type DatabaseConnectionFormState = {
  name: string
  host: string
  port: string
  database: string
  user: string
  /** Typed password; empty with `passwordEdited` false keeps the saved one. */
  password: string
  passwordEdited: boolean
  passwordStorage: DatabasePasswordStorage
  sslMode: PostgresSslMode
  readOnly: boolean
}

export function initialConnectionForm(
  existing: DatabaseConnectionSummary | null,
  canStorePasswords: boolean
): DatabaseConnectionFormState {
  if (existing) {
    return {
      name: existing.name,
      host: existing.host,
      port: String(existing.port),
      database: existing.database,
      user: existing.user,
      password: '',
      passwordEdited: false,
      passwordStorage: existing.passwordStorage,
      sslMode: existing.sslMode,
      readOnly: existing.readOnly
    }
  }
  return {
    name: '',
    host: 'localhost',
    port: String(DEFAULT_POSTGRES_PORT),
    database: 'postgres',
    user: 'postgres',
    password: '',
    passwordEdited: false,
    passwordStorage: canStorePasswords ? 'forever' : 'session',
    sslMode: 'prefer',
    readOnly: false
  }
}

/** DataGrip-style default name, used when the Name field is left blank. */
export function defaultConnectionName(form: DatabaseConnectionFormState): string {
  const database = form.database.trim() || form.user.trim() || 'postgres'
  return `${database}@${form.host.trim() || 'localhost'}`
}

export type ConnectionFormParse =
  | { ok: true; draft: DatabaseConnectionDraft }
  | { ok: false; invalidFields: ReadonlySet<keyof DatabaseConnectionFormState> }

export function parseConnectionForm(form: DatabaseConnectionFormState): ConnectionFormParse {
  const port = Number(form.port)
  const candidate = {
    driver: 'postgres' as const,
    name: form.name.trim() || defaultConnectionName(form),
    host: form.host.trim(),
    port: Number.isInteger(port) ? port : Number.NaN,
    database: form.database.trim(),
    user: form.user,
    sslMode: form.sslMode,
    readOnly: form.readOnly,
    passwordStorage: form.passwordStorage
  }
  const result = databaseConnectionDraftSchema.safeParse(candidate)
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

const FORM_FIELDS = [
  'name',
  'host',
  'port',
  'database',
  'user',
  'password',
  'passwordEdited',
  'passwordStorage',
  'sslMode',
  'readOnly'
] as const satisfies readonly (keyof DatabaseConnectionFormState)[]

function isFormField(value: unknown): value is keyof DatabaseConnectionFormState {
  return FORM_FIELDS.some((field) => field === value)
}

/** `undefined` keeps the saved password; a string replaces it. */
export function passwordToSave(form: DatabaseConnectionFormState): string | undefined {
  return form.passwordEdited ? form.password : undefined
}
