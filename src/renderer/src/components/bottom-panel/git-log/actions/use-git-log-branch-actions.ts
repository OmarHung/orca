import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { runRuntimeGitBranchAction } from '@/runtime/runtime-git-branch-action-client'
import { shortBranchName } from '../../../../../../shared/git-branch-action/git-branch-action-refs'
import type {
  GitBranchAction,
  GitBranchActionKind,
  GitBranchActionResult
} from '../../../../../../shared/git-branch-action/git-branch-action-types'
import type { GitLogWorktree } from '../use-git-log-worktree'
import { resolveActiveGitFetchTarget } from '../../../git-branch-status/git-auto-fetch-runner'
import { refreshGitStatusForWorktree } from '../../../right-sidebar/git-status-refresh'
import { useGitLogActionDialogStore } from './git-log-action-dialog-store'
import { gitLogActionProgress, gitLogActionSuccess, shortCommit } from './git-log-action-feedback'
import {
  gitLogActionErrorMessage,
  showCheckedOutElsewhereToast,
  showGitLogConflictToast
} from './git-log-action-outcome-toasts'
import type { GitLogActions } from './git-log-actions-context'

// Why: local git answers well under this, so only slower (SSH, network) runs show progress.
const PROGRESS_TOAST_DELAY_MS = 400

type FollowUp = (() => void) | null

/** Status, branch label and ahead/behind move with every action; don't wait for the next poll. */
function refreshWorktreeGitState(worktreeId: string): void {
  const target = resolveActiveGitFetchTarget()
  if (target?.worktreeId !== worktreeId) {
    return
  }
  const store = useAppStore.getState()
  void refreshGitStatusForWorktree({
    settings: target.settings,
    worktreeId,
    worktreePath: target.worktreePath,
    connectionId: target.connectionId,
    pushTarget: target.pushTarget,
    deps: {
      setGitStatus: store.setGitStatus,
      updateWorktreeGitIdentity: store.updateWorktreeGitIdentity,
      setUpstreamStatus: store.setUpstreamStatus,
      fetchUpstreamStatus: store.fetchUpstreamStatus
    },
    request: { admissionTier: 'interactive' }
  })
    .then(() =>
      store.fetchUpstreamStatus(
        worktreeId,
        target.worktreePath,
        target.connectionId,
        target.pushTarget,
        { runtimeTargetSettings: target.settings }
      )
    )
    .catch((error: unknown) => console.warn('[GitLog] post-action status refresh failed', error))
}

/**
 * Runs Git Log branch and commit actions one at a time for the active worktree, reporting each
 * outcome (toast, dialog or confirmation), then reloads the log through `onSettled`.
 */
export function useGitLogBranchActions(
  worktree: GitLogWorktree,
  currentBranchName: string | null,
  onSettled: () => void
): GitLogActions {
  const [runningKind, setRunningKind] = useState<GitBranchActionKind | null>(null)
  const runningRef = useRef(false)
  const toastSeqRef = useRef(0)
  const confirm = useConfirmationDialog()
  const openDialog = useGitLogActionDialogStore((s) => s.open)
  const { worktreeId, worktreePath, repoSettings } = worktree

  const handleResult = useCallback(
    (
      action: GitBranchAction,
      result: GitBranchActionResult,
      toastId: string,
      run: (next: GitBranchAction) => void
    ): FollowUp => {
      switch (result.status) {
        case 'ok':
          toast.success(gitLogActionSuccess(action, currentBranchName), { id: toastId })
          return null
        case 'conflicts':
          showGitLogConflictToast(toastId, result.operation, (operation) =>
            run({ kind: 'abortOperation', operation })
          )
          return null
        case 'checked-out-elsewhere':
          showCheckedOutElsewhereToast(toastId, result.branch, result.worktreePath)
          return null
        case 'local-changes':
          toast.dismiss(toastId)
          openDialog({
            kind: 'localChanges',
            target: result.target,
            targetLabel:
              result.target.kind === 'ref'
                ? shortBranchName(result.target.ref)
                : shortCommit(result.target.commit),
            files: result.files
          })
          return null
        case 'not-fully-merged':
          toast.dismiss(toastId)
          if (action.kind !== 'deleteBranch') {
            return null
          }
          return () =>
            void confirm({
              title: translate(
                'bottomPanel.gitLog.actions.forceDeleteTitle',
                'Delete unmerged branch?'
              ),
              description: translate(
                'bottomPanel.gitLog.actions.forceDeleteDescription',
                '{{branch}} has commits that are not merged into the current branch. Deleting it can lose them.',
                { branch: result.branch }
              ),
              confirmLabel: translate('bottomPanel.gitLog.actions.forceDelete', 'Force Delete'),
              confirmVariant: 'destructive'
            }).then((confirmed) => confirmed && run({ ...action, force: true }))
      }
    },
    [confirm, currentBranchName, openDialog]
  )

  const run = useCallback(
    (action: GitBranchAction): void => {
      if (runningRef.current || !worktreeId || !worktreePath) {
        return
      }
      runningRef.current = true
      setRunningKind(action.kind)
      const toastId = `git-log-action-${++toastSeqRef.current}`
      const progressTimer = setTimeout(
        () => toast.loading(gitLogActionProgress(action), { id: toastId }),
        PROGRESS_TOAST_DELAY_MS
      )
      const context = {
        settings: repoSettings,
        worktreeId,
        worktreePath,
        connectionId: getConnectionId(worktreeId) ?? undefined
      }
      let followUp: FollowUp = null
      void runRuntimeGitBranchAction(context, action)
        .then((result) => {
          clearTimeout(progressTimer)
          followUp = handleResult(action, result, toastId, run)
        })
        .catch((error: unknown) => {
          clearTimeout(progressTimer)
          toast.error(gitLogActionErrorMessage(error), { id: toastId })
        })
        .finally(() => {
          runningRef.current = false
          setRunningKind(null)
          onSettled()
          refreshWorktreeGitState(worktreeId)
          followUp?.()
        })
    },
    [handleResult, onSettled, repoSettings, worktreeId, worktreePath]
  )

  return useMemo(
    () => ({ runningKind, currentBranchName, run }),
    [currentBranchName, run, runningKind]
  )
}
