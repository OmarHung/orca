import { useMemo, useRef, useState } from 'react'
import { FolderPlus, Search } from 'lucide-react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import { SftpNameDialog, type SftpNameRequest } from '../sftp-page/SftpNameDialog'
import { SshVpnButton } from '../ssh-vpn/SshVpnButton'
import { newSshHostGroupRequest } from './ssh-host-group-name-requests'
import { useSshHostGroups } from './ssh-host-groups-store'
import { buildSshHostTreeRows } from './ssh-host-tree'
import { SshHostGroupRow, SshHostRow, SshHostUngroupedRow } from './SshHostTreeRows'
import { useSshHostDrag } from './use-ssh-host-drag'

type SshHostListProps = {
  targets: readonly SshTarget[]
  currentTargetId?: string | null
  onSelect: (target: SshTarget) => void
  /** Extra right-click actions for a host row. */
  hostMenuItems?: (target: SshTarget) => React.ReactNode
  /** Buttons at the end of a host row, shown while it is hovered or focused. */
  hostRowActions?: (target: SshTarget) => React.ReactNode
  /** Hosts picked with ⌘/Ctrl, where the list can open several together. */
  selectedTargetIds?: ReadonlySet<string>
  onToggleSelected?: (target: SshTarget) => void
  onConnectGroup?: (groupId: string) => void
}

function NewGroupButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  const label = translate('sshPage.groups.newGroupButton', 'New group')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label={label}
          data-ssh-new-group
          onClick={onClick}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function SshHostList({
  targets,
  currentTargetId,
  onSelect,
  hostMenuItems,
  hostRowActions,
  selectedTargetIds,
  onToggleSelected,
  onConnectGroup
}: SshHostListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  // Why local: the page's list and the host picker's can both be mounted, so one dialog per list.
  const [nameRequest, setNameRequest] = useState<SftpNameRequest | null>(null)
  const groups = useSshHostGroups((state) => state.data)
  const rows = useMemo(() => buildSshHostTreeRows(targets, groups, query), [targets, groups, query])
  const listRef = useRef<HTMLDivElement>(null)
  const { drop, handlers } = useSshHostDrag(rows, listRef)
  const isSearching = query.trim() !== ''
  const hasHostRows = rows.some((row) => row.kind === 'host')
  const searchLabel = translate('sshPage.hostList.search', 'Search hosts')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            variant="search"
          />
        </div>
        <NewGroupButton onClick={() => setNameRequest(newSshHostGroupRequest(null))} />
        <SshVpnButton />
      </div>
      <div
        ref={listRef}
        {...handlers}
        data-ssh-host-tree
        className={cn(
          'scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2',
          drop && drop.indicatorKey === null && 'ring-1 ring-inset ring-ring'
        )}
      >
        {isSearching && !hasHostRows ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {translate('sshPage.hostList.noMatches', 'No hosts match your search.')}
          </p>
        ) : (
          rows.map((row) => {
            if (row.kind === 'group') {
              return (
                <SshHostGroupRow
                  key={row.key}
                  row={row}
                  drop={drop}
                  isSearching={isSearching}
                  onAskName={setNameRequest}
                  onConnectGroup={onConnectGroup}
                />
              )
            }
            if (row.kind === 'ungrouped') {
              return (
                <SshHostUngroupedRow
                  key={row.key}
                  row={row}
                  drop={drop}
                  isSearching={isSearching}
                />
              )
            }
            return (
              <SshHostRow
                key={row.key}
                row={row}
                isCurrent={row.target.id === currentTargetId}
                isSelected={selectedTargetIds?.has(row.target.id) === true}
                onSelect={onSelect}
                onToggleSelected={onToggleSelected}
                menuItems={hostMenuItems?.(row.target)}
                rowActions={hostRowActions?.(row.target)}
                onAskName={setNameRequest}
              />
            )
          })
        )}
      </div>
      <SftpNameDialog request={nameRequest} onClose={() => setNameRequest(null)} />
    </div>
  )
}
