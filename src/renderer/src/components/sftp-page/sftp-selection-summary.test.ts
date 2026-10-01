import { describe, expect, it } from 'vitest'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpPaneSummaryText } from './sftp-selection-summary'

function entry(name: string, kind: SftpEntry['kind'], size: number): SftpEntry {
  return {
    name,
    path: `/srv/${name}`,
    kind,
    size,
    modifiedMs: 1_700_000_000_000,
    createdMs: null,
    owner: null
  }
}

const report = entry('report.html', 'file', 34_200_000)
const backup = entry('backup.tar', 'file', 2 * 1024 * 1024)
const link = entry('current', 'symlink', 12)
const logs = entry('logs', 'directory', 4096)
const listing = [report, backup, link, logs]

describe('sftpPaneSummaryText', () => {
  it('counts the folder items when nothing is selected', () => {
    expect(sftpPaneSummaryText(listing, [])).toBe('Items: 4')
  })

  it('adds up the sizes of the selected files', () => {
    expect(sftpPaneSummaryText(listing, [report, backup, link])).toBe('Selected: 3 of 4 · 34.6 MB')
  })

  it('leaves selected folders out of the total and says so', () => {
    expect(sftpPaneSummaryText(listing, [backup, logs])).toBe(
      'Selected: 2 of 4 · 2.00 MB (excluding folders)'
    )
  })

  it('shows no size when only folders are selected', () => {
    expect(sftpPaneSummaryText(listing, [logs])).toBe('Selected: 1 of 4')
  })
})
