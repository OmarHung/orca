import React from 'react'
import { ExternalLink, Loader2, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { MondayBoardSchedule, MondayItemDetail } from '../../../../shared/monday/monday-types'
import type { MondayCalendarEntry } from './monday-calendar-model'
import { daysBetween, formatMondayDay } from './monday-date-format'
import { loadMondayItemDetail, selectMondayItem } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { mondayErrorMessage } from './monday-error-message'
import { mondayScheduleWarnings } from './MondayItemHoverSummary'
import { MondayColumnValue } from './MondayColumnValue'
import { MondayItemUpdates } from './MondayItemUpdates'
import { MondayLinkedItems } from './MondayLinkedItems'
import { MondayDueFlag, MondayLabelBadge, mondayDueNeedsAttention } from './MondayScheduleVisuals'

export const MONDAY_DETAIL_PANEL_WIDTH = 440

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  )
}

function FieldRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/** Which columns the bar came from, when it is not simply the timeline column. */
function spanSourceLabel(
  entry: MondayCalendarEntry,
  board: MondayBoardSchedule | null
): string | null {
  const titles = board?.roleTitles ?? {}
  const start = titles.startDateColumnId
  if (entry.schedule.spanSource === 'start-due' && start) {
    return `${start} → ${titles.dueDateColumnId ?? ''}`
  }
  return entry.schedule.spanSource === 'start' ? (start ?? null) : null
}

function ScheduleFields(props: {
  entry: MondayCalendarEntry
  board: MondayBoardSchedule | null
  today: string
}): React.JSX.Element {
  const { entry, board, today } = props
  const { schedule, item } = entry
  const warnings = mondayScheduleWarnings(entry, today)
  return (
    <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs">
      <FieldRow label={translate('monday.detail.timeline', 'Timeline')}>
        {schedule.span ? (
          <div>
            <div>
              {formatMondayDay(schedule.span.from)} → {formatMondayDay(schedule.span.to)}
              <span className="text-muted-foreground">
                {' · '}
                {translate('monday.detail.days', '{{value0}} day(s)', {
                  value0: daysBetween(schedule.span.from, schedule.span.to) + 1
                })}
              </span>
            </div>
            {spanSourceLabel(entry, board) ? (
              <div className="text-[11px] text-muted-foreground">
                {spanSourceLabel(entry, board)}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">{translate('monday.detail.none', 'None')}</span>
        )}
      </FieldRow>
      <FieldRow label={translate('monday.detail.due', 'Due date')}>
        {schedule.due ? (
          <span className="inline-flex items-center gap-1.5">
            <MondayDueFlag attention={mondayDueNeedsAttention(schedule)} />
            {formatMondayDay(schedule.due)}
          </span>
        ) : (
          <span className="text-muted-foreground">{translate('monday.detail.none', 'None')}</span>
        )}
        {warnings.map((warning) => (
          <div key={warning} className="mt-1 font-medium text-destructive">
            {warning}
          </div>
        ))}
      </FieldRow>
      {item.status ? (
        <FieldRow label={translate('monday.detail.status', 'Status')}>
          <MondayLabelBadge label={item.status} />
        </FieldRow>
      ) : null}
      {item.priority ? (
        <FieldRow label={translate('monday.detail.priority', 'Priority')}>
          <MondayLabelBadge label={item.priority} />
        </FieldRow>
      ) : null}
      {item.peopleText ? (
        <FieldRow label={translate('monday.detail.people', 'People')}>{item.peopleText}</FieldRow>
      ) : null}
    </dl>
  )
}

function ItemActivity({
  detail,
  board
}: {
  detail: MondayItemDetail
  board: MondayBoardSchedule | null
}): React.JSX.Element {
  const shown = new Set(Object.values(board?.roles ?? {}))
  const otherColumns = detail.columns.filter((column) => !shown.has(column.id))
  return (
    <>
      <MondayLinkedItems relations={detail.relations} />
      {otherColumns.length > 0 ? (
        <section>
          <SectionTitle>{translate('monday.detail.otherColumns', 'Other columns')}</SectionTitle>
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs">
            {otherColumns.map((column) => (
              <FieldRow key={column.id} label={column.title}>
                <MondayColumnValue column={column} />
              </FieldRow>
            ))}
          </dl>
        </section>
      ) : null}
      {detail.descriptionText ? (
        <section>
          <SectionTitle>{translate('monday.detail.description', 'Description')}</SectionTitle>
          <p className="whitespace-pre-wrap break-words text-sm">{detail.descriptionText}</p>
        </section>
      ) : null}
      {detail.subitems.length > 0 ? (
        <section>
          <SectionTitle>
            {translate('monday.detail.subitems', 'Subitems ({{value0}})', {
              value0: detail.subitems.length
            })}
          </SectionTitle>
          <ul className="space-y-1 text-sm">
            {detail.subitems.map((subitem) => (
              <li key={subitem.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{subitem.name}</span>
                {subitem.statusText ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {subitem.statusText}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <SectionTitle>
          {translate('monday.detail.updates', 'Updates ({{value0}})', {
            value0: detail.updates.length
          })}
        </SectionTitle>
        <MondayItemUpdates updates={detail.updates} />
      </section>
    </>
  )
}

function DetailBody({
  itemId,
  board
}: {
  itemId: string
  board: MondayBoardSchedule | null
}): React.JSX.Element {
  const state = useMondayPageStore((store) => store.details[itemId])
  if (!state || state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {translate('monday.detail.loading', 'Loading updates…')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">{mondayErrorMessage(state.error)}</p>
        <Button variant="outline" size="xs" onClick={() => void loadMondayItemDetail(itemId)}>
          <RotateCw className="size-3" />
          {translate('monday.action.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  return <ItemActivity detail={state.detail} board={board} />
}

function IconAction(props: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={props.label} onClick={props.onClick}>
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  )
}

export function MondayItemDetailPanel(props: {
  itemId: string
  entry: MondayCalendarEntry | null
  board: MondayBoardSchedule | null
  today: string
}): React.JSX.Element {
  const { itemId, entry, board, today } = props
  const detail = useMondayPageStore((store) => {
    const state = store.details[itemId]
    return state?.status === 'ready' ? state.detail : null
  })
  const name = entry?.item.name ?? detail?.name ?? ''
  const url = entry?.item.url ?? detail?.url ?? ''
  const groupTitle = entry?.item.groupTitle ?? detail?.groupTitle ?? ''
  const groupColor = entry?.item.groupColor ?? detail?.groupColor ?? null
  return (
    <aside
      className="flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width: MONDAY_DETAIL_PANEL_WIDTH }}
      data-testid="monday-detail-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          selectMondayItem(null)
        }
      }}
    >
      <header className="flex items-start gap-1 border-b border-border py-2.5 pl-4 pr-2">
        <div className="min-w-0 flex-1 space-y-1 pt-1">
          <h2 className="break-words text-sm font-semibold leading-snug">{name}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {groupColor ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: groupColor }}
              />
            ) : null}
            <span className="truncate">
              {entry?.boardName ?? detail?.boardName}
              {groupTitle ? ` · ${groupTitle}` : ''}
            </span>
          </div>
        </div>
        {url ? (
          <IconAction
            label={translate('monday.detail.openInMonday', 'Open in monday')}
            onClick={() => void window.api.shell.openUrl(url)}
          >
            <ExternalLink />
          </IconAction>
        ) : null}
        <IconAction
          label={translate('monday.detail.close', 'Close')}
          onClick={() => selectMondayItem(null)}
        >
          <X />
        </IconAction>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        {entry ? (
          <section>
            <ScheduleFields entry={entry} board={board} today={today} />
          </section>
        ) : null}
        <DetailBody itemId={itemId} board={board} />
      </div>
    </aside>
  )
}
