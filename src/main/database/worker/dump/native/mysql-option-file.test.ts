import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpTool } from '../../../../../shared/database/database-dump-types'
import {
  mysqlOptionFileText,
  removeAbandonedMysqlOptionFiles,
  writeMysqlOptionFile
} from './mysql-option-file'
import { mysqldumpPlan } from './mysqldump-plan'

const root = mkdtempSync(join(tmpdir(), 'orca-option-file-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// A pid no system hands out.
const GONE_PID = 2_147_483_000

const MYSQLDUMP: DatabaseDumpTool = {
  kind: 'mysqldump',
  flavor: 'mysql',
  path: '/usr/local/bin/mysqldump',
  version: '8.4.3',
  problem: null
}

describe('writeMysqlOptionFile', () => {
  it('writes the password where only the current user can read it, and removes it', async () => {
    const file = await writeMysqlOptionFile('s3cret"pw', { root })
    expect(readFileSync(file.path, 'utf8')).toBe(mysqlOptionFileText('s3cret"pw'))
    // Windows gets a current-user-only ACL from writeSecureFile instead of mode bits.
    if (process.platform !== 'win32') {
      expect(statSync(file.path).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(file.path)).mode & 0o777).toBe(0o700)
    }
    await file.remove()
    expect(existsSync(dirname(file.path))).toBe(false)
  })

  it('leaves nothing behind and refuses when the file couldn’t be restricted', async () => {
    const before = readdirSync(root)
    await expect(writeMysqlOptionFile('pw', { root, write: () => false })).rejects.toThrow(
      /couldn’t limit the MySQL option file to the current user/
    )
    expect(readdirSync(root)).toEqual(before)
  })

  it('removes option files a crashed Orca left, but not a running one’s', async () => {
    const abandoned = join(root, `orca-mysqldump-${GONE_PID}-abc`)
    const ours = join(root, `orca-mysqldump-${process.pid}-def`)
    const running = join(root, `orca-mysqldump-${process.ppid}-ghi`)
    const unrelated = join(root, 'orca-mysqldump-notes')
    for (const folder of [abandoned, ours, running, unrelated]) {
      mkdirSync(folder)
    }
    await removeAbandonedMysqlOptionFiles(root)
    expect(existsSync(abandoned)).toBe(false)
    expect([ours, running, unrelated].every((folder) => existsSync(folder))).toBe(true)
  })
})

describe('mysqldumpPlan', () => {
  it('removes the password file with the plan’s cleanup, and writes none without a password', async () => {
    const input = {
      tool: MYSQLDUMP,
      target: {
        connection: {
          driver: 'mysql' as const,
          name: 'shop',
          host: '127.0.0.1',
          port: 3306,
          database: 'shop',
          user: 'root',
          sslMode: 'disable' as const,
          passwordStorage: 'never' as const
        },
        password: 'pw',
        serverVersion: '8.4.2'
      },
      request: {
        objects: [{ kind: 'table' as const, schema: 'shop', name: 'people' }],
        options: {
          contents: 'structure-and-data' as const,
          disableForeignKeys: true,
          layout: 'single-file' as const,
          rowsPerInsert: 100,
          dropExisting: false
        }
      }
    }
    const plan = await mysqldumpPlan(input, (password) => writeMysqlOptionFile(password, { root }))
    const optionArg = plan.runs[0]!.args[0]!
    const path = optionArg.replace('--defaults-extra-file=', '')
    expect(existsSync(path)).toBe(true)
    await plan.cleanup()
    expect(existsSync(dirname(path))).toBe(false)

    const withoutPassword = await mysqldumpPlan({
      ...input,
      target: { ...input.target, password: null }
    })
    expect(withoutPassword.runs[0]!.args.some((arg) => arg.startsWith('--defaults'))).toBe(false)
  })
})
