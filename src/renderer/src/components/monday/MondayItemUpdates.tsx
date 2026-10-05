import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import type { MondayUpdate, MondayUpdateReply } from '../../../../shared/monday/monday-types'
import { formatMondayTimestamp } from './monday-date-format'
import { mondayLinkFromClick, sanitizeMondayHtml } from './monday-update-html'

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
      className="break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

function UpdateMeta({ update }: { update: MondayUpdateReply }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-medium text-foreground">{update.creatorName}</span>
      <span className="text-muted-foreground">{formatMondayTimestamp(update.createdAt)}</span>
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
          className="space-y-1.5 rounded-lg border border-border bg-card p-3"
          data-testid="monday-update"
        >
          <UpdateMeta update={update} />
          <UpdateBody html={update.bodyHtml} />
          {update.replies.length > 0 ? (
            <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
              {update.replies.map((reply) => (
                <div key={reply.id} className="space-y-1">
                  <UpdateMeta update={reply} />
                  <UpdateBody html={reply.bodyHtml} />
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
