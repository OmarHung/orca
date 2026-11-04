import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { hasSshCommandControlCharacter } from '../../../../shared/ssh-command-types'
import {
  checkSshCommandTarget,
  sendSshCommand,
  sshCommandRemotePlatform
} from '../ssh-commands/ssh-command-send'

/** How SFTP spells a Windows path, without the slash a Windows shell wouldn't take. */
function windowsPath(path: string): string {
  return path.replace(/^\/([A-Za-z]:)/, '$1')
}

/**
 * For a name the server decides, in a shell Orca can't see. Why not `quotePosixShell`: fish reads
 * a backslash inside single quotes as an escape, so a name holding one could end the quote early.
 * Outside quotes, an escaped apostrophe or backslash means the same in every POSIX-style shell.
 */
export function quotePathForAnyShell(path: string): string {
  return path
    .split(/(['\\])/)
    .filter((part) => part !== '')
    .map((part) => (part === "'" || part === '\\' ? `\\${part}` : `'${part}'`))
    .join('')
}

async function copyPaths(paths: readonly string[], explanation: string): Promise<void> {
  await window.api.ui.writeClipboardText(paths.map(windowsPath).join('\n'))
  toast.info(explanation)
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
    await copyPaths(
      paths,
      translate(
        'sshPage.link.copiedForWindows',
        'Copied the path, since this host runs Windows and its shell may quote differently.'
      )
    )
    return
  }
  // Why: this names a file on this tab's host, and the terminal may be on another or on this computer.
  const check = await checkSshCommandTarget(tabId)
  if (check.kind === 'ready' && check.doubt) {
    await copyPaths(
      paths,
      translate(
        'sshPage.link.copiedInDoubt',
        'Copied the path, since Orca can’t confirm this terminal is on this host.'
      )
    )
    return
  }
  await sendSshCommand(tabId, buildText(), 'insert')
}

export function typeCdIntoTerminal(tabId: string, targetId: string, path: string): Promise<void> {
  return typeInTerminal(tabId, targetId, [path], () => `cd -- ${quotePathForAnyShell(path)}`)
}

export function typePathsIntoTerminal(
  tabId: string,
  targetId: string,
  paths: readonly string[]
): Promise<void> {
  return typeInTerminal(
    tabId,
    targetId,
    paths,
    () => `${paths.map(quotePathForAnyShell).join(' ')} `
  )
}
