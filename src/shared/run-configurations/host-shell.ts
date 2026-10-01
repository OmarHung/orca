import { isWindowsAbsolutePathLike } from '../cross-platform-path'
import { isWslUncPath } from '../wsl-paths'

/**
 * Whether terminals in this workspace run a POSIX-style shell (sh, bash, zsh, fish), which can
 * chain with `&&` and has `rm`; a local Windows workspace may be Windows PowerShell 5.1, which has
 * neither. Decided by path syntax, since SSH and WSL workspaces are POSIX whatever the client.
 */
export function runsPosixShell(workspacePath: string): boolean {
  return !isWindowsAbsolutePathLike(workspacePath) || isWslUncPath(workspacePath)
}
