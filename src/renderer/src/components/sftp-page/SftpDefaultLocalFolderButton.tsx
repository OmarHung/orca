import { Pin } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PaneIconButton } from './SftpFilePane'
import { useSftpDefaultLocalFolder } from './sftp-local-folder-memory'

/** Local pane toggle: makes the folder shown the one every host starts in, or stops that. */
export function SftpDefaultLocalFolderButton({ path }: { path: string | null }): React.JSX.Element {
  const defaultFolder = useSftpDefaultLocalFolder((s) => s.defaultFolder)
  const setDefaultFolder = useSftpDefaultLocalFolder((s) => s.setDefaultFolder)
  const isDefault = path !== null && path === defaultFolder
  return (
    <PaneIconButton
      label={
        isDefault
          ? translate('sftpPage.local.clearDefaultFolder', 'Remove as default local folder')
          : translate(
              'sftpPage.local.setDefaultFolder',
              'Set as default local folder for all hosts'
            )
      }
      disabled={path === null}
      isPressed={isDefault}
      onClick={() => setDefaultFolder(isDefault ? null : path)}
    >
      <Pin className="size-3.5" />
    </PaneIconButton>
  )
}
