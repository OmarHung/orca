import { useEffect, useState } from 'react'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLocalImageSrc } from '@/components/editor/useLocalImageSrc'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { cn } from '@/lib/utils'
import {
  useTerminalImagePreviewStore,
  type TerminalImagePreviewRequest
} from '@/store/terminal-image-preview'
import { listTerminalImagePastes, type TerminalImagePaste } from './terminal-image-paste-history'
import {
  resolveTerminalImagePreview,
  type TerminalImagePreviewResolution
} from './terminal-image-preview-resolution'

function imageMarkerLabel(pasteId: number): string {
  return translate('components.terminalPane.imagePreview.title', '[Image #{{pasteId}}]', {
    pasteId
  })
}

// Local lookups finish well under this; only slow (WSL, large transcript) reads show a spinner.
const LOADING_INDICATOR_DELAY_MS = 200

/** Full-size preview of the image behind a terminal `[Image #N]` chip. */
export function TerminalImagePreviewDialog(): React.JSX.Element {
  const request = useTerminalImagePreviewStore((state) => state.request)
  const close = useTerminalImagePreviewStore((state) => state.closeTerminalImagePreview)
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-[90vw] sm:max-w-4xl">
        <DialogTitle>{request ? imageMarkerLabel(request.pasteId) : ''}</DialogTitle>
        <DialogDescription className="sr-only">
          {translate('components.native-chat.composer.imagePreview', 'Full-size image preview')}
        </DialogDescription>
        {request ? <TerminalImagePreviewBody request={request} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function TerminalImagePreviewBody({
  request
}: {
  request: TerminalImagePreviewRequest
}): React.JSX.Element {
  const [resolution, setResolution] = useState<TerminalImagePreviewResolution | null>(null)
  const [chosenPaste, setChosenPaste] = useState<TerminalImagePaste | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    setResolution(null)
    setChosenPaste(null)
    setShowLoading(false)
    const timer = window.setTimeout(() => setShowLoading(true), LOADING_INDICATOR_DELAY_MS)
    void resolveTerminalImagePreview(request, {
      findClaudePastedImage: window.api.nativeChat.findClaudePastedImage,
      listPastes: listTerminalImagePastes
    }).then((next) => {
      if (!cancelled) {
        setResolution(next)
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [request])

  if (!resolution) {
    return (
      <PreviewFrame>
        {showLoading ? (
          <PreviewNotice icon="loading">
            {translate('components.terminalPane.imagePreview.loading', 'Loading image…')}
          </PreviewNotice>
        ) : null}
      </PreviewFrame>
    )
  }
  if (resolution.kind === 'submitted') {
    return (
      <PreviewFrame>
        <img
          src={resolution.src}
          alt={imageMarkerLabel(request.pasteId)}
          className="max-h-[60vh] max-w-full object-contain"
        />
      </PreviewFrame>
    )
  }
  const shownPaste = chosenPaste ?? (resolution.kind === 'unsubmitted' ? resolution.paste : null)
  return (
    <>
      <PreviewFrame>
        {shownPaste ? (
          <PastedImage paste={shownPaste} />
        ) : (
          <PreviewNotice icon="image">
            {translate(
              'components.terminalPane.imagePreview.notFound',
              'Couldn’t find this image. Pick it from the images pasted into this terminal.'
            )}
          </PreviewNotice>
        )}
      </PreviewFrame>
      <PreviewCaption resolution={resolution} isChosen={chosenPaste !== null} />
      <PasteChooser
        candidates={resolution.candidates}
        selected={shownPaste}
        onSelect={setChosenPaste}
      />
    </>
  )
}

function PreviewFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex max-h-[65vh] min-h-48 items-center justify-center overflow-auto rounded-md bg-muted/20 p-2">
      {children}
    </div>
  )
}

function PreviewNotice({
  icon,
  children
}: {
  icon: 'loading' | 'image'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
      {icon === 'loading' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ImageIcon className="size-4" />
      )}
      {children}
    </div>
  )
}

function PreviewCaption({
  resolution,
  isChosen
}: {
  resolution: Exclude<TerminalImagePreviewResolution, { kind: 'submitted' }>
  isChosen: boolean
}): React.JSX.Element | null {
  if (resolution.kind === 'unsubmitted' && !isChosen) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'components.terminalPane.imagePreview.unsubmittedHint',
          'Not sent yet — matched by paste order. If it’s the wrong image, pick another below.'
        )}
      </p>
    )
  }
  if (resolution.kind === 'unresolved' && resolution.detail) {
    return <p className="text-xs text-muted-foreground">{resolution.detail}</p>
  }
  return null
}

function PastedImage({ paste }: { paste: TerminalImagePaste }): React.JSX.Element {
  const src = useLocalImageSrc(paste.path, paste.path, paste.connectionId)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || src === failedSrc) {
    return (
      <PreviewNotice icon="image">
        {translate(
          'components.native-chat.composer.imagePreviewUnavailable',
          'Preview unavailable'
        )}
      </PreviewNotice>
    )
  }
  return (
    <img
      src={src}
      alt={basename(paste.path)}
      onError={() => setFailedSrc(src)}
      className="max-h-[60vh] max-w-full object-contain"
    />
  )
}

function PasteChooser({
  candidates,
  selected,
  onSelect
}: {
  candidates: readonly TerminalImagePaste[]
  selected: TerminalImagePaste | null
  onSelect: (paste: TerminalImagePaste) => void
}): React.JSX.Element | null {
  if (candidates.length === 0 || (candidates.length === 1 && candidates[0] === selected)) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.toReversed().map((paste) => (
        <PasteThumbnail
          key={`${paste.pastedAt}-${paste.path}`}
          paste={paste}
          isSelected={paste === selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function PasteThumbnail({
  paste,
  isSelected,
  onSelect
}: {
  paste: TerminalImagePaste
  isSelected: boolean
  onSelect: (paste: TerminalImagePaste) => void
}): React.JSX.Element {
  const src = useLocalImageSrc(paste.path, paste.path, paste.connectionId)
  const label = basename(paste.path)
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={`${translate('components.native-chat.composer.viewAttachment', 'View image')}: ${label}`}
      title={label}
      onClick={() => onSelect(paste)}
      className={cn(
        'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'border-ring'
      )}
    >
      {src ? (
        <img src={src} alt={label} className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-5 text-muted-foreground" />
      )}
    </button>
  )
}
