import React from 'react'
import { FolderSearch } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { Repo } from '../../../../shared/repo-types'
import { canRelocateProjectFolder, relocateProjectFolder } from './relocate-project-folder'

export function RelocateProjectMenuItem({ repo }: { repo: Repo }): React.JSX.Element | null {
  if (!canRelocateProjectFolder(repo)) {
    return null
  }
  return (
    <DropdownMenuItem onSelect={() => void relocateProjectFolder(repo)}>
      <FolderSearch className="size-3.5" />
      {translate('repoRelocate.menu', 'Change Folder Location…')}
    </DropdownMenuItem>
  )
}
