import { constants } from 'node:fs'
import { access, readdir, realpath } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type {
  DatabaseDumpTool,
  DatabaseDumpToolKind
} from '../../../../../shared/database/database-dump-types'
import { runProcess } from '../../../../../shared/child-process/run-process'

// Why a cap: a PATH full of old installs shouldn't turn opening a dialog into dozens of spawns.
const MAX_CANDIDATES = 12
const VERSION_TIMEOUT_MS = 5_000
const VERSION_ORDER = new Intl.Collator(undefined, { numeric: true })

export type DumpToolServer = { driver: 'postgres' | 'mysql'; serverVersion: string }

/** A folder to look in, or every entry of `parent` starting with `prefix`, joined with `under`. */
type ToolDir = string | { parent: string; prefix: string; under: string }

export type ToolProbe = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  listDir: (dir: string) => Promise<string[]>
  /** The resolved path when `path` is an executable file, else null. */
  executable: (path: string) => Promise<string | null>
  /** The tool's `--version` output, or null when it didn't run. */
  version: (path: string) => Promise<string | null>
}

export const localToolProbe: ToolProbe = {
  platform: process.platform,
  env: process.env,
  listDir: (dir) => readdir(dir).catch(() => []),
  executable: async (path) => {
    try {
      await access(path, constants.X_OK)
      return await realpath(path)
    } catch {
      return null
    }
  },
  version: async (path) => {
    const result = await runProcess({
      program: path,
      args: ['--version'],
      timeoutMs: VERSION_TIMEOUT_MS
    }).catch(() => null)
    return result?.code === 0 ? result.stdout : null
  }
}

function knownDirs(driver: DumpToolServer['driver'], probe: ToolProbe): ToolDir[] {
  const brew = ['/opt/homebrew', '/usr/local']
  if (probe.platform === 'darwin') {
    return driver === 'postgres'
      ? [
          ...brew.map((root) => `${root}/opt/libpq/bin`),
          ...brew.map((root) => ({ parent: `${root}/opt`, prefix: 'postgresql', under: 'bin' })),
          { parent: '/Applications/Postgres.app/Contents/Versions', prefix: '', under: 'bin' },
          '/opt/homebrew/bin',
          '/usr/local/bin'
        ]
      : [
          ...brew.flatMap((root) => [
            { parent: `${root}/opt`, prefix: 'mysql', under: 'bin' },
            { parent: `${root}/opt`, prefix: 'mariadb', under: 'bin' }
          ]),
          '/usr/local/mysql/bin',
          { parent: '/usr/local', prefix: 'mysql-', under: 'bin' },
          '/opt/homebrew/bin',
          '/usr/local/bin'
        ]
  }
  if (probe.platform === 'win32') {
    const programFiles = probe.env.ProgramFiles ?? 'C:\\Program Files'
    return driver === 'postgres'
      ? [{ parent: join(programFiles, 'PostgreSQL'), prefix: '', under: 'bin' }]
      : [
          { parent: join(programFiles, 'MySQL'), prefix: 'MySQL Server', under: 'bin' },
          { parent: programFiles, prefix: 'MariaDB', under: 'bin' }
        ]
  }
  // Linux and other Unix: distribution packages.
  return driver === 'postgres'
    ? [
        { parent: '/usr/lib/postgresql', prefix: '', under: 'bin' },
        { parent: '/usr', prefix: 'pgsql-', under: 'bin' },
        '/usr/bin'
      ]
    : ['/usr/bin', '/usr/local/mysql/bin']
}

async function expand(dir: ToolDir, probe: ToolProbe): Promise<string[]> {
  if (typeof dir === 'string') {
    return [dir]
  }
  const entries = await probe.listDir(dir.parent)
  // Newest version folders first, so the cap keeps them.
  return entries
    .filter((entry) => entry.startsWith(dir.prefix))
    .sort((a, b) => VERSION_ORDER.compare(b, a))
    .map((entry) => join(dir.parent, entry, dir.under))
}

function toolNames(server: DumpToolServer): DatabaseDumpToolKind[] {
  if (server.driver === 'postgres') {
    return ['pg_dump']
  }
  return /mariadb/i.test(server.serverVersion)
    ? ['mariadb-dump', 'mysqldump']
    : ['mysqldump', 'mariadb-dump']
}

type Found = { kind: DatabaseDumpToolKind; path: string; version: string; mariadb: boolean }

/** `pg_dump (PostgreSQL) 17.9 (Homebrew)`, `mysqldump  Ver 8.4.3 for …`, `… from 11.8.9-MariaDB, …`. */
export function parseToolVersion(output: string): { version: string; mariadb: boolean } | null {
  const mariadb = /(\d+\.\d+\.\d+)-MariaDB/.exec(output)
  if (mariadb) {
    return { version: mariadb[1]!, mariadb: true }
  }
  const version = /(?:\(PostgreSQL\)|Ver)\s+(\d+(?:\.\d+)*)/.exec(output)
  return version ? { version: version[1]!, mariadb: false } : null
}

/** A comparable major version: 17 for 17.9, and 9.6 for PostgreSQL's older 9.6.24. */
export function majorVersion(version: string): number {
  const [first = 0, second = 0] = version.split('.').map(Number)
  return first >= 10 ? first : first + second / 10
}

function compareVersions(a: string, b: string): number {
  return VERSION_ORDER.compare(a, b)
}

function choose(found: readonly Found[], server: DumpToolServer): DatabaseDumpTool | null {
  const serverMariadb = /mariadb/i.test(server.serverVersion)
  const ranked = found.toSorted((a, b) => {
    const flavor = Number(b.mariadb === serverMariadb) - Number(a.mariadb === serverMariadb)
    return server.driver === 'mysql' && flavor !== 0
      ? flavor
      : compareVersions(b.version, a.version)
  })
  const best = ranked[0]
  if (!best) {
    return null
  }
  const serverMajor = majorVersion(/\d+(?:\.\d+)*/.exec(server.serverVersion)?.[0] ?? '0')
  const tooOld = server.driver === 'postgres' && majorVersion(best.version) < serverMajor
  return {
    kind: best.kind,
    flavor: server.driver === 'postgres' ? 'postgres' : best.mariadb ? 'mariadb' : 'mysql',
    path: best.path,
    version: best.version,
    problem: tooOld
      ? `pg_dump ${best.version} is older than the server (PostgreSQL ${serverMajor}) and refuses to dump it. Install pg_dump ${serverMajor} or later.`
      : null
  }
}

/** Finds the native dump tool for a server on PATH and in the usual install folders. */
export async function findDumpTool(
  server: DumpToolServer,
  probe: ToolProbe = localToolProbe
): Promise<DatabaseDumpTool | null> {
  const pathValue = probe.env.PATH ?? probe.env.Path ?? ''
  const dirs = [
    ...pathValue.split(probe.platform === 'win32' ? ';' : delimiter).filter(Boolean),
    ...(await Promise.all(knownDirs(server.driver, probe).map((dir) => expand(dir, probe)))).flat()
  ]
  const suffix = probe.platform === 'win32' ? '.exe' : ''
  const seen = new Set<string>()
  const candidates: { kind: DatabaseDumpToolKind; path: string }[] = []
  for (const kind of toolNames(server)) {
    for (const dir of dirs) {
      const path = await probe.executable(join(dir, `${kind}${suffix}`))
      if (path && !seen.has(path) && candidates.length < MAX_CANDIDATES) {
        seen.add(path)
        candidates.push({ kind, path })
      }
    }
  }
  const found: Found[] = []
  for (const candidate of candidates) {
    const parsed = parseToolVersion((await probe.version(candidate.path)) ?? '')
    if (parsed) {
      found.push({ ...candidate, ...parsed })
    }
  }
  return choose(found, server)
}
