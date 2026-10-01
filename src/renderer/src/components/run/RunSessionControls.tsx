import React from 'react'
import { RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { RunStatusIcon } from './RunStatusIcon'
import { rerunConfiguration, stopConfiguration, type RunTarget } from './run-configuration-control'
import { runTargetMode } from './run-mode'
import { describeRunStatus, runStatusTone } from './run-status-presentation'
import { isRunSessionActive, runStopStage } from './run-session-store'
import { runStopAction } from './run-stop-stage-presentation'
import { useLiveRunSession } from './use-live-run-session'

export type ControlAction = {
  icon: LucideIcon
  label: string
  testId: string
  onClick: () => void
  /** Stop actions are red, as in JetBrains. */
  isStop?: boolean
}

export function ControlButton({ action }: { action: ControlAction }): React.JSX.Element {
  const Icon = action.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={action.label}
          data-testid={action.testId}
          onClick={action.onClick}
        >
          <Icon className={cn(action.isStop && 'text-destructive')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {action.label}
      </TooltipContent>
    </Tooltip>
  )
}

/** JetBrains-style run controls: status, Rerun and Stop for one run configuration. */
export function RunSessionControls({
  target,
  testId = 'run-session-controls',
  onRerun,
  showStop = true
}: {
  target: RunTarget | null
  testId?: string
  /** Replaces the plain rerun, e.g. to repeat trust checks and Before launch steps. */
  onRerun?: () => void
  /** False where a shared Stop control already covers this run. */
  showStop?: boolean
}): React.JSX.Element {
  const session = useLiveRunSession(target)
  const active = session !== null && isRunSessionActive(session.status)
  const label = target?.command.label ?? ''

  const actions: ControlAction[] = []
  if (target && active) {
    actions.push({
      icon: RotateCcw,
      label: translate('run.action.rerun', "Rerun '{{value0}}'", { value0: label }),
      testId: 'run-rerun',
      onClick: () => (onRerun ? onRerun() : void rerunConfiguration(target))
    })
    if (showStop) {
      actions.push({
        ...runStopAction(runStopStage(session), label),
        testId: 'run-stop',
        onClick: () => stopConfiguration(target.worktreeId, target.commandKey),
        isStop: true
      })
    }
  }
  const status = describeRunStatus(session)

  return (
    <div
      data-testid={testId}
      data-run-status={session?.status ?? 'idle'}
      className="my-auto flex shrink-0 items-center gap-0.5"
    >
      {status ? (
        <span className="flex size-4 items-center justify-center" title={`${label}: ${status}`}>
          <RunStatusIcon tone={runStatusTone(session)} mode={runTargetMode(target)} />
        </span>
      ) : null}
      {actions.map((action) => (
        <ControlButton key={action.testId} action={action} />
      ))}
    </div>
  )
}
