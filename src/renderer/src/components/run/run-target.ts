import { isTerminalAgentQuickCommand } from '../../../../shared/terminal-quick-commands'
import type {
  TerminalCommandQuickCommand,
  TerminalQuickCommand
} from '../../../../shared/terminal-quick-command-types'
import type {
  DebugLaunchOptions,
  DebugLaunchTarget
} from '../../../../shared/debug/debug-session-types'
import type { RunConfigurationKind } from '../../../../shared/run-configurations/run-configuration-types'

export type RunTarget = {
  worktreeId: string
  groupId: string | null
  commandKey: string
  command: TerminalCommandQuickCommand
  /** Directory the run's terminal starts in; the worktree root when omitted. */
  cwd?: string
  /** How to debug the same configuration, when an adapter supports it. */
  debug?: DebugLaunchTarget
  debugOptions?: DebugLaunchOptions
  /** What the run does (build, publish…), for its mode icon; a plain run when omitted. */
  kind?: RunConfigurationKind
}

/** Only shell commands are run configurations; agent prompts start agents and have no Stop/Rerun. */
export function toRunTarget(
  entry: { key: string; command: TerminalQuickCommand },
  worktreeId: string,
  groupId: string | null
): RunTarget | null {
  const { command } = entry
  if (isTerminalAgentQuickCommand(command)) {
    return null
  }
  return { worktreeId, groupId, commandKey: entry.key, command }
}
