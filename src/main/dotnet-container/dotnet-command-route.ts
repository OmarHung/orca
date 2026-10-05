import { isAbsolute } from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'

const WHERE_TIMEOUT_MS = 10_000
const MAX_COMMAND_LENGTH = 10_000
// Ends the simple command that starts with `dotnet`.
const SHELL_OPERATOR = /[;&|<>()]/
// Expansions only a shell can resolve; the launcher then decides when the command runs.
const NEEDS_SHELL = /[$`*?[\]{}]/

/** The words after a leading `dotnet` on a command's first line; null when only a shell could tell. */
export function dotnetCommandArgs(command: string): string[] | null {
  const line = command.split(/\r?\n/, 1)[0] ?? ''
  const words: string[] = []
  let word: string | null = null
  let quote: string | null = null
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (char === quote) {
        quote = null
      } else if (quote === '"' && (char === '$' || char === '`')) {
        return null
      } else if (quote === '"' && char === '\\' && '"\\'.includes(line[index + 1] ?? '')) {
        word += line[++index]!
      } else {
        word += char
      }
      continue
    }
    if (/\s/.test(char)) {
      if (word !== null) {
        words.push(word)
        word = null
      }
    } else if (char === "'" || char === '"') {
      quote = char
      word ??= ''
    } else if (char === '\\') {
      if (index + 1 >= line.length) {
        return null
      }
      word = (word ?? '') + line[++index]!
    } else if (SHELL_OPERATOR.test(char) || (char === '#' && word === null)) {
      break
    } else if (NEEDS_SHELL.test(char) || (char === '~' && word === null)) {
      return null
    } else {
      word = (word ?? '') + char
    }
  }
  if (quote) {
    return null
  }
  if (word !== null) {
    words.push(word)
  }
  return words[0] === 'dotnet' ? words.slice(1) : null
}

/**
 * Whether a Run command's `dotnet` must go through the launcher (the project runs in the
 * container). Any doubt answers yes: the launcher decides correctly either way.
 */
export async function dotnetCommandNeedsLauncher(
  launcherPath: string,
  cwd: string,
  command: string
): Promise<boolean> {
  const args = command.length <= MAX_COMMAND_LENGTH ? dotnetCommandArgs(command) : null
  if (!args || !isAbsolute(cwd)) {
    return true
  }
  const result = await runProcess({
    program: launcherPath,
    args: ['--orca-where', ...args],
    cwd,
    timeoutMs: WHERE_TIMEOUT_MS
  }).catch(() => null)
  return !(result?.code === 0 && result.stdout.trim() === 'native')
}
