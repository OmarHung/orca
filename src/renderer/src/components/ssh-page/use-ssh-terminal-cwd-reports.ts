import { useEffect } from 'react'
import { readCwdReport, useSshTerminalCwdStore } from './ssh-terminal-cwd-store'
import { watchTabTerminals } from './ssh-tab-terminal-watch'

const OSC_CWD = 7

/** Notes the folders these tabs' shells report. Only reads: the terminal's own handling carries on. */
export function useSshTerminalCwdReports(tabIds: readonly string[]): void {
  const tabIdsKey = tabIds.join('\n')
  useEffect(() => {
    void window.api.sftp
      .localHostname()
      .then((name) => useSshTerminalCwdStore.getState().setLocalHostName(name))
      // Why nothing more: without the name no report is trusted, so following just stays off.
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!tabIdsKey) {
      return
    }
    return watchTabTerminals(tabIdsKey.split('\n'), (tabId, terminal) => {
      const handler = terminal.parser.registerOscHandler(OSC_CWD, (payload) => {
        const report = readCwdReport(payload)
        if (report) {
          useSshTerminalCwdStore.getState().record(tabId, report)
        }
        return false
      })
      return () => handler.dispose()
    })
  }, [tabIdsKey])
}
