import { useMemo } from 'react'
import { useTerminalTabColdParking } from '@/components/terminal-pane/use-terminal-tab-cold-parking'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'

type TerminalTabs = NonNullable<AppState['tabsByWorktree'][string]>
type TabGroups = NonNullable<AppState['groupsByWorktree'][string]>
type UnifiedTabs = NonNullable<AppState['unifiedTabsByWorktree'][string]>

const EMPTY_TABS: TerminalTabs = []
const EMPTY_GROUPS: TabGroups = []
const EMPTY_UNIFIED_TABS: UnifiedTabs = []
const NO_ACTIVITY_TERMINAL_PORTALS = []

export type SshSessionItem = TerminalTab & { unifiedTabId: string }

/** Terminal tabs of the SSH sessions workspace, shaped for TabBar (terminal-only floating model). */
export function useSshSessionItems(isVisible: boolean) {
  const tabs = useAppStore((s) => s.tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? EMPTY_TABS)
  const groups = useAppStore((s) => s.groupsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? EMPTY_GROUPS)
  const unifiedTabs = useAppStore(
    (s) => s.unifiedTabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? EMPTY_UNIFIED_TABS
  )
  const generatedTabTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  const expandedPanes = useAppStore((s) => s.expandedPaneByTabId)

  const activeGroup = useMemo(
    () =>
      groups.find((group) => group.activeTabId != null) ??
      groups.find((group) => group.id === unifiedTabs[0]?.groupId) ??
      null,
    [groups, unifiedTabs]
  )
  const groupTabs = useMemo(
    () =>
      unifiedTabs.filter(
        (tab) => tab.contentType === 'terminal' && (!activeGroup || tab.groupId === activeGroup.id)
      ),
    [activeGroup, unifiedTabs]
  )
  const activeUnifiedTab =
    groupTabs.find((tab) => tab.id === activeGroup?.activeTabId) ?? groupTabs[0] ?? null
  const activeTerminalId = activeUnifiedTab?.entityId ?? null

  const terminalAssignments = useMemo(() => {
    const assignments = new Map<string, { groupId: string; isActiveInGroup: boolean }>()
    for (const tab of groupTabs) {
      assignments.set(tab.entityId, {
        groupId: tab.groupId,
        isActiveInGroup: tab.entityId === activeTerminalId
      })
    }
    return assignments
  }, [activeTerminalId, groupTabs])
  const parkedTerminalTabIds = useTerminalTabColdParking({
    worktreeId: SSH_SESSIONS_WORKTREE_ID,
    terminalTabs: tabs,
    assignments: terminalAssignments,
    activeTerminalTabId: activeTerminalId,
    isWorktreeActive: isVisible,
    coldParkTerminalPanes: false,
    shouldMeasureHiddenWorktree: false,
    activityTerminalPortals: NO_ACTIVITY_TERMINAL_PORTALS
  })

  const terminalItems = useMemo<SshSessionItem[]>(() => {
    const terminalTabById = new Map(tabs.map((tab) => [tab.id, tab]))
    return groupTabs.flatMap((tab): SshSessionItem[] => {
      const terminalTab = terminalTabById.get(tab.entityId)
      if (!terminalTab) {
        return []
      }
      const quickCommandLabel = terminalTab.quickCommandLabel ?? tab.quickCommandLabel ?? null
      return [
        {
          ...terminalTab,
          unifiedTabId: tab.id,
          title: resolveUnifiedTabLabel(
            {
              ...tab,
              quickCommandLabel: quickCommandLabel ?? undefined,
              generatedLabel: tab.generatedLabel ?? terminalTab.generatedTitle
            },
            generatedTabTitlesEnabled,
            tab.label
          ),
          quickCommandLabel,
          customTitle: tab.customLabel ?? terminalTab.customTitle,
          color: tab.color ?? terminalTab.color
        }
      ]
    })
  }, [generatedTabTitlesEnabled, groupTabs, tabs])

  const expandedPaneByTabId = useMemo(() => {
    const expanded: Record<string, boolean> = {}
    for (const tab of tabs) {
      if (expandedPanes[tab.id] === true) {
        expanded[tab.id] = true
      }
    }
    return expanded
  }, [expandedPanes, tabs])

  const tabBarOrder = useMemo(
    () =>
      (activeGroup?.tabOrder ?? []).flatMap((unifiedId) => {
        const tab = groupTabs.find((candidate) => candidate.id === unifiedId)
        return tab ? [tab.entityId] : []
      }),
    [activeGroup, groupTabs]
  )

  return {
    activeGroup,
    groupTabs,
    activeTerminalId,
    parkedTerminalTabIds,
    terminalItems,
    expandedPaneByTabId,
    tabBarOrder,
    tabs
  }
}

export type SshSessionItems = ReturnType<typeof useSshSessionItems>
