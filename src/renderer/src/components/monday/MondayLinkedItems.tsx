import React, { useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  MondayItemColumnValue,
  MondayItemRelation,
  MondayLinkedItem
} from '../../../../shared/monday/monday-types'
import { isMondayWebAddress, MondayColumnValue } from './MondayColumnValue'

const WEBSITE_TITLE = /website|網站|网站|網址|网址|官網|官网|url/i

/** The web address shown without expanding: a Website-titled link column, else the first link. */
function websiteColumn(columns: MondayItemColumnValue[]): MondayItemColumnValue | undefined {
  const links = columns.filter((column) => !column.color && isMondayWebAddress(column.text))
  return links.find((column) => WEBSITE_TITLE.test(column.title)) ?? links[0]
}

function LinkedItemCard({ item }: { item: MondayLinkedItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const openLabel = translate('monday.detail.openInMonday', 'Open in monday')
  const website = websiteColumn(item.columns)
  const details = item.columns.filter((column) => column !== website)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article className="rounded-lg border border-border bg-card" data-testid="monday-linked-item">
        <div className="flex items-start gap-1 p-1.5">
          <CollapsibleTrigger asChild disabled={details.length === 0}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                  open && 'rotate-90',
                  details.length === 0 && 'invisible'
                )}
              />
              <span className="break-words text-sm font-semibold">{item.name}</span>
            </button>
          </CollapsibleTrigger>
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
        </div>
        {website ? (
          <div className="pb-2.5 pl-8 pr-3 text-xs">
            <MondayColumnValue column={website} />
          </div>
        ) : null}
        <CollapsibleContent>
          <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 border-t border-border p-3 text-xs">
            {details.map((column) => (
              <div key={column.id} className="contents">
                <dt className="break-words text-muted-foreground">{column.title}</dt>
                <dd className="min-w-0">
                  <MondayColumnValue column={column} />
                </dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </article>
    </Collapsible>
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
