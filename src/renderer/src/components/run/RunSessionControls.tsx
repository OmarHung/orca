import React from 'react'
import { Bug, RotateCcw, Square } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { debugFile } from '../debug/debug-launch'
import { useDebugLaunchTarget } from '../debug/use-debug-launch-target'
import { RunStatusDot } from './RunStatusDot'
import { rerunConfiguration, stopConfiguration, type RunTarget } from './run-configuration-control'
import { describeRunStatus, runStatusTone } from './run-status-presentation'
import { isRunSessionActive, runSessionKey, useRunSessionStore } from './run-session-store'

type ControlAction = {
  icon: LucideIcon
  label: string
  testId: string
  onClick: () => void
}

function ControlButton({ action }: { action: ControlAction }): React.JSX.Element {
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
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {action.label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * JetBrains-style run controls beside the tab bar's Run split button: status, Rerun and
 * Stop for the selected configuration's run, and Debug for the active Python file.
 */
export function RunSessionControls({ target }: { target: RunTarget | null }): React.JSX.Element {
  const debugTarget = useDebugLaunchTarget()
  const storedSession = useRunSessionStore((s) =>
    target ? s.sessionsByKey[runSessionKey(target.worktreeId, target.commandKey)] : undefined
  )
  const tabAlive = useAppStore((s) =>
    storedSession && target
      ? (s.tabsByWorktree[target.worktreeId] ?? []).some((tab) => tab.id === storedSession.tabId)
      : false
  )
  const session = storedSession && tabAlive ? storedSession : null
  const active = session !== null && isRunSessionActive(session.status)
  const label = target?.command.label ?? ''

  const actions: ControlAction[] = []
  if (target && active) {
    actions.push(
      {
        icon: RotateCcw,
        label: translate('run.action.rerun', "Rerun '{{value0}}'", { value0: label }),
        testId: 'run-rerun',
        onClick: () => void rerunConfiguration(target)
      },
      {
        icon: Square,
        label: translate('run.action.stop', "Stop '{{value0}}'", { value0: label }),
        testId: 'run-stop',
        onClick: () => stopConfiguration(target.worktreeId, target.commandKey)
      }
    )
  }
  if (debugTarget) {
    actions.push({
      icon: Bug,
      label: translate('debug.action.debugFile', "Debug '{{value0}}'", {
        value0: basename(debugTarget.filePath)
      }),
      testId: 'run-debug-file',
      onClick: () => void debugFile(debugTarget.worktreeId, debugTarget.filePath)
    })
  }
  const status = describeRunStatus(session)

  return (
    <div
      data-testid="run-session-controls"
      data-run-status={session?.status ?? 'idle'}
      className="my-auto flex shrink-0 items-center gap-0.5"
    >
      {status ? (
        <span className="flex size-4 items-center justify-center" title={`${label}: ${status}`}>
          <RunStatusDot tone={runStatusTone(session)} />
        </span>
      ) : null}
      {actions.map((action) => (
        <ControlButton key={action.testId} action={action} />
      ))}
    </div>
  )
}
