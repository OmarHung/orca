import { isWebClientLocation } from '@/lib/web-client-location'

type RemoteHostsPageFrameProps = {
  desktopOnlyMessage: string
  children: React.ReactNode
}

/** Page shell shared by the SSH and SFTP pages. No header: the sidebar entry names the page. */
export function RemoteHostsPageFrame({
  desktopOnlyMessage,
  children
}: RemoteHostsPageFrameProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
