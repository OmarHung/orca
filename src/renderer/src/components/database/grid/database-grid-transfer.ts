import { toast } from 'sonner'
import { getIntlLocale, translate } from '@/i18n/i18n'
import {
  CLIPBOARD_TEXT_WRITE_MAX_BYTES,
  isClipboardTextByteLengthOverLimit
} from '../../../../../shared/clipboard-text'
import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import {
  DATABASE_EXPORT_MAX_CHARS,
  type DatabaseExportFormat
} from '../../../../../shared/database/database-export-types'
import {
  DATABASE_CELL_PREVIEW_MAX_CHARS,
  isDatabaseTruncatedCell
} from '../../../../../shared/database/database-query-types'
import { asDatabaseResult } from '../database-connections-store'
import {
  toCsv,
  toInsertSql,
  toJson,
  toTsv,
  type GridExportInput,
  type GridSlice
} from './database-grid-export'
import {
  withWholeValues,
  type GridResultSource,
  type WholeValuesFailure
} from './database-grid-long-values'

export type GridCopyFormat = 'tsv' | 'tsv-header' | DatabaseExportFormat

/** Where rows came from: INSERT target table, suggested file name, and the result itself. */
export type GridExportTarget = {
  table: string
  driver: DatabaseDriver
  fileName: string
  /** Holds the whole text of values the grid shows only a preview of. */
  result: GridResultSource
}

/** Placeholder INSERT target for query results, whose source table is unknown. */
export const RESULT_INSERT_TABLE = 'my_table'

const CLIPBOARD_LIMIT_MB = CLIPBOARD_TEXT_WRITE_MAX_BYTES / (1024 * 1024)

export function formatGridText(
  input: GridExportInput,
  format: GridCopyFormat,
  target: GridExportTarget
): string {
  switch (format) {
    case 'tsv':
      return toTsv(input, { header: false })
    case 'tsv-header':
      return toTsv(input, { header: true })
    case 'csv':
      return toCsv(input)
    case 'json':
      return toJson(input)
    case 'sql':
      return toInsertSql(input, { table: target.table, driver: target.driver })
  }
}

type Destination = {
  failedTitle: string
  maxChars: number
  tooLarge: string
  fits: (text: string) => boolean
}

function failureMessage(failure: WholeValuesFailure, destination: Destination): string {
  switch (failure.kind) {
    case 'not-kept':
      return translate(
        'database.grid.valuesGone',
        'Orca no longer holds the whole text of {{value0}} values longer than {{value1}} characters (it keeps a limited amount, newest results first), so nothing was written. Run the query again, then try again.',
        {
          value0: failure.count.toLocaleString(getIntlLocale()),
          value1: DATABASE_CELL_PREVIEW_MAX_CHARS.toLocaleString(getIntlLocale())
        }
      )
    case 'too-large':
      return destination.tooLarge
    case 'read-failed':
      return failure.message
  }
}

/**
 * The slice as `format` text with every value whole, or null once the user was told why it
 * can't be: nothing is ever written from a preview.
 */
async function wholeGridText(
  slice: GridSlice,
  format: GridCopyFormat,
  target: GridExportTarget,
  destination: Destination
): Promise<string | null> {
  const reads = slice.rows.some((row) => row.some(isDatabaseTruncatedCell))
  const toastId = reads
    ? toast.loading(translate('database.grid.readingValues', 'Reading whole values…'))
    : undefined
  let description: string
  try {
    const whole = await withWholeValues(
      slice,
      async (slices) => {
        const response = asDatabaseResult(
          await window.api.database.readLongValues({ ...target.result, slices })
        )
        // Why as gone: a closed session took its values along; reconnecting brings none back.
        return !response.ok && response.error.code === 'not-connected'
          ? { ok: true, value: { values: slices.map(() => null) } }
          : response
      },
      destination.maxChars
    )
    const text = whole.ok ? formatGridText(whole.input, format, target) : null
    if (text !== null && destination.fits(text)) {
      if (toastId !== undefined) {
        toast.dismiss(toastId)
      }
      return text
    }
    description = whole.ok ? destination.tooLarge : failureMessage(whole.failure, destination)
  } catch (error) {
    description = error instanceof Error ? error.message : String(error)
  }
  toast.error(destination.failedTitle, { id: toastId, description })
  return null
}

export async function copyGridText(
  slice: GridSlice,
  format: GridCopyFormat,
  target: GridExportTarget
): Promise<void> {
  const failedTitle = translate('database.grid.copyFailed', 'Copy failed')
  const text = await wholeGridText(slice, format, target, {
    failedTitle,
    maxChars: CLIPBOARD_TEXT_WRITE_MAX_BYTES,
    tooLarge: translate(
      'database.grid.tooLargeToCopy',
      'The copy would pass the clipboard’s {{value0}} MB limit. Select less, or export to a file.',
      { value0: CLIPBOARD_LIMIT_MB }
    ),
    fits: (value) => !isClipboardTextByteLengthOverLimit(value, CLIPBOARD_TEXT_WRITE_MAX_BYTES)
  })
  if (text === null) {
    return
  }
  try {
    await window.api.ui.writeClipboardText(text)
  } catch (error) {
    toast.error(failedTitle, {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function saveGridExport(
  slice: GridSlice,
  format: DatabaseExportFormat,
  target: GridExportTarget
): Promise<void> {
  const failedTitle = translate('database.grid.exportFailed', 'Export failed')
  const content = await wholeGridText(slice, format, target, {
    failedTitle,
    maxChars: DATABASE_EXPORT_MAX_CHARS,
    tooLarge: translate(
      'database.grid.tooLargeToExport',
      'The export would pass {{value0}} characters. Export fewer rows or columns.',
      { value0: DATABASE_EXPORT_MAX_CHARS.toLocaleString(getIntlLocale()) }
    ),
    fits: (value) => value.length <= DATABASE_EXPORT_MAX_CHARS
  })
  if (content === null) {
    return
  }
  const response = asDatabaseResult(
    await window.api.database.saveExport({ suggestedName: target.fileName, format, content })
  )
  if (!response.ok) {
    toast.error(failedTitle, { description: response.error.message })
  } else if (response.value) {
    toast.success(
      translate('database.grid.exported', 'Exported {{value0}} rows', {
        value0: slice.rows.length.toLocaleString(getIntlLocale())
      }),
      { description: response.value.filePath }
    )
  }
}
