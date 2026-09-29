import type { LucideIcon } from 'lucide-react'
import { isWebClientLocation } from '@/lib/web-client-location'

type RemoteHostsPageFrameProps = {
  icon: LucideIcon
  title: string
  description: string
  desktopOnlyMessage: string
  children: React.ReactNode
}

/** Header and desktop-only guard shared by the SSH and SFTP pages. */
export function RemoteHostsPageFrame({
  icon: Icon,
  title,
  description,
  desktopOnlyMessage,
  children
}: RemoteHostsPageFrameProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {isWebClientLocation() ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {desktopOnlyMessage}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
