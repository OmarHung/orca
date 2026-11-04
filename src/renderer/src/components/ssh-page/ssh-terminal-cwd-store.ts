import { create } from 'zustand'
import { parseOsc7 } from '../terminal-pane/parse-osc7'

/** The folder a tab's remote shell reported, and the host it was on when it first reported one. */
export type SshTerminalCwdReport = { host: string; path: string }

/** Why it reads the host itself: `parseOsc7` drops it, and it is how a local shell gives itself away. */
export function readCwdReport(payload: string): SshTerminalCwdReport | null {
  const host = /^file:\/\/([^/]*)\//.exec(payload)?.[1]
  const path = parseOsc7(payload)
  // Why absolute only: a drive path is a Windows shell's, which an SFTP pane spells differently.
  return host && path?.startsWith('/') ? { host, path } : null
}

function shortHostName(host: string): string {
  return (host.split('.')[0] ?? '').toLowerCase()
}

/** A shell can name itself with or without its domain, so only the first label is compared. */
function isSameHost(a: string, b: string): boolean {
  return shortHostName(a) === shortHostName(b)
}

/**
 * What a tab should remember after a report. Once ssh ends the tab holds a local shell, and a shell
 * can also ssh onward, so a report from either says nothing about the host the files pane is on.
 */
export function nextCwdReport(
  current: SshTerminalCwdReport | undefined,
  report: SshTerminalCwdReport,
  localHostName: string | null
): SshTerminalCwdReport | undefined {
  const isLocal =
    localHostName === null ||
    isSameHost(report.host, localHostName) ||
    shortHostName(report.host) === 'localhost'
  if (isLocal || (current && !isSameHost(current.host, report.host))) {
    return current
  }
  return { host: current?.host ?? report.host, path: report.path }
}

type SshTerminalCwdState = {
  localHostName: string | null
  reportByTab: Readonly<Record<string, SshTerminalCwdReport>>
  followingTabIds: ReadonlySet<string>
  setLocalHostName: (name: string) => void
  record: (tabId: string, report: SshTerminalCwdReport) => void
  setFollowing: (tabId: string, isFollowing: boolean) => void
}

/** Never saved: following is off whenever Orca starts, and only a live shell can report a folder. */
export const useSshTerminalCwdStore = create<SshTerminalCwdState>((set, get) => ({
  localHostName: null,
  reportByTab: {},
  followingTabIds: new Set(),
  setLocalHostName: (name) => set({ localHostName: name }),
  record: (tabId, report) => {
    const { reportByTab, localHostName } = get()
    const next = nextCwdReport(reportByTab[tabId], report, localHostName)
    if (next && next.path !== reportByTab[tabId]?.path) {
      set({ reportByTab: { ...reportByTab, [tabId]: next } })
    }
  },
  setFollowing: (tabId, isFollowing) => {
    const rest = [...get().followingTabIds].filter((id) => id !== tabId)
    set({ followingTabIds: new Set(isFollowing ? [...rest, tabId] : rest) })
  }
}))
