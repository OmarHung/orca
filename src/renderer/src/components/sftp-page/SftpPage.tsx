import { useCallback, useMemo, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ContextMenuItem } from '../ui/context-menu'
import { CommandConfirmProvider } from '../command-confirm/CommandConfirmProvider'
import { HostListToggleButton } from '../ssh-page/HostListToggleButton'
import { useRemoteHostsLayout } from '../ssh-page/remote-hosts-layout-store'
import { RemoteHostsPageFrame } from '../ssh-page/RemoteHostsPageFrame'
import { SshHostListPanel } from '../ssh-page/SshHostListPanel'
import { SshHostPickerDialog } from '../ssh-page/SshHostPickerDialog'
import { useSshPageShortcuts } from '../ssh-page/use-ssh-page-shortcuts'
import { useSshTargetList } from '../ssh-page/use-ssh-target-list'
import { remoteFolderName } from './sftp-paths'
import { sftpHostLine } from './sftp-plan-confirm'
import { useSftpTabsStore, type SftpTab } from './sftp-tabs-store'
import { SftpTabPanels } from './SftpTabPanels'
import { SftpTabStrip } from './SftpTabStrip'
import { useSftpProgressEvents } from './use-sftp-progress-events'

export default function SftpPage({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  return (
    <CommandConfirmProvider>
      <SftpPageContent isVisible={isVisible} />
    </CommandConfirmProvider>
  )
}

function SftpPageContent({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const list = useSshTargetList(isVisible)
  const isHostListCollapsed = useRemoteHostsLayout((s) => s.hostListCollapsed.sftp)
  const tabs = useSftpTabsStore((s) => s.tabs)
  const activeTabId = useSftpTabsStore((s) => s.activeTabId)
  const openTab = useSftpTabsStore((s) => s.openTab)
  const showHost = useSftpTabsStore((s) => s.showHost)
  const activateTab = useSftpTabsStore((s) => s.activateTab)
  const closeTab = useSftpTabsStore((s) => s.closeTab)
  const remotePathByTab = useSftpTabsStore((s) => s.remotePathByTab)
  const [pickerOpen, setPickerOpen] = useState(false)
  useSftpProgressEvents()

  const openPicker = useCallback(() => setPickerOpen(true), [])
  const closeActiveTab = useCallback(() => {
    if (activeTabId) {
      closeTab(activeTabId)
    }
  }, [activeTabId, closeTab])
  useSshPageShortcuts({
    isVisible,
    onNewSession: openPicker,
    onCloseActiveSession: closeActiveTab
  })

  const targetsById = useMemo(
    () => new Map(list.targets.map((target) => [target.id, target])),
    [list.targets]
  )
  const folderByTab = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(remotePathByTab).map(([tabId, path]) => [tabId, remoteFolderName(path)])
      ),
    [remotePathByTab]
  )
  const describeTab = (tab: SftpTab): string => {
    const target = targetsById.get(tab.targetId)
    const host = target ? sftpHostLine(target) : tab.label
    const path = remotePathByTab[tab.id]
    return path ? `${host} — ${path}` : host
  }
  const activeTargetId = tabs.find((tab) => tab.id === activeTabId)?.targetId ?? null
  const openTabOnHost = useCallback(
    (tab: SftpTab) =>
      openTab(
        { id: tab.targetId, label: targetsById.get(tab.targetId)?.label ?? tab.label },
        tab.id
      ),
    [openTab, targetsById]
  )
  const hostMenuItems = useCallback(
    (target: SshTarget) => (
      <ContextMenuItem onSelect={() => openTab(target)}>
        {translate('sftpPage.tabs.openInNewTab', 'Open in new tab')}
      </ContextMenuItem>
    ),
    [openTab]
  )

  return (
    <RemoteHostsPageFrame
      desktopOnlyMessage={translate(
        'sftpPage.page.desktopOnly',
        'File transfers are available in the desktop app only.'
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SftpTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          folderByTab={folderByTab}
          describeTab={describeTab}
          onActivate={activateTab}
          onClose={closeTab}
          onNewTab={openPicker}
          onNewTabOnHost={openTabOnHost}
          leadingControl={<HostListToggleButton page="sftp" />}
        />
        <div className="flex min-h-0 flex-1">
          {isHostListCollapsed ? null : (
            <SshHostListPanel
              list={list}
              currentTargetId={activeTargetId}
              onSelect={showHost}
              hostMenuItems={hostMenuItems}
            />
          )}
          <SftpTabPanels
            tabs={tabs}
            activeTabId={activeTabId}
            isPageVisible={isVisible}
            targetsById={targetsById}
            targetsStatus={list.status}
          />
        </div>
      </div>
      <SshHostPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        targets={list.targets}
        onSelect={openTab}
        title={translate('sftpPage.tabs.pickerTitle', 'Open an SFTP tab')}
        description={translate('sftpPage.tabs.pickerDescription', 'Pick the host to browse.')}
      />
    </RemoteHostsPageFrame>
  )
}
