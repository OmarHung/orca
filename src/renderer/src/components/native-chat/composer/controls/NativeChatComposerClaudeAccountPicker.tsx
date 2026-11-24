import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ClaudeIcon } from '@/components/status-bar/accounts/provider-icons'
import { useTranslate } from '@/i18n/use-translate'
import { findIndexedRepoOwnerForHost } from '@/lib/workspace/ownership/repo-owner-index'
import { structuredChatTabById } from '@/lib/agent-session/tab-identity/structured-chat-tab-index'
import {
  buildClaudeProjectAccountModel,
  canPickClaudeProjectAccount,
  CLAUDE_PROJECT_ACCOUNT_INHERIT
} from '@/lib/provider-accounts/claude-project-account-choices'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host/execution-host'

/** Picks the Claude account of a Claude chat's project, the same setting as Project settings. */
export function NativeChatComposerClaudeAccountPicker({
  chat,
  repoId,
  textClassName
}: {
  /** The structured chat tab and the workspace that owns it. */
  chat: { tabId: string; worktreeId: string }
  repoId: string
  textClassName: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const isClaudeChat = useAppStore(
    (s) =>
      structuredChatTabById(s.unifiedTabsByWorktree, chat.worktreeId, chat.tabId)
        ?.agentSessionAgent === 'claude'
  )
  // Accounts are saved on this desktop, so only a project that runs here offers them.
  const repo = useAppStore((s) =>
    findIndexedRepoOwnerForHost(s.repos, repoId, LOCAL_EXECUTION_HOST_ID)
  )
  const settings = useAppStore((s) => s.settings)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const [saving, setSaving] = useState(false)
  if (!isClaudeChat || !repo || !settings || !canPickClaudeProjectAccount(repo)) {
    return null
  }
  const model = buildClaudeProjectAccountModel(repo, settings, t)
  // Without saved accounts there is nothing to pick besides System default.
  if (model.choices.length <= 1 && !model.pinned && !model.pickMissing) {
    return null
  }
  const title = t('components.RepositoryClaudeAccountSection.title', 'Claude account')
  const pick = (next: string): void => {
    if (next === model.value || saving) {
      return
    }
    setSaving(true)
    void updateRepo(
      repo.id,
      { claudeAccountId: next === CLAUDE_PROJECT_ACCOUNT_INHERIT ? null : next },
      { hostId: LOCAL_EXECUTION_HOST_ID }
    )
      .then((saved) => {
        if (!saved) {
          toast.error(
            t(
              'components.RepositoryClaudeAccountSection.saveFailed',
              "Couldn't save the Claude account for this project."
            )
          )
        }
      })
      .catch(() =>
        toast.error(
          t(
            'components.RepositoryClaudeAccountSection.saveFailed',
            "Couldn't save the Claude account for this project."
          )
        )
      )
      .finally(() => setSaving(false))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={saving}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-5.5 min-w-0 max-w-48 shrink justify-start"
              aria-label={t(
                'components.native-chat.composerWorkspace.claudeAccount',
                'Claude account: {{account}}',
                { account: model.effectiveLabel }
              )}
            >
              <ClaudeIcon size={12} className="shrink-0" />
              <span className={textClassName}>{model.effectiveLabel}</span>
              <ChevronDown className="size-3 shrink-0" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t(
            'components.native-chat.composerWorkspace.claudeAccount',
            'Claude account: {{account}}',
            { account: model.effectiveLabel }
          )}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" collisionPadding={8} className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t(
            'components.native-chat.composerWorkspace.claudeAccountHint',
            "This project's Claude account. New chats and terminals use it at once; a running chat switches when it next starts."
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup aria-label={title} value={model.value}>
          <DropdownMenuRadioItem
            value={CLAUDE_PROJECT_ACCOUNT_INHERIT}
            onSelect={() => pick(CLAUDE_PROJECT_ACCOUNT_INHERIT)}
          >
            {model.inheritLabel}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {model.pickMissing ? (
            <DropdownMenuRadioItem value={model.value} disabled>
              {t('components.RepositoryClaudeAccountSection.removedOption', 'Removed account')}
            </DropdownMenuRadioItem>
          ) : null}
          {model.choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.value}
              value={choice.value}
              onSelect={() => pick(choice.value)}
            >
              <span className="truncate">{choice.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
