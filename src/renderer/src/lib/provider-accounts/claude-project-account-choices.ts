import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import {
  CLAUDE_PROJECT_SYSTEM_DEFAULT,
  claudeLaunchProjectForWorktree,
  resolveClaudeProjectAccount
} from '../../../../shared/agent-accounts/claude/claude-project-account'
import {
  getManagedAccountDisplayName,
  getManagedAccountInlineLabel
} from '../../../../shared/agent-accounts/managed-account-display-names'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host/execution-host'
import { isWslUncPath } from '../../../../shared/file-access/wsl-paths'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { findIndexedRepoOwnerForHost } from '@/lib/workspace/ownership/repo-owner-index'
import type { AppState } from '@/store/types'

/** Radix forbids empty item values; this one means "follow the Accounts selection". */
export const CLAUDE_PROJECT_ACCOUNT_INHERIT = '__accounts_setting__'

type AccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'managedAccountDisplayNames'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
>

export type ClaudeProjectAccountChoice = { value: string; label: string }

export type ClaudeProjectAccountModel = {
  /** The picker's value: inherit, `system`, or an account id. */
  value: string
  inheritLabel: string
  /** System default first, then this host's saved accounts. */
  choices: ClaudeProjectAccountChoice[]
  /** The account the project's Claude launches with now. */
  effectiveLabel: string
  /** Whether the project pins its own account. */
  pinned: boolean
  /** The pinned account was removed, so launches follow the Accounts selection. */
  pickMissing: boolean
}

function hostAccounts(settings: AccountSettings): GlobalSettings['claudeManagedAccounts'] {
  return settings.claudeManagedAccounts.filter((account) => account.managedAuthRuntime !== 'wsl')
}

function accountLabel(settings: AccountSettings, accountId: string | null, t: Translate): string {
  if (accountId === null) {
    return t('accounts.claude.systemDefault', 'System default')
  }
  const account = settings.claudeManagedAccounts.find((entry) => entry.id === accountId)
  if (!account) {
    return t('accounts.claude.unnamedAccount', 'Claude account')
  }
  const displayName = getManagedAccountDisplayName(
    settings.managedAccountDisplayNames,
    'claude',
    account.id
  )
  return getManagedAccountInlineLabel({ email: account.email, displayName })
}

/** Accounts are saved on this desktop's host; WSL and remote projects keep their own selection. */
export function canPickClaudeProjectAccount(
  repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'>
): boolean {
  return getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID && !isWslUncPath(repo.path)
}

export function selectGlobalClaudeHostAccountId(settings: AccountSettings): string | null {
  return (
    settings.activeClaudeManagedAccountIdsByRuntime?.host ??
    settings.activeClaudeManagedAccountId ??
    null
  )
}

export function buildClaudeProjectAccountModel(
  repo: Pick<Repo, 'claudeAccountId'>,
  settings: AccountSettings,
  t: Translate = translate
): ClaudeProjectAccountModel {
  const accounts = hostAccounts(settings)
  const pinnedAccount = resolveClaudeProjectAccount(repo, accounts)
  const globalId = selectGlobalClaudeHostAccountId(settings)
  const globalLabel = accountLabel(settings, globalId, t)
  const picked = repo.claudeAccountId?.trim() || null
  return {
    value: picked ?? CLAUDE_PROJECT_ACCOUNT_INHERIT,
    inheritLabel: t(
      'components.RepositoryClaudeAccountSection.inherit',
      'Accounts setting ({{account}})',
      { account: globalLabel }
    ),
    choices: [
      {
        value: CLAUDE_PROJECT_SYSTEM_DEFAULT,
        label: t('accounts.claude.systemDefault', 'System default')
      },
      ...accounts.map((account) => ({
        value: account.id,
        label: accountLabel(settings, account.id, t)
      }))
    ],
    effectiveLabel: pinnedAccount
      ? accountLabel(settings, pinnedAccount.accountId, t)
      : globalLabel,
    pinned: pinnedAccount !== null,
    pickMissing: picked !== null && pinnedAccount === null
  }
}

/** The host account a local Claude launch in this workspace uses: its project's pin, else Accounts. */
export function selectClaudeLaunchAccountId(
  state: Pick<AppState, 'repos' | 'settings'>,
  worktreeId: string | null | undefined
): string | null {
  const settings = state.settings
  if (!settings) {
    return null
  }
  const project = claudeLaunchProjectForWorktree(worktreeId)
  const repo = project
    ? findIndexedRepoOwnerForHost(state.repos, project.repoId, LOCAL_EXECUTION_HOST_ID)
    : null
  const pinned = resolveClaudeProjectAccount(repo, hostAccounts(settings))
  return pinned ? pinned.accountId : selectGlobalClaudeHostAccountId(settings)
}
