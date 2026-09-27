import { toast } from 'sonner'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import type { DatabaseExportFormat } from '../../../../../shared/database/database-export-types'
import { asDatabaseResult } from '../database-connections-store'
import { toCsv, toInsertSql, toJson, toTsv, type GridExportInput } from './database-grid-export'

export type GridCopyFormat = 'tsv' | 'tsv-header' | DatabaseExportFormat

/** Where rows came from: the INSERT target table and the suggested export file name. */
export type GridExportTarget = { table: string; driver: DatabaseDriver; fileName: string }

/** Placeholder INSERT target for query results, whose source table is unknown. */
export const RESULT_INSERT_TABLE = 'my_table'

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

export function copyGridText(
  input: GridExportInput,
  format: GridCopyFormat,
  target: GridExportTarget
): void {
  void window.api.ui.writeClipboardText(formatGridText(input, format, target))
}

export async function saveGridExport(
  input: GridExportInput,
  format: DatabaseExportFormat,
  target: GridExportTarget
): Promise<void> {
  const response = asDatabaseResult(
    await window.api.database.saveExport({
      suggestedName: target.fileName,
      format,
      content: formatGridText(input, format, target)
    })
  )
  if (!response.ok) {
    toast.error(translate('database.grid.exportFailed', 'Export failed'), {
      description: response.error.message
    })
  } else if (response.value) {
    toast.success(
      translate('database.grid.exported', 'Exported {{value0}} rows', {
        value0: input.rows.length.toLocaleString(getIntlLocale())
      }),
      { description: response.value.filePath }
    )
  }
}
