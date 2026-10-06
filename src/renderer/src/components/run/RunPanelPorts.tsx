import React from 'react'
import { useAppStore } from '@/store'
import { selectedDebugSession, useDebugStore } from '../debug/debug-store'
import { RunPortLinks } from './RunPortLinks'
import { debugPortOwnerKey, runPortOwnerKey } from './run-port-claims'
import { useSelectedRunPanelSession } from './use-run-panel-sessions'

function RunSessionPorts({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const session = useSelectedRunPanelSession(worktreeId)
  return session ? <RunPortLinks ownerKeys={[runPortOwnerKey(session.key)]} /> : null
}

function DebugSessionPorts({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const session = useDebugStore((s) => selectedDebugSession(s, worktreeId))
  return session ? <RunPortLinks ownerKeys={[debugPortOwnerKey(session.id)]} /> : null
}

/** The bottom panel header's port buttons for the run or debug session its tab shows. */
export function RunPanelPorts({ tab }: { tab: 'run' | 'debug' }): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  if (!worktreeId) {
    return null
  }
  return tab === 'run' ? (
    <RunSessionPorts worktreeId={worktreeId} />
  ) : (
    <DebugSessionPorts worktreeId={worktreeId} />
  )
}
