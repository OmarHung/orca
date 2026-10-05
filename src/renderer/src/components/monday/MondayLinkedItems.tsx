import type React from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { MondayItemRelation, MondayLinkedItem } from '../../../../shared/monday/monday-types'
import { MondayColumnValue } from './MondayColumnValue'

function LinkedItemCard({ item }: { item: MondayLinkedItem }): React.JSX.Element {
  const openLabel = translate('monday.detail.openInMonday', 'Open in monday')
  return (
    <article className="rounded-lg border border-border bg-card" data-testid="monday-linked-item">
      <header className="flex items-start gap-1 border-b border-border py-1.5 pl-3 pr-1.5">
        <div className="min-w-0 flex-1 py-1">
          <div className="break-words text-sm font-semibold">{item.name}</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={openLabel}
              onClick={() => void window.api.shell.openUrl(item.url)}
            >
              <ExternalLink />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {openLabel}
          </TooltipContent>
        </Tooltip>
      </header>
      {item.columns.length > 0 ? (
        <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 p-3 text-xs">
          {item.columns.map((column) => (
            <div key={column.id} className="contents">
              <dt className="break-words text-muted-foreground">{column.title}</dt>
              <dd className="min-w-0">
                <MondayColumnValue column={column} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}

/** Items the task links to through connect-boards columns, e.g. its Web CRM record. */
export function MondayLinkedItems({
  relations
}: {
  relations: MondayItemRelation[]
}): React.JSX.Element | null {
  if (relations.length === 0) {
    return null
  }
  return (
    <>
      {relations.map((relation) => (
        <section key={relation.columnId} data-testid="monday-relation">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {relation.title}
          </h3>
          <div className="space-y-2">
            {relation.items.map((item) => (
              <LinkedItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
