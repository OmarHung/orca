import { dialog, type BrowserWindow } from 'electron'
import type {
  DatabaseExportFormat,
  DatabaseSaveExportRequest
} from '../../shared/database/database-export-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'

const FILTERS: Record<DatabaseExportFormat, Electron.FileFilter> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  tsv: { name: 'TSV', extensions: ['tsv'] },
  json: { name: 'JSON', extensions: ['json'] },
  sql: { name: 'SQL', extensions: ['sql'] }
}

// oxlint-disable-next-line no-control-regex -- control characters are illegal in file names
const ILLEGAL_FILE_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g
const MAX_BASE_NAME_LENGTH = 100
// Why: Windows strips these, so `orders.` would name the same file (or folder) as `orders`.
const TRAILING_DOTS_AND_SPACES = /[. ]+$/
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i

/** Keeps the suggested name legal on every platform (Windows forbids the most). */
export function exportBaseName(suggestedName: string): string {
  const name = suggestedName
    .replace(ILLEGAL_FILE_NAME_CHARS, '_')
    .slice(0, MAX_BASE_NAME_LENGTH)
    .trim()
    .replace(TRAILING_DOTS_AND_SPACES, '')
  if (!name) {
    return 'export'
  }
  // Why: Windows opens a device for `con`, `con.txt` or `NUL .csv`, whatever the extension.
  const dot = name.indexOf('.')
  const stem = (dot === -1 ? name : name.slice(0, dot)).trimEnd()
  return WINDOWS_DEVICE_NAME.test(stem) ? `${stem}_${name.slice(stem.length)}` : name
}

export function exportFileName(suggestedName: string, format: DatabaseExportFormat): string {
  return `${exportBaseName(suggestedName)}.${format}`
}

/**
 * Asks where to save, then writes the text through a temp file renamed into place, so a failed
 * write leaves an existing file whole. A cancelled dialog resolves to `null`.
 */
export async function saveDatabaseExport(
  window: BrowserWindow | null,
  request: DatabaseSaveExportRequest
): Promise<DatabaseResult<{ filePath: string } | null>> {
  const options: Electron.SaveDialogOptions = {
    defaultPath: exportFileName(request.suggestedName, request.format),
    filters: [FILTERS[request.format]]
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) {
    return { ok: true, value: null }
  }
  try {
    await writeFileDurable(durableWriteTempPath(result.filePath), result.filePath, request.content)
    return { ok: true, value: { filePath: result.filePath } }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}
