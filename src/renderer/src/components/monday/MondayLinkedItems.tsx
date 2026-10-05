import React, { useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
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

function OpenInMonday({ url }: { url: string }): React.JSX.Element {
  const label = translate('monday.detail.openInMonday', 'Open in monday')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={() => void window.api.shell.openUrl(url)}
        >
          <ExternalLink />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One linked item as a row of the panel's field grid: name and website beside the column title,
 * the remaining columns in a full-width box under it when expanded.
 */
function LinkedItemRow({
  item,
  label
}: {
  item: MondayLinkedItem
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const website = websiteColumn(item.columns)
  const details = item.columns.filter((column) => column !== website)
  return (
    // Why `contents`: dt, dd and the details box stay cells of the surrounding field grid.
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="contents"
      data-testid="monday-linked-item"
    >
      <dt className="pt-0.5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <div className="flex items-start gap-1">
          <CollapsibleTrigger asChild disabled={details.length === 0}>
            <button
              type="button"
              className="flex min-w-0 items-start gap-1 rounded-sm py-0.5 text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:hover:no-underline"
            >
              <span className="break-words">{item.name}</span>
              {details.length > 0 ? (
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                    open && 'rotate-180'
                  )}
                />
              ) : null}
            </button>
          </CollapsibleTrigger>
          <span className="flex-1" />
          <OpenInMonday url={item.url} />
        </div>
        {website ? <MondayColumnValue column={website} /> : null}
      </dd>
      <CollapsibleContent className="col-span-2">
        <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-3">
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
    </Collapsible>
  )
}

/** Rows for the items the task links to (e.g. its Web CRM record), inside the field grid. */
export function MondayLinkedItemRows({
  relations
}: {
  relations: MondayItemRelation[]
}): React.JSX.Element {
  return (
    <>
      {relations.flatMap((relation) =>
        relation.items.map((item, index) => (
          <LinkedItemRow
            key={`${relation.columnId}:${item.id}`}
            item={item}
            label={index === 0 ? relation.title : ''}
          />
        ))
      )}
    </>
  )
}
