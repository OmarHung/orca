import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CodeOutlineRow } from './code-outline-tree'
import { CODE_OUTLINE_KIND_ICON } from './code-outline-kind-icon'

type CodeOutlineRowButtonProps = {
  row: CodeOutlineRow
  isCurrent: boolean
  onToggle: (key: string) => void
  onReveal: (row: CodeOutlineRow) => void
}

export const CodeOutlineRowButton = React.memo(function CodeOutlineRowButton({
  row,
  isCurrent,
  onToggle,
  onReveal
}: CodeOutlineRowButtonProps): React.JSX.Element {
  const KindIcon = CODE_OUTLINE_KIND_ICON[row.symbol.kind]
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-selected={isCurrent}
      data-current={isCurrent ? 'true' : undefined}
      data-outline-key={row.key}
      className={cn(
        'flex w-full items-center gap-1 whitespace-nowrap rounded-sm py-1 pr-2 text-left text-xs transition-colors',
        isCurrent ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-foreground'
      )}
      style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
      onClick={() => onReveal(row)}
      onKeyDown={(event) => {
        const wantsToggle =
          (event.key === 'ArrowRight' && !row.isExpanded) ||
          (event.key === 'ArrowLeft' && row.isExpanded)
        if (row.hasChildren && wantsToggle) {
          event.preventDefault()
          onToggle(row.key)
        }
      }}
    >
      {row.hasChildren ? (
        <span
          role="presentation"
          className="flex shrink-0 items-center text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onToggle(row.key)
          }}
        >
          <ChevronRight
            className={cn('size-3 transition-transform', row.isExpanded && 'rotate-90')}
          />
        </span>
      ) : (
        <span className="size-3 shrink-0" />
      )}
      <KindIcon className="size-3 shrink-0 text-muted-foreground" />
      <span>{row.symbol.name}</span>
      {row.symbol.detail ? (
        <span className="text-muted-foreground">{row.symbol.detail}</span>
      ) : null}
    </button>
  )
})
