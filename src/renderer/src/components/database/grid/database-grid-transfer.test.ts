import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DatabaseCell,
  DatabaseLongValues,
  DatabaseResult
} from '../../../../../shared/database/database-query-types'
import { gridExportSlice } from './database-grid-export'
import { copyGridText, saveGridExport, type GridExportTarget } from './database-grid-transfer'

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'reading'),
  dismiss: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const TEXT = 'y'.repeat(15_000)
const columns = [
  { name: 'id', typeName: 'int' },
  { name: 'body', typeName: 'text' }
]
const rows: DatabaseCell[][] = [
  ['1', 'short'],
  ['2', { preview: TEXT.slice(0, 10_000), length: TEXT.length }]
]
const target: GridExportTarget = {
  table: 'notes',
  driver: 'postgres',
  fileName: 'notes',
  result: { connectionId: 'conn-0001', consoleId: 'console-01', resultId: 'result-1' }
}
const everything = gridExportSlice(columns, rows, [0, 1], null)

function installApi(held: string | null) {
  const api = {
    database: {
      readLongValues: vi.fn(
        async ({
          slices
        }: {
          slices: { start: number; end: number }[]
        }): Promise<DatabaseResult<DatabaseLongValues>> => ({
          ok: true,
          value: { values: slices.map((slice) => held?.slice(slice.start, slice.end) ?? null) }
        })
      ),
      saveExport: vi.fn(async () => ({ ok: true, value: { filePath: '/tmp/notes.csv' } }))
    },
    ui: { writeClipboardText: vi.fn(async () => undefined) }
  }
  vi.stubGlobal('window', { api })
  return api
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('grid export and copy', () => {
  it('exports the whole value, read from the result, and only then reports success', async () => {
    const api = installApi(TEXT)
    await saveGridExport(everything, 'csv', target)
    expect(api.database.readLongValues).toHaveBeenCalledWith({
      ...target.result,
      slices: [{ row: 1, column: 1, start: 0, end: TEXT.length }]
    })
    expect(api.database.saveExport).toHaveBeenCalledWith({
      suggestedName: 'notes',
      format: 'csv',
      content: `id,body\n1,short\n2,${TEXT}`
    })
    expect(toast.success).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refuses the export, saying why, when a value is no longer held', async () => {
    const api = installApi(null)
    await saveGridExport(everything, 'json', target)
    expect(api.database.saveExport).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Export failed', {
      id: 'reading',
      description: expect.stringMatching(/no longer holds the whole text of 1 values longer than/)
    })
  })

  it('explains a session that closed (a restart, a disconnect) as values no longer held', async () => {
    const api = installApi(TEXT)
    api.database.readLongValues.mockResolvedValueOnce({
      ok: false,
      error: { message: 'Not connected', code: 'not-connected' }
    })
    await saveGridExport(everything, 'csv', target)
    expect(api.database.saveExport).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Export failed', {
      id: 'reading',
      description: expect.stringMatching(/no longer holds the whole text of 1 values/)
    })
  })

  it('copies the whole value of a selected cell, with no toast for a plain copy', async () => {
    const api = installApi(TEXT)
    const cell = gridExportSlice(columns, rows, [1, 0], { top: 0, bottom: 0, left: 1, right: 1 })
    await copyGridText(cell, 'tsv', target)
    expect(api.ui.writeClipboardText).toHaveBeenCalledWith(TEXT)
    expect(toast.error).not.toHaveBeenCalled()
    await copyGridText(
      gridExportSlice(columns, rows, [0, 1], { top: 0, bottom: 0, left: 0, right: 1 }),
      'tsv',
      target
    )
    expect(toast.loading).toHaveBeenCalledOnce()
  })

  it('refuses a copy past the clipboard’s limit, and reports a clipboard failure', async () => {
    const huge = 'z'.repeat(17 * 1024 * 1024)
    const api = installApi(huge)
    const big: DatabaseCell[][] = [['1', { preview: huge.slice(0, 10_000), length: huge.length }]]
    await copyGridText(gridExportSlice(columns, big, [0], null), 'tsv', target)
    expect(api.database.readLongValues).not.toHaveBeenCalled()
    expect(api.ui.writeClipboardText).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Copy failed', {
      id: 'reading',
      description: expect.stringMatching(/clipboard’s 16 MB limit/)
    })
    api.ui.writeClipboardText.mockRejectedValueOnce(new Error('Clipboard text is too large'))
    await copyGridText(everything, 'tsv', target)
    expect(toast.error).toHaveBeenLastCalledWith('Copy failed', {
      description: 'Clipboard text is too large'
    })
  })
})
