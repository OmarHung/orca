import { describe, expect, it } from 'vitest'
import { findDumpTool, majorVersion, parseToolVersion, type ToolProbe } from './native-dump-tools'

/** A probe over a fake file system: `tools` maps executable paths to their --version output. */
function probe(tools: Record<string, string>, options: Partial<ToolProbe> = {}): ToolProbe {
  const paths = Object.keys(tools)
  return {
    platform: 'darwin',
    env: { PATH: '/usr/bin:/opt/homebrew/bin' },
    listDir: async (dir) => [
      ...new Set(
        paths
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split('/')[0]!)
      )
    ],
    executable: async (path) => (path in tools ? path : null),
    version: async (path) => tools[path] ?? null,
    ...options
  }
}

describe('parseToolVersion', () => {
  it('reads PostgreSQL, MySQL and MariaDB tools', () => {
    expect(parseToolVersion('pg_dump (PostgreSQL) 17.9 (Homebrew)')).toEqual({
      version: '17.9',
      mariadb: false
    })
    expect(
      parseToolVersion('mysqldump  Ver 8.4.3 for macos14 on arm64 (MySQL Community Server - GPL)')
    ).toEqual({ version: '8.4.3', mariadb: false })
    expect(
      parseToolVersion('mariadb-dump from 11.8.9-MariaDB, client 10.20 for debian-linux-gnu')
    ).toEqual({ version: '11.8.9', mariadb: true })
    expect(
      parseToolVersion('mysqldump  Ver 10.19 Distrib 10.5.21-MariaDB, for debian-linux-gnu')
    ).toEqual({ version: '10.5.21', mariadb: true })
    expect(parseToolVersion('command not found')).toBeNull()
  })

  it('compares PostgreSQL 9.x by its first two parts', () => {
    expect(majorVersion('17.9')).toBe(17)
    expect(majorVersion('9.6.24')).toBeCloseTo(9.6)
  })
})

describe('findDumpTool', () => {
  it('picks the newest pg_dump from PATH and Homebrew’s versioned folders', async () => {
    const tool = await findDumpTool(
      { driver: 'postgres', serverVersion: '16.4 (Debian 16.4-1)' },
      probe({
        '/usr/bin/pg_dump': 'pg_dump (PostgreSQL) 14.12',
        '/opt/homebrew/opt/postgresql@17/bin/pg_dump': 'pg_dump (PostgreSQL) 17.9 (Homebrew)'
      })
    )
    expect(tool).toEqual({
      kind: 'pg_dump',
      flavor: 'postgres',
      path: '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
      version: '17.9',
      problem: null
    })
  })

  it('says why a pg_dump older than the server can’t be used', async () => {
    const tool = await findDumpTool(
      { driver: 'postgres', serverVersion: '17.2' },
      probe({ '/usr/bin/pg_dump': 'pg_dump (PostgreSQL) 15.8' })
    )
    expect(tool?.problem).toMatch(/older than the server \(PostgreSQL 17\)/)
  })

  it('prefers the client of the server’s own flavor, then the newest', async () => {
    const tools = {
      '/usr/local/mysql/bin/mysqldump': 'mysqldump  Ver 8.4.3 for macos14 on arm64',
      '/opt/homebrew/opt/mariadb/bin/mariadb-dump': 'mariadb-dump from 11.4.2-MariaDB, client 10.19'
    }
    expect(
      await findDumpTool(
        { driver: 'mysql', serverVersion: '10.5.21-MariaDB-0+deb11u1' },
        probe(tools)
      )
    ).toMatchObject({ kind: 'mariadb-dump', flavor: 'mariadb' })
    expect(
      await findDumpTool({ driver: 'mysql', serverVersion: '8.4.2' }, probe(tools))
    ).toMatchObject({ kind: 'mysqldump', flavor: 'mysql', version: '8.4.3' })
  })

  it('looks under Program Files on Windows, and finds nothing where there is nothing', async () => {
    const windows = probe(
      { 'C:\\Program Files/PostgreSQL/16/bin/pg_dump.exe': 'pg_dump (PostgreSQL) 16.3' },
      { platform: 'win32', env: { Path: '', ProgramFiles: 'C:\\Program Files' } }
    )
    expect(
      await findDumpTool({ driver: 'postgres', serverVersion: '16.1' }, windows)
    ).toMatchObject({
      version: '16.3'
    })
    expect(await findDumpTool({ driver: 'postgres', serverVersion: '16.1' }, probe({}))).toBeNull()
  })
})
