import { Fragment, useState } from 'react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'
import { filterSshTargetsBySearchQuery } from './ssh-target-search'

type SshTargetListProps = {
  targets: readonly SshTarget[]
  renderTarget: (target: SshTarget) => React.ReactNode
}

export function SshTargetList({ targets, renderTarget }: SshTargetListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const visibleTargets = filterSshTargetsBySearchQuery(targets, query)
  const searchLabel = translate(
    'auto.components.settings.SshTargetList.searchLabel',
    'Search targets'
  )

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
      />
      {visibleTargets.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-5 text-sm text-muted-foreground">
          {translate(
            'auto.components.settings.SshTargetList.noMatches',
            'No SSH targets match your search.'
          )}
        </div>
      ) : (
        visibleTargets.map((target) => <Fragment key={target.id}>{renderTarget(target)}</Fragment>)
      )}
    </div>
  )
}
