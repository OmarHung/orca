import type { DatabaseSslMode } from '../../../../../shared/database/database-connection-types'
import type { DatabaseDumpTool } from '../../../../../shared/database/database-dump-types'
import { writeMysqlOptionFile } from './mysql-option-file'
import { majorVersion } from './native-dump-tools'
import {
  objectsBySchema,
  perTableSnapshotNote,
  type NativeDumpPlan,
  type NativePlanInput,
  type NativeRun
} from './native-dump-plan'

const MYSQL_SSL_MODES: Record<DatabaseSslMode, string> = {
  disable: 'DISABLED',
  prefer: 'PREFERRED',
  require: 'REQUIRED',
  'verify-full': 'VERIFY_IDENTITY'
}

const q = (name: string): string => `\`${name.replaceAll('`', '``')}\``

// Why no "prefer" for MariaDB's client: --ssl fails outright on a server without TLS, so a
// preferred connection tries TLS and retries a run without it (see NativeDumpPlan.withoutTls).
function sslArgs(tool: DatabaseDumpTool, mode: DatabaseSslMode): string[] {
  if (tool.flavor !== 'mariadb') {
    // Why the key: without TLS, MySQL 8's default login (caching_sha2_password) needs the
    // server's public key to send the password, and refuses otherwise.
    const plain = (mode === 'disable' || mode === 'prefer') && majorVersion(tool.version) >= 8
    return [`--ssl-mode=${MYSQL_SSL_MODES[mode]}`, ...(plain ? ['--get-server-public-key'] : [])]
  }
  switch (mode) {
    case 'disable':
      return ['--skip-ssl']
    case 'prefer':
    case 'require':
      return ['--ssl', '--skip-ssl-verify-server-cert']
    case 'verify-full':
      return ['--ssl', '--ssl-verify-server-cert']
  }
}

function withoutTls(args: string[]): string[] {
  return args
    .filter((arg) => arg !== '--skip-ssl-verify-server-cert')
    .map((arg) => (arg === '--ssl' ? '--skip-ssl' : arg))
}

/** mysqldump runs for a request, given where the password's option file is (null: no password). */
export function mysqldumpRuns(
  input: NativePlanInput,
  optionFile: string | null
): Pick<NativeDumpPlan, 'runs' | 'notes' | 'withoutTls'> {
  const { tool, target, request } = input
  const { connection } = target
  const { options } = request
  if (connection.tlsServerName && connection.sslMode === 'verify-full') {
    throw new Error(
      `${tool.kind} can’t check the server’s certificate through an SSH tunnel (it would check it against 127.0.0.1). Use Orca’s built-in dump, or SSL "require".`
    )
  }
  const withStructure = options.contents !== 'data'
  const notes: string[] = []
  const common = [
    // Must come first: MySQL clients only take it as the first option.
    ...(optionFile ? [`--defaults-extra-file=${optionFile}`] : []),
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    ...(connection.user ? [`--user=${connection.user}`] : []),
    // Why TCP: "localhost" would otherwise mean the local socket, ignoring the port.
    '--protocol=TCP',
    '--single-transaction',
    '--no-tablespaces',
    '--default-character-set=utf8mb4',
    '--hex-blob',
    ...sslArgs(tool, connection.sslMode),
    ...(tool.flavor === 'mysql'
      ? [
          '--set-gtid-purged=OFF',
          // Why: MySQL 8's mysqldump otherwise asks MariaDB for a table it doesn't have.
          ...(majorVersion(tool.version) >= 8 ? ['--skip-column-statistics'] : [])
        ]
      : []),
    ...(options.rowsPerInsert === 1 ? ['--skip-extended-insert'] : []),
    ...(withStructure && !options.dropExisting ? ['--skip-add-drop-table'] : []),
    ...(options.contents === 'structure'
      ? ['--no-data']
      : options.contents === 'data'
        ? ['--no-create-info', '--skip-triggers']
        : [])
  ]
  const routinesOnly = [...common, '--no-create-info', '--no-data', '--skip-triggers', '--routines']
  const groups = objectsBySchema(request)
  const complete = new Set(request.completeSchemas ?? [])
  const prelude = (database: string): string =>
    groups.size > 1
      ? `${withStructure ? `CREATE DATABASE IF NOT EXISTS ${q(database)};\n` : ''}USE ${q(database)};\n\n`
      : ''
  const runs: NativeRun[] = []
  for (const [database, objects] of groups) {
    const relations = objects.filter((object) => object.kind !== 'routine')
    const routines = withStructure && objects.some((object) => object.kind === 'routine')
    const tables = objects.filter((object) => object.kind === 'table').length
    if (routines && !complete.has(database)) {
      notes.push(`${tool.kind} writes every routine of ${database}, not only the ones selected.`)
    }
    if (options.layout === 'file-per-table') {
      for (const table of relations.filter((relation) => relation.kind === 'table')) {
        runs.push({
          label: `${database}.${table.name}`,
          args: [...common, database, table.name],
          prelude: prelude(database),
          tables: 1
        })
      }
      // Why one file for views: mysqldump orders views that select from views only within a run.
      const views = relations.filter((relation) => relation.kind === 'view')
      if (views.length > 0) {
        runs.push({
          label: `${database}.views`,
          args: [...common, database, ...views.map((view) => view.name)],
          prelude: prelude(database),
          tables: 0
        })
      }
      if (routines) {
        runs.push({
          label: `${database}.routines`,
          args: [...routinesOnly, database],
          prelude: prelude(database),
          tables: 0
        })
      }
    } else if (relations.length > 0) {
      const names = complete.has(database) ? [] : relations.map((relation) => relation.name)
      runs.push({
        label: database,
        args: [...common, ...(routines ? ['--routines'] : []), database, ...names],
        prelude: prelude(database),
        tables
      })
    } else if (routines) {
      runs.push({
        label: database,
        args: [...routinesOnly, database],
        prelude: prelude(database),
        tables
      })
    }
  }
  if (withStructure) {
    notes.push(
      `${tool.kind} keeps the DEFINER of any view, routine or trigger it writes; loading those as another account needs the privilege to set it.`
    )
  }
  if (options.layout === 'file-per-table') {
    notes.push(perTableSnapshotNote(tool))
  }
  const preferred = tool.flavor === 'mariadb' && connection.sslMode === 'prefer'
  return { runs, notes, withoutTls: preferred ? withoutTls : null }
}

/** The runs, with the password in an option file that the plan's cleanup removes. */
export async function mysqldumpPlan(
  input: NativePlanInput,
  writeOptionFile: typeof writeMysqlOptionFile = writeMysqlOptionFile
): Promise<NativeDumpPlan> {
  const password = input.target.password
  const optionFile = password === null ? null : await writeOptionFile(password)
  const cleanup = async (): Promise<void> => {
    await optionFile?.remove()
  }
  try {
    return {
      tool: input.tool,
      env: { ...process.env },
      ...mysqldumpRuns(input, optionFile?.path ?? null),
      cleanup
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
