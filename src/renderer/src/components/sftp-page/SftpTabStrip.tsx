import { Plus, X } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { ACTIVE_TAB_INDICATOR_CLASSES } from '../tab-bar/drop-indicator'
import { TAB_CONTAINER_WIDTH_CLASSES } from '../tab-bar/tab-width-rules'
import type { SftpTab } from './sftp-tabs-store'

const MIDDLE_BUTTON = 1

type SftpTabStripProps = {
  tabs: readonly SftpTab[]
  activeTabId: string | null
  /** Folder name shown after the host, so tabs on one host can be told apart. */
  folderByTab?: Readonly<Record<string, string>>
  /** Tooltip per tab, e.g. the host's user@address. */
  describeTab: (tab: SftpTab) => string
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: () => void
  /** Right-click → a second tab on the same host, placed next to this one. */
  onNewTabOnHost: (tab: SftpTab) => void
  /** Shown before the tabs, e.g. the host list toggle. */
  leadingControl?: React.ReactNode
}

function SftpTabItem({
  tab,
  folder,
  isActive,
  description,
  onActivate,
  onClose,
  onNewTabOnHost
}: {
  tab: SftpTab
  folder: string | null
  isActive: boolean
  description: string
  onActivate: () => void
  onClose: () => void
  onNewTabOnHost: () => void
}): React.JSX.Element {
  const closeLabel = translate('sftpPage.tabs.close', 'Close tab {{name}}', { name: tab.label })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={TAB_CONTAINER_WIDTH_CLASSES}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                data-sftp-tab={tab.id}
                data-active={isActive ? 'true' : 'false'}
                onClick={onActivate}
                onAuxClick={(event) => event.button === MIDDLE_BUTTON && onClose()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onActivate()
                  }
                }}
                // Why: same surfaces as the workspace tab strip (getTabRootStateClasses), as static classes.
                className="group relative flex h-full cursor-pointer items-center border-r border-border bg-card px-2 text-xs text-muted-foreground outline-none select-none hover:text-foreground focus-visible:text-foreground data-[active=true]:bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] data-[active=true]:text-foreground"
              >
                {isActive ? <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden /> : null}
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                {folder ? (
                  // Why: long host names truncate first, so tabs on one host stay distinguishable.
                  <span
                    data-tab-folder
                    className="mr-1 ml-1 max-w-24 shrink-0 truncate text-muted-foreground"
                  >
                    {folder}
                  </span>
                ) : (
                  <span className="mr-1" />
                )}
                <button
                  type="button"
                  aria-label={closeLabel}
                  data-tab-close-button="true"
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose()
                  }}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[active=true]:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {description}
            </TooltipContent>
          </Tooltip>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onNewTabOnHost}>
          {translate('sftpPage.tabs.newTabOnHost', 'New tab on this host')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The SFTP page's titlebar row: one tab per open host browser, like the SSH page's terminals. */
export function SftpTabStrip({
  tabs,
  activeTabId,
  folderByTab,
  describeTab,
  onActivate,
  onClose,
  onNewTab,
  onNewTabOnHost,
  leadingControl
}: SftpTabStripProps): React.JSX.Element {
  const newTabLabel = translate('sftpPage.tabs.new', 'New tab')
  return (
    // Why: this strip replaces the stacked titlebar on the SFTP page, so its empty space drags the window.
    <div
      className="flex h-9 shrink-0 items-center border-b border-border bg-card"
      data-terminal-focus-release-surface="true"
    >
      {leadingControl ? (
        <div className="flex shrink-0 items-center pl-1 [-webkit-app-region:no-drag]">
          {leadingControl}
        </div>
      ) : null}
      <div
        role="tablist"
        aria-label={translate('sftpPage.tabs.label', 'SFTP tabs')}
        className="scrollbar-sleek flex h-full min-w-0 flex-[0_1_auto] items-stretch overflow-x-auto overflow-y-hidden [-webkit-app-region:no-drag]"
      >
        {tabs.map((tab) => (
          <SftpTabItem
            key={tab.id}
            tab={tab}
            folder={folderByTab?.[tab.id] ?? null}
            isActive={tab.id === activeTabId}
            description={describeTab(tab)}
            onActivate={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
            onNewTabOnHost={() => onNewTabOnHost(tab)}
          />
        ))}
      </div>
      <button
        type="button"
        title={newTabLabel}
        aria-label={newTabLabel}
        onClick={onNewTab}
        className="my-auto ml-2 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground [-webkit-app-region:no-drag]"
      >
        <Plus className="size-3.5" />
      </button>
      <div className="min-w-0 flex-1" />
      <div className="window-controls-titlebar-spacer" />
    </div>
  )
}
