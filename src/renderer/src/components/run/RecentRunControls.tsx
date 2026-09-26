import React from 'react'
import { Play } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { RunSessionControls } from './RunSessionControls'
import { runConfiguration } from './run-configuration-control'
import { useRunSessionStore } from './run-session-store'

/** The worktree's last detected configuration (e.g. from the file tree), ready to run again. */
export function RecentRunControls({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const target = useRunSessionStore((s) => s.lastDetectedRunByWorktree[worktreeId])
  if (!target) {
    return null
  }
  const label = translate('run.action.runNamed', "Run '{{value0}}'", {
    value0: target.command.label
  })
  return (
    <div data-testid="recent-run-controls" className="my-auto flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            data-testid="recent-run-button"
            className="flex h-6 max-w-48 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            onClick={() => void runConfiguration(target)}
          >
            <Play className="size-3 shrink-0" fill="currentColor" strokeWidth={0} />
            <span className="truncate">{target.command.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {target.command.command}
        </TooltipContent>
      </Tooltip>
      <RunSessionControls target={target} testId="recent-run-session-controls" />
    </div>
  )
}
