export const DATABASE_EXPORT_FORMATS = ['csv', 'tsv', 'json', 'sql'] as const

export type DatabaseExportFormat = (typeof DATABASE_EXPORT_FORMATS)[number]

// Why a cap: the text crosses IPC as one string; 100k wide rows stay well under it.
export const DATABASE_EXPORT_MAX_CHARS = 256 * 1024 * 1024

export type DatabaseSaveExportRequest = {
  /** File name without extension, offered in the save dialog. */
  suggestedName: string
  format: DatabaseExportFormat
  content: string
}
