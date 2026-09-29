import { FolderOpen, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsRow } from '../settings/SettingsFormControls'
import { useSftpDefaultLocalFolder } from './sftp-local-folder-memory'

/** The SFTP block in Settings → SSH: where the local pane opens for hosts without a folder of their own. */
export function SftpLocalFolderSettingsSection(): React.JSX.Element {
  const defaultFolder = useSftpDefaultLocalFolder((s) => s.defaultFolder)
  const setDefaultFolder = useSftpDefaultLocalFolder((s) => s.setDefaultFolder)
  const pickFolder = async (): Promise<void> => {
    const picked = await window.api.shell.pickDirectory({ defaultPath: defaultFolder ?? undefined })
    if (picked) {
      setDefaultFolder(picked)
    }
  }

  return (
    <section className="border-t border-border/60 pt-4" data-sftp-local-folder-settings>
      <SettingsRow
        alignTop
        label={translate('sftpSettings.defaultLocalFolder.label', 'SFTP default local folder')}
        description={translate(
          'sftpSettings.defaultLocalFolder.description',
          'Where the local pane opens for hosts that have not been browsed yet. Each host reopens the local folder it showed last.'
        )}
        control={
          <div className="flex w-72 max-w-full gap-2">
            <Input
              value={defaultFolder ?? ''}
              readOnly
              placeholder={translate('sftpSettings.defaultLocalFolder.home', 'Home folder')}
              aria-label={translate(
                'sftpSettings.defaultLocalFolder.label',
                'SFTP default local folder'
              )}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={translate(
                'sftpSettings.defaultLocalFolder.choose',
                'Choose default local folder'
              )}
              onClick={() => void pickFolder()}
            >
              <FolderOpen className="size-4" />
            </Button>
            {defaultFolder ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={translate(
                  'sftpSettings.defaultLocalFolder.clear',
                  'Use the home folder'
                )}
                onClick={() => setDefaultFolder(null)}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        }
      />
    </section>
  )
}
