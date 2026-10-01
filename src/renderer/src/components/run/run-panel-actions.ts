import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { runConfiguration } from './run-configuration-control'
import { launchRunConfiguration } from './run-configuration-launcher'
import { useRunSessionStore, type RunSession } from './run-session-store'
import { configurationIdOfCommandKey } from './run-widget-items'

/** Runs the session's configuration again; a running one is stopped first, as in JetBrains. */
export async function rerunRunPanelSession(session: RunSession): Promise<void> {
  const configurationId = configurationIdOfCommandKey(session.commandKey)
  if (configurationId !== null) {
    // Why the launcher: trust checks and Before launch steps apply to a rerun too.
    await launchRunConfiguration({
      worktreeId: session.worktreeId,
      groupId: null,
      reference: configurationId
    })
    return
  }
  if (session.target) {
    await runConfiguration(session.target)
  }
}

/** Closes the run's terminal; a still-running process asks first, like any terminal tab. */
export function closeRunPanelSession(session: RunSession): void {
  closeTerminalTab(session.tabId, {
    onClosed: () => {
      const current = useRunSessionStore.getState().sessionsByKey[session.key]
      if (current?.tabId === session.tabId) {
        useRunSessionStore.getState().removeSession(session.key)
      }
    }
  })
}
