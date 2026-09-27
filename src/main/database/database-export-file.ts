import { writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow } from 'electron'
import type {
  DatabaseExportFormat,
  DatabaseSaveExportRequest
} from '../../shared/database/database-export-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'

const FILTERS: Record<DatabaseExportFormat, Electron.FileFilter> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  tsv: { name: 'TSV', extensions: ['tsv'] },
  json: { name: 'JSON', extensions: ['json'] },
  sql: { name: 'SQL', extensions: ['sql'] }
}

// oxlint-disable-next-line no-control-regex -- control characters are illegal in file names
const ILLEGAL_FILE_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g

/** Keeps the suggested name legal on every platform (Windows forbids the most). */
export function exportBaseName(suggestedName: string): string {
  return suggestedName.replace(ILLEGAL_FILE_NAME_CHARS, '_').slice(0, 100).trim() || 'export'
}

export function exportFileName(suggestedName: string, format: DatabaseExportFormat): string {
  return `${exportBaseName(suggestedName)}.${format}`
}

/** Asks where to save, then writes the text. A cancelled dialog resolves to `null`. */
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
    await writeFile(result.filePath, request.content, 'utf8')
    return { ok: true, value: { filePath: result.filePath } }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}
