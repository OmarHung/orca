import React from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { RunModeIcon } from './RunModeIcon'
import { ControlButton } from './RunSessionControls'
import { gentlestStopStage } from './run-session-store'
import {
  runStopAction,
  stopAllAction,
  stoppingLabel,
  type RunStopAction
} from './run-stop-stage-presentation'
import {
  runningProcesses,
  type RunningProcess,
  type RunWidgetActivity
} from './run-widget-activity'
import { stopAllRunningProcesses, stopRunningProcess } from './run-widget-actions'

export function debugStopAction(name: string): RunStopAction {
  return {
    icon: Square,
    label: translate('run.debug.stop', "Stop debugging '{{value0}}'", { value0: name })
  }
}

function stopProcessAction(process: RunningProcess): RunStopAction {
  return process.kind === 'debug'
    ? debugStopAction(process.label)
    : runStopAction(process.stage, process.label)
}

function StopMenu({
  processes,
  worktreeId
}: {
  processes: readonly RunningProcess[]
  worktreeId: string
}): React.JSX.Element {
  const count = String(processes.length)
  const label = translate('run.widget.stopRunning', 'Stop ({{value0}} running)', { value0: count })
  const stopAll = stopAllAction(
    gentlestStopStage(
      processes.flatMap((process) => (process.kind === 'run' ? [process.stage] : []))
    )
  )
  const StopAllIcon = stopAll.icon
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              data-testid="run-stop"
              className="relative"
            >
              <Square className="text-destructive" />
              <span
                aria-hidden
                className="absolute -right-0.5 -bottom-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none font-medium text-primary-foreground tabular-nums"
              >
                {processes.length > 9 ? '9+' : count}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-52">
        {processes.map((process) => {
          const action = stopProcessAction(process)
          const Icon = action.icon
          return (
            <DropdownMenuItem
              key={process.key}
              data-testid="run-stop-item"
              onSelect={() => stopRunningProcess(process, worktreeId)}
            >
              {process.kind === 'debug' ? (
                <RunModeIcon mode="debug" />
              ) : (
                <Icon className="text-destructive" />
              )}
              <span className="truncate">{action.label}</span>
              {process.kind === 'run' && process.stage !== 'interrupt' ? (
                <DropdownMenuShortcut>{stoppingLabel()}</DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="run-stop-all"
          onSelect={() => stopAllRunningProcesses(processes, worktreeId)}
        >
          <StopAllIcon className="text-destructive" />
          {stopAll.label}
          <DropdownMenuShortcut>{count}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * JetBrains' Stop button for everything running in the worktree: one process stops at once;
 * several show their count and a menu of each one plus Stop All. Its label names the next step.
 */
export function RunStopControl({
  worktreeId,
  activity
}: {
  worktreeId: string
  activity: RunWidgetActivity
}): React.JSX.Element | null {
  const processes = runningProcesses(activity)
  if (processes.length === 0) {
    return null
  }
  const [only] = processes
  const onlyAction = stopProcessAction(only)
  return (
    <div
      data-testid="run-stop-control"
      data-count={processes.length}
      className="my-auto flex shrink-0 items-center"
    >
      {processes.length === 1 ? (
        <ControlButton
          action={{
            ...onlyAction,
            testId: 'run-stop',
            onClick: () => stopRunningProcess(only, worktreeId),
            isStop: true
          }}
        />
      ) : (
        <StopMenu processes={processes} worktreeId={worktreeId} />
      )}
    </div>
  )
}
