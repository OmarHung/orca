import { useRef, useState } from 'react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import {
  databaseCellText,
  type DatabaseQueryResult,
  type DatabaseRowsResult
} from '../../../../../shared/database/database-query-types'
import { asDatabaseResult } from '../database-connections-store'
import type { DatabaseTableTab } from '../database-page-tabs'
import { buildTableCountSql } from '../../../../../shared/database/table-data-sql'

export type TableRowCount =
  | { status: 'idle' }
  | { status: 'counting' }
  | { status: 'done'; count: string }
  | { status: 'error'; message: string }

function formatCount(text: string): string {
  return /^\d+$/.test(text) ? BigInt(text).toLocaleString(getIntlLocale()) : text
}

/**
 * On-demand `count(*)` for the table's applied filter, on the tab's second session so a
 * slow count never blocks paging. A newer request or `reset` discards an older answer.
 */
export function useTableRowCount(
  tab: DatabaseTableTab,
  driver: DatabaseDriver
): { rowCount: TableRowCount; count: () => Promise<void>; reset: () => void } {
  const [rowCount, setRowCount] = useState<TableRowCount>({ status: 'idle' })
  const requestRef = useRef(0)

  const count = async (): Promise<void> => {
    requestRef.current += 1
    const request = requestRef.current
    setRowCount({ status: 'counting' })
    const response = asDatabaseResult(
      await window.api.database.execute({
        connectionId: tab.connectionId,
        consoleId: tab.countConsoleId,
        sql: buildTableCountSql({
          driver,
          schema: tab.schema,
          relation: tab.relation,
          where: tab.where
        }),
        pageSize: 1
      })
    )
    if (request !== requestRef.current) {
      return
    }
    if (!response.ok) {
      setRowCount({ status: 'error', message: response.error.message })
      return
    }
    const rows = response.value.results.find(
      (result: DatabaseQueryResult): result is DatabaseRowsResult => result.kind === 'rows'
    )
    const text = databaseCellText(rows?.rows[0]?.[0] ?? null)
    setRowCount(
      text === null
        ? {
            status: 'error',
            message: translate('database.table.countMissing', 'The count query returned no rows.')
          }
        : { status: 'done', count: formatCount(text) }
    )
  }

  const reset = (): void => {
    requestRef.current += 1
    setRowCount({ status: 'idle' })
  }

  return { rowCount, count, reset }
}
