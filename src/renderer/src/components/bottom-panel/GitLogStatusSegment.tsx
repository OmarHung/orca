import React from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useBottomPanelLayout } from './bottom-panel-layout-store'

/** Status-bar toggle for the bottom Git Log panel, mirroring JetBrains' tool-window button. */
export function GitLogStatusSegment(): React.JSX.Element {
  const open = useBottomPanelLayout((s) => s.open)
  const toggle = useBottomPanelLayout((s) => s.toggle)
  const shortcut = useShortcutLabel('bottomPanel.gitLog.toggle')
  const label = translate('bottomPanel.gitLog.toggleLabel', 'Git Log')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={open}
          aria-label={label}
          data-testid="git-log-status-toggle"
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground',
            open ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={toggle}
        >
          <GitCommitHorizontal className="size-3.5" />
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  )
}
