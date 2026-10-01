import React from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { RunStatusIcon } from './RunStatusIcon'
import { runTargetMode } from './run-mode'
import { closeRunPanelSession } from './run-panel-actions'
import { useRunPanelStore } from './run-panel-store'
import { describeRunStatus, runStatusTone } from './run-status-presentation'
import type { RunSession } from './run-session-store'
import { selectedRunPanelSession, useRunPanelSessions } from './use-run-panel-sessions'

function RunPanelTab({
  session,
  selected
}: {
  session: RunSession
  selected: boolean
}): React.JSX.Element {
  const select = useRunPanelStore((s) => s.select)
  const status = describeRunStatus(session)
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
        type="button"
        role="tab"
        aria-selected={selected}
        data-testid="run-panel-tab"
        data-run-status={session.status}
        title={status ? `${session.label}: ${status}` : session.label}
        className="flex max-w-48 min-w-0 items-center gap-1.5"
        onClick={() => select(session.worktreeId, session.commandKey)}
      >
        <RunStatusIcon tone={runStatusTone(session)} mode={runTargetMode(session.target)} />
        <span className="truncate">{session.label}</span>
      </button>
      <button
        type="button"
        aria-label={translate('run.panel.close', "Close '{{value0}}'", { value0: session.label })}
        data-testid="run-panel-tab-close"
        className="flex size-4 items-center justify-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100"
        onClick={() => closeRunPanelSession(session)}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function RunPanelTabList({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const sessions = useRunPanelSessions(worktreeId)
  const selectedKey = useRunPanelStore((s) => s.selectedByWorktree[worktreeId])
  const selected = selectedRunPanelSession(sessions, selectedKey)
  if (sessions.length === 0) {
    return null
  }
  return (
    <div
      role="tablist"
      aria-label={translate('run.panel.runs', 'Runs')}
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-l border-border pl-2"
      data-testid="run-panel-tabs"
    >
      {sessions.map((session) => (
        <RunPanelTab key={session.key} session={session} selected={session === selected} />
      ))}
    </div>
  )
}

/** One tab per run in the Run tool window's header, like JetBrains' Run tool window. */
export function RunPanelTabs(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  return worktreeId ? <RunPanelTabList worktreeId={worktreeId} /> : null
}
