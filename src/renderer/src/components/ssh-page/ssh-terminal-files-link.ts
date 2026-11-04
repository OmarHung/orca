import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { hasSshCommandControlCharacter } from '../../../../shared/ssh-command-types'
import { quotePosixShell } from '../../../../shared/shell-argument-quoting'
import { sendSshCommand, sshCommandRemotePlatform } from '../ssh-commands/ssh-command-send'

/** How SFTP spells a Windows path, without the slash a Windows shell wouldn't take. */
function windowsPath(path: string): string {
  return path.replace(/^\/([A-Za-z]:)/, '$1')
}

async function copyPaths(paths: readonly string[]): Promise<void> {
  await window.api.ui.writeClipboardText(paths.map(windowsPath).join('\n'))
  toast.info(
    translate(
      'sshPage.link.copiedForWindows',
      'Copied the path, since this host runs Windows and its shell may quote differently.'
    )
  )
}

/** Never presses Enter: the user reads the line and decides. */
async function typeInTerminal(
  tabId: string,
  targetId: string,
  paths: readonly string[],
  buildText: () => string
): Promise<void> {
  // Why: a file name is whatever the server says, and a line break in one would run what follows it.
  if (paths.some(hasSshCommandControlCharacter)) {
    toast.error(
      translate(
        'sshPage.link.controlCharacter',
        'This name contains control characters, so Orca won’t type it into the terminal.'
      )
    )
    return
  }
  if (sshCommandRemotePlatform(tabId, targetId) === 'win32') {
    await copyPaths(paths)
    return
  }
  await sendSshCommand(tabId, buildText(), 'insert')
}

export function typeCdIntoTerminal(tabId: string, targetId: string, path: string): Promise<void> {
  return typeInTerminal(tabId, targetId, [path], () => `cd -- ${quotePosixShell(path)}`)
}

export function typePathsIntoTerminal(
  tabId: string,
  targetId: string,
  paths: readonly string[]
): Promise<void> {
  return typeInTerminal(tabId, targetId, paths, () => `${paths.map(quotePosixShell).join(' ')} `)
}
