import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'
import { matchesSettingsSearch } from './settings-search'

const GIT_INLINE_BLAME_KEYWORDS = [
  'blame',
  'gitlens',
  'annotate',
  'author',
  'current line',
  'commit'
]

function getTitle(): string {
  return translate('inlineBlame.settings.title', 'Inline Blame')
}

function getDescription(): string {
  return translate(
    'inlineBlame.settings.description',
    'Show who last changed the line under the caret, when, and in which commit, after the end of that line. Click it for the commit and a link to its changes.'
  )
}

export function gitInlineBlameSettingMatchesSearch(searchQuery: string): boolean {
  return matchesSettingsSearch(searchQuery, {
    title: getTitle(),
    description: getDescription(),
    keywords: GIT_INLINE_BLAME_KEYWORDS
  })
}

export function GitInlineBlameSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const title = getTitle()
  const description = getDescription()
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={GIT_INLINE_BLAME_KEYWORDS}
      className="max-w-none"
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <Switch
            aria-label={title}
            checked={settings.gitInlineBlameEnabled !== false}
            onCheckedChange={(checked) => updateSettings({ gitInlineBlameEnabled: checked })}
          />
        }
      />
    </SearchableSetting>
  )
}
