import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listLocalDirectory } from './sftp-local-fs'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'sftp-local-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listLocalDirectory', () => {
  it('lists folders first, then files by natural name order, with links marked', async () => {
    writeFileSync(path.join(root, 'file10.txt'), '1234')
    writeFileSync(path.join(root, 'file2.txt'), '12')
    mkdirSync(path.join(root, 'zeta'))
    symlinkSync(path.join(root, 'file2.txt'), path.join(root, 'link'))

    const entries = await listLocalDirectory(root)

    expect(entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ['zeta', 'directory'],
      ['file2.txt', 'file'],
      ['file10.txt', 'file'],
      ['link', 'symlink']
    ])
    expect(entries.find((entry) => entry.name === 'file10.txt')).toMatchObject({
      path: path.join(root, 'file10.txt'),
      size: 4,
      owner: os.userInfo().username
    })
  })

  it('rejects a folder that does not exist', async () => {
    await expect(listLocalDirectory(path.join(root, 'missing'))).rejects.toThrow()
  })
})
