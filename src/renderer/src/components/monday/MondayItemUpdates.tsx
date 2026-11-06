import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PanZoomImageDialog } from '@/components/editor/PanZoomImageDialog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { MondayUpdate, MondayUpdateReply } from '../../../../shared/monday/monday-types'
import { openMondayLink } from './monday-browser-actions'
import { formatMondayTimestamp } from './monday-date-format'
import {
  mondayInlineImageAssetIds,
  mondayLinkFromClick,
  sanitizeMondayHtml
} from './monday-update-html'
import { mondayAssetKind, MondayUpdateAttachments } from './MondayUpdateAttachments'

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
    openMondayLink(href, { systemBrowser: event.shiftKey })
  }
}

function UpdateBody({ update }: { update: MondayUpdateReply }): React.JSX.Element {
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { safe, attachments } = useMemo(() => {
    const imageUrls = new Map(
      update.assets
        .filter((asset) => mondayAssetKind(asset) === 'image')
        .map((asset) => [asset.id, asset.publicUrl])
    )
    const inline = mondayInlineImageAssetIds(update.bodyHtml, imageUrls)
    return {
      safe: sanitizeMondayHtml(
        update.bodyHtml,
        translate('monday.detail.imageLink', '[Image]'),
        imageUrls
      ),
      attachments: update.assets.filter((asset) => !inline.has(asset.id))
    }
  }, [update.bodyHtml, update.assets])

  // Why a capture listener: load errors don't bubble, and these images come from injected HTML.
  // Why a layout effect: it is attached before the images can start, so no error slips past.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) {
      return
    }
    const onImageError = (event: Event): void => {
      const image = event.target
      if (!(image instanceof HTMLImageElement)) {
        return
      }
      // An expired public address falls back to monday's own link, as an image without one would.
      const asset = update.assets.find((entry) => entry.publicUrl === image.getAttribute('src'))
      const link = document.createElement('a')
      link.setAttribute('href', asset?.url ?? '')
      link.textContent = translate('monday.detail.imageLink', '[Image]')
      image.replaceWith(link)
    }
    body.addEventListener('error', onImageError, true)
    return () => body.removeEventListener('error', onImageError, true)
  }, [update.assets, safe])

  const onBodyClick = (event: React.MouseEvent): void => {
    const target = event.target
    if (target instanceof HTMLImageElement && target.src) {
      setZoomed({ src: target.src, alt: target.alt })
      return
    }
    openClickedLink(event)
  }

  return (
    <>
      {/* Why onClick here: links inside keep their own keyboard activation; this reroutes them to the system browser. */}
      <div
        ref={bodyRef}
        onClick={onBodyClick}
        className="break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_img]:my-1 [&_img]:max-h-72 [&_img]:cursor-zoom-in [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      <MondayUpdateAttachments assets={attachments} />
      <PanZoomImageDialog
        open={zoomed !== null}
        onOpenChange={(open) => !open && setZoomed(null)}
        src={zoomed?.src}
        title={zoomed?.alt || translate('monday.detail.image', 'Image')}
      />
    </>
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
        <UpdateBody update={update} />
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
