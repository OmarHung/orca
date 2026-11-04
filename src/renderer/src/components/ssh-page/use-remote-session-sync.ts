import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { useRemoteSessionStore } from './remote-session-store'
import { adoptSessionlessTabs, migrateLegacySftpTabs } from './ssh-session-actions'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import type { SshTargetList } from './use-ssh-target-list'

const EMPTY_TABS: readonly never[] = []

/**
 * Keeps session records in step with the terminal tabs. Waits for session hydration: before it
 * every tab looks closed, and pruning then would forget them all.
 */
export function useRemoteSessionSync(list: SshTargetList): void {
  const isSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const tabs = useAppStore((s) => s.tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? EMPTY_TABS)
  const { status, targets } = list

  useEffect(() => {
    if (isSessionReady) {
      migrateLegacySftpTabs()
    }
  }, [isSessionReady])

  useEffect(() => {
    if (isSessionReady && status === 'ready') {
      adoptSessionlessTabs(targets)
    }
  }, [isSessionReady, status, targets, tabs])

  useEffect(() => {
    if (!isSessionReady) {
      return
    }
    // Why read fresh: the migration effect above may have opened tabs this render hasn't seen.
    const openTabs = useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? EMPTY_TABS
    const openTabIds = new Set(openTabs.map((tab) => tab.id))
    useRemoteSessionStore.getState().prune(openTabIds)
    useSshSessionLivenessStore.getState().prune(openTabIds)
  }, [isSessionReady, tabs])
}
