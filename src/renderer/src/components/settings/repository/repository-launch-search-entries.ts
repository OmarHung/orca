import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { Repo } from '../../../../../shared/repository/repo-types'
import type { SettingsSearchEntry } from '../search/settings-search'
import { searchKeywordTranslator } from '../search/settings-search-keywords'
import { getRepositoryClaudeAccountSearchEntry } from './RepositoryClaudeAccountSection'
import { getRepositoryBrowserProfileSearchEntry } from './RepositoryBrowserProfileSection'

// Fork-only project launch search entries, kept out of the upstream search file.

/** What this project's new browser tabs and agents launch with, in settings-search order. */
export function getRepositoryLaunchSearchEntries(
  repo: Repo,
  t: Translate = translate
): SettingsSearchEntry[] {
  const translateSearchKeyword = searchKeywordTranslator(t)
  const initialTab = {
    title: t('auto.components.settings.repository.search.initialTab', 'Initial Tab'),
    description: t(
      'auto.components.settings.repository.search.initialTabDescription',
      'What opens when a workspace of this project has no tabs.'
    ),
    keywords: [
      repo.displayName,
      ...translateSearchKeyword(
        'auto.components.settings.repository.search.initialTabDefaultTab',
        'default tab'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.repository.search.initialTabAgent',
        'agent'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.repository.search.initialTabClaude',
        'claude',
        { englishOnly: true }
      )
    ]
  }
  return [
    getRepositoryBrowserProfileSearchEntry(t),
    getRepositoryClaudeAccountSearchEntry(t),
    initialTab
  ]
}
