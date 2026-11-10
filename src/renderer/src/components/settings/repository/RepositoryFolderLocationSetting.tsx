import { FolderSearch } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import { Button } from '../../ui/button'
import { Label } from '../../ui/label'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'
import {
  canRelocateProjectFolder,
  relocateProjectFolder
} from '@/components/repo-relocation/relocate-project-folder'

type RepositoryFolderLocationSettingProps = {
  repo: Repo
  forceVisible: boolean
}

export function RepositoryFolderLocationSetting({
  repo,
  forceVisible
}: RepositoryFolderLocationSettingProps): React.JSX.Element | null {
  if (!canRelocateProjectFolder(repo)) {
    return null
  }
  const title = translate('repoRelocate.settingTitle', 'Folder Location')
  return (
    <SearchableSetting
      title={title}
      description={translate(
        'repoRelocate.settingDescription',
        'Where this project lives on this computer.'
      )}
      keywords={[repo.displayName, repo.path, 'folder', 'path', 'location', 'move', 'relocate']}
      className="space-y-2"
      forceVisible={forceVisible}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Label>{title}</Label>
          <p className="truncate font-mono text-xs text-muted-foreground" title={repo.path}>
            {repo.path}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'repoRelocate.settingHelp',
              'Moved the folder? Pick its new location to keep this project, its settings and its workspaces.'
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void relocateProjectFolder(repo)}
        >
          <FolderSearch className="size-3.5" />
          {translate('repoRelocate.settingButton', 'Change…')}
        </Button>
      </div>
    </SearchableSetting>
  )
}
