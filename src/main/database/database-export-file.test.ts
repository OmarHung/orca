import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm, writeFile as writeRealFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { showSaveDialog, faults } = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  faults: { failWrites: false }
}))

vi.mock('electron', () => ({ dialog: { showSaveDialog } }))

// Why both: a failing disk can stop a path write or a handle write halfway through.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  const halfThenFail = async (write: (half: string) => Promise<void>, data: unknown) => {
    await write(String(data).slice(0, 3))
    throw new Error('ENOSPC: no space left on device')
  }
  return {
    ...actual,
    writeFile: (async (file, data, options) =>
      faults.failWrites && typeof file === 'string'
        ? halfThenFail((half) => actual.writeFile(file, half), data)
        : actual.writeFile(file, data, options)) satisfies typeof actual.writeFile,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (faults.failWrites) {
        const write = handle.writeFile.bind(handle)
        handle.writeFile = (data) => halfThenFail((half) => write(half), data)
      }
      return handle
    }) satisfies typeof actual.open
  }
})

import { exportBaseName, exportFileName, saveDatabaseExport } from './database-export-file'

describe('exportFileName', () => {
  it('replaces characters no platform allows and keeps the format extension', () => {
    expect(exportFileName('public/orders:2026', 'csv')).toBe('public_orders_2026.csv')
    expect(exportFileName('a\u0000b\tc', 'json')).toBe('a_b_c.json')
  })

  it('falls back to a default name and caps long names', () => {
    expect(exportFileName('   ', 'sql')).toBe('export.sql')
    expect(exportFileName('x'.repeat(300), 'tsv')).toBe(`${'x'.repeat(100)}.tsv`)
  })

  it('renames Windows device names, with or without an extension', () => {
    expect(exportFileName('CON', 'csv')).toBe('CON_.csv')
    expect(exportFileName('con.txt', 'csv')).toBe('con_.txt.csv')
    for (const name of ['prn', 'AUX', 'Nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM¹']) {
      expect(exportBaseName(name), name).toBe(`${name}_`)
    }
    expect(exportBaseName('NUL .backup')).toBe('NUL_ .backup')
    for (const name of ['CONSOLE', 'connections', 'COM10', 'lpt', 'aux_log', 'nul-orders']) {
      expect(exportBaseName(name), name).toBe(name)
    }
  })

  it('drops trailing dots and spaces, which Windows strips from file and folder names', () => {
    expect(exportBaseName('orders. ')).toBe('orders')
    expect(exportBaseName('sales ...')).toBe('sales')
    expect(exportBaseName('...')).toBe('export')
    expect(exportBaseName('..')).toBe('export')
    expect(exportBaseName(`${'x'.repeat(99)}.y`)).toBe('x'.repeat(99))
    expect(exportBaseName('v1.2 draft')).toBe('v1.2 draft')
  })
})

describe('saveDatabaseExport', () => {
  let directory = ''
  let target = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-db-export-'))
    target = join(directory, 'orders.csv')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
  })

  afterEach(async () => {
    faults.failWrites = false
    showSaveDialog.mockReset()
    await rm(directory, { recursive: true, force: true })
  })

  const save = (content: string) =>
    saveDatabaseExport(null, { suggestedName: 'orders', format: 'csv', content })

  it('replaces the file and leaves no temporary file behind', async () => {
    await writeRealFile(target, 'old rows')

    expect(await save('id\n1\n')).toEqual({ ok: true, value: { filePath: target } })

    expect(await readFile(target, 'utf8')).toBe('id\n1\n')
    expect(await readdir(directory)).toEqual(['orders.csv'])
  })

  it('keeps the existing file whole when the write fails partway', async () => {
    await writeRealFile(target, 'old rows')
    faults.failWrites = true

    const result = await save('id\n1\n2\n3\n')

    expect(result).toEqual({
      ok: false,
      error: { message: expect.stringContaining('no space left on device') }
    })
    expect(await readFile(target, 'utf8')).toBe('old rows')
    expect(await readdir(directory)).toEqual(['orders.csv'])
  })

  it('creates nothing when the first write of a new file fails', async () => {
    faults.failWrites = true

    expect((await save('id\n1\n')).ok).toBe(false)

    expect(await readdir(directory)).toEqual([])
  })

  it('writes nothing when the dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

    expect(await save('id\n1\n')).toEqual({ ok: true, value: null })

    expect(await readdir(directory)).toEqual([])
  })
})
