import React from 'react'
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  Bug,
  LoaderCircle,
  Pause,
  Play,
  RedoDot,
  Square
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { cn } from '@/lib/utils'
import { stopDebugSession } from './debug-session-controller'
import { isLiveDebugSession, type DebugSessionView } from './debug-store'
import {
  debugContinue,
  debugPause,
  debugStepInto,
  debugStepOut,
  debugStepOver
} from './debug-thread-commands'
import { useDebugLaunchTarget } from './use-debug-launch-target'
import { debugFile } from './debug-launch'

type ToolbarAction = {
  icon: LucideIcon
  label: string
  enabled: boolean
  onClick: () => void
  isStop?: boolean
}

function describeSession(session: DebugSessionView | null): string {
  if (!session) {
    return translate('debug.status.idle', 'No debug session')
  }
  const file = session.title
  switch (session.phase) {
    case 'installing-adapter':
      return translate('debug.status.installing', 'Downloading debugpy…')
    case 'starting':
      return translate('debug.status.starting', 'Starting {{value0}}…', { value0: file })
    case 'ended':
      return translate('debug.status.ended', '{{value0}} finished', { value0: file })
    case 'running':
      return session.stoppedThreadId === null
        ? translate('debug.status.running', 'Running {{value0}}', { value0: file })
        : translate('debug.status.paused', 'Paused in {{value0}} ({{value1}})', {
            value0: file,
            value1: session.stopReason ?? ''
          })
  }
}

function ToolbarButton({ action }: { action: ToolbarAction }): React.JSX.Element {
  const Icon = action.icon
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={action.label}
      title={action.label}
      disabled={!action.enabled}
      onClick={action.onClick}
    >
      <Icon className={cn(action.isStop && action.enabled && 'text-destructive')} />
    </Button>
  )
}

/** Controls for the session tab the Debug window shows. */
export function DebugToolbar({ session }: { session: DebugSessionView | null }): React.JSX.Element {
  const launchTarget = useDebugLaunchTarget()
  const live = session !== null && isLiveDebugSession(session)
  const paused = live && session.stoppedThreadId !== null
  const busy = session?.phase === 'installing-adapter' || session?.phase === 'starting'
  const id = session?.id ?? ''

  const actions: ToolbarAction[] = [
    {
      icon: Play,
      label: translate('debug.action.resume', 'Resume Program'),
      enabled: paused,
      onClick: () => debugContinue(id)
    },
    {
      icon: Pause,
      label: translate('debug.action.pause', 'Pause Program'),
      enabled: live && !paused && !busy,
      onClick: () => void debugPause(id)
    },
    {
      icon: RedoDot,
      label: translate('debug.action.stepOver', 'Step Over'),
      enabled: paused,
      onClick: () => debugStepOver(id)
    },
    {
      icon: ArrowDownToDot,
      label: translate('debug.action.stepInto', 'Step Into'),
      enabled: paused,
      onClick: () => debugStepInto(id)
    },
    {
      icon: ArrowUpFromDot,
      label: translate('debug.action.stepOut', 'Step Out'),
      enabled: paused,
      onClick: () => debugStepOut(id)
    },
    {
      icon: Square,
      label: translate('debug.action.stop', 'Stop'),
      enabled: live,
      onClick: () => void stopDebugSession(id),
      isStop: true
    }
  ]

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      {launchTarget ? (
        <Button
          variant="ghost"
          size="xs"
          title={launchTarget.filePath}
          onClick={() => void debugFile(launchTarget.worktreeId, launchTarget.filePath)}
        >
          <Bug />
          {translate('debug.action.debugFile', "Debug '{{value0}}'", {
            value0: basename(launchTarget.filePath)
          })}
        </Button>
      ) : null}
      {actions.map((action) => (
        <ToolbarButton key={action.label} action={action} />
      ))}
      <span className="ml-2 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
        {busy ? <LoaderCircle className="size-3 animate-spin" /> : null}
        {describeSession(session)}
      </span>
    </div>
  )
}
