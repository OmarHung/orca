import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useRemoteSessionStore } from '../ssh-page/remote-session-store'
import type { SshTargetListStatus } from '../ssh-page/use-ssh-target-list'
import { SftpWorkbench } from './SftpWorkbench'

export type RemoteFilesTab = { id: string; targetId: string; label: string }

type SftpTabPanelsProps = {
  tabs: readonly RemoteFilesTab[]
  /** The tab to show; null while the active tab shows only its terminal. */
  activeTabId: string | null
  isPageVisible: boolean
  targetsById: ReadonlyMap<string, SshTarget>
  targetsStatus: SshTargetListStatus
}

function PanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * One workbench per tab. A tab mounts (and connects) the first time its files are shown, then
 * stays mounted while hidden so its folders, selection and listings survive tab switches.
 */
export function SftpTabPanels({
  tabs,
  activeTabId,
  isPageVisible,
  targetsById,
  targetsStatus
}: SftpTabPanelsProps): React.JSX.Element {
  const setRemotePath = useRemoteSessionStore((s) => s.setRemotePath)
  const [shownTabIds, setShownTabIds] = useState<ReadonlySet<string>>(() => new Set())
  // Why: adjust during render (not in an Effect) so the newly shown tab mounts in this pass.
  if (activeTabId && !shownTabIds.has(activeTabId)) {
    setShownTabIds(new Set([...shownTabIds, activeTabId]))
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {tabs
        .filter((tab) => shownTabIds.has(tab.id))
        .map((tab) => {
          const target = targetsById.get(tab.targetId)
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              data-sftp-tab-panel={tab.id}
              data-active={isActive ? 'true' : 'false'}
              aria-hidden={!isActive}
              className="absolute inset-0 flex data-[active=false]:hidden"
            >
              {target ? (
                <SftpWorkbench
                  target={target}
                  isActive={isActive && isPageVisible}
                  onRemotePathChange={(path) => setRemotePath(tab.id, path)}
                />
              ) : (
                <PanelMessage>
                  {targetsStatus === 'loading'
                    ? translate('sshPage.hostList.loading', 'Loading hosts…')
                    : translate(
                        'sftpPage.tabs.missingHost',
                        '“{{name}}” is no longer in your SSH hosts. Close this tab.',
                        { name: tab.label }
                      )}
                </PanelMessage>
              )}
            </div>
          )
        })}
    </div>
  )
}
