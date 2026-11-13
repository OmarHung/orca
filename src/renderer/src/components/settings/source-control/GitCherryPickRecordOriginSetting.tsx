import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Switch } from '../../ui/switch'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { matchesSettingsSearch } from '../search/settings-search'

const GIT_CHERRY_PICK_RECORD_ORIGIN_KEYWORDS = [
  'cherry-pick',
  'cherry pick',
  '-x',
  'cherry picked from',
  'git log',
  'source commit'
]

function getTitle(): string {
  return translate('gitCherryPick.settings.title', 'Record Cherry-Pick Source')
}

function getDescription(): string {
  return translate(
    'gitCherryPick.settings.description',
    'When you cherry-pick from the Git Log, add a "(cherry picked from commit …)" line naming the original commit to the message (git cherry-pick -x). Highlight commits already cherry-picked can then also recognize picks whose conflicts you resolved.'
  )
}

export function gitCherryPickRecordOriginSettingMatchesSearch(searchQuery: string): boolean {
  return matchesSettingsSearch(searchQuery, {
    title: getTitle(),
    description: getDescription(),
    keywords: GIT_CHERRY_PICK_RECORD_ORIGIN_KEYWORDS
  })
}

export function GitCherryPickRecordOriginSetting({
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
      keywords={GIT_CHERRY_PICK_RECORD_ORIGIN_KEYWORDS}
      className="max-w-none"
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <Switch
            aria-label={title}
            checked={settings.gitCherryPickRecordOrigin !== false}
            onCheckedChange={(checked) => updateSettings({ gitCherryPickRecordOrigin: checked })}
          />
        }
      />
    </SearchableSetting>
  )
}
