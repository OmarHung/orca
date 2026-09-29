import type { DebugLaunchTarget } from '../debug/debug-session-types'

export type RunConfigurationKind = 'build' | 'run' | 'test' | 'publish' | 'other'

export type RunConfigurationEcosystem = 'node' | 'dotnet'

/** A run configuration derived from project files; suggested, never persisted. */
export type DetectedRunConfiguration = {
  /** Stable across detections of the same project, so runs can reuse their tab. */
  id: string
  ecosystem: RunConfigurationEcosystem
  projectName: string
  /** Absolute directory the command runs in. */
  projectDir: string
  /** Absolute path of the .NET project file (.csproj etc.) the configuration came from. */
  projectFile?: string
  kind: RunConfigurationKind
  /** Short name within the project, e.g. "dev" or "MvcWeb". */
  name: string
  command: string
  /** How to debug this configuration, when an adapter supports it. */
  debug?: DebugLaunchTarget
}

// Literal unquoted in POSIX shells, fish, PowerShell and cmd alike.
const SHELL_SAFE = /^[A-Za-z0-9_.:+=/-]+$/
// Why: inside double quotes these still act in at least one of those shells — $ and ` expand in
// POSIX, fish and PowerShell; % and ! in cmd (and ! in interactive bash/zsh); “ ” „ end a
// PowerShell string; POSIX shells collapse \\, and a trailing \ escapes the closing quote.
const UNQUOTABLE = /["$`%!\u201C\u201D\u201E]|\\\\|\\$/

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    // Why: typed into a terminal, a control character is a keystroke (Enter, Ctrl-C, escapes).
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/**
 * Commands are typed into whichever shell the terminal runs, so no one escaping scheme fits every
 * shell; null when double quotes cannot keep `value` literal in all of them.
 */
export function quoteShellArgument(value: string): string | null {
  if (SHELL_SAFE.test(value)) {
    return value
  }
  return UNQUOTABLE.test(value) || hasControlCharacter(value) ? null : `"${value}"`
}
