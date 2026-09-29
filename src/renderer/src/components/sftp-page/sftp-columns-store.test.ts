// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SFTP_COLUMN_WIDTHS,
  MAX_SFTP_COLUMN_WIDTH,
  MIN_SFTP_COLUMN_WIDTH,
  sftpRowWidthPx
} from './sftp-columns'
import { useSftpColumnsStore } from './sftp-columns-store'
import { DEFAULT_SFTP_SORT } from './sftp-entry-sort'

function persisted(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem('orca.sftpColumns') ?? '{}')
}

beforeEach(() => {
  window.localStorage.clear()
  useSftpColumnsStore.setState({
    hiddenColumns: [],
    sortByPane: { local: DEFAULT_SFTP_SORT, remote: DEFAULT_SFTP_SORT },
    columnWidths: { ...DEFAULT_SFTP_COLUMN_WIDTHS }
  })
})

describe('column widths', () => {
  it('clamps widths and saves only when asked, so a drag writes once on release', () => {
    const { setColumnWidth } = useSftpColumnsStore.getState()

    setColumnWidth('name', 5, false)
    expect(useSftpColumnsStore.getState().columnWidths.name).toBe(MIN_SFTP_COLUMN_WIDTH)
    expect(persisted()).toEqual({})

    setColumnWidth('name', 99_999)
    expect(useSftpColumnsStore.getState().columnWidths.name).toBe(MAX_SFTP_COLUMN_WIDTH)
    expect(persisted()).toMatchObject({ columnWidths: { name: MAX_SFTP_COLUMN_WIDTH } })
  })

  it('resets one column to its default', () => {
    const { setColumnWidth, resetColumnWidth } = useSftpColumnsStore.getState()
    setColumnWidth('size', 300)

    resetColumnWidth('size')

    expect(useSftpColumnsStore.getState().columnWidths.size).toBe(DEFAULT_SFTP_COLUMN_WIDTHS.size)
  })

  it('sizes a row from the visible columns only', () => {
    const widths = { ...DEFAULT_SFTP_COLUMN_WIDTHS, name: 200, size: 100 }

    expect(sftpRowWidthPx(['name', 'size'], widths) - sftpRowWidthPx(['name'], widths)).toBe(100)
  })
})
