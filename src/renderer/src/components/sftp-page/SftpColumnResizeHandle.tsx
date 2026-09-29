import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  MAX_SFTP_COLUMN_WIDTH,
  MIN_SFTP_COLUMN_WIDTH,
  sftpColumnLabel,
  type SftpColumnId
} from './sftp-columns'
import { useSftpColumnsStore } from './sftp-columns-store'

const KEYBOARD_STEP_PX = 16

/** Drag the header divider to resize a column; double-click resets it. Shared by both panes. */
export function SftpColumnResizeHandle({ column }: { column: SftpColumnId }): React.JSX.Element {
  const width = useSftpColumnsStore((s) => s.columnWidths[column])
  const setColumnWidth = useSftpColumnsStore((s) => s.setColumnWidth)
  const resetColumnWidth = useSftpColumnsStore((s) => s.resetColumnWidth)
  const [isDragging, setIsDragging] = useState(false)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    setIsDragging(true)
    // Why: window listeners keep the drag alive when the pointer leaves the thin handle.
    const onMove = (move: PointerEvent): void =>
      setColumnWidth(column, startWidth + move.clientX - startX, false)
    const onEnd = (end: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      setIsDragging(false)
      setColumnWidth(column, startWidth + end.clientX - startX)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={translate('sftpPage.column.resize', 'Resize {{column}}', {
        column: sftpColumnLabel(column)
      })}
      aria-valuenow={width}
      aria-valuemin={MIN_SFTP_COLUMN_WIDTH}
      aria-valuemax={MAX_SFTP_COLUMN_WIDTH}
      tabIndex={0}
      data-sftp-resize={column}
      data-dragging={isDragging ? 'true' : undefined}
      onPointerDown={startDrag}
      onDoubleClick={() => resetColumnWidth(column)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowRight'
            ? KEYBOARD_STEP_PX
            : event.key === 'ArrowLeft'
              ? -KEYBOARD_STEP_PX
              : 0
        if (step !== 0) {
          event.preventDefault()
          setColumnWidth(column, width + step)
        }
      }}
      className="group/resize absolute top-0 -right-1 z-10 flex h-full w-2 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span className="h-3.5 w-px bg-border group-hover/resize:bg-ring group-focus-visible/resize:bg-ring group-data-[dragging=true]/resize:bg-ring" />
    </div>
  )
}
