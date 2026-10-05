import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import type {
  GitAbortableOperation,
  GitBranchActionConflictOperation
} from '../../../../../../shared/git-branch-action/git-branch-action-types'
import { gitLogConflictDescription, gitLogConflictMessage } from './git-log-action-feedback'

const CONFLICT_TOAST_DURATION_MS = 20_000
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/
// Why: an SSH relay or paired host from before this feature has no git.branchAction handler.
const MISSING_METHOD = /(?:Method not found|Unknown method): git\.branchAction/

export function gitLogActionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (MISSING_METHOD.test(message)) {
    return translate(
      'bottomPanel.gitLog.actions.hostTooOld',
      'Update Orca on this host to use Git Log actions.'
    )
  }
  return message.replace(IPC_ERROR_PREFIX, '').trim() || 'Git operation failed.'
}

function openSourceControl(): void {
  const store = useAppStore.getState()
  store.setRightSidebarTab('source-control')
  store.setRightSidebarOpen(true)
}

export function showGitLogConflictToast(
  toastId: string,
  operation: GitBranchActionConflictOperation,
  abort: (operation: GitAbortableOperation) => void
): void {
  toast.warning(gitLogConflictMessage(operation), {
    id: toastId,
    description: gitLogConflictDescription(operation),
    duration: CONFLICT_TOAST_DURATION_MS,
    action: {
      label: translate('bottomPanel.gitLog.actions.openSourceControl', 'Source Control'),
      onClick: openSourceControl
    },
    ...(operation === 'stash'
      ? {}
      : {
          cancel: {
            label: translate('bottomPanel.gitLog.actions.abort', 'Abort'),
            onClick: () => abort(operation)
          }
        })
  })
}

function findWorkspaceIdByPath(worktreePath: string): string | null {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, '')
  const target = normalize(worktreePath)
  for (const worktrees of Object.values(useAppStore.getState().worktreesByRepo)) {
    const match = worktrees.find((worktree) => normalize(worktree.path) === target)
    if (match) {
      return match.id
    }
  }
  return null
}

/** The branch is checked out in another worktree; offer to open it when Orca knows that workspace. */
export function showCheckedOutElsewhereToast(
  toastId: string,
  branch: string,
  worktreePath: string
): void {
  const workspaceId = findWorkspaceIdByPath(worktreePath)
  toast.error(
    translate(
      'bottomPanel.gitLog.actions.checkedOutElsewhere',
      '{{branch}} is checked out in another worktree',
      { branch }
    ),
    {
      id: toastId,
      description: worktreePath,
      ...(workspaceId
        ? {
            action: {
              label: translate('bottomPanel.gitLog.actions.openWorkspace', 'Open'),
              onClick: () => activateAndRevealWorktree(workspaceId)
            }
          }
        : {})
    }
  )
}
