import React from 'react'
import { cn } from '@/lib/utils'
import type { DragResizeHandleProps } from './use-drag-resize'

const EDGE_CLASS = {
  left: 'absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize',
  right: 'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize',
  top: 'absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize',
  // Why -right-2.5: centers the strip in the 12px grid gap after a table column.
  columnRight: 'absolute inset-y-0 -right-2.5 z-10 w-2 cursor-col-resize'
} as const

/** An invisible hit strip straddling a region's edge; the region needs `relative`. */
export function ResizeHandle({
  edge,
  label,
  handleProps,
  onDoubleClick
}: {
  edge: keyof typeof EDGE_CLASS
  label: string
  handleProps: DragResizeHandleProps
  onDoubleClick?: () => void
}): React.JSX.Element {
  return (
    <div
      {...handleProps}
      aria-label={label}
      onDoubleClick={onDoubleClick}
      className={cn(EDGE_CLASS[edge], 'outline-none hover:bg-ring/30 focus-visible:bg-ring/30')}
    />
  )
}
