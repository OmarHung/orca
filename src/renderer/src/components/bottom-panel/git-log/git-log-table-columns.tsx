import type React from 'react'
import { translate } from '@/i18n/i18n'
import {
  BOTTOM_PANEL_SIZE_LIMITS,
  useBottomPanelLayout,
  type BottomPanelSizeKey
} from '../bottom-panel-layout-store'
import { ResizeHandle } from '../ResizeHandle'
import { clampDragSize } from '../use-drag-resize'
import { useBottomPanelRegionResize } from '../use-bottom-panel-region-resize'

export type GitLogColumnId = 'subject' | 'author' | 'date' | 'hash'

/** Slack so auto-fit text never lands exactly on the ellipsis threshold. */
const AUTO_FIT_SLACK_PX = 4

const COLUMNS: readonly { id: GitLogColumnId; sizeKey: BottomPanelSizeKey }[] = [
  { id: 'subject', sizeKey: 'subjectColumnWidth' },
  { id: 'author', sizeKey: 'authorColumnWidth' },
  { id: 'date', sizeKey: 'dateColumnWidth' },
  { id: 'hash', sizeKey: 'hashColumnWidth' }
]

export function buildGitLogGridTemplate(widths: Record<GitLogColumnId, number>): string {
  return COLUMNS.map((column) => `${widths[column.id]}px`).join(' ')
}

export function useGitLogGridTemplate(): string {
  const subject = useBottomPanelLayout((s) => s.subjectColumnWidth)
  const author = useBottomPanelLayout((s) => s.authorColumnWidth)
  const date = useBottomPanelLayout((s) => s.dateColumnWidth)
  const hash = useBottomPanelLayout((s) => s.hashColumnWidth)
  return buildGitLogGridTemplate({ subject, author, date, hash })
}

/**
 * Widest content in a column, header included — Excel's double-click fit. A cell that holds
 * fixed parts plus a truncating text (Subject: graph, ref badges, message) marks that text with
 * `data-git-log-text`, and its hidden overflow is added back.
 */
export function measureGitLogColumnContentWidth(
  container: ParentNode,
  column: GitLogColumnId
): number {
  let widest = 0
  for (const cell of container.querySelectorAll<HTMLElement>(`[data-git-log-col="${column}"]`)) {
    const text = cell.querySelector<HTMLElement>('[data-git-log-text]')
    const hiddenText = text ? Math.max(0, text.scrollWidth - text.clientWidth) : 0
    // Why scrollWidth: cells truncate, so their box width is the column, not the text.
    widest = Math.max(widest, cell.scrollWidth + hiddenText)
  }
  return Math.ceil(widest) + AUTO_FIT_SLACK_PX
}

function ColumnHeaderCell({
  column,
  label,
  tableRef
}: {
  column: (typeof COLUMNS)[number]
  label: string
  tableRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const setSize = useBottomPanelLayout((s) => s.setSize)
  const { min, max } = BOTTOM_PANEL_SIZE_LIMITS[column.sizeKey]
  // Why no container bound: like Excel, a wider table scrolls horizontally instead.
  const resize = useBottomPanelRegionResize(column.sizeKey, 'x', 1, () => max)
  const autoFit = (): void => {
    const table = tableRef.current
    if (table) {
      setSize(
        column.sizeKey,
        clampDragSize(measureGitLogColumnContentWidth(table, column.id), min, max)
      )
    }
  }
  return (
    <span className="relative flex h-full min-w-0 items-center">
      <span className="truncate" data-git-log-col={column.id}>
        {label}
      </span>
      <ResizeHandle
        edge="columnRight"
        label={translate('bottomPanel.gitLog.resizeColumn', 'Resize {{value0}} column', {
          value0: label
        })}
        handleProps={resize.handleProps}
        onDoubleClick={autoFit}
      />
    </span>
  )
}

/** Sticky inside the table's scroll root so it scrolls sideways with the rows. */
export function GitLogTableHeader({
  tableRef,
  gridTemplateColumns
}: {
  tableRef: React.RefObject<HTMLElement | null>
  gridTemplateColumns: string
}): React.JSX.Element {
  const labels: Record<GitLogColumnId, string> = {
    subject: translate('bottomPanel.gitLog.columnSubject', 'Subject'),
    author: translate('bottomPanel.gitLog.columnAuthor', 'Author'),
    date: translate('bottomPanel.gitLog.columnDate', 'Date'),
    hash: translate('bottomPanel.gitLog.columnHash', 'Hash')
  }
  return (
    <div
      className="sticky top-0 z-20 grid h-6 items-center gap-x-3 border-b border-border bg-background px-2 text-[11px] text-muted-foreground"
      style={{ gridTemplateColumns }}
      data-testid="git-log-table-header"
    >
      {COLUMNS.map((column) => (
        <ColumnHeaderCell
          key={column.id}
          column={column}
          label={labels[column.id]}
          tableRef={tableRef}
        />
      ))}
    </div>
  )
}
