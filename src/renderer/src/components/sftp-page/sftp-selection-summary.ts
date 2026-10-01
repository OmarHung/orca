import { translate } from '@/i18n/i18n'
import { formatBytes } from '../status-bar/workspace-space-format'
import type { SftpEntry } from '../../../../shared/sftp-types'

/** The pane footer: how many items the folder holds, or how many are selected and their size. */
export function sftpPaneSummaryText(
  entries: readonly SftpEntry[],
  selected: readonly SftpEntry[]
): string {
  if (selected.length === 0) {
    return translate('sftpPage.summary.items', 'Items: {{total}}', { total: entries.length })
  }
  const counts = { selected: selected.length, total: entries.length }
  // Why: a listing reports a folder's own entry size, not what it contains.
  const sized = selected.filter((entry) => entry.kind !== 'directory')
  if (sized.length === 0) {
    return translate('sftpPage.summary.selected', 'Selected: {{selected}} of {{total}}', counts)
  }
  const size = formatBytes(sized.reduce((total, entry) => total + entry.size, 0))
  return sized.length === selected.length
    ? translate('sftpPage.summary.selectedSize', 'Selected: {{selected}} of {{total}} · {{size}}', {
        ...counts,
        size
      })
    : translate(
        'sftpPage.summary.selectedSizeWithoutFolders',
        'Selected: {{selected}} of {{total}} · {{size}} (excluding folders)',
        { ...counts, size }
      )
}
