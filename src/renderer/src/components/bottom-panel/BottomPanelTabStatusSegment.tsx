import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBottomPanelLayout, type BottomPanelTab } from './bottom-panel-layout-store'

type BottomPanelTabStatusSegmentProps = {
  tab: BottomPanelTab
  icon: LucideIcon
  label: string
  shortcut?: string | null
  testId: string
}

/** Status-bar toggle for one bottom-panel tab, mirroring JetBrains' tool-window buttons. */
export function BottomPanelTabStatusSegment({
  tab,
  icon: Icon,
  label,
  shortcut,
  testId
}: BottomPanelTabStatusSegmentProps): React.JSX.Element {
  const active = useBottomPanelLayout((s) => s.open && s.activeTab === tab)
  const toggleTab = useBottomPanelLayout((s) => s.toggleTab)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={active}
          aria-label={label}
          data-testid={testId}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground',
            active ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={() => toggleTab(tab)}
        >
          <Icon className="size-3.5" />
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  )
}
