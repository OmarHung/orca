import { useId, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { Repo } from '../../../../../shared/repository/repo-types'
import {
  buildClaudeProjectAccountModel,
  canPickClaudeProjectAccount,
  CLAUDE_PROJECT_ACCOUNT_INHERIT
} from '@/lib/provider-accounts/claude-project-account-choices'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../../ui/select'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import type { SettingsSearchEntry } from '../search/settings-search'
import { searchKeywordTranslator } from '../search/settings-search-keywords'

export function getRepositoryClaudeAccountSearchEntry(
  t: Translate = translate
): SettingsSearchEntry {
  const keyword = searchKeywordTranslator(t)
  return {
    title: t('components.RepositoryClaudeAccountSection.title', 'Claude account'),
    description: t(
      'components.RepositoryClaudeAccountSection.description',
      'Claude in this project, in chats and terminals, signs in with this account. Open terminals switch on their next claude launch; a running chat switches when it next starts.'
    ),
    keywords: [
      ...keyword('components.RepositoryClaudeAccountSection.keywordAccount', 'claude account'),
      ...keyword('components.RepositoryClaudeAccountSection.keywordSubscription', 'subscription')
    ]
  }
}

/** Accounts are saved on this desktop, so only projects that run here can pick one. */
export function RepositoryClaudeAccountSection({
  repo,
  updateRepo,
  forceVisible = false
}: {
  repo: Repo
  updateRepo: (
    repoId: string,
    updates: { claudeAccountId: string | null }
  ) => void | Promise<boolean>
  forceVisible?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const entry = getRepositoryClaudeAccountSearchEntry(t)
  const selectLabelId = useId()
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const settings = useAppStore((s) => s.settings)
  if (!settings || !canPickClaudeProjectAccount(repo)) {
    return null
  }
  const model = buildClaudeProjectAccountModel(repo, settings, t)
  const hasAccounts = model.choices.length > 1

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={[repo.displayName, ...(entry.keywords ?? [])]}
      className="space-y-3 py-3"
      forceVisible={forceVisible}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold">{entry.title}</div>
        <p className="text-xs text-muted-foreground">{entry.description}</p>
      </div>
      <div className="space-y-1.5">
        <span id={selectLabelId} className="text-xs text-muted-foreground">
          {t('components.RepositoryClaudeAccountSection.selectLabel', 'Account for this project')}
        </span>
        <Select
          value={model.value}
          disabled={saving || (!hasAccounts && !model.pinned)}
          onValueChange={(next) => {
            if (next === model.value) {
              return
            }
            setSaveFailed(false)
            // Why: the row updates only when the host answers, so a second pick before then would be lost.
            setSaving(true)
            void Promise.resolve(
              updateRepo(repo.id, {
                claudeAccountId: next === CLAUDE_PROJECT_ACCOUNT_INHERIT ? null : next
              })
            )
              .then((saved) => setSaveFailed(saved === false))
              .catch(() => setSaveFailed(true))
              .finally(() => setSaving(false))
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-labelledby={selectLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLAUDE_PROJECT_ACCOUNT_INHERIT}>{model.inheritLabel}</SelectItem>
            <SelectSeparator />
            {model.pickMissing ? (
              // A distinct value, so choosing the Accounts setting still clears the stale pick.
              <SelectItem value={model.value} disabled>
                {t('components.RepositoryClaudeAccountSection.removedOption', 'Removed account')}
              </SelectItem>
            ) : null}
            {model.choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!hasAccounts ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'components.RepositoryClaudeAccountSection.noAccounts',
            'Add Claude accounts in Settings → Accounts to pick one for this project.'
          )}
        </p>
      ) : null}
      {model.pickMissing ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'components.RepositoryClaudeAccountSection.removed',
            'The account picked for this project was removed, so Claude follows the Accounts setting.'
          )}
        </p>
      ) : null}
      {saveFailed ? (
        <p className="text-xs text-destructive">
          {t(
            'components.RepositoryClaudeAccountSection.saveFailed',
            "Couldn't save the Claude account for this project."
          )}
        </p>
      ) : null}
    </SearchableSetting>
  )
}
