import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type DataAttributes = Record<`data-${string}`, string | undefined>

/** One closable tab in a tool window's header: a run in Run, a session in Debug. */
export function BottomPanelSessionTab({
  label,
  title,
  status,
  selected,
  onSelect,
  onClose,
  closeLabel,
  tabProps,
  closeTestId
}: {
  label: string
  title: string
  /** A small leading status mark, e.g. a dot. */
  status: React.ReactNode
  selected: boolean
  onSelect: () => void
  onClose: () => void
  closeLabel: string
  /** Test ids and data attributes for the tab button. */
  tabProps?: DataAttributes
  closeTestId: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex h-6 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-xs transition-colors',
        selected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <button
        {...tabProps}
        type="button"
        role="tab"
        aria-selected={selected}
        title={title}
        className="flex max-w-48 min-w-0 items-center gap-1.5"
        onClick={onSelect}
      >
        {status}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        data-testid={closeTestId}
        className="flex size-4 items-center justify-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100"
        onClick={onClose}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
