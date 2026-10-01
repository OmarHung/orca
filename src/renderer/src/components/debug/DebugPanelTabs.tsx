import React from 'react'
import { Pause } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { BottomPanelSessionTab } from '../bottom-panel/BottomPanelSessionTab'
import { RunStatusIcon } from '../run/RunStatusIcon'
import { closeDebugSession } from './debug-session-controller'
import {
  isLiveDebugSession,
  selectedDebugSession,
  useDebugStore,
  type DebugSession
} from './debug-store'

function SessionStatus({ session }: { session: DebugSession }): React.JSX.Element | null {
  if (session.stoppedThreadId !== null) {
    return <Pause aria-hidden className="size-3 shrink-0 text-run-mode-debug" />
  }
  return <RunStatusIcon tone={isLiveDebugSession(session) ? 'running' : 'success'} mode="debug" />
}

function describeTab(session: DebugSession): string {
  if (!isLiveDebugSession(session)) {
    return translate('debug.tab.ended', '{{value0}} (finished)', { value0: session.title })
  }
  return session.stoppedThreadId === null
    ? session.title
    : translate('debug.tab.paused', '{{value0}} (paused)', { value0: session.title })
}

function DebugSessionTabs({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const allSessions = useDebugStore((s) => s.sessions)
  const selected = useDebugStore((s) => selectedDebugSession(s, worktreeId))
  const selectSession = useDebugStore((s) => s.selectSession)
  const sessions = allSessions.filter((session) => session.worktreeId === worktreeId)
  if (sessions.length === 0) {
    return null
  }
  return (
    <div
      role="tablist"
      aria-label={translate('debug.tab.sessions', 'Debug sessions')}
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-l border-border pl-2"
      data-testid="debug-session-tabs"
    >
      {sessions.map((session) => (
        <BottomPanelSessionTab
          key={session.id}
          label={session.title}
          title={describeTab(session)}
          status={<SessionStatus session={session} />}
          selected={session === selected}
          onSelect={() => selectSession(worktreeId, session.id)}
          onClose={() => void closeDebugSession(session.id)}
          closeLabel={translate('debug.tab.close', "Close '{{value0}}'", {
            value0: session.title
          })}
          tabProps={{
            'data-testid': 'debug-session-tab',
            'data-debug-phase': session.phase,
            'data-debug-paused': String(session.stoppedThreadId !== null)
          }}
          closeTestId="debug-session-tab-close"
        />
      ))}
    </div>
  )
}

/** One tab per debug session in the Debug tool window's header, as in JetBrains. */
export function DebugPanelTabs(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  return worktreeId ? <DebugSessionTabs worktreeId={worktreeId} /> : null
}
