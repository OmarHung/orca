import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SshTargetListStatus } from '../ssh-page/use-ssh-target-list'
import { SftpWorkbench } from './SftpWorkbench'
import { useSftpTabsStore, type SftpTab } from './sftp-tabs-store'

type SftpTabPanelsProps = {
  tabs: readonly SftpTab[]
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
 * One workbench per tab. A tab mounts (and connects) the first time it is shown, then stays
 * mounted while hidden so its folders, selection and listings survive tab switches.
 */
export function SftpTabPanels({
  tabs,
  activeTabId,
  isPageVisible,
  targetsById,
  targetsStatus
}: SftpTabPanelsProps): React.JSX.Element {
  const setTabRemotePath = useSftpTabsStore((s) => s.setTabRemotePath)
  const [shownTabIds, setShownTabIds] = useState<ReadonlySet<string>>(() => new Set())
  // Why: adjust during render (not in an Effect) so the newly shown tab mounts in this pass.
  if (activeTabId && !shownTabIds.has(activeTabId)) {
    setShownTabIds(new Set([...shownTabIds, activeTabId]))
  }

  if (tabs.length === 0) {
    return (
      <PanelMessage>
        {translate('sftpPage.page.pickHost', 'Pick a host to browse its files.')}
      </PanelMessage>
    )
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
                  onRemotePathChange={(path) => setTabRemotePath(tab.id, path)}
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
