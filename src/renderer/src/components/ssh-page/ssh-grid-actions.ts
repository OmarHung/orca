import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { useAppStore } from '@/store'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { CommandConfirm } from '../command-confirm/command-confirm-context'
import { MAX_REMOTE_GRID_TABS, planRemoteGridHosts, type RemoteGridHostStep } from './remote-grid'
import { remoteSessionForTab, useRemoteSessionStore } from './remote-session-store'
import {
  activateSessionTab,
  createSessionTab,
  prepareSshCommand,
  sshConnectionDetails
} from './ssh-session-actions'
import { buildSshSessionCommand } from './ssh-session-command'
import { useSshSessionLivenessStore } from './ssh-session-liveness'

function openTabIds(): string[] {
  const tabs = useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? []
  return tabs.map((tab) => tab.id)
}

/** Tabs can close while a VPN starts or a dialog waits, and a closed tab must not get a pane. */
function keepOpen(tabIds: readonly string[]): string[] {
  const open = new Set(openTabIds())
  return tabIds.filter((tabId) => open.has(tabId))
}

/** Puts a tab in front, and the keyboard in its terminal if it has one running. */
function showTab(tabId: string): void {
  activateSessionTab(tabId)
  if (remoteSessionForTab(useRemoteSessionStore.getState().sessions, tabId).terminalStarted) {
    focusTerminalTabSurface(tabId)
  }
}

/** Steps for as many hosts as the grid has room for; says so when some don't fit. */
function plannedSteps(
  targets: readonly SshTarget[],
  gridTabIds: readonly string[]
): RemoteGridHostStep[] {
  const { sessions } = useRemoteSessionStore.getState()
  const steps = planRemoteGridHosts(targets, openTabIds(), sessions, gridTabIds)
  const isAlreadyShown = (step: RemoteGridHostStep): boolean =>
    step.kind !== 'open' && gridTabIds.includes(step.tabId)
  const newSteps = steps.filter((step) => !isAlreadyShown(step))
  const room = MAX_REMOTE_GRID_TABS - gridTabIds.length
  if (newSteps.length > room) {
    toast.info(
      translate(
        'sshPage.grid.tooMany',
        'A grid holds {{max}} panes, so only {{count}} were added.',
        {
          max: MAX_REMOTE_GRID_TABS,
          count: Math.max(room, 0)
        }
      )
    )
  }
  return newSteps.slice(0, Math.max(room, 0))
}

/** Every host's new ssh, on one confirmation. Hosts already running need no new connection. */
async function runHostSteps(
  steps: readonly RemoteGridHostStep[],
  confirm: CommandConfirm
): Promise<string[] | null> {
  const connecting = steps.filter((step) => step.kind !== 'reuse')
  // Why first: a host that cannot be typed safely must not leave the others' VPNs started for nothing.
  const unsafe = connecting.find((step) => !buildSshSessionCommand(step.target))
  if (unsafe) {
    toast.error(
      translate(
        'sshPage.grid.unsafeTarget',
        '“{{host}}” has characters Orca cannot pass to ssh safely, so nothing was opened. Rename it in ~/.ssh/config.',
        { host: unsafe.target.label }
      )
    )
    return null
  }
  const prepared: { step: (typeof connecting)[number]; command: string; details: string[] }[] = []
  for (const step of connecting) {
    const command = await prepareSshCommand(step.target)
    if (!command) {
      toast.info(
        translate(
          'sshPage.grid.notConnected',
          'Nothing was opened, because “{{host}}” couldn’t be prepared.',
          { host: step.target.label }
        )
      )
      return null
    }
    prepared.push({
      step,
      command: command.command,
      details: sshConnectionDetails(step.target, command.vpnName).map(
        (line) => `${step.target.label} · ${line}`
      )
    })
  }
  if (prepared.length > 0) {
    const isConfirmed = await confirm({
      title: translate('sshPage.grid.confirmTitle', 'Connect to {{count}} hosts?', {
        count: prepared.length
      }),
      details: prepared.flatMap((entry) => entry.details),
      commands: prepared.map((entry) => entry.command),
      notes: [
        translate(
          'sshPage.grid.confirmNote',
          'Each host gets its own tab running your login shell, with its command typed in as if you typed it. Any login prompt appears in that host’s pane.'
        )
      ],
      confirmLabel: translate('sshPage.session.connect', 'Connect')
    })
    if (!isConfirmed) {
      return null
    }
  }
  const store = useAppStore.getState()
  const session = useRemoteSessionStore.getState()
  // Why fresh: tabs can close while the VPN starts or the dialog waits.
  const stillOpen = new Set(openTabIds())
  const added = steps.flatMap((step) => (step.kind === 'reuse' ? [step.tabId] : []))
  for (const { step, command } of prepared) {
    if (step.kind === 'open') {
      const tabId = createSessionTab(step.target.label)
      session.addSession({
        tabId,
        targetId: step.target.id,
        layout: 'terminal',
        terminalStarted: true
      })
      store.queueTabStartupCommand(tabId, { command })
      added.push(tabId)
    } else if (stillOpen.has(step.tabId)) {
      store.queueTabStartupCommand(step.tabId, { command })
      session.markTerminalStarted(step.tabId)
      useSshSessionLivenessStore.getState().markStarting(step.tabId, Date.now())
      added.push(step.tabId)
    }
  }
  return added
}

/**
 * Shows these hosts together, after confirming every new ssh at once. With a grid already open they
 * join it. `alongsideTabId` starts a new grid beside the tab on screen, unless that is the same tab.
 */
export async function openHostsInGrid(
  targets: readonly SshTarget[],
  confirm: CommandConfirm,
  alongsideTabId: string | null = null
): Promise<void> {
  const { grid } = useRemoteSessionStore.getState()
  const gridTabIds = grid?.tabIds ?? []
  const added = await runHostSteps(plannedSteps(targets, gridTabIds), confirm)
  if (!added) {
    return
  }
  const first = !grid && alongsideTabId && !added.includes(alongsideTabId) ? [alongsideTabId] : []
  const tabIds = keepOpen([...first, ...added])
  useRemoteSessionStore.getState().addToGrid(tabIds)
  // Why only something new: adding nothing shouldn't move the user off the pane they're in.
  const toShow = keepOpen(added)[0]
  if (toShow) {
    showTab(toShow)
  }
}

/** Shows an open tab in the grid. Starting one that never ran its terminal is asked for first. */
export async function addTabToGrid(
  tabId: string,
  target: SshTarget | undefined,
  confirm: CommandConfirm,
  activeTabId: string | null
): Promise<void> {
  const { grid, sessions, addToGrid } = useRemoteSessionStore.getState()
  if ((grid?.tabIds.length ?? 0) >= MAX_REMOTE_GRID_TABS) {
    toast.info(
      translate('sshPage.grid.full', 'A grid holds {{max}} panes. Remove one first.', {
        max: MAX_REMOTE_GRID_TABS
      })
    )
    return
  }
  if (!remoteSessionForTab(sessions, tabId).terminalStarted && target) {
    const added = await runHostSteps([{ kind: 'start', tabId, target }], confirm)
    if (!added) {
      return
    }
  }
  const first = !grid && activeTabId && activeTabId !== tabId ? [activeTabId] : []
  const tabIds = keepOpen([...first, tabId])
  if (!tabIds.includes(tabId)) {
    return
  }
  addToGrid(tabIds)
  showTab(tabId)
}

/** Stops showing a tab in the grid, moving on to the next pane if it was the one in use. */
export function removeTabFromGrid(tabId: string, isInUse: boolean): void {
  const { grid, removeFromGrid } = useRemoteSessionStore.getState()
  if (!grid) {
    return
  }
  const index = grid.tabIds.indexOf(tabId)
  const next = grid.tabIds[index + 1] ?? grid.tabIds[index - 1]
  removeFromGrid(tabId)
  if (isInUse && next) {
    showTab(next)
  }
}

/** Back to the grid from a tab outside it. */
export function returnToGrid(): void {
  const tabId = useRemoteSessionStore.getState().grid?.tabIds[0]
  if (tabId) {
    showTab(tabId)
  }
}
