import React from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { BottomPanelSessionTab } from '../bottom-panel/BottomPanelSessionTab'
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
    <BottomPanelSessionTab
      label={session.label}
      title={status ? `${session.label}: ${status}` : session.label}
      status={<RunStatusIcon tone={runStatusTone(session)} mode={runTargetMode(session.target)} />}
      selected={selected}
      onSelect={() => select(session.worktreeId, session.commandKey)}
      onClose={() => closeRunPanelSession(session)}
      closeLabel={translate('run.panel.close', "Close '{{value0}}'", { value0: session.label })}
      tabProps={{ 'data-testid': 'run-panel-tab', 'data-run-status': session.status }}
      closeTestId="run-panel-tab-close"
    />
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
