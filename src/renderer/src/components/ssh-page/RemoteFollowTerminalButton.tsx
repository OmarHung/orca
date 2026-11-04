import { useState } from 'react'
import { FolderSync } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { PaneIconButton } from '../sftp-page/SftpFilePane'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { useSshTerminalCwdStore } from './ssh-terminal-cwd-store'

const SHELL_SETUPS = [
  {
    file: '~/.bashrc',
    line: `PROMPT_COMMAND='printf "\\033]7;file://%s%s\\033\\\\" "$HOSTNAME" "$PWD"'"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`
  },
  {
    file: '~/.zshrc',
    line: `orca_report_folder() { printf '\\033]7;file://%s%s\\033\\\\' "$HOST" "$PWD" }; precmd_functions+=(orca_report_folder)`
  }
] as const

function ShellSetupDialog({
  isOpen,
  onClose
}: {
  isOpen: boolean
  onClose: () => void
}): React.JSX.Element {
  const copy = async (line: string): Promise<void> => {
    await window.api.ui.writeClipboardText(line)
    toast.info(translate('sshPage.follow.copied', 'Copied.'))
  }
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-remote-follow-setup>
        <DialogHeader className="min-w-0">
          <DialogTitle>
            {translate('sshPage.follow.setupTitle', 'This host hasn’t said which folder it is in')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'sshPage.follow.setupDescription',
              'The files can follow the terminal once the host’s shell reports its folder, which takes one line in its startup file. Orca won’t change anything on the server. After adding it, log in again.'
            )}
          </DialogDescription>
        </DialogHeader>
        {SHELL_SETUPS.map(({ file, line }) => (
          <div key={file} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{file}</span>
              <Button variant="outline" size="xs" onClick={() => void copy(line)}>
                {translate('sshPage.follow.copy', 'Copy')}
              </Button>
            </div>
            <code className="overflow-x-auto rounded-sm bg-muted p-2 font-mono text-xs whitespace-pre">
              {line}
            </code>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  )
}

/** Off by default. It can't turn on until this tab's shell has reported a folder. */
export function RemoteFollowTerminalButton({ tabId }: { tabId: string }): React.JSX.Element {
  const hasReport = useSshTerminalCwdStore((s) => s.reportByTab[tabId] !== undefined)
  const isFollowing = useSshTerminalCwdStore((s) => s.followingTabIds.has(tabId))
  const setFollowing = useSshTerminalCwdStore((s) => s.setFollowing)
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  return (
    <>
      <PaneIconButton
        label={
          isFollowing
            ? translate('sshPage.follow.stop', 'Stop following the terminal’s folder')
            : translate('sshPage.follow.start', 'Follow the terminal’s folder')
        }
        isPressed={isFollowing}
        onClick={() => {
          if (hasReport) {
            setFollowing(tabId, !isFollowing)
          } else {
            setIsSetupOpen(true)
          }
        }}
      >
        <FolderSync className="size-3.5" />
      </PaneIconButton>
      <ShellSetupDialog isOpen={isSetupOpen} onClose={() => setIsSetupOpen(false)} />
    </>
  )
}
