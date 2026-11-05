import type { TuiAgent } from './agent-launch/catalog/tui-agent'
import { isTuiAgent } from './agent-launch/catalog/tui-agent-config'

/** What a project's workspace opens when it has no tabs: a plain shell or a coding agent. */
export type RepoInitialTab = 'terminal' | TuiAgent

export const DEFAULT_REPO_INITIAL_TAB: RepoInitialTab = 'claude'

export function isRepoInitialTab(value: unknown): value is RepoInitialTab {
  return value === 'terminal' || isTuiAgent(value)
}

export function resolveRepoInitialTab(value: unknown): RepoInitialTab {
  return isRepoInitialTab(value) ? value : DEFAULT_REPO_INITIAL_TAB
}
