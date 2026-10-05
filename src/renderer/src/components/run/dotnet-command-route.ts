import { basename } from '@/lib/path'
import { quotePosixArg } from '../../../../shared/ssh-vpn-command-format'

const LEADING_DOTNET = /^(\s*)dotnet(?=\s|$)/

export function startsWithDotnet(command: string): boolean {
  return LEADING_DOTNET.test(command)
}

/** A quoted path is only a command in POSIX shells; PowerShell needs `&` and Nushell `^`. */
export function invokePath(path: string, shell: string): string {
  const quoted = quotePosixArg(path)
  const name = basename(shell.trim())
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (name === 'pwsh' || name === 'powershell') {
    return `& ${quoted}`
  }
  return name === 'nu' ? `^${quoted}` : quoted
}

/**
 * Sends a command's leading `dotnet` through the launcher; any other command is left alone.
 * `shell` is the configured terminal shell, empty for the login shell.
 */
export function routeDotnetCommand(command: string, launcherPath: string, shell = ''): string {
  return command.replace(
    LEADING_DOTNET,
    (_match, indent: string) => `${indent}${invokePath(launcherPath, shell)}`
  )
}
