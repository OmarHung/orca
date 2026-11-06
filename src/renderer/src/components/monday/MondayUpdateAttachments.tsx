import React, { useState } from 'react'
import { FileText } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { ExpandableMarkdownImage } from '@/components/sidebar/MarkdownImageLightbox'
import { formatBytes } from '../../../../shared/format-bytes'
import type { MondayAsset } from '../../../../shared/monday/monday-types'
import { openMondayLink } from './monday-browser-actions'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])
// Chromium plays H.264 .mov files, which is what macOS screen recordings produce.
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm'])

export type MondayAssetKind = 'image' | 'video' | 'file'

export function mondayAssetKind(asset: MondayAsset): MondayAssetKind {
  if (IMAGE_EXTENSIONS.has(asset.extension)) {
    return 'image'
  }
  return VIDEO_EXTENSIONS.has(asset.extension) ? 'video' : 'file'
}

function FileRow({ asset }: { asset: MondayAsset }): React.JSX.Element {
  // monday's own address opens with the browser's monday login; the public one only downloads.
  const href = asset.url || asset.publicUrl
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-accent"
      onClick={(event) => openMondayLink(href, { systemBrowser: event.shiftKey })}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{asset.name}</span>
      {asset.sizeBytes > 0 ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatBytes(asset.sizeBytes)}
        </span>
      ) : null}
    </button>
  )
}

/** Its public address expires an hour after the read; a failed load falls back to a file row. */
function MediaAsset({ asset }: { asset: MondayAsset }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <FileRow asset={asset} />
  }
  if (mondayAssetKind(asset) === 'video') {
    return (
      <figure className="space-y-1">
        <video
          controls
          preload="metadata"
          src={asset.publicUrl}
          onError={() => setFailed(true)}
          className="max-h-72 w-full rounded-md border border-border bg-black"
          data-testid="monday-update-video"
        />
        <figcaption className="truncate text-[11px] text-muted-foreground">{asset.name}</figcaption>
      </figure>
    )
  }
  return (
    <ExpandableMarkdownImage
      src={asset.publicUrl}
      alt={asset.name}
      onError={() => setFailed(true)}
      triggerClassName="my-0 w-full overflow-hidden rounded-md border border-border"
      className="h-28 w-full object-cover"
    />
  )
}

/** Files attached to an update: images and videos inline, anything else as a link. */
export function MondayUpdateAttachments({
  assets
}: {
  assets: readonly MondayAsset[]
}): React.JSX.Element | null {
  if (assets.length === 0) {
    return null
  }
  const images = assets.filter((asset) => mondayAssetKind(asset) === 'image')
  const videos = assets.filter((asset) => mondayAssetKind(asset) === 'video')
  const files = assets.filter((asset) => mondayAssetKind(asset) === 'file')
  return (
    <div
      className="mt-2 space-y-2"
      aria-label={translate('monday.detail.attachments', 'Attachments')}
    >
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.map((asset) => (
            <MediaAsset key={asset.id} asset={asset} />
          ))}
        </div>
      ) : null}
      {videos.map((asset) => (
        <MediaAsset key={asset.id} asset={asset} />
      ))}
      {files.map((asset) => (
        <FileRow key={asset.id} asset={asset} />
      ))}
    </div>
  )
}
