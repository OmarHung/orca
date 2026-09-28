import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { matchesSettingsSearch } from './settings-search'
import {
  GIT_AUTO_FETCH_INTERVAL_OPTIONS_MINUTES,
  normalizeGitAutoFetchIntervalMinutes
} from '../git-branch-status/git-auto-fetch-schedule'
import { GIT_BRANCH_STATUS_SETTINGS_SECTION_ID } from '../git-branch-status/GitBranchStatusSegment'

const GIT_BRANCH_STATUS_KEYWORDS = [
  'status bar',
  'branch',
  'ahead',
  'behind',
  'fetch',
  'auto fetch',
  'git fetch',
  'interval',
  'gittoolbox'
]

function getTitle(): string {
  return translate('gitBranchStatus.settings.title', 'Branch Status & Auto Fetch')
}

function getDescription(): string {
  return translate(
    'gitBranchStatus.settings.description',
    "Show the active workspace's branch, commits to push or pull, and uncommitted files in the status bar, and keep its remote branches current with a background fetch."
  )
}

export function gitBranchStatusSettingsMatchSearch(searchQuery: string): boolean {
  return matchesSettingsSearch(searchQuery, {
    title: getTitle(),
    description: getDescription(),
    keywords: GIT_BRANCH_STATUS_KEYWORDS
  })
}

export function GitBranchStatusSettings({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const title = getTitle()
  const statusBarLabel = translate(
    'gitBranchStatus.settings.statusBar',
    'Show branch status in the status bar'
  )
  const autoFetchLabel = translate('gitBranchStatus.settings.autoFetch', 'Fetch automatically')
  const intervalLabel = translate('gitBranchStatus.settings.interval', 'Fetch interval')

  return (
    <SearchableSetting
      id={GIT_BRANCH_STATUS_SETTINGS_SECTION_ID}
      title={title}
      description={getDescription()}
      keywords={GIT_BRANCH_STATUS_KEYWORDS}
      className="max-w-none space-y-1"
    >
      <SettingsRow
        label={statusBarLabel}
        description={translate(
          'gitBranchStatus.settings.statusBarDescription',
          'Click it for upstream details, a Fetch button and a link to Source Control.'
        )}
        control={
          <Switch
            aria-label={statusBarLabel}
            checked={settings.gitBranchStatusBarEnabled !== false}
            onCheckedChange={(checked) => updateSettings({ gitBranchStatusBarEnabled: checked })}
          />
        }
      />
      <SettingsRow
        label={autoFetchLabel}
        description={translate(
          'gitBranchStatus.settings.autoFetchDescription',
          "Runs git fetch for the active workspace's repository in the background, so behind counts stay current. Paused while the window is hidden. Failures show in the status-bar details instead of a notification."
        )}
        control={
          <Switch
            aria-label={autoFetchLabel}
            checked={settings.gitAutoFetchEnabled === true}
            onCheckedChange={(checked) => updateSettings({ gitAutoFetchEnabled: checked })}
          />
        }
      />
      {settings.gitAutoFetchEnabled === true ? (
        <SettingsRow
          label={intervalLabel}
          control={
            <SettingsSegmentedControl<number>
              value={normalizeGitAutoFetchIntervalMinutes(settings.gitAutoFetchIntervalMinutes)}
              onChange={(minutes) => updateSettings({ gitAutoFetchIntervalMinutes: minutes })}
              ariaLabel={intervalLabel}
              size="sm"
              options={GIT_AUTO_FETCH_INTERVAL_OPTIONS_MINUTES.map((minutes) => ({
                value: minutes,
                label: translate('gitBranchStatus.settings.minutes', '{{minutes}} min', {
                  minutes
                })
              }))}
            />
          }
        />
      ) : null}
    </SearchableSetting>
  )
}
