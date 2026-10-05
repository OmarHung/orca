import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { MondayUpdate, MondayUpdateReply } from '../../../../shared/monday/monday-types'
import { formatMondayTimestamp } from './monday-date-format'
import { mondayLinkFromClick, sanitizeMondayHtml } from './monday-update-html'

// monday's own label palette, so a person keeps one color across every update thread.
const PERSON_COLORS = [
  '#579bfc',
  '#00c875',
  '#fdab3d',
  '#e2445c',
  '#a25ddc',
  '#037f4c',
  '#ff642e',
  '#66ccff',
  '#bb3354',
  '#9aadbd'
]

function personColor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003
  }
  return PERSON_COLORS[hash % PERSON_COLORS.length]
}

function PersonAvatar({ name, small }: { name: string; small: boolean }): React.JSX.Element {
  const color = personColor(name)
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-foreground',
        small ? 'size-6 text-[11px]' : 'size-7 text-xs'
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 35%, var(--background))`,
        boxShadow: `inset 0 0 0 1px ${color}`
      }}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

function openClickedLink(event: React.MouseEvent): void {
  const href = mondayLinkFromClick(event.target)
  if (href) {
    event.preventDefault()
    void window.api.shell.openUrl(href)
  }
}

function UpdateBody({ html }: { html: string }): React.JSX.Element {
  const safe = useMemo(
    () => sanitizeMondayHtml(html, translate('monday.detail.imageLink', '[Image]')),
    [html]
  )
  return (
    // Why onClick here: links inside keep their own keyboard activation; this reroutes them to the system browser.
    <div
      onClick={openClickedLink}
      className="break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

function UpdateEntry({
  update,
  reply
}: {
  update: MondayUpdateReply
  reply: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn('flex gap-2.5', reply ? 'px-3 py-2.5' : 'p-3')}
      data-testid="monday-update-entry"
    >
      <PersonAvatar name={update.creatorName} small={reply} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-foreground">{update.creatorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatMondayTimestamp(update.createdAt)}
          </span>
        </div>
        <UpdateBody html={update.bodyHtml} />
      </div>
    </div>
  )
}

export function MondayItemUpdates({ updates }: { updates: MondayUpdate[] }): React.JSX.Element {
  if (updates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('monday.detail.noUpdates', 'No updates yet.')}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {updates.map((update) => (
        <article
          key={update.id}
          className="overflow-hidden rounded-lg border border-border bg-card"
          data-testid="monday-update"
        >
          <UpdateEntry update={update} reply={false} />
          {update.replies.length > 0 ? (
            <div className="border-t border-border bg-muted/40">
              <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {translate('monday.detail.replies', 'Replies ({{value0}})', {
                  value0: update.replies.length
                })}
              </div>
              <div className="divide-y divide-border">
                {update.replies.map((reply) => (
                  <UpdateEntry key={reply.id} update={reply} reply />
                ))}
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
