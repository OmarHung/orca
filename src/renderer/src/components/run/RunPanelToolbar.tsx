import React from 'react'
import { RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { stopConfiguration } from './run-configuration-control'
import { rerunRunPanelSession } from './run-panel-actions'
import { isRunSessionActive, runStopStage, type RunSession } from './run-session-store'
import { runStopAction } from './run-stop-stage-presentation'
import { configurationIdOfCommandKey } from './run-widget-items'

function ToolbarButton({
  icon: Icon,
  label,
  testId,
  disabled,
  onClick,
  isStop = false
}: {
  icon: LucideIcon
  label: string
  testId: string
  disabled: boolean
  onClick: () => void
  isStop?: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why a span: a disabled button fires no pointer events, so its tooltip would never show. */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon className={cn(isStop && !disabled && 'text-destructive')} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** The Run tool window's vertical toolbar: Rerun and staged Stop for the shown run. */
export function RunPanelToolbar({ session }: { session: RunSession | null }): React.JSX.Element {
  const label = session?.label ?? ''
  const active = session !== null && isRunSessionActive(session.status)
  const canRerun =
    session !== null &&
    (session.target !== undefined || configurationIdOfCommandKey(session.commandKey) !== null)
  const stop = runStopAction(session && active ? runStopStage(session) : 'interrupt', label)
  return (
    <div
      className="flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-border py-1"
      data-testid="run-panel-toolbar"
    >
      <ToolbarButton
        icon={RotateCcw}
        label={translate('run.action.rerun', "Rerun '{{value0}}'", { value0: label })}
        testId="run-panel-rerun"
        disabled={!canRerun}
        onClick={() => {
          if (session) {
            void rerunRunPanelSession(session)
          }
        }}
      />
      <ToolbarButton
        icon={stop.icon}
        label={stop.label}
        testId="run-panel-stop"
        disabled={!active}
        isStop
        onClick={() => {
          if (session) {
            stopConfiguration(session.worktreeId, session.commandKey)
          }
        }}
      />
    </div>
  )
}
