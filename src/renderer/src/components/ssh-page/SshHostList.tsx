import { useState } from 'react'
import { Search } from 'lucide-react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'
import {
  filterSshTargetsBySearchQuery,
  formatSshTargetEndpoint
} from '../settings/ssh-target-search'
import { SshVpnButton } from '../ssh-vpn/SshVpnButton'
import { SshHostVpnBadge, SshHostVpnMenu } from '../ssh-vpn/SshHostVpnMenu'

type SshHostListProps = {
  targets: readonly SshTarget[]
  currentTargetId?: string | null
  onSelect: (target: SshTarget) => void
  /** Extra right-click actions for a host row. */
  hostMenuItems?: (target: SshTarget) => React.ReactNode
}

export function SshHostList({
  targets,
  currentTargetId,
  onSelect,
  hostMenuItems
}: SshHostListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const visibleTargets = filterSshTargetsBySearchQuery(targets, query)
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
        <SshVpnButton />
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visibleTargets.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {translate('sshPage.hostList.noMatches', 'No hosts match your search.')}
          </p>
        ) : (
          visibleTargets.map((target) => {
            const isCurrent = target.id === currentTargetId
            return (
              <SshHostVpnMenu
                key={target.id}
                targetId={target.id}
                leadingItems={hostMenuItems?.(target)}
              >
                <button
                  type="button"
                  data-ssh-host-row={target.id}
                  data-current={isCurrent ? 'true' : undefined}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => onSelect(target)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent data-[current=true]:bg-accent"
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {target.label}
                    </span>
                    <SshHostVpnBadge targetId={target.id} />
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {formatSshTargetEndpoint(target)}
                  </span>
                </button>
              </SshHostVpnMenu>
            )
          })
        )}
      </div>
    </div>
  )
}
